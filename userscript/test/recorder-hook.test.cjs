// Node test for the browser side of userscript/mwics-exporter.user.js (hook, menu commands, storage) on mocked page objects.
// Run: node userscript/test/recorder-hook.test.cjs
// Covers: the getter returns every message unchanged; only the game socket is read; recorded messages feed the recorder;
// "Copy loot export" copies the file, "Clear recorded loot" empties it, the record survives a reload through the stored keys.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');

// opts.prompt: answer of page.prompt; opts.respond(request) -> {status, responseText} for the helper (default: 200, all accepted).
function boot(store, opts) {
    opts = opts || {};
    class ME { constructor(d, url) { this._d = d; this.currentTarget = { url }; } get data() { return this._d; } }
    const commands = {}, clip = [], toasts = [], reqs = [], timers = [], downloads = [], intervals = [], created = [];
    const el = () => { const e = { style: {}, remove() {}, appendChild() {}, addEventListener(ev, fn) { this.on = fn; }, click() { downloads.push({ href: this.href, name: this.download }); }, set textContent(v) { toasts.push(v); } }; created.push(e); return e; };
    const blobs = [];
    const sandbox = {
        console, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, JSON, Date, WeakSet, Object, Promise, Math, Set, Map, Array, String, Number, Error, RegExp, Blob: class { constructor(parts) { blobs.push(parts.join('')); } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        unsafeWindow: { MessageEvent: ME, addEventListener() {}, prompt: () => opts.prompt },
        document: { body: { appendChild() {} }, createElement: el, addEventListener() {}, getElementById: (id) => (opts.dom && opts.dom[id]) || null, visibilityState: 'visible' }, location: opts.location, setInterval: (fn) => { intervals.push(fn); return intervals.length; }, clearInterval: (i) => { intervals[i - 1] = null; },
        GM_registerMenuCommand: (n, f) => { commands[n] = f; },
        GM_setClipboard: (t) => clip.push(t),
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        GM_xmlhttpRequest: (o) => {
            reqs.push(o);
            const n = JSON.parse(o.data).records.length;
            const r = opts.respond ? opts.respond(o) : { status: 200, responseText: JSON.stringify({ accepted: n, duplicate: 0, rejected: 0 }) };
            Promise.resolve().then(() => o.onload(r));
        },
    };
    vm.runInNewContext(SRC, sandbox);
    const send = (msg, url) => new ME(typeof msg === 'string' ? msg : JSON.stringify(msg), url || 'wss://api.milkywayidle.com/ws').data;
    return { commands, clip, toasts, send, reqs, timers, downloads, blobs, intervals, created };
}
const tick = () => new Promise((r) => setImmediate(r));

const unit = (o) => ({ currentHitpoints: 100, maxHitpoints: 100, currentManapoints: 10, maxManapoints: 10, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0, preparingAbilityHrid: '', isPreparingAutoAttack: true, combatDetails: { combatStats: {} }, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0, ...o });
const NB = (id) => ({ type: 'new_battle', battleId: id, combatStartTime: 'x', players: [unit({ character: { id: 1, name: 'Hidden' } })], monsters: [{ ...unit({}), hrid: '/monsters/m' }] });

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok - ' + name); }

(async () => {
await test('messages pass through unchanged, other sockets are ignored, the recorder fills and exports', () => {
    const store = {};
    const b = boot(store);
    const raw = JSON.stringify({ type: 'init_character_data', character: { id: 1, name: 'Hidden' } });
    assert.equal(b.send(raw), raw);
    assert.equal(b.send(JSON.stringify(NB(1))), JSON.stringify(NB(1)));
    b.send(JSON.stringify(NB(2)), 'wss://example.com/other');
    b.send(NB(3));
    b.send(NB(4));
    assert.deepEqual(Object.keys(b.commands), ['Copy character export (player, gear, inventory)', 'Copy group export (party, for Group Combat import)', 'Copy combat recording (clipboard)', 'Save combat recording (file)', 'Clear recorded combat data', 'Set helper token', 'Set helper address', 'Status', 'Settings']);
    b.commands['Copy combat recording (clipboard)']();
    assert.equal(b.clip.length, 1);
    assert.equal(b.reqs.length, 0, 'no token set: nothing is sent');
    const file = JSON.parse(b.clip[0]);
    assert.equal(file.format, 'mwics-loot');
    assert.deepEqual(file.encounters.map((e) => e.battleId), [1, 3]);
    assert.ok(!b.clip[0].includes('Hidden'));
});

await test('Clear recorded combat data empties the record and the stored keys; the record survives a reload', () => {
    const store = {};
    const b = boot(store);
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (const id of [1, 2, 3]) b.send(NB(id));
    b.commands['Copy combat recording (clipboard)']();
    assert.equal(JSON.parse(b.clip[0]).encounters.length, 2);
    // pagehide/visibility saves; here the cap of dirty rows is not reached, so save through the clear path first
    const reloaded0 = boot(store);
    reloaded0.commands['Copy combat recording (clipboard)']();
    assert.ok(reloaded0.toasts.some((t) => /nothing recorded/.test(t)));
    b.commands['Clear recorded combat data']();
    const reloaded = boot(store);
    reloaded.commands['Copy combat recording (clipboard)']();
    assert.ok(reloaded.toasts.some((t) => /nothing recorded/.test(t)));
    assert.equal(reloaded.clip.length, 0);
});

await test('the record is saved every 20 closed encounters and loaded after a reload', () => {
    const store = {};
    const b = boot(store);
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 22; id++) b.send(NB(id));
    assert.ok(store.mwicsRecorderEncounters);
    const again = boot(store);
    again.commands['Copy combat recording (clipboard)']();
    assert.ok(JSON.parse(again.clip[0]).encounters.length >= 20);
});

await test('Save combat recording (file) downloads the same content the copy gives, through a blob link', () => {
    const b = boot({});
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 3; id++) b.send(NB(id));
    b.commands['Save combat recording (file)']();
    b.commands['Copy combat recording (clipboard)']();
    assert.equal(b.downloads.length, 1);
    assert.match(b.downloads[0].name, /^mwics-combat-recording-.*\.json$/);
    assert.equal(b.downloads[0].href, 'blob:test');
    const a = JSON.parse(b.blobs[0]), c = JSON.parse(b.clip[0]);
    delete a.exportedAt; delete c.exportedAt;
    assert.deepEqual(a, c);
    assert.equal(b.clip.length, 1, 'the save does not touch the clipboard');
    const empty = boot({});
    empty.commands['Save combat recording (file)']();
    assert.equal(empty.downloads.length, 0);
});

await test('with a token the finished encounters go to the helper once, in the wire shape, and a reload does not resend', async () => {
    const store = {};
    const b = boot(store, { prompt: 'secret-token' });
    b.send({ type: 'init_character_data', character: { id: 1 } });
    b.commands['Set helper token']();
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.ok(b.reqs.length >= 1);
    const r = b.reqs[0];
    assert.equal(r.method, 'POST');
    assert.equal(r.url, 'http://127.0.0.1:47631/v1/combat');
    assert.equal(r.headers['X-MWI-Token'], 'secret-token');
    const bodies = b.reqs.map((q) => JSON.parse(q.data));
    const recs = bodies.flatMap((x) => x.records);
    for (const body of bodies) { assert.equal(body.v, 1); assert.ok(body.records.length <= 64); }
    for (const rec of recs) { assert.equal(typeof rec.key, 'string'); assert.ok(rec.key.length <= 200); assert.ok(['encounter', 'window', 'task'].includes(rec.type)); assert.ok(rec.data); }
    assert.ok(recs.some((x) => x.type === 'encounter'));
    assert.ok(recs.some((x) => x.type === 'window'));
    assert.ok(!r.data.includes('Hidden'), 'no character name in what is sent');
    // page hidden: the rest goes too, and the sent keys are stored
    b.commands.Status();
    assert.ok(b.toasts.some((t) => /v0\.5\.1/.test(t)));
    assert.ok(store.mwicsSinkSent);
    const sentKeys = JSON.parse(store.mwicsSinkSent);
    const b2 = boot(store, { prompt: 'secret-token' });
    b2.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 8; id++) b2.send(NB(id));
    await tick(); await tick();
    const again = b2.reqs.flatMap((q) => JSON.parse(q.data).records.map((x) => x.key));
    for (const k of again) assert.ok(!sentKeys.includes(k) || !k.startsWith('enc:'), 'an encounter key already sent is not sent again: ' + k);
});

