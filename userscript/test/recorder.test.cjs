// Node test for the combat recorder in userscript/mwics-exporter.user.js, on made-up messages (no real player's data).
// Run: node userscript/test/recorder.test.cjs
// Covers: damage attribution by counters (hit, miss, crit, auto attack record without abilityHrid), damage over time ticks,
// ambiguous ticks kept raw, encounters without new_battle skipped, loot/XP/consumable differences (count change split into
// consume and trade by the cooldown restart), food heal over time and healMismatch, regen and heal sources, windows,
// kills, anonymity and selfOnly, tasks, persistence and caps.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'userscript', 'mwics-exporter.user.js'), 'utf8'), { module: mod, console });
const { createRecorder, REC, unpackHits } = mod.exports;
const J = (x) => JSON.parse(JSON.stringify(x));

const GAME = {
    abilityDetailMap: {
        '/abilities/firestorm': { abilityEffects: [{ effectType: '/ability_effect_types/damage', damageOverTimeRatio: 1, damageOverTimeDuration: 6e9, buffs: null }] },
        '/abilities/quick_aid': { abilityEffects: [{ effectType: '/ability_effect_types/heal', damageOverTimeRatio: 0 }] },
        '/abilities/fear': { abilityEffects: [{ effectType: '/ability_effect_types/damage', damageOverTimeRatio: 0, buffs: [{ typeHrid: '/buff_types/x' }] }] },
    },
    itemDetailMap: {
        '/items/test_cake': { consumableDetail: { hitpointRestore: 300, manapointRestore: 0, recoveryDuration: 30e9, cooldownDuration: 60e9, buffs: null } },
        '/items/test_donut': { consumableDetail: { hitpointRestore: 280, manapointRestore: 0, recoveryDuration: 0, cooldownDuration: 60e9, buffs: null } },
    },
};
const unit = (o) => ({
    currentHitpoints: 1000, maxHitpoints: 1000, currentManapoints: 100, maxManapoints: 100, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0,
    preparingAbilityHrid: '', isPreparingAutoAttack: true, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0,
    combatDetails: { combatStats: { hpRegenPer10: 0.01, combatDropRate: 0.1, combatDropQuantity: 0, combatRareFind: 0 }, attackLevel: 10 }, ...o,
});
const mon = (hrid, o) => unit({ hrid, isBoss: false, difficultyTier: 1, ...o });
const NB = (battleId, players, monsters, extra) => ({ type: 'new_battle', battleId, combatStartTime: '2026-01-01T00:00:00Z', wave: 0, players, monsters, ...extra });
const ent = (cHP, atk, dmg, crit, extra) => ({ cHP, mHP: 1000, cMP: 100, mMP: 100, isActive: true, leftCombat: false, atkCounter: atk, int: 1, dmgCounter: dmg, critCounter: crit, ...extra });
const BU = (battleId, pMap, mMap) => ({ type: 'battle_updated', battleId, pMap: pMap || {}, mMap: mMap || {} });
const fresh = () => createRecorder({ clientData: () => GAME });
const lastEnc = (r) => r.state.encounters[r.state.encounters.length - 1];
const close = (r, t) => r.handle(NB(999, [unit()], [mon('/monsters/m')]), t);

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('hit, miss, crit and auto attack are attributed by counters', () => {
    const r = fresh();
    r.handle(NB(1, [unit({ preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false })], [mon('/monsters/m')]), 1000);
    // the player executes fireball (atk 1) and prepares x; the monster loses 100 (hit, crit)
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/x' }) }, { 0: ent(900, 0, 1, 1) }), 1100);
    // executes x (atk 2): miss, no hp change
    r.handle(BU(1, { 0: ent(1000, 2, 0, 0, { isAutoAtk: true }) }, { 0: ent(900, 0, 2, 1) }), 1200);
    // executes auto (the previous record had isAutoAtk and no abilityHrid): hit for 50
    r.handle(BU(1, { 0: ent(1000, 3, 0, 0, { abilityHrid: '/abilities/y' }) }, { 0: ent(850, 0, 3, 1) }), 1300);
    close(r, 2000);
    const p = lastEnc(r).players[0];
    assert.equal(p.dealt.total, 150);
    assert.equal(p.dealt.bySource['/abilities/fireball'].amount, 100);
    assert.equal(p.dealt.bySource['/abilities/fireball'].crits, 1);
    assert.equal(p.dealt.bySource['/abilities/x'].misses, 1);
    assert.equal(p.dealt.bySource.auto.amount, 50);
    assert.equal(p.dealt.byMonster['/monsters/m'], 150);
    assert.equal(p.attempts, 3);
    assert.deepEqual(J(p.events.dealt), { events: 3, hits: 2, misses: 1, crits: 1, critsOnMiss: 0 });
});

