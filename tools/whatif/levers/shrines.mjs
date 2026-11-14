// The guild shrine lever of the what-if optimizer: one combat shrine buff of one player raised by a jump. Candidates in the
// optimizer's shape ({ id, kind, groups, player, monotone, desc, ops, cost: { cost, known, path, note, split } }), like houses.mjs.
//
// - Levels: guildBuffDetailMap.json, the combat buffs (isCombat). The level now is the setup's, read as the import reads it
//   (guildLevels, src/guildLevels.mjs). The guild's shrine level caps every buff: `cap` (--shrine-cap, empty = the game's
//   maximum), never above the buff's own top level.
// - Jumps: `steps` (--shrine-steps, a list, default 1,2,3,cap): each entry is a number of levels or `cap` (straight to the cap); a jump
//   past the cap is not offered, and two entries reaching the same level give one candidate. The rows of one buff are alternatives
//   (one group).
// - All five: per player, one row "all five combat buffs +1" and one "all five up to the cap" (`allFive`), each the sum of its parts;
//   a buff that cannot move is left out, and the row is not offered when fewer than two buffs can move. It touches every buff group,
//   so after it is taken the single rows are rebuilt from the new levels. Only this lever has a combined row.
// - Cost in Coin, from the price snapshot the search uses (the pricer's +0 buy price): each level's Guild Credits (levelCosts
//   creditCosts) at the cheapest market item that converts into that credit (itemDetailMap.json guildCreditConversions: itemCount
//   items give creditCount credits), plus the level's own Guild Tokens (guildTokenCost, payable only in tokens) at the token's best
//   exchange value (the most Coin one token's credits would cost bought as market items, /items/guild_token guildCreditConversions).
//   The search does not know how many tokens the player holds.
// - The split on each row (`cost.split`): the tokens the levels require, the credits priced as market items (Coin), and the same
//   credits paid with left-over tokens instead (how many tokens), so a row answers when tokens pay.
import guildBuffDetailMap from '../../../src/combatsimulator/data/guildBuffDetailMap.json' with { type: 'json' };
import itemDetailMap from '../../../src/combatsimulator/data/itemDetailMap.json' with { type: 'json' };
import { guildLevels } from '../../../src/guildLevels.mjs';

const short = (h) => h.split('/').pop();
export const TOKEN = '/items/guild_token';
export const COMBAT_BUFFS = Object.values(guildBuffDetailMap).filter((b) => b.isCombat).sort((a, b) => a.sortIndex - b.sortIndex).map((b) => b.hrid);
export const buffMaxLevel = (buff) => Math.max(...Object.keys(guildBuffDetailMap[buff].levelCosts).map(Number));
const known = (hrid) => !!guildBuffDetailMap[hrid];
export const buffLevel = (setup, buff) => Number(guildLevels(setup, known)[buff] || 0);
const TOKEN_CONVERSIONS = Object.fromEntries((itemDetailMap[TOKEN]?.guildCreditConversions || []).map((c) => [c.creditItemHrid, c]));

// The cheapest market route to each credit: { [credit]: { coin, item } }, coin per credit. buy(hrid) -> the +0 ask, Infinity when no seller.
export function creditRoutes(buy) {
    const best = {};
    for (const it of Object.values(itemDetailMap)) {
        if (it.hrid === TOKEN || !it.guildCreditConversions) continue;
        const unit = buy(it.hrid);
        if (!Number.isFinite(unit)) continue;
        for (const c of it.guildCreditConversions) {
            const coin = (unit * c.itemCount) / c.creditCount;
            if (!best[c.creditItemHrid] || coin < best[c.creditItemHrid].coin) best[c.creditItemHrid] = { coin, item: it.hrid };
        }
    }
    return best;
}

// A token's best exchange: { coin, credit } (the credit whose market route its exchange saves the most Coin on), coin null with no route.
export function tokenValue(routes) {
    let out = { coin: null, credit: null };
    for (const [credit, c] of Object.entries(TOKEN_CONVERSIONS)) {
        if (!routes[credit]) continue;
        const coin = (routes[credit].coin * c.creditCount) / c.itemCount;
        if (out.coin === null || coin > out.coin) out = { coin, credit };
    }
    return out;
}

