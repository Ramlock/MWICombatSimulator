// Test: the food filling of the what-if search (tools/whatif/foodfill.mjs): the food table and the dominance cut on the repo's
// price file, the qualify rule at the margin, the best 3 per type with no widening, the current filling, slot placement,
// trigger inheritance, the id and description shape, and fewer open slots. Invented foods and needs; no private data.
// Usage: node tools/test/whatif-food.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = await import(pathToFileURL(path.join(root, 'tools/whatif/foodfill.mjs')).href);
const realItems = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const realMarket = JSON.parse(readFileSync(path.join(root, 'tools/calibration/marketplace-2026-11-03.json'), 'utf8')).marketData;

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- The repo's price file ----
const table = F.foodTable(realItems, realMarket);
check(table.length === 27 && table.every((f) => f.capacity === f.restore * 60 && Math.abs(f.ppp - f.ask / f.restore) < 1e-12 && ['hp', 'mp'].includes(f.resource)), 'table: 27 combat foods with an ask; capacity = restore x 60, price per point = ask / restore');
check(new Set(table.map((f) => f.type)).size === 4, 'table: the four food types');
check(F.dominatedFoods(table).size === 14, 'dominance: 14 of the 27 foods are dropped', String(F.dominatedFoods(table).size));
check(F.MARGIN === 0.25, 'MARGIN is 0.25');

// ---- Invented foods: two per type, none dominated (more restore costs more per point) ----
const items = {}, market = {};
const add = (name, hp, mp, over, ask) => {
    const hrid = '/items/' + name;
    items[hrid] = { hrid, categoryHrid: '/item_categories/food', consumableDetail: { hitpointRestore: hp, manapointRestore: mp, recoveryDuration: over ? 3e10 : 0, cooldownDuration: 6e10, usableInActionTypeMap: { '/action_types/combat': true } } };
    market[hrid] = { 0: { a: ask } };
    return hrid;
};
const hi1 = add('hi1', 100, 0, false, 1000), hi2 = add('hi2', 200, 0, false, 2400); // hp at once, 10 and 12 per point
const ho1 = add('ho1', 100, 0, true, 1100), ho2 = add('ho2', 200, 0, true, 2600); // hp over time, 11 and 13
const mi1 = add('mi1', 0, 100, false, 1000), mi2 = add('mi2', 0, 200, false, 2400);
const mo1 = add('mo1', 0, 100, true, 1100), mo2 = add('mo2', 0, 200, true, 2600);
const cands = (baseline, need, extra = {}) => F.foodFillCands('P', { items, market, baseline, triggerMap: {}, need, ...extra });
const idsOf = (r) => r.cands.map((c) => c.id.replace('P:foodfill=', ''));
const small = { hp: 1000, mp: 1000 };

// Every filling qualifies at this need: 4 type triples x 2 x 2 x 2 = 32, minus the current one.
let r = cands([hi1, mi1, mo1], small);
check(F.dominatedFoods(F.foodTable(items, market)).size === 0, 'invented foods: none dominated');
check(r.cands.length === 31 && r.stats.qualify === 32 && r.stats.left === 31 && r.stats.baseQualifies, 'fillings: 32 qualify, the current one is not a candidate, 31 are', `${r.cands.length} ${r.stats.qualify}`);
check(!idsOf(r).includes('hi1+mi1+mo1') && new Set(idsOf(r)).size === 31, 'the current filling (same set of foods) is not a candidate; ids are distinct');
check(r.cands.every((c) => c.kind === 'food-fill' && c.monotone === false && c.player === 'P' && c.cost.cost === 0 && c.cost.known), 'candidates: kind food-fill, not monotone, free');