test('a crit counts only on a hit; a crit flag on an event with no damage goes to critsOnMiss, in every tally', () => {
    const r = fresh();
    r.handle(NB(1, [unit({ preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false })], [mon('/monsters/m')]), 1000);
    // fireball executes (atk 1): hit for 100 with a crit (critCounter becomes 1)
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/fireball' }) }, { 0: ent(900, 0, 1, 1) }), 1100);
    // fireball executes again (atk 2): no hp change, but critCounter moved to 2 (a crit flag on an event with no damage)
    r.handle(BU(1, { 0: ent(1000, 2, 0, 0, { isAutoAtk: true }) }, { 0: ent(900, 0, 2, 2) }), 1200);
    close(r, 2000);
    const p = lastEnc(r).players[0];
    const b = p.dealt.bySource['/abilities/fireball'];
    assert.equal(b.hits, 1); assert.equal(b.misses, 1); assert.equal(b.crits, 1); assert.equal(b.critsOnMiss, 1);
    assert.deepEqual(J(p.events.dealt), { events: 2, hits: 1, misses: 1, crits: 1, critsOnMiss: 1 });
    // the window totals carry both fields
    const w = r.state.windows[r.state.windows.length - 1].players[0].totals;
    assert.equal(w.events.dealt.crits, 1); assert.equal(w.events.dealt.critsOnMiss, 1);
    // damage taken is tallied the same way
    const r2 = fresh();
    r2.handle(NB(1, [unit()], [mon('/monsters/m', { preparingAbilityHrid: '', isPreparingAutoAttack: true })]), 1000);
    r2.handle(BU(1, { 0: ent(950, 0, 1, 1) }, { 0: ent(1000, 1, 0, 0, { isAutoAtk: true }) }), 1100);
    r2.handle(BU(1, { 0: ent(950, 0, 2, 2) }, { 0: ent(1000, 2, 0, 0, { isAutoAtk: true }) }), 1200);
    close(r2, 2000);
    assert.deepEqual(J(lastEnc(r2).players[0].events.received), { events: 2, hits: 1, misses: 1, crits: 1, critsOnMiss: 1 });
});

test('hit log codec: a few hundred events round-trip (miss, crit, crit on a miss, big amounts, long gaps), base64 string', () => {
    const { createHitLog, unpackHits, filterHits, bytesToB64, b64ToBytes } = mod.exports;
    for (const len of [0, 1, 2, 3, 4, 5, 255]) { const a = Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255); assert.deepEqual(J(b64ToBytes(bytesToB64(a))), a); }
    assert.equal(bytesToB64([77, 97, 110]), Buffer.from('Man').toString('base64'));
    assert.equal(bytesToB64([77, 97]), Buffer.from('Ma').toString('base64'));
    const t0 = 1794000000000, srcs = ['auto', '/abilities/a', '/abilities/b', '/abilities/a:dot', '/abilities/c'];
    const L = createHitLog(t0), want = [];
    let t = t0, seed = 7;
    const rnd = (m) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % m; };
    for (let i = 0; i < 400; i++) {
        t += i % 50 === 0 ? 70000 + rnd(5000) : rnd(2500);
        const kind = i % 4; // 0 plain hit, 1 miss, 2 crit hit, 3 crit on a miss
        const hit = kind === 0 || kind === 2, crit = kind >= 2;
        const amount = !hit ? 0 : i % 97 === 0 ? 5000000 + rnd(1000) : i % 13 === 0 ? 16384 + rnd(100000) : 1 + rnd(900);
        const e = { t, slot: rnd(5), source: srcs[rnd(5)], monster: rnd(5), amount, hit, crit };
        L.add(e.t, e.slot, e.source, e.monster, e.amount, e.hit, e.crit); want.push(e);
    }
    const h = L.finish();
    assert.equal(h.n, 400); assert.equal(typeof h.data, 'string'); assert.match(h.data, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.deepEqual(J(unpackHits(h, t0)), want);
    assert.ok(h.src.length <= 5 && !('dropped' in h));
    // cut to some dealer slots
    const f = filterHits(h, [1, 3], t0);
    assert.deepEqual(J(unpackHits(f, t0)), want.filter((e) => e.slot === 1 || e.slot === 3));
    // a cap per encounter: the rest is counted, not stored
    const keep = REC.MAX_HITS; REC.MAX_HITS = 3;
    const C = createHitLog(0); for (let i = 0; i < 5; i++) C.add(i, 0, 'auto', 0, 10, true, false);
    REC.MAX_HITS = keep;
    const ch = C.finish(); assert.equal(ch.n, 3); assert.equal(ch.dropped, 2);
});

