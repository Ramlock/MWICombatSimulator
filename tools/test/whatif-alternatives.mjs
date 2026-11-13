// Test: one row per setting (tools/whatif/alternatives.mjs): the setting key of each op kind, which rows the helper hides (the row kept is the first in the
// search's own order), the paid switch (off: a paid row is never grouped), and the foods case (hideFoodRows is one case of the same function).
// Invented names, ids and figures only; no private data.
// Usage: node tools/test/whatif-alternatives.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = await import(pathToFileURL(path.join(root, 'tools/whatif/alternatives.mjs')).href);
const F = await import(pathToFileURL(path.join(root, 'tools/whatif/foodfill.mjs')).href);

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };

// ---- The setting key, per op kind ----
const key = (...ops) => A.settingKey(ops);
const AX = '/abilities/arrow_rain', AY = '/abilities/poke';
check(key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [{ value: 4550 }] }) === key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [{ value: 6400 }] }), 'trigger: two values of one ability of one player are one setting');
check(key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [] }) !== key({ op: 'trigger', player: 'Alice', hrid: AY, triggers: [] }) && key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [] }) !== key({ op: 'trigger', player: 'Bob', hrid: AX, triggers: [] }), 'trigger: another ability or another player is another setting');
check(key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) === key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 2 }) && key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) === key({ op: 'equip', player: 'Alice', slot: 'ring', item: '/items/x', level: 5 }) && key({ op: 'equip', player: 'Alice', slot: 'ring', item: '/items/x' }) === key({ op: 'unequip', player: 'Alice', slot: 'ring' }), 'slot: enhance, equip and unequip of one slot of one player are one setting');
check(key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) !== key({ op: 'enhance', player: 'Alice', slot: 'neck', delta: 1 }) && key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) !== key({ op: 'enhance', player: 'Bob', slot: 'ring', delta: 1 }), 'slot: another slot or another player is another setting');
check(key({ op: 'house', player: 'Alice', room: '/house_rooms/dojo', delta: 1 }) === key({ op: 'house', player: 'Alice', room: '/house_rooms/dojo', delta: 2 }) && key({ op: 'house', player: 'Alice', room: '/house_rooms/dojo', delta: 1 }) !== key({ op: 'house', player: 'Alice', room: '/house_rooms/forge', delta: 1 }), 'house: one room of one player is one setting, another room is another');
check(key({ op: 'ability', player: 'Alice', index: 3, ability: AX }) === key({ op: 'ability', player: 'Alice', index: 3, ability: AY, level: 5 }) && key({ op: 'ability', player: 'Alice', replace: AX, ability: AY }) === key({ op: 'ability', player: 'Alice', replace: AX, ability: '/abilities/z' }) && key({ op: 'ability', player: 'Alice', index: 3, ability: AX }) !== key({ op: 'ability', player: 'Alice', index: 4, ability: AX }), 'ability: one slot (by index, or by the replaced ability) of one player is one setting');
check(key({ op: 'abilityLevel', player: 'Alice', index: 3, delta: 1 }) === key({ op: 'abilityLevel', player: 'Alice', index: 3, delta: 2 }) && key({ op: 'abilityLevel', player: 'Alice', index: 3, delta: 1 }) !== key({ op: 'abilityLevel', player: 'Alice', index: 4, delta: 1 }), 'abilityLevel: one slot of one player is one setting');
check(key({ op: 'abilityOrder', player: 'Alice', order: [0, 2, 1] }) === key({ op: 'abilityOrder', player: 'Alice', order: [2, 1, 0] }) && key({ op: 'abilityOrder', player: 'Alice', order: [0, 2, 1] }) !== key({ op: 'abilityOrder', player: 'Bob', order: [0, 2, 1] }), 'abilityOrder: all the orders of one player are one setting');
check(key({ op: 'level', player: 'Alice', skill: 'magic', delta: 1 }) === key({ op: 'level', player: 'Alice', skill: 'magic', delta: 3 }) && key({ op: 'level', player: 'Alice', skill: 'magic', delta: 1 }) !== key({ op: 'level', player: 'Alice', skill: 'melee', delta: 1 }), 'level: one skill of one player is one setting');
check(key({ op: 'food', player: 'Alice', index: 0, item: '/items/a' }) === key({ op: 'food', player: 'Alice', index: 0, item: '/items/b' }) && key({ op: 'food', player: 'Alice', index: 0, item: '/items/a' }) !== key({ op: 'drink', player: 'Alice', index: 0, item: '/items/a' }), 'food and drink: one slot is one setting, a drink slot is not a food slot');
check(key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [] }, { op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) === key({ op: 'enhance', player: 'Alice', slot: 'ring', delta: 2 }, { op: 'trigger', player: 'Alice', hrid: AX, triggers: [{ value: 1 }] }) && key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [] }, { op: 'enhance', player: 'Alice', slot: 'ring', delta: 1 }) !== key({ op: 'trigger', player: 'Alice', hrid: AX, triggers: [] }), 'several ops: the key is all their targets together, in any order; a subset is another setting');
check(A.settingKey([]) === null && A.settingKey(undefined) === null, 'no ops: no key');

