// Node test for the profile age and the stored group export of userscript/mwics-exporter.user.js 0.12.0, synthetic data only (made-up names).
// Run: node userscript/test/profile-age.test.cjs
// Covers: the age in plain words; the fight start from the battle start; a member slot's seen / old in the export and its profileSeen;
// each way a profile is old (opened before the fight began, abilities differ, both) and a fresh one unmarked; the notice's words in each state;
// a slot with no profile and the own slot unchanged; the window record carries the group export of that very window (and only the own slot
// when only the own rows go); the group never enters the saved in-browser record; the record's size with a group of three players.
const assert = require('node:assert/strict');
const { buildGroupExport, trimBattle, groupNotice, ageText, fightStartOf, groupWithSelection, createRecorder, createSink, SINK, REC } = require('../mwics-exporter.user.js');

const G = ' (guild buffs from their profile)'; // the note a member's line has had since 0.7.0 when its profile gave the guild buffs
const J = (x) => JSON.parse(JSON.stringify(x));
const H = 3600000, D = 24 * H;
const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const FIGHT = NOW - 2 * D; // the fight began two days ago
const client = { abilityDetailMap: { '/abilities/aura_a': { isSpecialAbility: true }, '/abilities/x': {}, '/abilities/y': {}, '/abilities/z': {} }, itemDetailMap: {} };
const self = { type: 'init_character_data', character: { id: 10, name: 'ExampleSelf' }, characterSkills: [{ skillHrid: '/skills/attack', level: 50 }], characterItems: [], combatUnit: { combatAbilities: [{ abilityHrid: '/abilities/x', level: 5 }] } };
const unitOf = (id, name, abilities) => ({ isPlayer: true, character: { id, name }, name, combatAbilities: abilities.map((a) => ({ abilityHrid: a[0], level: a[1] })), combatConsumables: [] });
const battle = { type: 'new_battle', combatStartTime: new Date(FIGHT).toISOString().replace('Z', '123456Z'), players: [
    unitOf(11, 'ExampleB', [['/abilities/y', 40], ['/abilities/aura_a', 30]]),
    unitOf(10, 'ExampleSelf', [['/abilities/x', 5]]),
    unitOf(12, 'ExampleC', [['/abilities/z', 20]]),
] };
// A trimmed profile as trimProfile keeps it, seen at time t, with the given abilities.
const prof = (id, name, t, abilities) => ({ id, name, t, skills: { attack: 70 }, equipment: [], abilities: abilities.map((a) => ({ abilityHrid: a[0], level: a[1] })), abilityTriggers: {}, consumableTriggers: {}, houseRooms: {}, achievements: {}, guildBuffLevelMap: {} });
const same = [['/abilities/aura_a', 30], ['/abilities/y', 40]]; // ExampleB's battle abilities, in another order
const build = (profiles, extra) => buildGroupExport({ characterObj: self, clientObj: client, toggles: {}, members: trimBattle(battle), profiles, fightStart: FIGHT, ...extra });
const slotOf = (r, n) => r.slots.find((s) => s.slot === n);

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('ageText: just now, minutes, hours, days', () => {
    assert.equal(ageText(0), 'just now');
    assert.equal(ageText(59999), 'just now');
    assert.equal(ageText(60000), '1 min ago');
    assert.equal(ageText(59 * 60000), '59 min ago');
    assert.equal(ageText(H), '1 h ago');
    assert.equal(ageText(23 * H + 59 * 60000), '23 h ago');
    assert.equal(ageText(D), '1 day ago');
    assert.equal(ageText(3 * D + 5 * H), '3 days ago');
    assert.equal(ageText(-5000), 'just now', 'a clock a little ahead never reads negative');
});

test('fightStartOf: the battle start\'s combatStartTime (nanoseconds cut), null when it does not parse', () => {
    assert.equal(fightStartOf({ combatStartTime: '2026-11-02T19:49:58.01687973Z' }), Date.parse('2026-11-02T19:49:58.016Z'));
    assert.equal(fightStartOf(battle), FIGHT + 0, 'the made-up battle start');
    assert.equal(fightStartOf({ combatStartTime: 'x' }), null);
    assert.equal(fightStartOf({}), null);
    assert.equal(fightStartOf(null), null);
});

