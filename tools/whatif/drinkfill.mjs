// Drink filling for the what-if search (Stage D): the drinks are decided as whole fillings, like the foods (foodfill.mjs),
// before the rest of the search runs. A filling is one drink of each of as many different drink types as there are open
// drink slots (the game allows one drink per type). Before fillings are made, each player's drink pool is pruned by his
// rules, in this order, each one counted:
//   a. main stat: only the coffee of the player's own combat style stays (melee, ranged or magic; 3 tiers each);
//   b. basic attack: melee and ranged keep Swiftness (attack speed) and drop Channeling (cast speed); magic the opposite;
//   c. Wisdom or Lucky by the goal: profit keeps Lucky, exp keeps Wisdom;
//   d. exact dominance inside a type: another drink of the same type with every buff value at least as large and an ask
//      not above, one strictly (the player's current drinks are never dropped by d).
// Nothing else is cut by hand: clearly worse fillings drop out at the first cut of Stage D's halving. Pure functions: no
// page, no optimizer globals, no side effects.
import { consumableType } from './consumables.mjs';

const short = (h) => h.split('/').pop();
const FREE = (path) => ({ cost: 0, known: true, path, mirrors: 0, note: '' });
const askOf = (market, h) => market?.[h]?.['0']?.a;
const MELEE_STYLES = new Set(['stab', 'slash', 'smash']);

// The weapon's own combat style, 'stab' | 'slash' | 'smash' | 'ranged' | 'magic', the way the engine reads it (player.js:
// the main hand's, else the two hand's `combatStyleHrids[0]`; no weapon is smash).
export function weaponStyleOf(setup, items) {
    for (const slot of ['main_hand', 'two_hand']) {
        const e = setup.player?.equipment?.find((x) => x.itemLocationHrid === '/item_locations/' + slot);
        const style = e && items[e.itemHrid]?.equipmentDetail?.combatStats?.combatStyleHrids?.[0];
        if (style) return short(style);
    }
    return 'smash';
}
// The player's combat style, 'melee' | 'ranged' | 'magic' (stab, slash and smash are melee).
export function combatStyleOf(setup, items) {
    const s = weaponStyleOf(setup, items);
    return MELEE_STYLES.has(s) ? 'melee' : s;
}

// Every combat drink with an ask: { hrid, type, ask, buffs: { '<unique>|<buff type>': [flat, ratio] } }.
export function drinkTable(items, market) {
    const rows = [];
    for (const it of Object.values(items)) {
        if (it.categoryHrid !== '/item_categories/drink' || !it.consumableDetail?.usableInActionTypeMap?.['/action_types/combat']) continue;
        const ask = askOf(market, it.hrid);
        if (!(ask > 0)) continue;
        const buffs = {};
        for (const b of it.consumableDetail.buffs || []) buffs[short(b.uniqueHrid) + '|' + short(b.typeHrid)] = [b.flatBoost || 0, b.ratioBoost || 0];
        rows.push({ hrid: it.hrid, type: consumableType(it), ask, buffs });
    }
    return rows;
}

// Drink types by the buff unique they apply (consumableType gives 'drink:<unique>[+<unique>]').
const typeOfUnique = (u) => 'drink:/buff_uniques/' + u;
const STYLE_COFFEE = { melee: typeOfUnique('melee_coffee'), ranged: typeOfUnique('ranged_coffee'), magic: typeOfUnique('magic_coffee') };
const SWIFT = typeOfUnique('swiftness_coffee'), CHANNEL = typeOfUnique('channeling_coffee');
const LUCKY = typeOfUnique('lucky_coffee'), WISDOM = typeOfUnique('wisdom_coffee');

// `g` beats `f`: same type, every buff value of f is matched or exceeded by g, g's ask is not above f's, one of these
// strictly (a buff g has and f lacks counts as strictly larger; a buff f has and g lacks makes g not a match).
export function drinkBeats(g, f) {
    if (g === f || g.type !== f.type || g.ask > f.ask) return false;
    let strict = g.ask < f.ask;
    for (const [k, [fl, ra]] of Object.entries(f.buffs)) {
        const o = g.buffs[k];
        if (!o || o[0] < fl || o[1] < ra) return false;
        if (o[0] > fl || o[1] > ra) strict = true;
    }
    for (const k of Object.keys(g.buffs)) if (!f.buffs[k]) strict = true;
    return strict;
}