await test('a refused or unreachable helper keeps the data and retries; the toggle off sends nothing', async () => {
    const b = boot({}, { prompt: 't', respond: () => ({ status: 401, responseText: '{}' }) });
    b.send({ type: 'init_character_data', character: { id: 1 } });
    b.commands['Set helper token']();
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.ok(b.reqs.length >= 1);
    assert.ok(b.toasts.some((t) => /helper not reachable or token wrong/.test(t)));
    assert.ok(b.timers.some((t) => t.ms >= 2000), 'a retry is scheduled');
    b.commands['Copy combat recording (clipboard)']();
    assert.ok(JSON.parse(b.clip[0]).encounters.length >= 3, 'the in-browser record is untouched');
    const off = boot({ mwicsRecorderToggles: JSON.stringify({ recorder: true, sendToHelper: false }) }, { prompt: 't' });
    off.send({ type: 'init_character_data', character: { id: 1 } });
    off.commands['Set helper token']();
    for (let id = 1; id <= 8; id++) off.send(NB(id));
    await tick(); await tick();
    assert.equal(off.reqs.length, 0);
});

await test('cross-tab link: the game tab leaves the party in storage; the simulator page button imports it, refuses stale or missing data', () => {
    const store = {};
    const game = boot(store);
    game.send({ type: 'init_character_data', character: { id: 1, name: 'Zed' }, characterSkills: [], characterItems: [] });
    const snap = JSON.parse(store.mwicsGroupSnapshot);
    assert.deepEqual(Object.keys(snap.group), ['1']);
    assert.equal(game.reqs.length, 0);

    const mkSim = (s) => {
        const input = { value: '' }, clicks = [];
        const dom = { buttonImportExport: { closest(sel) { dom.closestSel = sel; return { insertAdjacentElement(pos, e) { dom.inserted = [pos, e]; } }; } }, inputSetGroupCombatAll: input, buttonImportSet: { click() { clicks.push('import:' + input.value); } }, 'group-combat-tab': { click() { clicks.push('tab'); } } };
        const sim = boot(s, { location: { hostname: 'ramlock.github.io' }, dom });
        sim.intervals[0]();
        return { sim, dom, clicks, input, press: () => sim.created.find((e) => e.id === 'mwicsImportParty').on() };
    };
    const a = mkSim(store);
    assert.deepEqual(Object.keys(a.sim.commands), [], 'on the simulator page there is no menu and no hook');
    assert.equal(a.dom.inserted[0], 'afterend');
    assert.equal(a.dom.closestSel, '.row', 'the button goes after the whole button row, never into it (that row would widen and push the Dark Mode toggle out of line)');
    assert.match(a.dom.inserted[1].className, /\brow\b.*\bmt-2\b/, 'its own row with a top margin');
    a.press();
    assert.deepEqual(a.clicks.map((c) => c.split(':')[0]), ['tab', 'import']);
    assert.deepEqual(Object.keys(JSON.parse(a.input.value)), ['1']);

    const b = mkSim({ ...store, mwicsGroupSnapshot: JSON.stringify({ ...snap, t: Date.now() - 31 * 60000 }) });
    b.press();
    assert.equal(b.clicks.length, 0);
    assert.ok(b.sim.toasts.some((t) => /3\d min old/.test(t)));
    const c = mkSim({});
    c.press();
    assert.equal(c.clicks.length, 0);
    assert.ok(c.sim.toasts.some((t) => /no party data from the game/.test(t)));
});