test('a fresh profile (opened after the fight began, same abilities): seen and profileSeen, not old; the notice says complete and its age', () => {
    const r = build([prof(11, 'ExampleB', NOW - 3 * H, same)]);
    const s = slotOf(r, 1);
    assert.equal(s.seen, NOW - 3 * H);
    assert.equal(s.old, undefined);
    assert.deepEqual(s.missing, []);
    assert.equal(r.group['1'].profileSeen, new Date(NOW - 3 * H).toISOString());
    const note = groupNotice('group copied', r.slots, ', then copy again', NOW);
    assert.equal(note.lines[0], 'slot 1: complete, profile opened 3 h ago' + G);
    assert.ok(!/OLD|Open the profile of/.test(note.text));
});

test('opened before the fight began: old beforeFight; the line reads OLD profile with its age, never complete, and asks to open it', () => {
    const r = build([prof(11, 'ExampleB', FIGHT - D, same)]);
    assert.deepEqual(slotOf(r, 1).old, ['beforeFight']);
    assert.equal(r.group['1'].profileSeen, new Date(FIGHT - D).toISOString(), 'the age goes into the export too');
    const note = groupNotice('group copied', r.slots, ', then copy again', NOW);
    assert.equal(note.lines[0], 'slot 1: OLD profile, opened 3 days ago, before this fight began' + G);
    assert.ok(!/complete/.test(note.lines[0]));
    assert.equal(note.gaps, true, 'the notice stays up longer');
    assert.ok(note.text.includes('Open the profile of ExampleB (slot 1) in the game, then copy again.'), note.text);
});

test('abilities differ from the fight (a level, an ability): old abilities, even when opened after the fight began', () => {
    const lvl = build([prof(11, 'ExampleB', NOW - 10 * 60000, [['/abilities/y', 39], ['/abilities/aura_a', 30]])]);
    assert.deepEqual(slotOf(lvl, 1).old, ['abilities']);
    assert.equal(groupNotice('group copied', lvl.slots, ', then copy again', NOW).lines[0], 'slot 1: OLD profile, opened 10 min ago, abilities differ from this fight' + G);
    const other = build([prof(11, 'ExampleB', NOW - 10 * 60000, [['/abilities/z', 40], ['/abilities/aura_a', 30]])]);
    assert.deepEqual(slotOf(other, 1).old, ['abilities']);
    const fewer = build([prof(11, 'ExampleB', NOW - 10 * 60000, [['/abilities/y', 40]])]);
    assert.deepEqual(slotOf(fewer, 1).old, ['abilities']);
});

test('both: opened before the fight and abilities differ; two old slots are both asked for', () => {
    const r = build([prof(11, 'ExampleB', FIGHT - H, [['/abilities/y', 1]]), prof(12, 'ExampleC', FIGHT - 2 * D, [['/abilities/z', 20]])]);
    assert.deepEqual(slotOf(r, 1).old, ['beforeFight', 'abilities']);
    assert.deepEqual(slotOf(r, 3).old, ['beforeFight']);
    const note = groupNotice('group copied', r.slots, ', then copy again', NOW);
    assert.equal(note.lines[0], 'slot 1: OLD profile, opened 2 days ago, before this fight began and abilities differ from this fight' + G);
    assert.equal(note.lines[2], 'slot 3: OLD profile, opened 4 days ago, before this fight began' + G);
    assert.ok(note.text.includes('Open the profile of ExampleB (slot 1) and ExampleC (slot 3) in the game, then copy again.'), note.text);
});

test('an old profile that also lacks a kind names both; the import notice uses its own words to retry', () => {
    const p = prof(11, 'ExampleB', FIGHT - D, same); delete p.guildBuffLevelMap;
    const r = build([p]);
    const note = groupNotice('party imported from the game tab (2 min old)', r.slots, ', then press this button again', NOW);
    assert.equal(note.lines[0], 'slot 1: OLD profile, opened 3 days ago, before this fight began, missing guild buffs');
    assert.ok(note.text.includes('Open the profile of ExampleB (slot 1) in the game, then press this button again.'));
    assert.ok(note.text.endsWith('What is missing keeps its value in the simulator.'));
});

test('no fight start known: only the abilities rule applies', () => {
    const r = build([prof(11, 'ExampleB', FIGHT - 5 * D, same)], { fightStart: null });
    assert.equal(slotOf(r, 1).old, undefined);
    assert.equal(slotOf(r, 1).seen, FIGHT - 5 * D);
});