test('every attributed dealt event is stored in order; ambiguous ones are not; selfOnly keeps only the self slot\'s hits', () => {
    const r = fresh();
    r.handle({ type: 'init_character_data', character: { id: 7, name: 'Someone' } }, 500);
    r.handle(NB(1, [unit({ character: { id: 8 }, preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false }), unit({ character: { id: 7 }, preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false })], [mon('/monsters/m'), mon('/monsters/n')]), 1000);
    // slot 0 hits monster 0 for 100 with a crit
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/x' }), 1: ent(1000, 0, 0, 0) }, { 0: ent(900, 0, 1, 1), 1: ent(1000, 0, 0, 0) }), 1100);
    // slot 1 (self) misses monster 1 with the crit flag set, no hp change
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0, { isAutoAtk: true }), 1: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/y' }) }, { 0: ent(900, 0, 1, 1), 1: ent(1000, 0, 1, 1) }), 1400);
    // two player actors in one message: ambiguous, not stored as a hit
    r.handle(BU(1, { 0: ent(1000, 2, 0, 0, { isAutoAtk: true }), 1: ent(1000, 2, 0, 0, { isAutoAtk: true }) }, { 0: ent(850, 0, 2, 1) }), 1700);
    close(r, 2000);
    const e = lastEnc(r);
    assert.equal(e.ambiguous.length, 1);
    assert.equal(e.hits.n, 2);
    assert.deepEqual(J(unpackHits(e.hits, e.startedAt)), [
        { t: 1100, slot: 0, source: '/abilities/fireball', monster: 0, amount: 100, hit: true, crit: true },
        { t: 1400, slot: 1, source: '/abilities/fireball', monster: 1, amount: 0, hit: false, crit: true },
    ]);
    const last = (x) => x.encounters[x.encounters.length - 1], all = last(r.exportData(false)), mine = last(r.exportData(true));
    assert.equal(all.hits.n, 2);
    assert.deepEqual(J(unpackHits(mine.hits, mine.startedAt).map((x) => x.slot)), [1]);
});

test('a message with two player actors is kept raw and flagged, never split', () => {
    const r = fresh();
    r.handle(NB(1, [unit(), unit()], [mon('/monsters/m')]), 1000);
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0), 1: ent(1000, 1, 0, 0) }, { 0: ent(900, 0, 1, 0) }), 1100);
    close(r, 2000);
    const e = lastEnc(r);
    assert.equal(e.ambiguous.length, 1);
    assert.equal(e.ambiguous[0].reason, 'multi-actor');
    assert.equal(e.ambiguous[0].actors.length, 2);
    assert.equal(e.ambiguous[0].hpChange, 100);
    assert.equal(e.players[0].dealt.total + e.players[1].dealt.total, 0);
    assert.equal(e.unattributed.dealt, 100);
});

test('damage over time ticks go to the monster ability that started the series; an unmatched tick is flagged', () => {
    const r = fresh();
    r.handle(NB(1, [unit()], [mon('/monsters/caster', { preparingAbilityHrid: '/abilities/firestorm', isPreparingAutoAttack: false })]), 1000);
    r.handle(BU(1, { 0: ent(940, 0, 1, 0) }, { 0: ent(1000, 1, 0, 0, { isAutoAtk: true }) }), 1100); // hit 60
    r.handle(BU(1, { 0: ent(910, 0, 2, 0) }, {}), 4100); // 3.0 s later, 30 = 60 / 2 ticks
    r.handle(BU(1, { 0: ent(880, 0, 3, 0) }, {}), 7100); // 6.0 s later
    r.handle(BU(1, { 0: ent(825, 0, 4, 0) }, {}), 8000); // 55: matches nothing
    close(r, 9000);
    const e = lastEnc(r);
    const p = e.players[0];
    assert.equal(p.taken.bySource['/monsters/caster::/abilities/firestorm'].amount, 60);
    assert.equal(p.taken.bySource['/monsters/caster::/abilities/firestorm:dot'].amount, 60);
    assert.equal(p.taken.total, 120);
    assert.equal(e.unattributed.taken, 55);
    assert.equal(e.ambiguous.length, 1);
    assert.equal(e.ambiguous[0].reason, 'no-actor');
});