// ---- The qualify rule at the margin: 3 types, one filling; capacity 100 x 60 = 6000 HP, 6000 + 6000 = 12000 MP ----
const three = (need) => cands([null, null, null], need, {}); // empty baseline: no current filling, the 4 type triples
const only = (need) => { const b = [hi1, mi1, mo1]; return F.planFillings({ table: F.foodTable(items, market).filter((f) => [hi1, mi1, mo1].includes(f.hrid)), nSlots: 3, current: b, need }); };
check(only({ hp: 4800, mp: 9600 }).baseQualifies && only({ hp: 4800, mp: 9600 }).qualifying.length === 0, 'qualify: capacity exactly need x 1.25 qualifies (hp 6000 vs 4800, mp 12000 vs 9600)');
check(!only({ hp: 4801, mp: 9600 }).baseQualifies, 'qualify: just below on HP does not');
check(!only({ hp: 4800, mp: 9601 }).baseQualifies, 'qualify: just below on MP does not');
check(only({ hp: 0, mp: 0 }).baseQualifies, 'qualify: a zero need always qualifies');

// ---- Best 3 per type, no widening, current foods kept ----
// A second world for the cut fixtures (so the first one's foods do not take a place among the 3).
const items2 = {}, market2 = {};
const add2 = (name, hp, mp, over, ask) => { const hrid = '/items/' + name; items2[hrid] = { ...items[hrid] || { hrid, categoryHrid: '/item_categories/food', consumableDetail: { hitpointRestore: hp, manapointRestore: mp, recoveryDuration: over ? 3e10 : 0, cooldownDuration: 6e10, usableInActionTypeMap: { '/action_types/combat': true } } } }; items2[hrid].consumableDetail = { ...items2[hrid].consumableDetail, hitpointRestore: hp, manapointRestore: mp, recoveryDuration: over ? 3e10 : 0 }; market2[hrid] = { 0: { a: ask } }; return hrid; };
add2('mi1', 0, 100, false, 1000); add2('mo1', 0, 100, true, 1100);
const hs = [100, 110, 120, 130, 140].map((rs, i) => add2('h' + (i + 1), rs, 0, false, Math.round(rs * (10 + i)))); // ppp 10..14, all non-dominated
check(F.dominatedFoods(F.foodTable(items2, market2).filter((f) => hs.includes(f.hrid))).size === 0, 'fixture: five HP foods, none dominated');
const tbl = F.foodTable(items2, market2).filter((f) => [...hs, mi1, mo1].includes(f.hrid));
const plan = (need, current) => F.planFillings({ table: tbl, nSlots: 3, current, need });
let p = plan({ hp: 1000, mp: 1000 }, [hs[4], mi1, mo1]);
check(p.left.length === 3 && p.left.every((f) => f.includes(mi1) && f.includes(mo1)) && same(p.left.map((f) => f.find((h) => hs.includes(h))).sort(), [hs[0], hs[1], hs[2]].sort()), 'best 3: of five qualifying HP foods the three cheapest per point stay (the current one, the dearest, is in addition: only its own filling, which is the base)');
p = plan({ hp: 6400, mp: 1000 }, [hs[4], mi1, mo1]); // only h5 (8400) clears 6400 x 1.25 = 8000; h4 (7800) does not
check(p.qualifying.length === 0 && p.baseQualifies && p.left.length === 0, 'no widening: only the current food qualifies, so nothing else is added back');
p = plan({ hp: 6000, mp: 1000 }, [hs[0], mi1, mo1]); // h4 (7800) and h5 (8400) clear 7500; h3 (7200) does not
check(same(p.left.map((f) => f.find((h) => hs.includes(h))).sort(), [hs[3], hs[4]].sort()) && !p.kept.has(hs[2]), 'no widening: only two non-current foods qualify, both kept, the cheaper ones that do not qualify are never added');
p = plan({ hp: 1000, mp: 1000 }, [hs[0], mi1, mo1]);
check(p.left.length === 3 && same(p.left.map((f) => f.find((h) => hs.includes(h))).sort(), [hs[1], hs[2], hs[3]].sort()) && p.kept.has(hs[0]) && !p.kept.has(hs[4]), 'best 3: a cheap current food keeps its place besides the 3 (the 3 are chosen among the others)');

