// Test: the what-if levers for an item in an empty slot and for the guild shrines, on a generic party (no real player).
// (1) The swap pricing with no old item. (2) The optimizer (tools/whatif/optimize.mjs) with every budget at 1 Coin (0 is no limit), so every paid
// change is priced and listed over budget and no run is made: the empty slots offer market items at +0 for their buy price
// through the swap loop; the weapon slots stay closed while a two-hand weapon is held. (3) The guild shrine lever: costs against a hand
// computation, the jumps and the cap, the all-five rows, the shrine op, a shrine row over budget with its split, and the window's texts.
// Usage: node tools/test/whatif-shrines.mjs [--skip-optimizer]       Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const R = await imp('tools/whatif/runner/server.mjs');
const { makePricer } = await imp('tools/whatif/prices.mjs');
const PRICES = 'marketplace-2026-11-03.json';
const market = JSON.parse(fs.readFileSync(path.join(root, 'tools/calibration', PRICES), 'utf8')).marketData;
const ask = (h, l = 0) => market[h]?.[String(l)]?.a;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shrines-'));

// ---- (1) The swap pricing with no old item ----
const pricer = makePricer(market);
const helm = '/items/cheese_helmet';
const empty = pricer.swap(null, 0, helm, 0);
check('pricing: an empty slot costs the buy price, nothing sold', empty.known && empty.cost === ask(helm) && empty.path === 'buy' && !/no buyer/.test(empty.note || ''), JSON.stringify(empty));
check('pricing: a swap from an item still sells the old one', /sell old/.test(pricer.swap('/items/cheese_sword', 0, '/items/cheese_spear', 0).path));

// ---- (2) The optimizer ----
if (process.argv.includes('--skip-optimizer')) { fs.rmSync(tmp, { recursive: true, force: true }); console.log(failed ? `${failed} failed (optimizer parts skipped)` : 'all passed (optimizer parts skipped)'); process.exit(failed ? 1 : 0); }
const generic = (name, equipment, extra = {}) => ({
    name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: equipment.map(([slot, itemHrid]) => ({ itemLocationHrid: '/item_locations/' + slot, itemHrid, enhancementLevel: 0 })) },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] }, ...extra,
});
const party = [generic('Alpha', [['main_hand', '/items/cheese_sword'], ['head', helm]]), generic('Beta', [['two_hand', '/items/wooden_bow']])];
const run = (name, body) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    const a = R.buildArgs({ setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, prices: PRICES }, goal: 'profit', budgets: { Alpha: 1, Beta: 1 },
        unitHours: 1, confirmHours: 1, maxRounds: 1, maxSteps: 1, z: 0, ...body }, d).filter((x) => x !== '--low-priority');
    try { execFileSync(process.execPath, [path.join(root, 'tools/whatif/optimize.mjs'), ...a], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 600) }; }
    return { res: JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')) };
};
const eq = run('equip', { levers: ['equip'] });
check('optimizer, equip lever: no throw', !eq.error, eq.error);
if (eq.res) {
    const over = eq.res.overBudget;
    const feet = over.filter((c) => c.id.startsWith('Alpha:feet='));
    check('empty slot: Alpha\'s empty feet slot offers market feet items, as "empty -> <item> +0"', feet.length > 0 && feet.every((c) => / feet empty -> \S+ \+0$/.test(c.desc)), JSON.stringify(feet.slice(0, 3)));
    check('empty slot: each costs the item\'s +0 buy price, bought only', feet.every((c) => c.cost === ask('/items/' + c.id.split('=')[1].replace(/\+0$/, '')) && c.costPath === 'buy'), JSON.stringify(feet.slice(0, 3)));
    check('empty slot: only +0 is offered for an empty slot', over.filter((c) => / empty -> /.test(c.desc)).every((c) => c.id.endsWith('+0')));
    check('empty slot: Alpha (one-hand weapon) gets off-hand items, never a two-hand weapon', over.some((c) => c.id.startsWith('Alpha:off_hand=')) && !over.some((c) => c.id.startsWith('Alpha:two_hand=')));
    check('empty slot: Beta (two-hand weapon) gets no main-hand or off-hand item', !over.some((c) => /^Beta:(main_hand|off_hand)=/.test(c.id)));
    check('empty slot: a filled slot keeps its swaps and upgrades', over.some((c) => c.id === 'Alpha:head+1') && over.some((c) => c.id.startsWith('Alpha:head=') && / head cheese_helmet \+0 -> /.test(c.desc)));
}
// The owned items of an empty slot's type, with Items you own on (free: they join the race, so one short round runs).
const own = run('owned', { levers: ['owned'], export: { Alpha: { name: 'Alpha', inventory: [{ itemHrid: '/items/cheese_boots', enhancementLevel: 2, count: 1 }], learnedAbilities: [] } } });
check('optimizer, owned lever: no throw', !own.error, own.error);
if (own.res) check('empty slot: an owned item of the slot\'s type is offered at its own level', own.res.candidateList.some((c) => c.id === 'Alpha:feet=own:cheese_boots+2' && / feet empty -> owned cheese_boots \+2$/.test(c.desc) && c.cost === 0), JSON.stringify(own.res.candidateList));
// The window's word for an empty slot follows the shown language.
const panel = await imp('src/whatif/panel.mjs');
check('window: "empty" in a change reads in the shown language', panel.localizeDesc('Alpha feet empty -> cheese_boots +0', panel.namesFrom({ itemNames: { '/items/cheese_boots': '奶酪靴' } }, undefined, { empty: '空' }), ['Alpha']) === 'Alpha feet 空 -> 奶酪靴 +0');