test('updates without a new_battle are skipped and counted', () => {
    const r = fresh();
    r.handle(BU(5, { 0: ent(1000, 1, 0, 0) }, {}), 1000);
    assert.equal(r.state.stats.skippedUpdates, 1);
    assert.equal(r.state.encounters.length, 0);
});

test('loot, XP and ability XP are snapshot differences; a negative difference is flagged and not credited', () => {
    const r = fresh();
    const loot = (c) => ({ 'k::a': { itemHrid: '/items/a', count: c }, 'k::b': { itemHrid: '/items/b', count: 4 } });
    r.handle(NB(1, [unit({ totalLootMap: loot(5), totalSkillExperienceMap: { '/skills/ranged': 100.5 }, totalAbilityExperienceMap: { '/abilities/x': 1 }, deathCount: 1 })], [mon('/monsters/m')]), 1000);
    r.handle(NB(2, [unit({ totalLootMap: loot(7), totalSkillExperienceMap: { '/skills/ranged': 110.5 }, totalAbilityExperienceMap: { '/abilities/x': 1.5 }, deathCount: 2 })], [mon('/monsters/m')]), 2000);
    r.handle(NB(3, [unit({ totalLootMap: loot(3) })], [mon('/monsters/m')]), 3000);
    close(r, 4000);
    const [a, b] = r.state.encounters;
    assert.deepEqual(J(a.players[0].loot), { '/items/a': 2 });
    assert.equal(a.players[0].xp['/skills/ranged'], 10);
    assert.equal(a.players[0].abilityXp['/abilities/x'], 0.5);
    assert.equal(a.players[0].deaths, 1);
    assert.equal(b.negativeDiff, true);
    assert.deepEqual(J(b.players[0].loot), {});
});

const donut = (count, avail) => ({ itemHrid: '/items/test_donut', enhancementLevel: 0, count, availableTime: avail, itemHash: 'secret::hash' });
const T1 = '2026-01-01T00:01:00.000Z', T2 = '2026-01-01T00:02:00.000Z';

test('a consume is the cooldown restart; the rest of a count change is a trade', () => {
    const r = fresh();
    const nbC = (id, c) => NB(id, [unit({ combatConsumables: [c] })], [mon('/monsters/m')]);
    r.handle(nbC(1, donut(10, T1)), 1000);
    r.handle(nbC(2, donut(9, T2)), 2000); // eaten
    r.handle(nbC(3, donut(20, T2)), 3000); // bought 11, no restart
    r.handle(nbC(4, donut(14, '2026-01-01T00:03:00.000Z')), 4000); // eaten and sold 5 in one interval
    close(r, 5000);
    const [a, b, c] = r.state.encounters;
    assert.equal(a.players[0].consumablesUsed['/items/test_donut'], 1);
    assert.equal(a.players[0].trades['/items/test_donut'], undefined);
    assert.equal(b.players[0].consumablesUsed['/items/test_donut'], undefined);
    assert.equal(b.players[0].trades['/items/test_donut'], 11);
    assert.equal(c.players[0].consumablesUsed['/items/test_donut'], 1);
    assert.equal(c.players[0].trades['/items/test_donut'], -5);
    assert.ok(!JSON.stringify(r.exportData(false)).includes('secret::hash'));
});

test('the restore only checks the heal: matching rise credited, missing rise sets healMismatch', () => {
    const r = fresh();
    const nbC = (id, c, hp) => NB(id, [unit({ currentHitpoints: hp, combatConsumables: [c] })], [mon('/monsters/m')]);
    r.handle(nbC(1, donut(10, T1), 500), 1000);
    r.handle(BU(1, { 0: ent(780, 0, 0, 0) }, {}), 1500); // +280, no actor
    r.handle(nbC(2, donut(9, T2), 780), 2000);
    r.handle(nbC(3, donut(8, '2026-01-01T00:03:00.000Z'), 780), 3000); // eaten, no rise follows
    for (let i = 4; i < 9; i++) r.handle(nbC(i, donut(8, '2026-01-01T00:03:00.000Z'), 780), i * 1000);
    const used = r.state.encounters.flatMap((e) => e.players[0].consumes || []);
    assert.equal(used.length, 2);
    assert.equal(used[0].credited, 280);
    assert.equal(used[0].healMismatch, false);
    assert.equal(used[1].credited, 0);
    assert.equal(used[1].healMismatch, true);
    assert.equal(r.state.encounters[1].players[0].healed.bySource['/items/test_donut'], undefined); // credited where it was resolved
    const total = r.state.encounters.reduce((s, e) => s + (e.players[0].healed.bySource['food:/items/test_donut'] || 0), 0);
    assert.equal(total, 280);
});