// ---- The helper on rows ----
const trig = (id, value, extra) => ({ id, player: 'Alice', cost: 0, ops: [{ op: 'trigger', player: 'Alice', hrid: AX, triggers: [{ value }] }], score: Infinity, ...extra });
const est = (r) => ({ score: r.cost > 0 ? r.buyerNet / r.cost : Infinity, net: r.buyerNet, gain: r.gain });
const hidden = (rows) => rows.filter((r) => r.hiddenAlt).map((r) => r.id);
const run = (rows) => { A.hideSettingAlternatives(rows, est); return rows; };
{
    // The picture: two values of one trigger, both accepted; the one with the higher buyer's gain stays.
    const rows = run([trig('t6400', 6400, { gain: 278, buyerNet: 356, accepted: true }), trig('t4550', 4550, { gain: 320, buyerNet: 390, accepted: true })]);
    check(!rows[1].hiddenAlt && rows[0].hiddenAlt === true, 'two trigger rows of one ability: the higher buyer gain (4550, not the lower bound) stays, the other is hidden', JSON.stringify(hidden(rows)));
}
{
    const rows = run([trig('weak-high', 1, { gain: 900, buyerNet: 900, accepted: false }), trig('ok-low', 2, { gain: 100, buyerNet: 100, accepted: true })]);
    check(!rows[1].hiddenAlt && rows[0].hiddenAlt === true, 'an accepted row stays over a rejected one that ranks higher (accepted rows come first)');
}
{
    const rows = run([trig('a', 1, { gain: 10, buyerNet: 5, accepted: false }), trig('b', 2, { gain: 30, buyerNet: 20, accepted: false }), trig('c', 3, { gain: 20, buyerNet: 20, accepted: false })]);
    check(hidden(rows).join() === 'a,c', 'no accepted row: the first in rankEst order stays (tie on the buyer net goes to the larger party gain)', JSON.stringify(hidden(rows)));
}
{
    const rows = run([trig('a', 1, { gain: 10, buyerNet: 5, accepted: true }), { ...trig('b', 1, { gain: 10, buyerNet: 5, accepted: true }), player: 'Bob', ops: [{ op: 'trigger', player: 'Bob', hrid: AX, triggers: [] }] }, { ...trig('c', 1, { gain: 10, buyerNet: 5, accepted: true }), ops: [{ op: 'trigger', player: 'Alice', hrid: AY, triggers: [] }] }]);
    check(hidden(rows).length === 0, 'rows of another player or another ability are not grouped');
}
{
    // Paid rows of one setting (equipment +5 and +6): the paid switch is on, the first in rankAcceptedFirst order stays (gain per price: 5/100 over 6/200), the rest are hidden.
    const rows = run([trig('p6', 6, { cost: 200, gain: 12, buyerNet: 6, accepted: true }), trig('p5', 5, { cost: 100, gain: 10, buyerNet: 5, accepted: true }), trig('p7', 7, { cost: 300, gain: 30, buyerNet: 7, accepted: true })]);
    check(A.GROUP_PAID === true && hidden(rows).join() === 'p6,p7' && !rows[1].hiddenAlt, 'paid rows of one setting are grouped (the paid switch is on): the best gain per price stays, the rest are hidden', JSON.stringify(hidden(rows)));
}
{
    const rows = run([trig('paid-ok', 2, { cost: 100, gain: 12, buyerNet: 6, accepted: true }), trig('paid-weak', 3, { cost: 10, gain: 1, buyerNet: 5, accepted: false })]);
    check(!rows[0].hiddenAlt && rows[1].hiddenAlt === true, 'paid rows: an accepted row stays over a rejected one with a better gain per price (accepted rows first)');
}
{
    const rows = run([trig('free', 1, { gain: 10, buyerNet: 5, accepted: true }), trig('paid', 2, { cost: 100, gain: 12, buyerNet: 6, accepted: true })]);
    check(!rows[0].hiddenAlt && rows[1].hiddenAlt === true, 'a free row and a paid row of one setting: the free row (score Infinity) stays, the paid one is hidden');
}
{
    const rows = run([trig('f1', 1, { gain: 10, buyerNet: 5, accepted: true, hiddenFood: true }), trig('f2', 2, { gain: 20, buyerNet: 6, accepted: true, hiddenFood: true }), { ...trig('x', 3, { gain: 5, buyerNet: 1, accepted: true }), ops: [] }]);
    check(hidden(rows).length === 0, 'a food-filling row (hiddenFood) and a row with no ops are left alone');
}
{
    // The generic function takes any key function: the policy (which rows are grouped) is the caller's.
    const rows = [trig('p5', 5, { cost: 100, gain: 10, buyerNet: 5, accepted: true }), trig('p6', 6, { cost: 200, gain: 12, buyerNet: 6, accepted: true })];
    A.hideAlternatives(rows, { keyOf: (r) => (r.cost > 150 ? null : A.settingKey(r.ops)), estOf: est });
    check(hidden(rows).length === 0, 'hideAlternatives: a row the key function gives null is never grouped (the policy is the caller\'s)');
}

// ---- The foods case: hideFoodRows is the same function keyed by player, flag hiddenFood ----
{
    const food = (id, player, extra) => ({ id, player, kind: 'food-fill', ...extra });
    const rows = [food('f1', 'Alice', { score: Infinity, buyerNet: 10, gain: 10, accepted: true }), food('f2', 'Alice', { score: Infinity, buyerNet: 20, gain: 20, accepted: true }), food('f3', 'Bob', { score: 1, buyerNet: 1, gain: 1, accepted: false }), { id: 'd1', player: 'Alice', kind: 'other' }];
    F.hideFoodRows(rows, (r) => r.kind === 'food-fill');
    check(rows.filter((r) => r.hiddenFood).map((r) => r.id).join() === 'f1' && rows.every((r) => !('hiddenAlt' in r)) && rows[3].hiddenFood === undefined, 'foods: one row per player, flag hiddenFood, other rows untouched');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
