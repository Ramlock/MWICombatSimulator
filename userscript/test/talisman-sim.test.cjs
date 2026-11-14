// Node test for userscript/mwics-exporter.user.js 0.11.0, on made-up messages and invented talisman lines (no real player's data):
// the character export carries the simulator's talisman field, and the recorder's healing sources keep Life Drain's drain out of Bloom.
// Run: node userscript/test/talisman-sim.test.cjs
// Covers: the field's shape { power, lines: [{ modifier, grade }] } from the game's list (slotted talismans only, slot order, pending rolls left out),
// no field without talisman data or without an equipped line, the gear switch, the recorder's live list over the payload's, the party export's self slot
// only; HP gained in the healer's own Life Drain cast goes under Life Drain's key and never under bloom, a Bloom heal on a plain cast stays bloom,
// another player's Life Drain cast is no Bloom update, and the export's note for healed.bySource.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(SRC, { module: mod, console });
const { buildExport, buildGroupExport, createRecorder, HEALED_NOTE } = mod.exports;
const J = (x) => JSON.parse(JSON.stringify(x));

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n', (e && e.stack) || e); } };

const MOD = (id, group, values) => ({ hrid: '/talisman_modifiers/' + id, name: id, groupHrid: '/talisman_modifier_groups/' + group, gradeValues: values });
const CLIENT = {
    abilityDetailMap: {
        '/abilities/quick_aid': { abilityEffects: [{ effectType: '/ability_effect_types/heal', damageOverTimeRatio: 0 }] },
        '/abilities/life_drain': { abilityEffects: [{ effectType: '/ability_effect_types/damage', damageOverTimeRatio: 0, hpDrainRatio: 0.08 }] },
        '/abilities/water_strike': { abilityEffects: [{ effectType: '/ability_effect_types/damage', damageOverTimeRatio: 0, hpDrainRatio: 0 }] },
    },
    itemDetailMap: {},
    talismanModifierDetailMap: {
        '/talisman_modifiers/armor': MOD('armor', 'defense', [2, 3, 4, 5, 6, 8]),
        '/talisman_modifiers/magic_damage': MOD('magic_damage', 'offense', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
        '/talisman_modifiers/echo': MOD('echo', 'special', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
    },
};
const tal = (id, slotIndex, modifiers, extra) => ({ id, characterID: 1, talismanTypeHrid: '/talisman_types/combat', modifiers, pendingModifiers: null, lockedModifierHrid: '', slotIndex, ...extra });
const m = (id, grade) => ({ hrid: '/talisman_modifiers/' + id, grade });
const character = (talismans, power) => ({
    character: { id: 1, name: 'Player 1' },
    characterSkills: [], characterItems: [], characterHouseRoomMap: {}, characterAchievements: [],
    combatUnit: { combatAbilities: [], combatDetails: { combatStats: power === undefined ? {} : { talismanPower: power } } },
    ...(talismans === undefined ? {} : { characterTalismans: talismans }),
});
const LIST = [tal(11, 2, [m('magic_damage', 3)]), tal(12, 0, [m('armor', 6)]), tal(10, 1, [m('armor', 2), m('echo', 1)], { pendingModifiers: [m('magic_damage', 6)] })];

test('export: the field is every line of every slotted talisman, in slot order, with the talisman power', () => {
    const out = J(buildExport(character(LIST, 0.2), CLIENT, {}));
    assert.deepEqual(out.talismans, { power: 0.2, lines: [{ modifier: 'armor', grade: 2 }, { modifier: 'echo', grade: 1 }, { modifier: 'magic_damage', grade: 3 }] });
});
test('export: no talisman data, an empty list, or no slotted talisman gives no field', () => {
    assert.equal('talismans' in J(buildExport(character(undefined, 0.2), CLIENT, {})), false);
    assert.equal('talismans' in J(buildExport(character([], 0.2), CLIENT, {})), false);
    assert.equal('talismans' in J(buildExport(character([tal(12, 0, [m('armor', 6)])], 0.2), CLIENT, {})), false);
});
test('export: no talisman power from the game leaves power out (the simulator reads 0)', () => {
    assert.deepEqual(J(buildExport(character([tal(1, 1, [m('armor', 4)])]), CLIENT, {})).talismans, { lines: [{ modifier: 'armor', grade: 4 }] });
});
test('export: the field goes with the gear switch', () => {
    assert.equal('talismans' in J(buildExport(character(LIST, 0.2), CLIENT, { gear: false })), false);
});
test("export: the recorder's live list and power win over the payload's once it has seen the game's list", () => {
    const live = { seen: true, power: 0.224, list: [tal(20, 1, [m('magic_damage', 1)])] };
    assert.deepEqual(J(buildExport(character(LIST, 0.2), CLIENT, {}, live)).talismans, { power: 0.224, lines: [{ modifier: 'magic_damage', grade: 1 }] });
    assert.equal(J(buildExport(character(LIST, 0.2), CLIENT, {}, { list: [], power: null })).talismans.power, 0.2); // not seen: the payload's
});
test('party export: the self slot carries the field, other members none', () => {
    const co = { ...character(LIST, 0.2), partyInfo: { partySlotMap: { a: { characterID: 1 }, b: { characterID: 2 } } } };
    const res = buildGroupExport({ characterObj: co, clientObj: CLIENT, toggles: {}, members: [{ id: 1, name: 'Player 1' }, { id: 2, name: 'Player 2', abilities: [] }], profiles: [] });
    const slots = Object.values(J(res.group)).filter((v) => v && typeof v === 'object').map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
    const self = slots.find((s) => s.talismans);
    assert.ok(self && self.talismans.lines.length === 3, JSON.stringify(res.group).slice(0, 400));
    assert.equal(slots.filter((s) => s.talismans).length, 1);
});

// ---- the recorder's healing sources ----
const unit = (o) => ({
    currentHitpoints: 1000, maxHitpoints: 1000, currentManapoints: 100, maxManapoints: 100, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0,
    preparingAbilityHrid: '', isPreparingAutoAttack: true, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0,
    combatDetails: { combatStats: { hpRegenPer10: 0 } }, ...o,
});
const bloomer = (ab) => unit({ currentHitpoints: 500, preparingAbilityHrid: ab, isPreparingAutoAttack: false, combatAbilities: [{ abilityHrid: ab, level: 1 }], combatDetails: { combatStats: { hpRegenPer10: 0, bloom: 0.1 } } });
const mon = (hrid) => unit({ hrid, isBoss: false, difficultyTier: 1 });
const NB = (battleId, players, monsters) => ({ type: 'new_battle', battleId, combatStartTime: '2026-01-01T00:00:00Z', wave: 0, players, monsters });
const ent = (cHP, atk, dmg, extra) => ({ cHP, mHP: 1000, cMP: 100, mMP: 100, isActive: true, leftCombat: false, atkCounter: atk, int: 1, dmgCounter: dmg, critCounter: 0, ...extra });
const BU = (battleId, pMap, mMap) => ({ type: 'battle_updated', battleId, pMap: pMap || {}, mMap: mMap || {} });
const run = (players, updates) => {
    const r = createRecorder({ clientData: () => CLIENT });
    r.handle(NB(1, players, [mon('/monsters/m')]), 1000);
    updates.forEach((u, i) => r.handle(u, 1100 + i * 100));
    r.handle(NB(999, [unit()], [mon('/monsters/m')]), 5000);
    return r.state.encounters[r.state.encounters.length - 1];
};

test("recorder: HP gained in the player's own Life Drain cast goes under Life Drain's key, never under bloom", () => {
    const e = run([bloomer('/abilities/life_drain')], [BU(1, { 0: ent(580, 1, 0) }, { 0: ent(900, 0, 1) })]);
    assert.equal(e.players[0].healed.bySource['/abilities/life_drain'], 80, JSON.stringify(e.players[0].healed));
    assert.equal(e.players[0].healed.bySource.bloom, undefined);
});
test('recorder: a Bloom heal in a cast of an ability that does not heal by itself stays bloom', () => {
    const e = run([bloomer('/abilities/water_strike')], [BU(1, { 0: ent(560, 1, 0) }, { 0: ent(900, 0, 1) })]);
    assert.equal(e.players[0].healed.bySource.bloom, 60, JSON.stringify(e.players[0].healed));
});
test("recorder: another player's Life Drain cast is not a Bloom update for the healed player", () => {
    const e = run([unit({ currentHitpoints: 500 }), bloomer('/abilities/life_drain')], [BU(1, { 0: ent(560, 0, 0), 1: ent(500, 1, 0) }, { 0: ent(900, 0, 1) })]);
    assert.equal(e.players[0].healed.bySource.bloom, undefined, JSON.stringify(e.players[0].healed));
    assert.equal(e.players[0].healed.bySource['/abilities/life_drain'], undefined);
});
test("recorder: the export's note for healed.bySource says what bloom and a self-healing ability's key hold", () => {
    const r = createRecorder({ clientData: () => CLIENT });
    const out = r.exportData(false, Date.UTC(2026, 0, 1));
    assert.equal(out.healedBySource, HEALED_NOTE);
    assert.match(HEALED_NOTE, /Life Drain/);
    assert.match(HEALED_NOTE, /Bloom heal/);
});

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('PASS: talisman-sim.');