// ---- (3) The guild shrines ----
const S = await imp('tools/whatif/levers/shrines.mjs');
const { applyOps } = await imp('src/whatif/applyOps.mjs');
const { guildLevels } = await imp('src/guildLevels.mjs');
const items = JSON.parse(fs.readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const FORCE = '/guild_buffs/force_combat';
// Hand computation, apart from the lever's code: the cheapest Coin per credit over every item that converts into it (its +0 ask), and a
// token's best exchange (1 token gives 10 brown, white, green or blue credits, 1 purple or red, 0.1 silver, 1/60 gold).
const perCredit = {};
for (const it of Object.values(items)) {
    if (it.hrid === '/items/guild_token' || !it.guildCreditConversions || !(ask(it.hrid) > 0)) continue;
    for (const c of it.guildCreditConversions) { const v = (ask(it.hrid) * c.itemCount) / c.creditCount; if (!(perCredit[c.creditItemHrid] <= v)) perCredit[c.creditItemHrid] = v; }
}
const perToken = Math.max(...[['green', 10], ['brown', 10], ['white', 10], ['blue', 10], ['purple', 1], ['red', 1], ['silver', 0.1], ['gold', 1 / 60]].filter(([c]) => perCredit[`/items/${c}_guild_credit`]).map(([c, n]) => perCredit[`/items/${c}_guild_credit`] * n));
// Force 0 -> 1 (guildBuffDetailMap.json level 1): 400 tokens, 2000 brown, 2000 white, 200 red credits; with spare tokens the credits take 200 + 200 + 200.
const forceOne = 400 * perToken + 2000 * perCredit['/items/brown_guild_credit'] + 2000 * perCredit['/items/white_guild_credit'] + 200 * perCredit['/items/red_guild_credit'];
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const cands = (extra, opts = {}) => S.shrineCands(generic('Alpha', [], extra), 'Alpha', { pricer, ...opts });
const ids = (list, slug) => list.filter((c) => c.groups.length === 1 && c.groups[0] === 'Alpha:shrine:' + slug).map((c) => c.id.split('+')[1]).join(',');
const at0 = cands({});
const f1 = at0.find((c) => c.id === 'Alpha:shrine:force+1');
check('shrines: force 0 -> 1 costs the hand-computed Coin (credits at their cheapest market item, tokens at their best exchange)', f1 && f1.cost.known && near(f1.cost.cost, forceOne), `${f1?.cost.cost} vs ${forceOne}`);
check('shrines: force 0 -> 1 split: 400 tokens required, the credits\' Coin, or 600 spare tokens', f1 && f1.cost.split.tokens === 400 && f1.cost.split.creditsTokens === 600 && near(f1.cost.split.creditsCoin, forceOne - 400 * perToken) && near(f1.cost.split.tokenCoin, 400 * perToken), JSON.stringify(f1?.cost.split));
check('shrines: from 0, no cap: +1, +2, +3 and up to the game\'s top level (20), one group per buff', ids(at0, 'force') === '1,2,3,20' && ids(at0, 'scholar') === '1,2,3,20', ids(at0, 'force'));
check('shrines: cap 2: +1 and +2 only (a jump past the cap is not offered; the cap row is the +2 row, once)', ids(cands({}, { cap: 2 }), 'force') === '1,2');
check('shrines: cap 0: no shrine row', cands({}, { cap: 0 }).length === 0);
check('shrines: force at 19: only +1 (to 20)', ids(cands({ guildCombatBuffLevels: { force: 19 } }), 'force') === '1');
check('shrines: a buff at the cap offers no row', ids(cands({ guildCombatBuffLevels: { force: 7 } }, { cap: 7 }), 'force') === '');
check('shrines: the level now is read as the import reads it (guildBuffs wins over the exporter levels)', at0 && cands({ guildCombatBuffLevels: { force: 3 }, guildBuffs: { [FORCE]: 5 } }).find((c) => c.id === 'Alpha:shrine:force+1')?.desc === 'Alpha force 5 -> 6');
const all1 = at0.find((c) => c.id === 'Alpha:shrine:all+1'), allCap = cands({}, { cap: 2 }).find((c) => c.id === 'Alpha:shrine:allcap');
const singles1 = at0.filter((c) => c.groups.length === 1 && c.id.endsWith('+1'));
check('shrines: all five +1 is the sum of the five +1 rows, touching all five buff groups', all1 && singles1.length === 5 && near(all1.cost.cost, singles1.reduce((a, c) => a + c.cost.cost, 0)) && all1.groups.length === 5 && all1.ops.length === 5 && all1.cost.split.tokens === 2000, JSON.stringify(all1?.cost));
check('shrines: all five up to the cap (cap 2) raises every buff 0 -> 2', allCap && allCap.ops.every((o) => o.delta === 2) && allCap.ops.length === 5);
const four = { guildCombatBuffLevels: { force: 20, tempo: 20, spirit: 20, rarity: 20, scholar: 5 } };
check('shrines: no all-five row when fewer than two buffs can move', !cands(four).some((c) => c.groups.length > 1));
check('shrines: a buff that cannot move is left out of the all-five row', cands({ guildCombatBuffLevels: { force: 20 } }).find((c) => c.id === 'Alpha:shrine:all+1')?.ops.length === 4);
const after = applyOps([generic('Alpha', [], { guildCombatBuffLevels: { force: 3 } })], [{ op: 'shrine', player: 'Alpha', buff: FORCE, delta: 2 }]);
check('shrines: the shrine op raises the level the import reads', guildLevels(after[0])[FORCE] === 5 && after[0].guildBuffs[FORCE] === 5);
check('shrines: --shrine-steps and --shrine-cap parse, a bad value throws', JSON.stringify(S.parseSteps('1,cap')) === '[1,"cap"]' && S.parseCap('') === null && S.parseCap('3') === 3 && (() => { try { S.parseCap('-1'); return false; } catch { return true; } })());
// The optimizer: every shrine row over budget at budget 0, with its split, under the guild's shrine level the request names.
check('runner: shrineCap is passed as --shrine-cap', R.buildArgs({ setups: party, levers: ['shrines'], shrineCap: 2 }, tmp).join(' ').includes('--shrine-cap 2'));
const sh = run('shrines', { levers: ['shrines'], shrineCap: 2 });
check('optimizer, shrines lever: no throw', !sh.error, sh.error);
if (sh.res) {
    const row = sh.res.overBudget.find((c) => c.id === 'Alpha:shrine:force+1');
    check('shrines: a shrine row over budget lands in overBudget with its split', row && near(row.cost, forceOne) && row.shrineSplit?.tokens === 400 && row.shrineSplit?.creditsTokens === 600 && row.costPath === 'guild shrine', JSON.stringify(row));
    check('shrines: nothing past the guild shrine level (2), and the result records it', ![...sh.res.overBudget, ...sh.res.candidateList].some((c) => / -> [3-9]/.test(c.desc) || / -> \d\d/.test(c.desc)) && sh.res.options.shrineCap === 2);
}
// The window: the split in each language, the shrine name in the change, the request.
const loc = (l) => JSON.parse(fs.readFileSync(path.join(root, 'locales', l, 'common.json'), 'utf8')).whatIf;
const tOf = (l) => (k, o = {}) => String(k.split('.').reduce((a, x) => a?.[x], loc(l)) ?? k).replace(/{{(\w+)}}/g, (m, x) => String(o[x]));
const plain = (h) => h.replace(/<[^>]+>/g, '');
const sp = { tokens: 400, tokenCoin: 1, tokenValue: 1, creditsCoin: 1234, creditsTokens: 600 };
const splits = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, plain(panel.shrineSplitText(sp, tOf(l)))]));
check('window: the split reads in en, pt and zh with its three figures', /400 Guild Tokens required.*1,?234 Coin.*600 spare Guild Tokens/.test(splits.en) && /400 Fichas de Guilda.*Moedas.*600 Fichas/.test(splits.pt) && /需要 400 公会代币.*金币.*600 公会代币/.test(splits.zh), JSON.stringify(splits));
const html = panel.renderResult({ goal: 'profit', budgets: { Alpha: 0 }, setups: [{ name: 'Alpha' }], steps: [], singles: [], overBudget: [{ id: 'Alpha:shrine:force+1', player: 'Alpha', desc: 'Alpha force 0 -> 1', cost: 5, costPath: 'guild shrine', note: '', shrineSplit: sp }], options: {} }, tOf('en'));
check('window: an over-budget shrine row shows its split', plain(html).includes('400 Guild Tokens required'));
check('window: a shrine change names the shrine in the shown language', panel.localizeDesc('Alpha force 0 -> 1', panel.namesFrom({ guildShrineNames: { '/guild_shrines/force': '力量神龛' } }), ['Alpha']) === 'Alpha 力量神龛 0 -> 1');
const body = (cap, levers) => panel.searchBody({ slots: [], goal: 'profit', budgets: {}, levers, shrineCap: cap });
check('window: the guild shrine level is sent only when typed and Shrines is ticked', body('2', ['shrines']).shrineCap === 2 && !('shrineCap' in body('', ['shrines'])) && !('shrineCap' in body('2', ['equip'])));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