// ---- A current food that is dominated stays an option ----
const dx = add2('dx', 100, 0, false, 2000), dy = add2('dy', 100, 0, false, 1000); // dy beats dx
const tbl2 = F.foodTable(items2, market2).filter((f) => [dx, dy, mi1, mo1].includes(f.hrid));
check(F.dominatedFoods(tbl2).has(dx) && !F.dominatedFoods(tbl2, new Set([dx])).has(dx), 'dominance: a dominated food is dropped, unless it is the player\'s current one');
const p2 = F.planFillings({ table: tbl2, nSlots: 3, current: [dx, mi1, mo1], need: small });
check(p2.kept.has(dx) && p2.dominated.size === 0 && same(p2.left, [[dy, mi1, mo1]]), 'a dominated current food stays in the options; the filling with the dominating food is the candidate');
const eq1 = add2('eq1', 100, 0, false, 1000), eq2 = add2('eq2', 100, 0, false, 1000);
check(F.dominatedFoods(F.foodTable(items2, market2).filter((f) => [eq1, eq2].includes(f.hrid))).size === 0, 'dominance: equal capacity and price drops neither (one must be strict)');
const cap1 = add2('cap1', 100, 0, false, 1000), cap2 = add2('cap2', 200, 0, false, 2000), cap3 = add2('cap3', 200, 0, false, 2200);
check(same([...F.dominatedFoods(F.foodTable(items2, market2).filter((f) => [cap1, cap2, cap3].includes(f.hrid)))].sort(), [cap1, cap3].sort()), 'dominance: more capacity at the same price per point drops the smaller; the dearer of equal capacity is dropped');

// ---- Slot placement ----
const info = (h) => F.foodInfo(items, h);
check(same(F.placeFilling([hi2, mi2, mo2], [hi1, mi1, mo1], info), [hi2, mi2, mo2]), 'placement: a food takes the slot of the baseline food of its type');
check(same(F.placeFilling([mo2, hi2, mi2], [hi1, mi1, mo1], info), [hi2, mi2, mo2]), 'placement: the order of the filling does not matter');
check(same(F.placeFilling([hi2, ho1, mi2], [hi1, mi1, mo1], info), [hi2, mi2, ho1]), 'placement: a new type with no resource match goes to the free slot (the MP over time slot goes to an HP over time food)');
check(same(F.placeFilling([hi2, ho1, mo2], [hi1, mi1, null], info), [hi2, mo2, ho1]), 'placement: of two new foods the MP one takes the free slot whose baseline food restores MP, the other the empty slot');
check(same(F.placeFilling([ho1, mi1, mo1], [hi1, mi1, mo1], info), [ho1, mi1, mo1]), 'placement: a new type takes the free slot whose baseline food restores the same resource (HP)');
check(F.placeFilling([hi1, mi1, mo1], [null, null, null], info).every(Boolean) && new Set(F.placeFilling([hi1, mi1, mo1], [null, null, null], info)).size === 3, 'placement: an empty baseline fills every slot');

