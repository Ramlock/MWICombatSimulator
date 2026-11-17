// Node test for userscript/mwics-exporter.user.js 0.13.0, on made-up talismans only (no real player's data): the character export's
// talismanInventory, every talisman the character owns, equipped or not.
// Run: node userscript/test/talisman-inventory.test.cjs
// Covers: equipped and unequipped talismans each with its slot and lines (value, locked, unique); a roll waiting to be accepted under pending and never
// among lines; the locked line; no field for an empty list or no talisman data; its own option (off leaves it out, the gear switch does not touch it);
// the recorder's live list over the payload's; the party export: the own slot carries it only in the snapshot for the page (ownExport), a member never;
// the simulator's talismans field and the encounter record's talismanLines unchanged beside it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(SRC, { module: mod, console });
const { buildExport, buildGroupExport, talismanLines, KINDS } = mod.exports;
const J = (x) => JSON.parse(JSON.stringify(x));

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n', (e && e.stack) || e); } };

const MOD = (id, group, values) => ({ hrid: '/talisman_modifiers/' + id, name: id, groupHrid: '/talisman_modifier_groups/' + group, gradeValues: values });
const CLIENT = {
    abilityDetailMap: {}, itemDetailMap: {},
    talismanModifierDetailMap: {
        '/talisman_modifiers/synth_armor': MOD('synth_armor', 'defense', [2, 3, 4, 5, 6, 8]),
        '/talisman_modifiers/synth_power': MOD('synth_power', 'offense', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
        '/talisman_modifiers/synth_echo': MOD('synth_echo', 'special', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
    },
};
const tal = (id, slotIndex, modifiers, extra) => ({ id, characterID: 1, talismanTypeHrid: '/talisman_types/synth_type', modifiers, pendingModifiers: null, lockedModifierHrid: '', slotIndex, ...extra });
const m = (id, grade) => ({ hrid: '/talisman_modifiers/' + id, grade });
const L = (id, grade, value, unique, locked = false) => ({ hrid: '/talisman_modifiers/' + id, grade, value, locked, unique });
const character = (talismans, power) => ({
    character: { id: 1, name: 'Player 1' },
    characterSkills: [], characterItems: [], characterHouseRoomMap: {}, characterAchievements: [],
    combatUnit: { combatAbilities: [], combatDetails: { combatStats: power === undefined ? {} : { talismanPower: power } } },
    ...(talismans === undefined ? {} : { characterTalismans: talismans }),
});
// Slot 2, an unequipped one with a locked line, slot 1 with a waiting roll, another unequipped one (no slotIndex at all).
const LIST = [
    tal(11, 2, [m('synth_power', 3)]),
    tal(12, 0, [m('synth_armor', 6), m('synth_power', 1)], { lockedModifierHrid: '/talisman_modifiers/synth_armor' }),
    tal(10, 1, [m('synth_armor', 2), m('synth_echo', 1)], { pendingModifiers: [m('synth_power', 6), m('synth_armor', 4)] }),
    tal(13, undefined, [m('synth_unknown', 2)]),
];
const EXPECTED = [
    { id: 10, type: '/talisman_types/synth_type', slotIndex: 1, locked: '', lines: [L('synth_armor', 2, 3, false), L('synth_echo', 1, 0.03, true)], pending: [L('synth_power', 6, 0.12, false), L('synth_armor', 4, 5, false)], equipped: true },
    { id: 11, type: '/talisman_types/synth_type', slotIndex: 2, locked: '', lines: [L('synth_power', 3, 0.06, false)], equipped: true },
    { id: 12, type: '/talisman_types/synth_type', slotIndex: 0, locked: '/talisman_modifiers/synth_armor', lines: [L('synth_armor', 6, 8, false, true), L('synth_power', 1, 0.03, false)], equipped: false },
    { id: 13, type: '/talisman_types/synth_type', slotIndex: 0, locked: '', lines: [L('synth_unknown', 2, null, null)], equipped: false },
];

test('the option sits beside Inventory, on by default', () => {
    const keys = KINDS.map((k) => k.key);
    assert.equal(keys.indexOf('talismanInventory'), keys.indexOf('inventory') + 1);
    assert.equal(KINDS.find((k) => k.key === 'talismanInventory').label, 'Talisman inventory');
    assert.equal(mod.exports.defaultToggles().talismanInventory, true);
});
test('every talisman, equipped (slot order) then unequipped (game order), each with its slot and its lines', () => {
    assert.deepEqual(J(buildExport(character(LIST, 0.2), CLIENT, {})).talismanInventory, EXPECTED);
});
test('a waiting roll is under pending, never among lines; no roll: no pending key', () => {
    const out = J(buildExport(character(LIST, 0.2), CLIENT, {})).talismanInventory;
    const t10 = out.find((t) => t.id === 10);
    assert.equal(t10.lines.some((l) => l.grade === 6), false);
    assert.equal(t10.pending.length, 2);
    assert.equal('pending' in out.find((t) => t.id === 11), false);
    assert.equal('pending' in J(buildExport(character([tal(1, 1, [m('synth_power', 1)], { pendingModifiers: [] })]), CLIENT, {})).talismanInventory[0], false);
});
test('the locked line: the talisman names it and only that line is flagged', () => {
    const t12 = J(buildExport(character(LIST, 0.2), CLIENT, {})).talismanInventory.find((t) => t.id === 12);
    assert.equal(t12.locked, '/talisman_modifiers/synth_armor');
    assert.deepEqual(t12.lines.map((l) => l.locked), [true, false]);
});
test('no talisman data, or an empty list: no field (absent, never empty)', () => {
    assert.equal('talismanInventory' in J(buildExport(character(undefined, 0.2), CLIENT, {})), false);
    assert.equal('talismanInventory' in J(buildExport(character([], 0.2), CLIENT, {})), false);
    assert.equal('talismanInventory' in J(buildExport(character([], 0.2), CLIENT, {}, { seen: true, list: [], power: null })), false);
});
test('the option off leaves it out; the gear switch does not touch it', () => {
    const off = J(buildExport(character(LIST, 0.2), CLIENT, { talismanInventory: false }));
    assert.equal('talismanInventory' in off, false);
    assert.ok(off.talismans, 'the equipped field stays with the option off');
    const noGear = J(buildExport(character(LIST, 0.2), CLIENT, { gear: false }));
    assert.equal(noGear.talismanInventory.length, 4);
    assert.equal('talismans' in noGear, false);
});
test("the recorder's live list wins over the payload's once it has seen the game's list, else the payload's", () => {
    const live = { seen: true, power: 0.3, list: [tal(20, 0, [m('synth_power', 1)])] };
    assert.deepEqual(J(buildExport(character(LIST, 0.2), CLIENT, {}, live)).talismanInventory.map((t) => t.id), [20]);
    assert.deepEqual(J(buildExport(character(LIST, 0.2), CLIENT, {}, { list: [], power: null })).talismanInventory.map((t) => t.id), [10, 11, 12, 13]);
});
test('the simulator talismans field and the encounter record (talismanLines) are what they were', () => {
    const out = J(buildExport(character(LIST, 0.2), CLIENT, {}));
    assert.deepEqual(out.talismans, { power: 0.2, lines: [{ modifier: 'synth_armor', grade: 2 }, { modifier: 'synth_echo', grade: 1 }, { modifier: 'synth_power', grade: 3 }] });
    const rec = J(talismanLines(LIST, CLIENT));
    assert.deepEqual(rec.map((t) => t.id), [10, 11]);
    assert.deepEqual(rec[0], { id: 10, type: '/talisman_types/synth_type', slotIndex: 1, locked: '', lines: [L('synth_armor', 2, 3, false), L('synth_echo', 1, 0.03, true)] });
});
const party = (ownExport, toggles = {}) => {
    const co = { ...character(LIST, 0.2), partyInfo: { partySlotMap: { a: { characterID: 1 }, b: { characterID: 2 } } } };
    const res = buildGroupExport({ characterObj: co, clientObj: CLIENT, toggles, ownExport, members: [{ id: 1, name: 'Player 1' }, { id: 2, name: 'Player 2', abilities: [] }], profiles: [] });
    return Object.values(J(res.group)).filter((v) => v && typeof v === 'object').map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
};
test('party export: the own slot carries it in the snapshot for the page only; a member never', () => {
    const snap = party(true);
    assert.equal(snap.filter((s) => s.talismanInventory).length, 1);
    assert.deepEqual(snap.find((s) => s.talismanInventory).talismanInventory, EXPECTED);
    assert.equal(party(false).some((s) => 'talismanInventory' in s), false);
    assert.equal(party(true, { talismanInventory: false }).some((s) => 'talismanInventory' in s), false);
});

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('PASS: talisman-inventory.');