test('a slot with no profile keeps saying so, as before; the own slot carries no age; without now the lines carry no age', () => {
    const r = build([prof(11, 'ExampleB', NOW - H, same)]);
    const c = slotOf(r, 3), me = slotOf(r, 2);
    assert.equal(c.seen, undefined); assert.equal(c.old, undefined); assert.equal(r.group['3'].profileSeen, undefined);
    assert.equal(me.seen, undefined); assert.equal(me.old, undefined); assert.equal(r.group['2'].profileSeen, undefined);
    const note = groupNotice('group copied', r.slots, ', then copy again', NOW);
    assert.equal(note.lines[1], 'slot 2 (you): complete');
    assert.equal(note.lines[2], 'slot 3: missing levels, gear, triggers, house rooms, achievements, guild buffs');
    assert.ok(note.text.includes("Open each member's profile in the game for levels, gear, triggers, house rooms, achievements and guild buffs, then copy again."));
    assert.equal(groupNotice('group copied', r.slots, ', then copy again').lines[0], 'slot 1: complete' + G, 'no now: the line as in 0.11.0');
});

// ---- the window record carries the group export ----
const unit = (o) => ({ currentHitpoints: 100, maxHitpoints: 100, currentManapoints: 10, maxManapoints: 10, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0, preparingAbilityHrid: '', isPreparingAutoAttack: true, combatDetails: { combatStats: {} }, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0, ...o });
const NB = (id, start, tier) => ({ type: 'new_battle', battleId: id, combatStartTime: start || 'S1', players: [unit({ character: { id: 10, name: 'ExampleSelf' } }), unit({ character: { id: 11, name: 'ExampleB' } })], monsters: [{ ...unit({}), hrid: '/monsters/m', difficultyTier: tier || 0 }] });
const groupRec = (t, profiles) => { const r = build(profiles); return { t, export: J(groupWithSelection(r, null)), slots: J(r.slots) }; };
function sinkOf(rec, selfOnly) {
    const bodies = [];
    const sink = createSink({ recorder: rec, enabled: () => true, selfOnly: () => !!selfOnly, now: () => 1e6, setTimer: () => 0, log() {}, post: async (b) => { bodies.push(J(b)); return { ok: true, status: 200, text: JSON.stringify({ accepted: b.records.length, duplicate: 0, rejected: 0 }) }; } });
    return { sink, bodies, windows: () => bodies.flatMap((b) => b.records).filter((x) => x.type === 'window') };
}
const settle = async (s) => { await s.sink.finish(); for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
    const atest = async (name, fn) => { await fn(); n++; console.log('ok - ' + name); };

    await atest('the window record carries the group export given for that window, with the ages; a later one replaces it while the window is open', async () => {
        const rec = createRecorder({});
        rec.handle({ type: 'init_character_data', character: { id: 10 } }, 1);
        const g1 = groupRec(100, [prof(11, 'ExampleB', FIGHT - D, same)]);
        rec.handle(NB(1), 1000);
        rec.setGroup(g1);
        const s = sinkOf(rec);
        await settle(s);
        let w = s.windows().pop();
        assert.deepEqual(w.data.group, g1);
        assert.equal(w.data.group.export['1'].profileSeen, new Date(FIGHT - D).toISOString());
        assert.deepEqual(w.data.group.slots[0].old, ['beforeFight']);
        const g2 = groupRec(200, [prof(11, 'ExampleB', NOW, same)]);
        rec.setGroup(g2);
        rec.handle(NB(2), 2000);
        await settle(s);
        w = s.windows().pop();
        assert.deepEqual(w.data.group, g2, 'the profile opened during the window: its record now has the fresh one');
        assert.equal(w.data.group.slots[0].old, undefined);
    });

    await atest('a new window takes the last group given; the closed window keeps its own; no group given, no field', async () => {
        const rec = createRecorder({});
        rec.handle({ type: 'init_character_data', character: { id: 10 } }, 1);
        const s0 = sinkOf(rec);
        rec.handle(NB(1, 'S1'), 1000);
        await settle(s0);
        assert.equal(s0.windows().pop().data.group, undefined, 'no group given yet: the record is as in 0.11.0');
        const gA = groupRec(100, [prof(11, 'ExampleB', NOW - H, same)]);
        rec.setGroup(gA);
        const gB = groupRec(300, [prof(11, 'ExampleB', NOW, same)]);
        rec.handle(NB(2, 'S2'), 2000); // another fight: a new window
        const second = rec.state.windows[1].startedAt;
        assert.deepEqual(rec.state.groups.get(second), gA, 'the new window starts with the last group');
        rec.setGroup(gB);
        rec.handle(NB(3, 'S2'), 3000);
        const s = sinkOf(rec);
        await settle(s);
        const byStart = Object.fromEntries(s.windows().map((x) => [x.data.startedAt, x.data.group]));
        assert.deepEqual(byStart[second], gB);
        assert.deepEqual(byStart[rec.state.windows[0].startedAt], gA, 'the first window kept the group it last had');
    });

    await atest('only the own rows: the group is cut to the own slot', async () => {
        const rec = createRecorder({});
        rec.handle({ type: 'init_character_data', character: { id: 10 } }, 1);
        rec.handle(NB(1), 1000);
        rec.setGroup(groupRec(100, [prof(11, 'ExampleB', NOW - H, same)]));
        const s = sinkOf(rec, true);
        await settle(s);
        const g = s.windows().pop().data.group;
        assert.deepEqual(Object.keys(g.export), ['2', 'selected']);
        assert.deepEqual(g.export.selected, [2]);
        assert.deepEqual(g.slots.map((x) => x.slot), [2]);
        assert.ok(!JSON.stringify(g).includes('ExampleB'), 'no other member in what is sent');
    });

    await atest('the group never enters the saved in-browser record; the recent groups are capped', () => {
        const rec = createRecorder({});
        rec.handle(NB(1, 'S0'), 1000);
        rec.setGroup(groupRec(1, []));
        assert.ok(!JSON.stringify(rec.persistable()).includes('"group"'));
        for (let i = 1; i <= REC.MAX_GROUPS + 5; i++) rec.handle(NB(i + 1, 'S' + i), 1000 + i * 1000);
        assert.equal(rec.state.groups.size, REC.MAX_GROUPS);
        rec.clear();
        assert.equal(rec.state.groups.size, 0);
    });

    await atest('size: a group of three players with full profiles adds its own size to a window record, well inside the helper\'s 1 MB a record', async () => {
        // Three members' worth of profile data, at the size a real one has (about 150 achievements, triggers on every ability and consumable).
        const big = (id, name) => { const p = prof(id, name, NOW - H, id === 11 ? same : [['/abilities/z', 20]]); for (let i = 0; i < 150; i++) p.achievements['/achievements/example_achievement_' + i] = i % 3 > 0; for (const h of ['/abilities/y', '/abilities/z', '/abilities/aura_a', '/items/example_food', '/items/example_drink']) p.abilityTriggers[h] = Array.from({ length: 4 }, (_, k) => ({ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/example_condition_' + k, comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: k * 10 })); for (let i = 0; i < 20; i++) p.houseRooms['/house_rooms/example_room_' + i] = 4; p.equipment = Array.from({ length: 12 }, (_, i) => ({ itemLocationHrid: '/item_locations/slot_' + i, itemHrid: '/items/example_item_' + i, enhancementLevel: 5 })); return p; };
        const g = groupRec(100, [big(11, 'ExampleB'), big(12, 'ExampleC')]);
        const gBytes = JSON.stringify(g).length;
        const rec = createRecorder({});
        rec.handle({ type: 'init_character_data', character: { id: 10 } }, 1);
        rec.handle(NB(1), 1000);
        const plain = sinkOf(rec); await settle(plain);
        const before = JSON.stringify(plain.windows().pop()).length;
        rec.setGroup(g);
        rec.handle(NB(2), 2000);
        const withG = sinkOf(rec); await settle(withG);
        const w = withG.windows().pop();
        const after = JSON.stringify(w).length;
        const bare = { ...w, data: { ...w.data } }; delete bare.data.group;
        assert.equal(after - JSON.stringify(bare).length, gBytes + ',"group":'.length, 'the record grows by the group itself');
        console.log('  group ' + gBytes + ' B; window record ' + before + ' B with no group (one battle), ' + after + ' B with it (two battles)');
        assert.ok(gBytes < 96 * 1024, 'a three-player group stays under 96 KB');
        assert.ok(667 * 1024 + gBytes + 64 < SINK.BATCH_BYTES, 'the largest window recorded so far (667 KB) plus the group still fits one batch, below the helper\'s 1 MB a record');
    });

    console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