// The pruning. Rule b is the owner's, 2026-11-10: "all magic casters use a basic attack ability, which is one that has zero cooldown. so in practice, magic users never auto attack, they are always ability casting, so any bonuses to auto attack don't actually help them at all. non-magic users don't benefit from cast speed for the inverted reason. They only cast sometimes, and even when they do, their cast time is super short, so reducing it wouldn't help, cooldown is their bottleneck, and they fill it with auto attacks."
// `goal`: 'profit' | 'exp'. `current`: the player's drink hrids (never dropped by d). Returns the kept drinks and, per
// rule, the hrids it dropped (a drink is counted by the first rule that drops it).
export function pruneDrinks({ table, style, goal, current = [] }) {
    const dropped = { a: [], b: [], c: [], d: [] };
    let pool = table;
    const cut = (rule, test) => { const keep = []; for (const d of pool) { if (test(d)) dropped[rule].push(d.hrid); else keep.push(d); } pool = keep; };
    const otherStyles = Object.entries(STYLE_COFFEE).filter(([s]) => s !== style).map(([, t]) => t);
    cut('a', (d) => otherStyles.includes(d.type));
    cut('b', (d) => d.type === (style === 'magic' ? SWIFT : CHANNEL));
    cut('c', (d) => d.type === (goal === 'exp' ? LUCKY : WISDOM));
    const cur = new Set(current);
    cut('d', (d) => !cur.has(d.hrid) && pool.some((g) => drinkBeats(g, d)));
    return { kept: pool, dropped };
}

function product(lists) { return lists.reduce((acc, l) => acc.flatMap((r) => l.map((x) => [...r, x])), [[]]); }
function choose(a, k) {
    if (k === 0) return [[]];
    if (a.length < k) return [];
    return [...choose(a.slice(1), k - 1).map((r) => [a[0], ...r]), ...choose(a.slice(1), k)];
}

// Where each drink of a filling goes: a drink of the type of a baseline drink takes that drink's slot; the rest take the free
// slots in slot order. `typeOf(hrid)` gives the drink's type.
export function placeDrinks(filling, baseline, typeOf) {
    const slots = Array(baseline.length).fill(null), rest = [];
    for (const f of [...filling].sort((a, b) => (typeOf(a) < typeOf(b) ? -1 : 1))) {
        const i = baseline.findIndex((b, j) => b && slots[j] === null && typeOf(b) === typeOf(f));
        if (i >= 0) slots[i] = f; else rest.push(f);
    }
    for (const f of rest) slots[slots.findIndex((s) => s === null)] = f;
    return slots;
}

// The drink-fill candidates of one player, shaped like foodFillCands makes them. baseline: the player's drink hrids per open
// slot (null = empty). `nSlots` is baseline.length. The baseline filling itself is not a candidate. Cheapest filling by ask
// first (only the order of the list). Returns { cands, stats } with stats.{ table, byRule: {a,b,c,d}, kept, fillings }.
export function drinkFillCands(p, { items, market, baseline, setup, goal }) {
    const table = drinkTable(items, market), typeOf = (h) => consumableType(items[h]), current = baseline.filter(Boolean);
    const style = combatStyleOf(setup, items);
    const { kept, dropped } = pruneDrinks({ table, style, goal, current });
    const types = [...new Set(kept.map((d) => d.type))].sort();
    const n = baseline.length;
    const isBase = (fill) => fill.length === current.length && fill.every((h) => current.includes(h)) && n === current.length;
    const cands = [];
    for (const combo of choose(types, Math.min(n, types.length))) {
        for (const fill of product(combo.map((t) => kept.filter((d) => d.type === t).map((d) => d.hrid)))) {
            if (isBase(fill)) continue;
            const slots = placeDrinks(fill, baseline, typeOf), changed = slots.map((s, i) => (s !== baseline[i] ? i : -1)).filter((i) => i >= 0);
            if (!changed.length) continue;
            const ask = fill.reduce((a, h) => a + askOf(market, h), 0);
            cands.push({
                id: `${p}:drinkfill=${slots.map((s) => (s ? short(s) : 'none')).join('+')}`, kind: 'drink-fill', groups: changed.map((i) => `${p}:drink${i}`), player: p, monotone: false,
                desc: `${p} drinks: ${changed.map((i) => `${baseline[i] ? short(baseline[i]) : 'empty'} -> ${short(slots[i])}`).join(', ')}`,
                ops: changed.map((i) => ({ op: 'drink', player: p, index: i, item: slots[i] })),
                cost: FREE('loadout tweak, used x buy price in expenses'), sortAsk: ask,
            });
        }
    }
    cands.sort((a, b) => (a.sortAsk - b.sortAsk) || (a.id < b.id ? -1 : 1));
    for (const c of cands) delete c.sortAsk;
    const stats = { style, table: table.length, byRule: Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, v.length])), dropped, kept: kept.map((d) => d.hrid), types: types.length, fillings: cands.length };
    return { cands, stats };
}