await test('the version in the header, the settings title and the status agree', () => {
    assert.match(SRC, /@version\s+0\.5\.1/);
    assert.ok(SRC.includes("const VERSION = '0.5.1'"));
});

await test('Copy group export: reads the battle start and a shared profile from the socket, keeps profiles across a reload, never sends', async () => {
    const store = {};
    const b = boot(store);
    const NAME = 'Copy group export (party, for Group Combat import)';
    b.commands[NAME]();
    assert.equal(b.clip.length, 0, 'no character data yet: nothing copied');
    assert.ok(b.toasts.some((t) => /no character data/.test(t)));
    b.send({ type: 'init_character_data', character: { id: 1, name: 'Zed' }, characterSkills: [], characterItems: [] });
    const mk = (id, name, ab) => unit({ isPlayer: true, name, character: { id, name }, combatAbilities: [{ abilityHrid: ab, level: 9 }], combatConsumables: [{ itemHrid: '/items/x_coffee', count: 1 }] });
    b.send({ type: 'new_battle', battleId: 1, combatStartTime: 'x', players: [mk(2, 'Ann', '/abilities/a1'), mk(1, 'Zed', '/abilities/a2')], monsters: [{ ...unit({}), hrid: '/monsters/m' }] });
    b.send({ type: 'profile_shared', profile: { sharableCharacter: { id: 2, name: 'Ann' }, characterSkills: [{ characterID: 2, skillHrid: '/skills/attack', level: 33 }], wearableItemMap: {} } });
    b.commands[NAME]();
    const g = JSON.parse(b.clip[0]);
    assert.deepEqual(Object.keys(g), ['1', '2']);
    assert.equal(g['1'].player.attackLevel, 33);
    assert.equal(g['1'].abilities[1].abilityHrid, '/abilities/a1');
    assert.equal(g['2'].name, 'Zed');
    assert.ok(b.toasts.some((t) => /slot 1: missing .*gear/.test(t) || /missing/.test(t)));
    assert.equal(b.reqs.length, 0);
    const again = boot(store);
    again.send({ type: 'init_character_data', character: { id: 1, name: 'Zed' }, characterSkills: [], characterItems: [] });
    again.commands[NAME]();
    assert.equal(JSON.parse(again.clip[0])['1'].player.attackLevel, 33, 'the shared profile and the party survive a reload');
});

console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