test('regen, a heal ability from another player, and a hidden second action are told apart', () => {
    const r = fresh();
    const healer = unit({ preparingAbilityHrid: '/abilities/quick_aid', isPreparingAutoAttack: false, combatAbilities: [{ abilityHrid: '/abilities/quick_aid', level: 3 }] });
    r.handle(NB(1, [unit({ currentHitpoints: 500 }), healer], [mon('/monsters/m')]), 1000);
    r.handle(BU(1, { 0: ent(510, 0, 0, 0) }, {}), 1100); // 1% of 1000: regen
    r.handle(BU(1, { 0: ent(710, 0, 0, 0), 1: ent(1000, 1, 0, 0, { isAutoAtk: true }) }, {}), 1200); // quick_aid cast by slot 1 heals slot 0
    r.handle(BU(1, { 0: ent(860, 0, 0, 0), 1: ent(1000, 3, 0, 0, { isAutoAtk: true }) }, {}), 1300); // atk +2: a hidden action
    close(r, 2000);
    const e = lastEnc(r);
    assert.equal(e.players[0].healed.regen, 10);
    assert.equal(e.players[0].healed.bySource['/abilities/quick_aid'], 200);
    assert.equal(e.players[0].healed.unresolved, 150);
    assert.equal(e.ambiguous.length, 1);
    assert.equal(e.ambiguous[0].reason, 'hidden-action');
});

test('windows: same conditions share one window, a changed drop rate or zone opens a new one', () => {
    const r = fresh();
    const nbR = (id, rate) => NB(id, [unit({ combatDetails: { combatStats: { hpRegenPer10: 0.01, combatDropRate: rate } } })], [mon('/monsters/m')]);
    r.handle(nbR(1, 0.1), 1000);
    r.handle({ type: 'action_completed', endCharacterAction: { actionHrid: '/actions/combat/zone_a', difficultyTier: 1 } }, 1500);
    r.handle(nbR(2, 0.1), 2000);
    assert.equal(r.state.windows.length, 1);
    assert.equal(r.state.windows[0].zone, '/actions/combat/zone_a');
    r.handle(nbR(3, 0.2), 3000);
    assert.equal(r.state.windows.length, 2);
    r.handle({ type: 'action_completed', endCharacterAction: { actionHrid: '/actions/combat/zone_b', difficultyTier: 1 } }, 3500);
    r.handle(nbR(4, 0.2), 4000);
    assert.equal(r.state.windows.length, 3);
    assert.equal(r.state.windows[1].battles, 1);
});

test('kills are counted once per monster and carry the time to kill; buff changes become events', () => {
    const r = fresh();
    const buff = (start) => ({ '/buff_uniques/c': { uniqueHrid: '/buff_uniques/c', typeHrid: '/buff_types/t', ratioBoost: 0.1, startTime: start, duration: 1e9 } });
    r.handle(NB(1, [unit({ combatBuffMap: buff('s1') })], [mon('/monsters/m'), mon('/monsters/n')]), 1000);
    r.handle(BU(1, {}, { 0: ent(0, 0, 1, 0, { isActive: false }) }), 1800);
    r.handle(BU(1, {}, { 0: ent(0, 0, 1, 0, { isActive: false }) }), 1900);
    r.handle(NB(2, [unit({ combatBuffMap: buff('s2') })], [mon('/monsters/m')]), 2000);
    const w = r.state.windows[0];
    assert.equal(w.kills['/monsters/m'], 1);
    assert.equal(r.state.encounters[0].monsters[0].killMs, 800);
    assert.equal(r.state.encounters[0].monsters[1].killMs, null);
    assert.equal(w.buffEvents.length, 1);
    assert.equal(w.buffEvents[0].change, 'refreshed');
});

