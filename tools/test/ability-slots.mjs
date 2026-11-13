// Test: the one function that writes an import's abilities list to the ability slots (applyAbilitySlots in src/main.js, cut out of the
// source text and run against a stub page). Lists of 3, 4 and 5 entries, null entries (slot 0 and others), the aura and arcane_reflection renames.
// Generic made-up data. Usage: node tools/test/ability-slots.mjs   Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('function applyAbilitySlots');
const b = src.indexOf('\n}\n', a) + 3;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
check('the function is in src/main.js', a >= 0 && b > a);

// The stub page: five ability slots, each holding a marker the import must overwrite (or, for a slot it leaves alone, keep).
const run = (abilities) => {
    const els = {};
    for (let i = 0; i < 5; i++) { els['selectAbility_' + i] = { value: 'KEEP' }; els['inputAbilityLevel_' + i] = { value: 'KEEP' }; }
    const ctx = { document: { getElementById: (id) => els[id] }, Object, String };
    vm.createContext(ctx);
    vm.runInContext(src.slice(a, b), ctx);
    let error = null;
    try { vm.runInContext('applyAbilitySlots(abilities)', Object.assign(ctx, { abilities })); } catch (e) { error = e; }
    return { error, slots: [0, 1, 2, 3, 4].map((i) => [els['selectAbility_' + i].value, els['inputAbilityLevel_' + i].value]) };
};
const ab = (hrid, level) => ({ abilityHrid: hrid, level });
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const KEEP = ['KEEP', 'KEEP'];
const EMPTY = ['', '1'];

// 5 entries: slots 0-4.
let r = run([ab('/abilities/a', 1), ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
check('5 abilities: slots 0-4 in order, levels as text', !r.error && same(r.slots, [['/abilities/a', '1'], ['/abilities/b', '2'], ['/abilities/c', '3'], ['/abilities/d', '4'], ['/abilities/e', '5']]), JSON.stringify(r));
// 4 entries: slots 1-4, slot 0 left alone.
r = run([ab('/abilities/a', 1), ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4)]);
check('4 abilities: slots 1-4, slot 0 untouched', !r.error && same(r.slots, [KEEP, ['/abilities/a', '1'], ['/abilities/b', '2'], ['/abilities/c', '3'], ['/abilities/d', '4']]), JSON.stringify(r));
// 3 entries (the file that failed): slots 1-3 written, slot 4 cleared, slot 0 untouched, no error.
r = run([ab('/abilities/flame_blast', 49), ab('/abilities/fireball', 29), ab('/abilities/firestorm', 1)]);
check('3 abilities: no error, slots 1-3 written, slot 4 cleared, slot 0 untouched', !r.error && same(r.slots, [KEEP, ['/abilities/flame_blast', '49'], ['/abilities/fireball', '29'], ['/abilities/firestorm', '1'], EMPTY]), JSON.stringify(r));
// Fewer.
r = run([ab('/abilities/a', 7), ab('/abilities/b', 8)]);
check('2 abilities: slots 1-2 written, slots 3-4 cleared', !r.error && same(r.slots, [KEEP, ['/abilities/a', '7'], ['/abilities/b', '8'], EMPTY, EMPTY]), JSON.stringify(r));
r = run([ab('/abilities/a', 7)]);
check('1 ability: slot 1 written, slots 2-4 cleared', !r.error && same(r.slots, [KEEP, ['/abilities/a', '7'], EMPTY, EMPTY, EMPTY]), JSON.stringify(r));
r = run([]);
check('no abilities: slots 1-4 cleared, slot 0 untouched', !r.error && same(r.slots, [KEEP, EMPTY, EMPTY, EMPTY, EMPTY]), JSON.stringify(r));
r = run(undefined);
check('abilities missing (undefined): slots 1-4 cleared, no error', !r.error && same(r.slots, [KEEP, EMPTY, EMPTY, EMPTY, EMPTY]), JSON.stringify(r));
// Null entries.
r = run([null, ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
check('5 abilities, slot 0 null: no error, slot 0 cleared, the rest written', !r.error && same(r.slots, [EMPTY, ['/abilities/b', '2'], ['/abilities/c', '3'], ['/abilities/d', '4'], ['/abilities/e', '5']]), JSON.stringify(r));
r = run([ab('/abilities/a', 1), null, ab('/abilities/c', 3), null, ab('/abilities/e', 5)]);
check('5 abilities, nulls inside: those slots cleared, the rest written', !r.error && same(r.slots, [['/abilities/a', '1'], EMPTY, ['/abilities/c', '3'], EMPTY, ['/abilities/e', '5']]), JSON.stringify(r));
r = run([ab('/abilities/a', 1), null, ab('/abilities/c', 3), ab('/abilities/d', 4)]);
check('4 abilities, a null inside: that slot cleared', !r.error && same(r.slots, [KEEP, ['/abilities/a', '1'], EMPTY, ['/abilities/c', '3'], ['/abilities/d', '4']]), JSON.stringify(r));
r = run([null, null, null, null, null]);
check('5 nulls: every slot cleared', !r.error && same(r.slots, [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]), JSON.stringify(r));
r = run([null]);
check('a list of one null: slot 1 cleared, no error', !r.error && same(r.slots, [KEEP, EMPTY, EMPTY, EMPTY, EMPTY]), JSON.stringify(r));

// The renames.
for (const old of ['aqua_aura', 'flame_aura', 'sylvan_aura']) {
    r = run([ab('/abilities/' + old, 3), ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
    check(old + ' in special slot 0 becomes the mystic aura', !r.error && same(r.slots[0], ['/abilities/mystic_aura', '3']), JSON.stringify(r.slots[0]));
    r = run([ab('/abilities/' + old, 3), ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4)]);
    check(old + ' in a 4-entry list (slot 1, not the special slot) is not renamed', !r.error && same(r.slots[1], ['/abilities/' + old, '3']), JSON.stringify(r.slots[1]));
}
r = run([ab('/abilities/a', 1), ab('/abilities/aqua_aura', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
check('an aura name in slot 1 of a 5-entry list is not renamed', same(r.slots[1], ['/abilities/aqua_aura', '2']), JSON.stringify(r.slots[1]));
for (const [n, list] of [[5, [ab('/abilities/a', 1), ab('/abilities/arcane_reflection', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]], [4, [ab('/abilities/a', 1), ab('/abilities/arcane_reflection', 2), ab('/abilities/c', 3), ab('/abilities/d', 4)]], [3, [ab('/abilities/a', 1), ab('/abilities/arcane_reflection', 2), ab('/abilities/c', 3)]]]) {
    r = run(list);
    check('arcane_reflection becomes retribution (' + n + ' entries)', !r.error && same(r.slots[n === 5 ? 1 : 2], ['/abilities/retribution', '2']), JSON.stringify(r));
}
r = run([ab('/abilities/arcane_reflection', 9), ab('/abilities/b', 2), ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
check('arcane_reflection in slot 0 becomes retribution', same(r.slots[0], ['/abilities/retribution', '9']), JSON.stringify(r.slots[0]));
r = run([ab('/abilities/arcane_reflection', 9), null, ab('/abilities/c', 3), ab('/abilities/d', 4), ab('/abilities/e', 5)]);
check('a rename and a null in one list both work', !r.error && same(r.slots.slice(0, 2), [['/abilities/retribution', '9'], EMPTY]), JSON.stringify(r));

console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