// Levels from+1..to of one buff: the cost, its note and its split.
export function shrineCost(buff, from, to, routes, token) {
    let tokens = 0;
    const credits = {};
    for (let L = from + 1; L <= to; L++) {
        const lc = guildBuffDetailMap[buff].levelCosts[String(L)];
        tokens += lc.guildTokenCost || 0;
        for (const { itemHrid, count } of lc.creditCosts || []) credits[itemHrid] = (credits[itemHrid] || 0) + count;
    }
    const missing = Object.keys(credits).filter((h) => !routes[h]);
    if (missing.length || (tokens > 0 && token.coin === null)) return { cost: Infinity, known: false, path: 'guild shrine', note: 'no seller: ' + (missing.length ? missing.map(short).join(', ') : 'any credit (the token has no value)') };
    let creditsCoin = 0, creditsTokens = 0;
    for (const [h, n] of Object.entries(credits)) {
        creditsCoin += n * routes[h].coin;
        const t = TOKEN_CONVERSIONS[h];
        creditsTokens += t ? Math.ceil((n * t.itemCount) / t.creditCount) : Infinity;
    }
    const tokenCoin = tokens * (token.coin ?? 0);
    return { cost: creditsCoin + tokenCoin, known: true, path: 'guild shrine', mirrors: 0, note: '', split: { tokens, tokenCoin, tokenValue: token.coin, creditsCoin, creditsTokens: Number.isFinite(creditsTokens) ? creditsTokens : null } };
}

// The jump list: numbers and `cap` (a string, or a list from a command line "1,2,cap").
export const DEFAULT_STEPS = [1, 2, 3, 'cap'];
export function parseSteps(v, def = DEFAULT_STEPS) {
    if (v === null || v === undefined || v === true || v === '') return def;
    const list = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean).map((x) => (x === 'cap' ? 'cap' : Number(x)));
    if (!list.length || list.some((x) => x !== 'cap' && !(Number.isInteger(x) && x >= 1))) throw new Error('--shrine-steps: whole numbers of 1 or more, or cap (e.g. 1,2,cap)');
    return list;
}
// The guild's shrine level: empty (null) = the game's maximum; else a whole number of 0 or more.
export function parseCap(v) {
    if (v === null || v === undefined || v === true || v === '') return null;
    const n = Number(v);
    if (!(Number.isInteger(n) && n >= 0)) throw new Error('--shrine-cap: the guild shrine level, a whole number of 0 or more (empty = the game\'s maximum)');
    return n;
}

// The sum of several costs (the all-five rows): one Coin figure and one split, unknown when any part is.
function sumCosts(parts) {
    const bad = parts.find((c) => !c.known);
    if (bad) return { ...bad };
    const add = (k) => parts.reduce((a, c) => (a === null || c.split[k] === null ? null : a + c.split[k]), 0);
    return { cost: parts.reduce((a, c) => a + c.cost, 0), known: true, path: 'guild shrine', mirrors: 0, note: '', split: { tokens: add('tokens'), tokenCoin: add('tokenCoin'), tokenValue: parts[0].split.tokenValue, creditsCoin: add('creditsCoin'), creditsTokens: add('creditsTokens') } };
}

const routeMemo = new WeakMap(); // pricer -> { routes, token }: one scan of the item table per price snapshot
export function shrineCands(setup, p, { pricer, cap = null, steps = DEFAULT_STEPS, allFive = true }) {
    if (!routeMemo.has(pricer)) { const routes = creditRoutes((h) => pricer.buy(h, 0).cost); routeMemo.set(pricer, { routes, token: tokenValue(routes) }); }
    const { routes, token } = routeMemo.get(pricer);
    const out = [], info = [];
    for (const buff of COMBAT_BUFFS) {
        const from = buffLevel(setup, buff), top = Math.min(buffMaxLevel(buff), cap ?? Infinity), slug = short(guildBuffDetailMap[buff].shrineHrid);
        info.push({ buff, from, top, slug });
        const tos = [...new Set(steps.map((d) => (d === 'cap' ? top : from + d)))].filter((to) => to > from && to <= top).sort((a, b) => a - b);
        for (const to of tos) {
            out.push({ id: `${p}:shrine:${slug}+${to - from}`, kind: 'shrine', groups: [`${p}:shrine:${slug}`], player: p, monotone: true, desc: `${p} ${slug} ${from} -> ${to}`, ops: [{ op: 'shrine', player: p, buff, delta: to - from }], cost: shrineCost(buff, from, to, routes, token) });
        }
    }
    if (allFive) {
        for (const [key, target] of [['+1', (b) => b.from + 1], ['cap', (b) => b.top]]) {
            const parts = info.map((b) => ({ ...b, to: target(b) })).filter((b) => b.to > b.from && b.to <= b.top);
            if (parts.length < 2) continue;
            out.push({ id: `${p}:shrine:all${key}`, kind: 'shrine', groups: info.map((b) => `${p}:shrine:${b.slug}`), player: p, monotone: true,
                desc: `${p} ${parts.map((b) => `${b.slug} ${b.from} -> ${b.to}`).join(', ')}`, ops: parts.map((b) => ({ op: 'shrine', player: p, buff: b.buff, delta: b.to - b.from })),
                cost: sumCosts(parts.map((b) => shrineCost(b.buff, b.from, b.to, routes, token))) });
        }
    }
    return out;
}