test('casts of abilities with buffs are logged', () => {
    const r = fresh();
    r.handle(NB(1, [unit()], [mon('/monsters/m', { preparingAbilityHrid: '/abilities/fear', isPreparingAutoAttack: false })]), 1000);
    r.handle(BU(1, {}, { 0: ent(1000, 1, 0, 0, { isAutoAtk: true }) }), 1100);
    close(r, 2000);
    assert.equal(lastEnc(r).casts.length, 1);
    assert.equal(lastEnc(r).casts[0].ability, '/abilities/fear');
});

test('the export is anonymous by slot; selfOnly keeps one player and refuses when the player is unknown', () => {
    const r = fresh();
    const pl = (id, name) => unit({ character: { id, name } });
    r.handle({ type: 'init_character_data', character: { id: 7, name: 'Secret' } }, 500);
    r.handle(NB(1, [pl(7, 'Secret'), pl(8, 'Other')], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const all = r.exportData(false, 3000);
    const text = JSON.stringify(all);
    assert.ok(!text.includes('Secret') && !text.includes('Other'));
    assert.equal(all.format, 'mwics-loot');
    assert.deepEqual(all.encounters[0].players.map((p) => p.self), [true, false]);
    const mine = r.exportData(true, 3000);
    assert.equal(mine.encounters[0].players.length, 1);
    assert.equal(mine.windows[0].players.length, 1);
    const r2 = fresh();
    r2.handle(NB(1, [pl(7, 'Secret')], [mon('/monsters/m')]), 1000);
    close(r2, 2000);
    assert.throws(() => r2.exportData(true), /cannot tell which player is you/);
});

test('active tasks are a timeline of changes, in-progress only', () => {
    const r = fresh();
    const q = (cur, status) => [{ id: 1, category: '/quest_category/random_task', status, monsterHrid: '/monsters/m', goalCount: 50, currentCount: cur }];
    r.handle({ type: 'quests_updated', endCharacterQuests: q(1, '/quest_status/in_progress') }, 1000);
    r.handle({ type: 'quests_updated', endCharacterQuests: q(1, '/quest_status/in_progress') }, 1100);
    r.handle({ type: 'quests_updated', endCharacterQuests: q(2, '/quest_status/in_progress') }, 1200);
    r.handle({ type: 'quests_updated', endCharacterQuests: q(50, '/quest_status/completed') }, 1300);
    const t = r.exportData(false).tasks;
    assert.equal(t.length, 3);
    assert.equal(t[1].tasks[0].currentCount, 2);
    assert.deepEqual(J(t[2].tasks), []);
});

test('persistence round trip, clear, and the caps drop the oldest rows', () => {
    const r = fresh();
    r.handle(NB(1, [unit()], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const saved = J(r.persistable());
    const r2 = fresh();
    r2.restore(saved);
    assert.equal(r2.state.encounters.length, 1);
    assert.equal(r2.state.windows.length, 1);
    r2.clear();
    assert.equal(r2.state.encounters.length, 0);
    const old = REC.MAX_ENCOUNTERS;
    REC.MAX_ENCOUNTERS = 3;
    for (let i = 1; i <= 6; i++) r.handle(NB(i + 10, [unit()], [mon('/monsters/m')]), 3000 + i * 100);
    REC.MAX_ENCOUNTERS = old;
    assert.equal(r.state.encounters.length, 3);
    assert.equal(r.state.encounters[2].battleId, 15);
});

test('the recorder and the sink have no network or storage calls of their own; the only request goes to a local helper', () => {
    const src = fs.readFileSync(path.join(ROOT, 'userscript', 'mwics-exporter.user.js'), 'utf8');
    const pure = src.slice(src.indexOf('==/UserScript=='), src.indexOf("if (typeof module !== 'undefined' && module.exports)"));
    for (const bad of ['fetch(', 'XMLHttpRequest', '.send(', 'GM_', 'sendBeacon', 'WebSocket']) assert.ok(!pure.includes(bad), 'module part: ' + bad);
    for (const bad of ['fetch(', 'XMLHttpRequest', '.send(', 'sendBeacon', 'new WebSocket']) assert.ok(!src.includes(bad), bad);
    assert.equal((src.match(/GM_xmlhttpRequest\(/g) || []).length, 2, 'two requests: the combat POST and the token GET, both to the helper address');
    assert.deepEqual(src.match(/url: helperUrl\(\) \+ '[^']+'/g), ["url: helperUrl() + '/v1/combat'", "url: helperUrl() + '/token'"]);
    assert.deepEqual(src.match(/^\/\/ @connect\s+\S+/gm).map((l) => l.split(/\s+/).pop()), ['127.0.0.1', 'localhost']);
    assert.ok(/url: helperUrl\(\) \+ '\/v1\/combat'/.test(src));
    assert.ok(/\^http:\\\/\\\/\(127\\\.0\\\.0\\\.1\|localhost\):\\d\+\$/.test(src), 'the helper address is limited to localhost');
});

// ---- helper sink ----
const { createSink, SINK } = mod.exports;
function sinkFor(r, o) {
    o = o || {};
    const calls = [], timers = [];
    let t = 1e6;
    const sink = createSink({
        recorder: r, enabled: () => o.enabled !== false, selfOnly: () => !!o.selfOnly, sent: o.sent, saveSent: o.saveSent,
        post: async (body) => { calls.push(J(body)); return o.respond ? o.respond(body, calls.length) : { ok: true, status: 200, text: JSON.stringify({ accepted: body.records.length, duplicate: 0, rejected: 0 }) }; },
        now: () => t, setTimer: (fn, ms) => timers.push({ fn, ms }), log() {},
    });
    return { sink, calls, timers, advance: (ms) => { t += ms; } };
}
const tick = () => new Promise((res) => setImmediate(res));
const run = (r, s, n0, n1) => { for (let i = n0; i <= n1; i++) { r.handle(NB(i, [unit()], [mon('/monsters/m')]), 1000 + i * 100); s.sink.notify(); } };
const settle = async (s) => { await s.sink.finish(); for (let i = 0; i < 20; i++) await tick(); };
const keysOf = (calls) => calls.flatMap((c) => c.records.map((x) => x.key));

async function atest(name, fn) { await fn(); n++; console.log('ok - ' + name); }

(async () => {
await atest('sink: an encounter goes out only after four later ones have closed; window and tasks go at once', async () => {
    const r = fresh(), s = sinkFor(r);
    r.handle({ type: 'quests_updated', endCharacterQuests: [{ status: '/quest_status/in_progress', category: 'c', monsterHrid: '/monsters/m', goalCount: 5, currentCount: 1 }] }, 900);
    s.sink.notify();
    run(r, s, 1, 3);
    await tick();
    let types = s.calls.flatMap((c) => c.records.map((x) => x.type));
    assert.ok(!types.includes('encounter'));
    assert.ok(types.includes('window') && types.includes('task'));
    run(r, s, 4, 8);
    await tick();
    const encs = s.calls.flatMap((c) => c.records).filter((x) => x.type === 'encounter');
    assert.equal(r.state.encounters.length, 7);
    assert.equal(encs.length, 3);
    assert.ok(encs.every((x) => x.key.startsWith('enc:') && x.data.battleId));
    assert.ok(s.calls.every((c) => c.v === 1 && c.records.length <= SINK.BATCH_RECORDS));
});

await atest('sink: finish() sends the rest, nothing is sent twice, and the idle timer sends the tail', async () => {
    const r = fresh(), s = sinkFor(r);
    run(r, s, 1, 8);
    await tick();
    const before = keysOf(s.calls).length;
    await settle(s);
    const all = keysOf(s.calls);
    assert.equal(new Set(all).size, all.length, 'no key twice');
    assert.equal(all.filter((k) => k.startsWith('enc:')).length, 7);
    assert.ok(all.length > before);
    const r2 = fresh(), s2 = sinkFor(r2);
    run(r2, s2, 1, 8);
    await tick();
    s2.advance(SINK.IDLE_MS + 1);
    s2.timers.forEach((x) => x.fn());
    await tick(); await tick();
    assert.equal(keysOf(s2.calls).filter((k) => k.startsWith('enc:')).length, 7);
});

await atest('sink: a failed send keeps the queue and retries with a doubling wait; 413 halves the batch', async () => {
    const r = fresh();
    let fail = 2;
    const s = sinkFor(r, { respond: (b) => (fail-- > 0 ? { ok: false, status: 0 } : { ok: true, status: 200, text: JSON.stringify({ accepted: b.records.length, duplicate: 0, rejected: 0 }) }) });
    run(r, s, 1, 8);
    await tick();
    assert.equal(s.sink.state.stats.failed, 1);
    const retry1 = s.timers.filter((x) => x.ms === SINK.RETRY_MIN_MS);
    assert.equal(retry1.length, 1);
    retry1[0].fn(); await tick();
    assert.equal(s.sink.state.stats.failed, 2);
    assert.ok(s.timers.some((x) => x.ms === SINK.RETRY_MIN_MS * 2));
    s.timers.filter((x) => x.ms === SINK.RETRY_MIN_MS * 2)[0].fn(); await tick();
    assert.equal(s.sink.state.queue.length, 0);
    assert.ok(keysOf(s.calls.slice(2)).some((k) => k.startsWith('enc:')));

    const r2 = fresh();
    const sizes = [];
    const s2 = sinkFor(r2, { respond: (b) => { sizes.push(b.records.length); return b.records.length > 2 ? { ok: false, status: 413 } : { ok: true, status: 200, text: '{"accepted":1,"duplicate":0,"rejected":0}' }; } });
    run(r2, s2, 1, 12);
    await settle(s2);
    assert.equal(s2.sink.state.queue.length, 0);
    assert.ok(sizes.some((x) => x > 2) && sizes[sizes.length - 1] <= 2);
});

await atest('sink: a record the helper keeps refusing is dropped from the queue, not retried forever', async () => {
    const r = fresh();
    const s = sinkFor(r, { respond: () => ({ ok: false, status: 400 }) });
    run(r, s, 1, 8);
    await settle(s);
    assert.equal(s.sink.state.queue.length, 0);
    assert.ok(s.sink.state.stats.rejected > 0);
});

await atest('sink: sent keys are remembered across a reload; a window re-sent only when it changed', async () => {
    const r = fresh();
    let saved = [];
    const s = sinkFor(r, { saveSent: (k) => { saved = k.slice(); } });
    run(r, s, 1, 8);
    await settle(s);
    assert.ok(saved.length > 0);
    const wins = keysOf(s.calls).filter((k) => k.startsWith('win:'));
    assert.ok(wins.length >= 1);
    const s2 = sinkFor(r, { sent: saved });
    await settle(s2);
    assert.equal(s2.calls.length, 0, 'nothing new after a reload');
    run(r, s2, 9, 12);
    await settle(s2);
    const k2 = keysOf(s2.calls);
    assert.ok(k2.every((k) => !saved.includes(k)));
    assert.ok(k2.some((k) => k.startsWith('win:')), 'the window changed (more battles), a new revision goes');
});

await atest('sink: nothing is queued when disabled; selfOnly holds until self is known, then sends only the self slot', async () => {
    const r = fresh(), off = sinkFor(r, { enabled: false });
    run(r, off, 1, 8);
    await settle(off);
    assert.equal(off.calls.length, 0);
    const r2 = fresh(), s = sinkFor(r2, { selfOnly: true });
    run(r2, s, 1, 8);
    await settle(s);
    assert.equal(s.calls.length, 0, 'self unknown: held');
    const r3 = fresh(), s3 = sinkFor(r3, { selfOnly: true });
    r3.handle({ type: 'init_character_data', character: { id: 7 } }, 500);
    for (let i = 1; i <= 8; i++) { r3.handle(NB(i, [unit({ character: { id: 7 } }), unit({ character: { id: 8 } })], [mon('/monsters/m')]), 1000 + i * 100); s3.sink.notify(); }
    await settle(s3);
    const recs = s3.calls.flatMap((c) => c.records).filter((x) => x.type === 'encounter' || x.type === 'window');
    assert.ok(recs.length > 0);
    assert.ok(recs.every((x) => x.data.players.length === 1 && x.data.players[0].self));
    assert.ok(!JSON.stringify(s3.calls).includes('"id":8'));
});

await atest('sink: no names or ids travel; the window sent has no internal key', async () => {
    const r = fresh(), s = sinkFor(r);
    r.handle({ type: 'init_character_data', character: { id: 7, name: 'Someone' } }, 500);
    r.handle(NB(1, [unit({ character: { id: 7, name: 'Someone' } })], [mon('/monsters/m')]), 1000);
    s.sink.notify();
    r.handle(NB(2, [unit({ character: { id: 7, name: 'Someone' } })], [mon('/monsters/m')]), 1100);
    await settle(s);
    const text = JSON.stringify(s.calls);
    assert.ok(!text.includes('Someone'));
    const w = s.calls.flatMap((c) => c.records).find((x) => x.type === 'window');
    assert.ok(!('key' in w.data) || w.data.key === undefined);
});

console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