// ---- Trigger inheritance ----
const T1 = [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/missing_hp', comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: 500 }];
const base = [hi1, mi1, mo1];
const withTrig = (map, filling) => F.foodFillCands('P', { items, market, baseline: base, triggerMap: map, need: small }).cands.find((c) => c.id === 'P:foodfill=' + filling.map((h) => h.split('/').pop()).join('+'));
let c = withTrig({ [hi1]: T1, [mi1]: null }, [hi2, mi2, mo1]);
const tops = (c) => c.ops.filter((o) => o.op === 'trigger');
check(c && tops(c).length === 2 && same(tops(c)[0], { op: 'trigger', player: 'P', hrid: hi2, triggers: T1 }) && tops(c)[0].triggers !== T1 && tops(c)[0].triggers[0] !== T1[0], 'triggers: a new food gets its same-type baseline food\'s list as a deep copy');
check(c && same(tops(c)[1], { op: 'trigger', player: 'P', hrid: mi2, triggers: [] }), 'triggers: an explicit null entry of the donor becomes []');
check(c && !tops(c).some((o) => o.hrid === mo1) && c.ops.filter((o) => o.op === 'food').length === 2, 'triggers: a kept food gets no trigger op; the food ops are for the changed slots only');
c = withTrig({ [mi1]: T1 }, [hi2, mi1, mo1]);
check(c && tops(c).length === 0, 'triggers: a donor with no entry in the triggerMap adds nothing');
c = withTrig({ [hi1]: T1 }, [ho1, mi1, mo1]);
check(c && same(tops(c), [{ op: 'trigger', player: 'P', hrid: ho1, triggers: T1 }]) && /ho1 \(trigger of hi1 kept\)/.test(c.desc), 'triggers: no baseline food of the type: the unused baseline food that restores the same resource is the donor');
c = withTrig({ [mi1]: T1 }, [ho1, mi1, mo1]);
check(c && tops(c).length === 0, 'triggers: the resource donor is an HP food, not an MP one (no entry for it: nothing)');
// Donor already used by a same-type food: the resource donor must be unused. Baseline [hi1, ho1, mi1]; filling hi2 + ho2 + mo1? (mo1 new, resource mp: mi1 is unused)
const base2 = [hi1, ho1, mi1];
const f2 = F.foodFillCands('P', { items, market, baseline: base2, triggerMap: { [hi1]: T1, [mi1]: null }, need: small }).cands.find((x) => x.id === 'P:foodfill=hi2+ho1+mo1');
check(f2 && same(tops(f2), [{ op: 'trigger', player: 'P', hrid: hi2, triggers: T1 }, { op: 'trigger', player: 'P', hrid: mo1, triggers: [] }]), 'triggers: by type first (hi1 -> hi2), then by resource (mi1 -> mo1, a null entry)');
// A baseline food that is already the donor of a same-type food is not reused by the resource rule.
const f3 = F.foodFillCands('P', { items, market, baseline: [hi1, mi1, mo1], triggerMap: { [hi1]: T1 }, need: small }).cands.find((x) => x.id === 'P:foodfill=hi2+mi1+mo1');
check(f3 && same(tops(f3), [{ op: 'trigger', player: 'P', hrid: hi2, triggers: T1 }]), 'triggers: one new food, one op');

// ---- Id and description ----
c = withTrig({ [hi1]: T1, [mi1]: null }, [hi2, mi2, mo1]);
check(c.id === 'P:foodfill=hi2+mi2+mo1' && c.desc === 'P food: hi1 -> hi2 (trigger of hi1 kept), mi1 -> mi2 (trigger of mi1 kept)' && same(c.groups, ['P:food0', 'P:food1']), 'id in slot order, desc old -> new per changed slot with the donor, groups per changed slot', c.desc);
c = F.foodFillCands('P', { items, market, baseline: [hi1, null, mo1], triggerMap: {}, need: small }).cands.find((x) => x.id === 'P:foodfill=hi1+mi1+mo1');
check(c && c.desc === 'P food: empty -> mi1' && same(c.groups, ['P:food1']) && same(c.ops, [{ op: 'food', player: 'P', index: 1, item: mi1 }]), 'an empty slot is filled: "empty -> food", one food op');
// Sorted by the filling's cost for the baseline need, cheapest first.
r = cands([hi1, mi1, mo1], { hp: 3000, mp: 3000 });
const perHour = (id) => { const names = id.replace('P:foodfill=', '').split('+'); return F.fillingCostPerHour(names.map((n) => '/items/' + n), F.foodTable(items, market), { hp: 3000, mp: 3000 }); };
check(r.cands.every((x, i) => i === 0 || perHour(r.cands[i - 1].id) <= perHour(x.id) + 1e-9), 'candidates are sorted by the filling\'s cost per hour for the need, cheapest first');
check(Math.abs(F.fillingCostPerHour([hi1, mi1, mo1], F.foodTable(items, market), { hp: 3000, mp: 8000 }) - (3000 * 10 + 6000 * 10 + 2000 * 11)) < 1e-9, 'cost per hour: cheapest food per point first, up to each food\'s capacity (MP: 6000 of mi1, then 2000 of mo1)');

// ---- Fewer open slots ----
r = cands([hi1, mi1], small);
check(r.stats.nSlots === 2 && r.cands.length > 0 && r.cands.every((x) => x.id.split('=')[1].split('+').length === 2 && x.ops.filter((o) => o.op === 'food').length <= 2) && !idsOf(r).includes('hi1+mi1'), 'two open slots: fillings of two types, the current pair is not a candidate');
const needBoth = r.cands.every((x) => { const fs = x.id.split('=')[1].split('+').map((n) => '/items/' + n); return fs.some((h) => items[h].consumableDetail.hitpointRestore > 0) && fs.some((h) => items[h].consumableDetail.manapointRestore > 0); });
check(needBoth, 'two open slots: every filling has an HP food and an MP food (a need on both)');
r = cands([hi1], small);
check(r.cands.length === 0 && r.stats.qualify === 0, 'one open slot: one food cannot cover HP and MP, no filling qualifies');
r = cands([], small);
check(r.cands.length === 0, 'no open slot: no candidates');
r = cands([hi1, mi1, mo1, ho1], small);
check(r.stats.nSlots === 4 && r.cands.length > 0 && r.cands.every((x) => x.id.split('=')[1].split('+').length === 4), 'four open slots: all four types in every filling');
r = cands([hi1, mi1, mo1], { hp: 1e9, mp: 1e9 });
check(r.cands.length === 0 && r.stats.qualify === 0, 'a need no filling reaches: no candidates');

// ---- The log counts ----
r = cands([hi1, mi1, mo1], small);
check(r.stats.foods === 8 && r.stats.dominated === 0 && r.stats.qualify === 32 && r.stats.left === 31 && Array.isArray(r.stats.currentCut), 'stats: foods, dominated, qualify, left, the current foods a rule cuts');


// ---- One food row per player in the report (hideFoodRows) ----
{
    const rr = (id, player, extra) => ({ id, player, score: 1, buyerNet: 0, gain: 0, gainPerUser: 0, accepted: false, ...extra });
    const isFood = (r) => r.id.startsWith('f');
    const rows = [rr('f1', 'A', { accepted: true, score: 2 }), rr('f2', 'A', { accepted: true, score: 5 }), rr('f3', 'A', { accepted: false, score: 9 }), rr('d1', 'A', { accepted: true }),
        rr('f4', 'B', { accepted: false }), rr('f5', 'B', { accepted: false }),
        rr('f6', 'C', { accepted: true, score: 3, buyerNet: 1 }), rr('f7', 'C', { accepted: true, score: 3, buyerNet: 7 }),
        rr('f8', 'D', { accepted: false, helpsParty: true, gainPerUser: 10 }), rr('f9', 'D', { accepted: false, helpsParty: true, gainPerUser: 30 }), rr('f10', 'D', { accepted: false }),
        rr('f11', 'E', { accepted: true, score: 2 }), rr('f12', 'E', { accepted: false, helpsParty: true, gainPerUser: 50 })];
    F.hideFoodRows(rows, isFood);
    const hidden = (id) => rows.find((r) => r.id === id).hiddenFood === true;
    check(!hidden('f2') && hidden('f1') && hidden('f3'), 'one food row: of a player\'s accepted food rows the best by score stays; the rest, accepted or not, are hidden');
    check(rows.find((r) => r.id === 'd1').hiddenFood === undefined, 'one food row: a row that is not a food filling is not touched');
    check(hidden('f4') && hidden('f5'), 'one food row: no accepted food row: every food row of that player is hidden');
    check(!hidden('f7') && hidden('f6'), 'one food row: a tie on score goes to the larger buyer net (the greedy\'s order)');
    check(!hidden('f9') && hidden('f8') && hidden('f10'), 'one food row: of the helps rows the largest gainPerUser stays, the other helps row and the weak row are hidden');
    check(!hidden('f11') && hidden('f12'), 'one food row: a player with an accepted food row keeps only that one; his helps-the-party row is hidden too');
    check(rows.every((r) => r.hiddenFood === undefined || r.hiddenFood === true), 'one food row: hiddenFood is true or absent');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
