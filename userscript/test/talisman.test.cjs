// Node test for userscript/mwics-exporter.user.js 0.10.0, on made-up messages (no real player's data): the test server beside the live one, the equipped
// talisman lines in the encounter, the raw trace rows, and tools/echo-analysis.mjs on a small stream.
// Run: node userscript/test/talisman.test.cjs
// Covers: server from the host, storage keys per server, a record carrying its server, the sink's body and key prefix, a live tab and a test tab over one
// fake storage (nothing mixes, each sends with its own server), talismans from init_character_data / talismans_updated / character_stats_updated
// (slotted only, pending rolls left out, value and unique from the client data, locked flag, deleted), other members' power only, the self-only cut,
// trace rows (columns, cap, test server only), and the analysis script (counts, ratio bins, window, file shapes).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRCFILE = path.join(__dirname, '..', 'mwics-exporter.user.js');
const SRC = fs.readFileSync(SRCFILE, 'utf8');
const mod = { exports: {} };
vm.runInNewContext(SRC, { module: mod, console });
const { createRecorder, createSink, serverOf, serverKey, talismanLines, TRACE_FIELDS, REC, SINK } = mod.exports;
const J = (x) => JSON.parse(JSON.stringify(x));

const MOD = (hrid, name, group, values) => ({ hrid, name, groupHrid: '/talisman_modifier_groups/' + group, gradeValues: values });
const GAME = {
    abilityDetailMap: {},
    itemDetailMap: {},
    talismanModifierDetailMap: {
        '/talisman_modifiers/magic_damage': MOD('/talisman_modifiers/magic_damage', 'Magic Damage', 'offense', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
        '/talisman_modifiers/echo': MOD('/talisman_modifiers/echo', 'Echo', 'special', [0.03, 0.045, 0.06, 0.075, 0.09, 0.12]),
        '/talisman_modifiers/armor': MOD('/talisman_modifiers/armor', 'Armor', 'defense', [1, 2, 3, 4, 5, 6]),
    },
};
const unit = (o) => ({
    currentHitpoints: 1000, maxHitpoints: 1000, currentManapoints: 100, maxManapoints: 100, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0,
    preparingAbilityHrid: '', isPreparingAutoAttack: true, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0,
    combatDetails: { combatStats: { hpRegenPer10: 0.01 } }, ...o,
});
const mon = (hrid, o) => unit({ hrid, isBoss: false, difficultyTier: 1, ...o });
const NB = (battleId, players, monsters, extra) => ({ type: 'new_battle', battleId, combatStartTime: '2026-01-01T00:00:00Z', wave: 0, players, monsters, ...extra });
const ent = (cHP, atk, dmg, crit, extra) => ({ cHP, mHP: 1000, cMP: 100, mMP: 100, isActive: true, leftCombat: false, atkCounter: atk, int: 1, dmgCounter: dmg, critCounter: crit, ...extra });
const BU = (battleId, pMap, mMap) => ({ type: 'battle_updated', battleId, pMap: pMap || {}, mMap: mMap || {} });
const tal = (id, slotIndex, modifiers, extra) => ({ id, characterID: 8, talismanTypeHrid: '/talisman_types/combat', modifiers, pendingModifiers: null, lockedModifierHrid: '', slotIndex, ...extra });
const mod1 = (name, grade) => ({ hrid: '/talisman_modifiers/' + name, grade });
const INIT = (list, power, slots, items) => ({ type: 'init_character_data', character: { id: 8 }, characterTalismans: list, characterItems: items || [], combatUnit: { combatDetails: { combatStats: { talismanPower: power, talismanSlots: slots } } } });
const mk = (opts) => createRecorder({ clientData: () => GAME, ...(opts || {}) });
const lastEnc = (r) => r.state.encounters[r.state.encounters.length - 1];
const SELF = { character: { id: 8, name: 'Self' } };
const close = (r, t) => r.handle(NB(999, [unit(SELF)], [mon('/monsters/m')]), t);

let n = 0;
const pending = [];
function test(name, fn) { pending.push(async () => { await fn(); n++; console.log('ok - ' + name); }); }

// ---------- server ----------
test('the server is told from the host name; storage keys of the test server carry a suffix, live keys are unchanged', () => {
    assert.equal(serverOf('test.milkywayidle.com'), 'test');
    assert.equal(serverOf('www.milkywayidle.com'), 'live');
    assert.equal(serverOf('milkywayidle.com'), 'live');
    assert.equal(serverOf('ramlock.github.io'), 'live');
    assert.equal(serverOf(''), 'live');
    assert.equal(serverOf(undefined), 'live');
    assert.equal(serverKey('mwicsRecorderEncounters', 'live'), 'mwicsRecorderEncounters');
    assert.equal(serverKey('mwicsRecorderEncounters', 'test'), 'mwicsRecorderEncounters.test');
    assert.equal(serverKey('k'), 'k');
});

test('a record carries its server: encounter, window, task and the export', () => {
    for (const server of ['test', 'live']) {
        const r = mk({ server });
        r.handle({ type: 'init_character_data', character: { id: 8 }, characterQuests: [{ status: '/quest_status/in_progress', category: '/c', goalCount: 5, currentCount: 1 }] }, 500);
        r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
        close(r, 2000);
        assert.equal(lastEnc(r).server, server);
        assert.equal(r.state.windows[0].server, server);
        assert.equal(r.state.quests[0].server, server);
        assert.equal(r.exportData(false, 3000).server, server);
        assert.equal(r.exportData(true, 3000).server, server);
    }
    assert.equal(mk({ server: 'whatever' }).exportData(false).server, 'live');
    assert.equal(mk().exportData(false).server, 'live');
});

function sinkOf(server) {
    const r = mk({ server });
    r.handle(INIT([], 0, 0), 500);
    r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const bodies = [];
    const sink = createSink({ recorder: r, enabled: () => true, selfOnly: () => false, now: () => 5000, setTimer: () => 0, log: () => {}, server, post: async (b) => { bodies.push(b); return { ok: true, status: 200, text: JSON.stringify({ accepted: b.records.length, duplicate: 0, rejected: 0 }) }; } });
    return { r, sink, bodies };
}
test('the sink names the server in the body and prefixes a test key; a live key and body stay as before', async () => {
    const t = sinkOf('test'), l = sinkOf('live');
    await t.sink.finish(); await l.sink.finish();
    assert.equal(t.bodies[0].server, 'test');
    assert.equal(l.bodies[0].server, 'live');
    assert.equal(t.bodies[0].v, 1);
    assert.ok(t.bodies[0].records.length >= 2);
    for (const rec of t.bodies[0].records) { assert.ok(rec.key.startsWith('test:'), rec.key); assert.equal(rec.data.server, 'test'); }
    for (const rec of l.bodies[0].records) { assert.ok(/^(enc|win|task):/.test(rec.key), rec.key); assert.equal(rec.data.server, 'live'); }
    const tk = t.bodies[0].records.map((x) => x.key.replace(/^test:/, '')).sort(), lk = l.bodies[0].records.map((x) => x.key).sort();
    assert.deepEqual(tk, lk, 'same rows, only the prefix differs');
});

// ---------- the script in a tab ----------
function boot(store, host, opts) {
    opts = opts || {};
    class ME { constructor(d, url) { this._d = d; this.currentTarget = { url }; } get data() { return this._d; } }
    const commands = {}, reqs = [], toasts = [], visibility = [];
    const el = () => ({ style: {}, remove() {}, appendChild() {}, addEventListener() {}, click() {}, set textContent(v) { toasts.push(v); } });
    const sandbox = {
        console, setTimeout: () => 0, JSON, Date, WeakSet, Object, Promise, Math, Set, Map, Array, String, Number, Error, RegExp, Blob: class {},
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        location: { hostname: host },
        unsafeWindow: { MessageEvent: ME, addEventListener() {}, prompt: () => 'tok', localStorageUtil: { getInitClientData: () => GAME } },
        document: { body: { appendChild() {} }, createElement: el, createTextNode: (text) => ({ text }), addEventListener: (ev, fn) => { if (ev === 'visibilitychange') visibility.push(fn); }, getElementById: () => null, visibilityState: 'visible' },
        GM_registerMenuCommand: (nm, f) => { commands[nm] = f; },
        GM_setClipboard() {},
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        GM_xmlhttpRequest: (o) => {
            if (o.method === 'GET') { Promise.resolve().then(() => o.onload({ status: 403, responseText: '' })); return; }
            reqs.push(JSON.parse(o.data));
            const m = JSON.parse(o.data).records.length;
            Promise.resolve().then(() => o.onload({ status: 200, responseText: JSON.stringify({ accepted: m, duplicate: 0, rejected: 0 }) }));
        },
    };
    vm.runInNewContext(SRC, sandbox);
    const url = host.startsWith('test.') ? 'wss://api-test.milkywayidle.com/ws' : 'wss://api.milkywayidle.com/ws';
    const send = (msg) => new ME(JSON.stringify(msg), url).data;
    const tab = { commands, reqs, toasts, send, hide: () => { sandbox.document.visibilityState = 'hidden'; visibility.forEach((f) => f()); } };
    send({ type: 'init_character_data', character: { id: opts.charId || 8 } });
    commands['Set helper token']();
    return tab;
}
const NBc = (id, charId) => NB(id, [unit({ character: { id: charId, name: 'P' } })], [mon('/monsters/m')], { combatStartTime: 'c' + charId });
const stored = (store, suffix) => ({ enc: JSON.parse(store['mwicsRecorderEncounters' + suffix] || '[]'), win: JSON.parse(store['mwicsRecorderWindows' + suffix] || '{}') });

test('a live tab and a test tab over one storage keep separate recordings, sent keys and sends; nothing mixes', async () => {
    const store = {};
    const live = boot(store, 'www.milkywayidle.com', { charId: 8 });
    const test = boot(store, 'test.milkywayidle.com', { charId: 9 });
    // the same battle id and start time on both servers: the keys would collide if the storage were shared
    for (const id of [1, 2, 3]) { live.send(NBc(id, 8)); test.send(NBc(id, 9)); }
    live.hide(); test.hide();
    await new Promise((r) => setImmediate(r));
    const s = stored(store, ''), t = stored(store, '.test');
    assert.equal(s.enc.length, 2); assert.equal(t.enc.length, 2);
    assert.ok(s.enc.every((e) => e.server === 'live'));
    assert.ok(t.enc.every((e) => e.server === 'test'));
    assert.ok(Array.isArray(s.win.windows) && s.win.windows.every((w) => w.server === 'live'));
    assert.ok(t.win.windows.every((w) => w.server === 'test'));
    // sends: each tab names its own server and sends only its own rows
    assert.ok(live.reqs.length >= 1 && test.reqs.length >= 1);
    assert.ok(live.reqs.every((b) => b.server === 'live' && b.records.every((x) => !x.key.startsWith('test:') && x.data.server === 'live')));
    assert.ok(test.reqs.every((b) => b.server === 'test' && b.records.every((x) => x.key.startsWith('test:') && x.data.server === 'test')));
    // sent keys per server
    const sl = JSON.parse(store.mwicsSinkSent), st = JSON.parse(store['mwicsSinkSent.test']);
    assert.ok(sl.length && st.length);
    assert.ok(sl.every((k) => !k.startsWith('test:')) && st.every((k) => k.startsWith('test:')));
    // the toggles and the helper token are shared
    assert.equal(store.mwicsHelperToken, 'tok');
    // a reload of a test tab reads only its own recording
    const again = boot(store, 'test.milkywayidle.com', { charId: 9 });
    again.send(NBc(7, 9));
    again.hide();
    assert.ok(stored(store, '.test').enc.every((e) => e.server === 'test'));
    assert.equal(stored(store, '').enc.length, 2, 'live copy untouched by the test tab');
});

test('the test tab keeps its party state and snapshot under suffixed keys; the live keys are not written by it', () => {
    const store = {};
    const test = boot(store, 'test.milkywayidle.com', { charId: 9 });
    test.send(NBc(1, 9));
    assert.ok('mwicsGroupState.test' in store);
    assert.ok(!('mwicsGroupState' in store));
    assert.ok(!('mwicsGroupSnapshot' in store) && !('mwicsGroupSnapshotIndex' in store));
    assert.ok(Object.keys(store).filter((k) => k.startsWith('mwicsGroupSnapshot')).every((k) => k.includes('.test')));
    const live = boot(store, 'www.milkywayidle.com', { charId: 8 });
    live.send(NBc(1, 8));
    assert.ok('mwicsGroupState' in store && 'mwicsGroupState.test' in store);
});

test('the status toast names the test server; the version is 0.10.0 in the header and the constant', () => {
    const store = {};
    const test = boot(store, 'test.milkywayidle.com', { charId: 9 });
    test.commands.Status();
    assert.ok(test.toasts.some((x) => /v0\.10\.0 \(test server\)/.test(x)));
    const live = boot(store, 'www.milkywayidle.com');
    live.commands.Status();
    assert.ok(live.toasts.some((x) => /v0\.10\.0:/.test(x) && !/test server/.test(x)));
    assert.match(SRC, /@version\s+0\.10\.0/);
    assert.ok(SRC.includes("const VERSION = '0.10.0'"));
});

// ---------- talismans ----------
const TALS = [
    tal(3197, 1, [mod1('magic_damage', 2), mod1('armor', 4)], { lockedModifierHrid: '/talisman_modifiers/armor' }),
    tal(3203, 2, [mod1('echo', 1)], { pendingModifiers: [mod1('magic_damage', 6)] }),
    tal(3233, 0, [mod1('magic_damage', 6)]),
];
test('an encounter records the equipped talismans: lines, grade, value, locked, unique; unslotted talismans and pending rolls are left out', () => {
    const r = mk({ server: 'test' });
    r.handle(INIT(TALS, 0.2, 3, [{ itemLocationHrid: '/item_locations/belt', itemHrid: '/items/large_talisman_belt' }, { itemLocationHrid: '/item_locations/inventory', itemHrid: '/items/x' }]), 500);
    r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const t = lastEnc(r).players[0].talisman;
    assert.equal(t.power, 0.2); assert.equal(t.slots, 3); assert.equal(t.belt, '/items/large_talisman_belt');
    assert.deepEqual(J(t.talismans.map((x) => x.id)), [3197, 3203]);
    assert.deepEqual(J(t.talismans[0].lines), [
        { hrid: '/talisman_modifiers/magic_damage', grade: 2, value: 0.045, locked: false, unique: false },
        { hrid: '/talisman_modifiers/armor', grade: 4, value: 4, locked: true, unique: false },
    ]);
    assert.equal(t.talismans[0].locked, '/talisman_modifiers/armor');
    assert.deepEqual(J(t.talismans[1].lines), [{ hrid: '/talisman_modifiers/echo', grade: 1, value: 0.03, locked: false, unique: true }]);
    assert.equal(t.talismans[1].slotIndex, 2); assert.equal(t.talismans[1].type, '/talisman_types/combat');
});

test('no talismans, no belt, no client data: empty lists and nulls, never a guess', () => {
    const r = mk({ clientData: undefined });
    r.handle(INIT(undefined, undefined, undefined), 500);
    r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    assert.deepEqual(J(lastEnc(r).players[0].talisman), { power: null, slots: null, belt: null, talismans: [] });
    const r2 = createRecorder({ clientData: () => null });
    r2.handle(INIT([tal(1, 1, [mod1('echo', 3)])], 0.1, 1), 500);
    r2.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
    close(r2, 2000);
    assert.deepEqual(J(lastEnc(r2).players[0].talisman.talismans[0].lines), [{ hrid: '/talisman_modifiers/echo', grade: 3, value: null, locked: false, unique: null }]);
    assert.deepEqual(J(talismanLines(undefined, null)), []);
    assert.deepEqual(J(talismanLines([tal(1, 1, [{ hrid: '/x/unknown', grade: 9 }])], GAME)[0].lines), [{ hrid: '/x/unknown', grade: 9, value: null, locked: false, unique: null }]);
});

test('talismans_updated: slotting, unslotting, a changed roll and a deleted talisman change the next encounter; character_stats_updated changes the power', () => {
    const r = mk();
    r.handle(INIT(TALS, 0.2, 3), 500);
    r.handle({ type: 'talismans_updated', endCharacterTalismans: [tal(3233, 3, [mod1('magic_damage', 6)])], deletedTalismanIds: null }, 1000); // slot the third talisman
    r.handle({ type: 'talismans_updated', endCharacterTalismans: [tal(3197, 0, [mod1('magic_damage', 2), mod1('armor', 4)])], deletedTalismanIds: null }, 1100); // unslot the first
    r.handle({ type: 'character_stats_updated', combatUnit: { combatDetails: { combatStats: { talismanSlots: 3, talismanPower: 0.4 } } } }, 1200);
    r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 3000);
    r.handle(NB(2, [unit(SELF)], [mon('/monsters/m')]), 4000);
    let t = r.state.encounters[0].players[0].talisman;
    assert.deepEqual(J(t.talismans.map((x) => [x.id, x.slotIndex])), [[3203, 2], [3233, 3]]);
    assert.equal(t.power, 0.4);
    r.handle({ type: 'talismans_updated', endCharacterTalismans: null, deletedTalismanIds: [3203] }, 4100);
    r.handle({ type: 'talismans_updated', endCharacterTalismans: [tal(3233, 3, [mod1('echo', 6)])], deletedTalismanIds: null }, 4200);
    r.handle(NB(3, [unit(SELF)], [mon('/monsters/m')]), 5000);
    r.handle(NB(4, [unit(SELF)], [mon('/monsters/m')]), 6000);
    t = r.state.encounters[2].players[0].talisman;
    assert.deepEqual(J(t.talismans.map((x) => [x.id, x.lines[0].hrid, x.lines[0].grade])), [[3233, '/talisman_modifiers/echo', 6]]);
});

test('garbage talisman messages change nothing and do not throw; they do not move the gap clock', () => {
    const r = mk();
    r.handle(INIT(TALS, 0.2, 3), 500);
    r.handle(NB(1, [unit(SELF)], [mon('/monsters/m')]), 1000);
    const last = r.state.lastT;
    for (const m of [{ type: 'talismans_updated' }, { type: 'talismans_updated', endCharacterTalismans: [null, {}, 5], deletedTalismanIds: 'x' }, { type: 'character_stats_updated' }, { type: 'character_stats_updated', combatUnit: {} }, { type: 'character_stats_updated', combatUnit: { combatDetails: { combatStats: { talismanPower: 'x' } } } }]) r.handle(m, 999999);
    assert.equal(r.state.lastT, last);
    assert.equal(r.state.tal.power, 0.2);
    assert.deepEqual(J(r.state.tal.list.map((x) => x.id).sort()), [3197, 3203, 3233]);
});

test('another party member: only the power and slots the unit shows, no lines; talisman fields are not added into the window totals', () => {
    const r = mk();
    r.handle(INIT(TALS, 0.2, 3), 500);
    const other = unit({ character: { id: 7 }, combatDetails: { combatStats: { talismanPower: 0.3, talismanSlots: 2 } } });
    r.handle(NB(1, [unit(SELF), other], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const e = lastEnc(r);
    assert.deepEqual(J(e.players[1].talisman), { power: 0.3, slots: 2 });
    assert.equal(e.players[0].talisman.talismans.length, 2);
    const unit0 = unit({ character: { id: 7 } });
    r.handle(NB(5, [unit(SELF), unit0], [mon('/monsters/m')]), 3000);
    close(r, 4000);
    assert.deepEqual(J(lastEnc(r).players[1].talisman), { power: null, slots: null });
    for (const w of r.state.windows) for (const p of w.players) assert.equal(p.totals.talisman, undefined);
});

test('self-only: the self player keeps its talismans and no other player appears', () => {
    const r = mk();
    r.handle(INIT(TALS, 0.2, 3), 500);
    r.handle(NB(1, [unit(SELF), unit({ character: { id: 7 }, combatDetails: { combatStats: { talismanPower: 0.3 } } })], [mon('/monsters/m')]), 1000);
    close(r, 2000);
    const ex = r.exportData(true, 3000);
    assert.equal(ex.encounters[0].players.length, 1);
    assert.equal(ex.encounters[0].players[0].talisman.talismans.length, 2);
    assert.ok(!JSON.stringify(ex).includes('0.3,"slots"'));
});

test('through the game socket hook: the talisman messages reach the recorder, the encounter of a test tab carries lines and a trace', async () => {
    const store = {};
    const tab = boot(store, 'test.milkywayidle.com', { charId: 8 });
    tab.send(INIT(TALS, 0.2, 3));
    tab.send({ type: 'talismans_updated', endCharacterTalismans: [tal(3233, 3, [mod1('echo', 6)])], deletedTalismanIds: null });
    tab.send({ type: 'character_stats_updated', combatUnit: { combatDetails: { combatStats: { talismanSlots: 3, talismanPower: 0.4 } } } });
    tab.send(NB(1, [unit({ ...SELF, preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false })], [mon('/monsters/m')]));
    tab.send(BU(1, { 0: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/fireball' }) }, { 0: ent(900, 0, 1, 0) }));
    tab.send(NB(2, [unit(SELF)], [mon('/monsters/m')]));
    tab.hide();
    const e = stored(store, '.test').enc[0];
    assert.equal(e.players[0].talisman.power, 0.4);
    assert.deepEqual(e.players[0].talisman.talismans.map((x) => x.id), [3197, 3203, 3233]);
    assert.equal(e.trace.rows.length, 2);
    assert.equal(e.server, 'test');
    assert.deepEqual(stored(store, '').enc, []);
});

// ---------- trace ----------
// A player casts fireball (atk 1) and the monster loses 100; 200 ms later the monster loses 50 with no cast; later a second cast and 120.
function echoStream(r) {
    r.handle(INIT([], 0, 0), 500);
    r.handle(NB(1, [unit({ ...SELF, preparingAbilityHrid: '/abilities/fireball', isPreparingAutoAttack: false })], [mon('/monsters/m')]), 1000);
    r.handle(BU(1, { 0: ent(1000, 1, 0, 0, { abilityHrid: '/abilities/fireball' }) }, { 0: ent(900, 0, 1, 0) }), 1100);
    r.handle(BU(1, {}, { 0: ent(850, 0, 2, 1) }), 1300);
    r.handle(BU(1, { 0: ent(1000, 2, 0, 0, { abilityHrid: '/abilities/fireball' }) }, { 0: ent(730, 0, 3, 1) }), 3500);
    close(r, 4000);
}
test('trace rows: one per changed unit per update, columns as named, abilities by index; none on the live server unless asked', () => {
    const r = mk({ server: 'test' });
    echoStream(r);
    const tr = lastEnc(r).trace;
    assert.deepEqual(J(tr.fields), J(TRACE_FIELDS));
    assert.deepEqual(J(tr.src), ['/abilities/fireball', 'auto']);
    // [msg, ms, side, idx, dAtk, dDmg, drop, rise, crit, src, atk, dmg, critN]
    assert.deepEqual(J(tr.rows), [
        [0, 100, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
        [0, 100, 1, 0, 0, 1, 100, 0, 0, 1, 0, 1, 0],
        [1, 300, 1, 0, 0, 1, 50, 0, 1, 1, 0, 2, 1],
        [2, 2500, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0],
        [2, 2500, 1, 0, 0, 1, 120, 0, 0, 1, 0, 3, 1],
    ]);
    assert.equal(tr.dropped, undefined);
    const live = mk({ server: 'live' });
    echoStream(live);
    assert.equal(lastEnc(live).trace, undefined);
    assert.equal(lastEnc(live).tr, undefined);
    const forced = mk({ server: 'live', trace: true });
    echoStream(forced);
    assert.ok(lastEnc(forced).trace);
    const off = mk({ server: 'test', trace: false });
    echoStream(off);
    assert.equal(lastEnc(off).trace, undefined);
});

test('trace: the row cap counts what it drops; an update with nothing changed adds no row; self-only keeps the self player rows and the monster rows', () => {
    const r = mk({ server: 'test' });
    r.handle(INIT([], 0, 0), 500);
    r.handle(NB(1, [unit(SELF), unit({ character: { id: 7 } })], [mon('/monsters/m')]), 1000);
    r.handle(BU(1, { 0: ent(1000, 0, 0, 0) }, { 0: ent(1000, 0, 0, 0) }), 1100); // nothing changed
    for (let i = 1; i <= REC.MAX_TRACE + 5; i++) r.handle(BU(1, { 0: ent(1000, i, 0, 0), 1: ent(1000, i, 0, 0) }, {}), 1100 + i);
    close(r, 999999);
    const e = lastEnc(r);
    assert.equal(e.trace.rows.length, REC.MAX_TRACE);
    assert.equal(e.trace.dropped, 2 * (REC.MAX_TRACE + 5) - REC.MAX_TRACE);
    const so = r.exportData(true, 1).encounters[0].trace;
    assert.ok(so.rows.every((row) => row[2] === 1 || row[3] === 0));
    assert.ok(so.rows.length > 0 && so.rows.length < e.trace.rows.length + 1);
});

// ---------- the analysis script ----------
function recFile(lines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-'));
    const f = path.join(dir, 'test.ndjson');
    fs.writeFileSync(f, lines.join('\n') + '\n');
    return f;
}
test('tools/echo-analysis.mjs: per cast the events that follow and their ratio to the first event; counts only', async () => {
    const A = await import(pathToUrl(path.join(__dirname, '..', '..', 'tools', 'echo-analysis.mjs')));
    const r = mk({ server: 'test' });
    echoStream(r);
    const enc = J(lastEnc(r));
    const res = A.analyze([enc], { windowMs: 2000 });
    assert.equal(res.used, 1); assert.equal(res.skipped, 0); assert.equal(res.casts, 2); assert.equal(res.castingPlayers, 1);
    const a = res.byAbility['/abilities/fireball'];
    assert.equal(a.casts, 2); assert.equal(a.noEvent, 0); assert.equal(a.noExtra, 1); assert.equal(a.oneExtra, 1); assert.equal(a.manyExtra, 0);
    assert.equal(a.extraLater, 1); assert.equal(a.extraSameUpdate, 0); assert.equal(a.extraDamage, 1); assert.deepEqual(J(a.ratios), { '0.5-0.6': 1 });
    assert.equal(res.list[0].base.amount, 100);
    assert.equal(res.list[0].extras[0].amount, 50); assert.equal(res.list[0].extras[0].ratio, 0.5); assert.equal(res.list[0].extras[0].ms, 200); assert.equal(res.list[0].extras[0].msg, 1);
    assert.equal(res.list[1].extras.length, 0);
    // a short window drops the late event
    assert.equal(A.analyze([enc], { windowMs: 100 }).byAbility['/abilities/fireball'].oneExtra, 0);
    // an encounter without a trace is counted and skipped
    const none = A.analyze([{ players: [] }, enc], {});
    assert.equal(none.skipped, 1); assert.equal(none.used, 1);
    const txt = A.format(res, { casts: true });
    assert.match(txt, /\/abilities\/fireball: casts 2/);
    assert.match(txt, /0\.5-0\.6 x1/);
    assert.match(txt, /ratio 0\.500/);
    assert.ok(!/echo|proc/i.test(A.format(res, {}).replace(/echo-analysis/g, '')), 'the report names no conclusion');
});

test('tools/echo-analysis.mjs: a same-update extra, a heal, a combined update (2+ splats), an ability with no event, and every file shape', async () => {
    const A = await import(pathToUrl(path.join(__dirname, '..', '..', 'tools', 'echo-analysis.mjs')));
    const F = TRACE_FIELDS;
    const trace = {
        fields: F, src: ['/abilities/a', '/abilities/heal', 'auto'],
        rows: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 2, 150, 0, 0, 2, 0, 2, 0], // cast a: one update with two splats, 150 lost
            [1, 100, 1, 0, 0, 1, 75, 0, 0, 2, 0, 3, 0], // extra half later
            [5, 3000, 0, 0, 1, 0, 0, 0, 0, 1, 2, 0, 0], [5, 3000, 0, 0, 0, 0, 0, 200, 0, 1, 2, 0, 0], // cast heal: heal 200 in the same update
            [6, 3100, 0, 0, 0, 0, 0, 100, 0, 1, 2, 0, 0], // half heal
            [9, 6000, 0, 0, 1, 0, 0, 0, 0, 0, 3, 0, 0], // cast a: nothing follows
        ],
    };
    const enc = { server: 'test', trace };
    const res = A.analyze([enc], { windowMs: 2000 });
    const a = res.byAbility['/abilities/a'], h = res.byAbility['/abilities/heal'];
    assert.equal(a.casts, 2); assert.equal(a.noEvent, 1); assert.equal(a.oneExtra, 1); assert.equal(a.multiSplatRows, 1);
    assert.deepEqual(J(a.ratios), { '0.5-0.6': 1 });
    assert.equal(h.casts, 1); assert.equal(h.oneExtra, 1); assert.equal(h.extraHeal, 1); assert.deepEqual(J(h.ratios), { '0.5-0.6': 1 });
    // file shapes: records, a bare encounter, a whole recording, a pretty-printed export, junk lines
    const rec = JSON.stringify({ key: 'test:enc:1:1', type: 'encounter', data: enc });
    const f1 = recFile([rec, 'not json', JSON.stringify({ key: 'k', type: 'task', data: { t: 1, tasks: [] } }), JSON.stringify(enc), JSON.stringify({ v: 1, records: [{ key: 'x', type: 'encounter', data: enc }] })]);
    assert.equal((await A.readEncounters(f1)).length, 3);
    const f2 = recFile([JSON.stringify({ format: 'mwics-loot', encounters: [enc, enc] })]);
    assert.equal((await A.readEncounters(f2)).length, 2);
    const f3 = recFile([JSON.stringify({ encounters: [enc] }, null, 2)]);
    assert.equal((await A.readEncounters(f3)).length, 1);
    const f4 = recFile(['', 'x']);
    assert.equal((await A.readEncounters(f4)).length, 0);
    // the helper's own line shape
    const f5 = recFile([JSON.stringify({ v: 1, seen: '2030-01-01T00:00:00.000-03:00', rec: { key: 'test:enc:1:1', type: 'encounter', data: enc } }), JSON.stringify({ v: 1, seen: 'x', rec: { key: 'test:win:1#1', type: 'window', data: { players: [] } } }), JSON.stringify({ v: 1, seen: 'x', rec: { key: 'test:task:1', type: 'task', data: { t: 1, tasks: [] } } })]);
    const got = await A.readEncounters(f5);
    assert.equal(got.length, 1, 'only the encounter record; window and task records are not encounters');
    assert.equal(A.analyze(got, {}).used, 1);
    assert.equal(A.analyze(got, {}).casts, 3);
    assert.equal(A.analyze([], {}).casts, 0);
    assert.equal(A.format(A.analyze([], {}), {}).split('\n').length, 1);
});

test('tools/echo-analysis.mjs candidates: a same-target half repeat is listed; an area hit on another unit and a food tick heal are only counted', async () => {
    const A = await import(pathToUrl(path.join(__dirname, '..', '..', 'tools', 'echo-analysis.mjs')));
    // [msg, ms, side, idx, dAtk, dDmg, drop, rise, crit, src, atk, dmg, critN]
    const rows = [
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],      // the player casts
        [0, 0, 1, 0, 0, 1, 100, 0, 0, 1, 0, 1, 0],    // first event: monster 0 loses 100
        [0, 0, 1, 1, 0, 1, 80, 0, 0, 1, 0, 1, 0],     // area: monster 1 loses 80 in the same update (also a first event)
        [1, 200, 1, 0, 0, 1, 50, 0, 0, 1, 0, 2, 0],   // monster 0 loses 50: the candidate, ratio 0.5 to its own first event
        [1, 200, 1, 2, 0, 1, 60, 0, 0, 1, 0, 1, 0],   // an area hit on monster 2, which had no first event: other units
        [2, 900, 0, 0, 0, 0, 0, 40, 0, 0, 1, 0, 0],   // a food tick heals the player: other units
    ];
    const enc = { trace: { fields: TRACE_FIELDS, src: ['/abilities/fireball', 'auto'], rows } };
    const res = A.analyze([enc], { windowMs: 2000 });
    const c = res.list[0];
    assert.equal(c.candidates.length, 1);
    assert.equal(c.candidates[0].amount, 50); assert.equal(c.candidates[0].ratio, 0.5); assert.equal(c.candidates[0].side, 1); assert.equal(c.candidates[0].idx, 0);
    assert.equal(c.otherUnits, 2);
    const a = res.byAbility['/abilities/fireball'];
    assert.equal(a.candCasts, 1); assert.equal(a.candidates, 1); assert.equal(a.candDamage, 1); assert.equal(a.candHeal, 0); assert.equal(a.otherUnits, 2);
    assert.deepEqual(J(a.candRatios), { '0.5-0.6': 1 });
    const txt = A.format(res, { casts: true });
    assert.match(txt, /\| \+200ms update \+1 1:0 damage 50 ratio 0\.500 \| other units: 2/);
    assert.ok(!/damage 60|heal 40/.test(txt), 'other units are counted, not listed');
    assert.match(txt, /candidates \(same unit as a first event\): casts with one 1, events 1 \(damage 1, heal 0\), other units 2/);
    assert.match(A.format(res, { casts: true, all: true }), /damage 60 ratio 0\.600/);
    // a repeat on the player's own unit (a heal echo): a first heal event, then a half heal on the same unit
    const heal = A.analyze([{ trace: { fields: TRACE_FIELDS, src: ['/abilities/h'], rows: [[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 1, 0, 0], [1, 100, 0, 0, 0, 0, 0, 100, 0, 0, 1, 0, 0]] } }], {});
    assert.equal(heal.list[0].candidates.length, 1); assert.equal(heal.list[0].candidates[0].kind, 'heal'); assert.equal(heal.list[0].candidates[0].ratio, 0.5);
    // no events, or nothing after the first: no candidates, no other units
    const none = A.analyze([{ trace: { fields: TRACE_FIELDS, src: ['a'], rows: [[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]] } }], {});
    assert.equal(none.list[0].candidates.length, 0); assert.equal(none.list[0].otherUnits, 0);
});

test('tools/echo-analysis.mjs on the command line: prints counts for a file, a usage line without one', async () => {
    const { spawnSync } = require('node:child_process');
    const script = path.join(__dirname, '..', '..', 'tools', 'echo-analysis.mjs');
    const r = mk({ server: 'test' });
    echoStream(r);
    const f = recFile([JSON.stringify({ key: 'test:enc:1:1', type: 'encounter', data: J(lastEnc(r)) })]);
    const ok = spawnSync(process.execPath, [script, f, '--window-ms', '2000', '--casts'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /casts 2/);
    assert.match(ok.stdout, /enc 0 \+100ms slot 0 \/abilities\/fireball first damage 100 \| \+200ms update \+1 1:0 damage 50 ratio 0\.500 \| other units: 0/);
    const all = spawnSync(process.execPath, [script, f, '--casts', '--all'], { encoding: 'utf8' });
    assert.match(all.stdout, /first damage 100 \| \+200ms update \+1 damage 50 ratio 0\.500/);
    const js = spawnSync(process.execPath, [script, f, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(js.stdout).casts, 2);
    const bad = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(bad.status, 2); assert.match(bad.stderr, /usage/);
    const badw = spawnSync(process.execPath, [script, f, '--window-ms', 'x'], { encoding: 'utf8' });
    assert.equal(badw.status, 2);
});

function pathToUrl(p) { return require('node:url').pathToFileURL(p).href; }

(async () => {
    for (const t of pending) await t();
    console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
