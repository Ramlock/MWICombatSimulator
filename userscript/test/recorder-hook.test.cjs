// Node test for the browser side of userscript/mwics-exporter.user.js (hook, menu commands, storage) on mocked page objects.
// Run: node userscript/test/recorder-hook.test.cjs
// Covers: the getter returns every message unchanged; only the game socket is read; recorded messages feed the recorder;
// GET /token (the script asks the helper for its token; opts.tokenRespond(request) -> {status, responseText} or 'error'; default 403) is counted apart in tokenReqs.
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
    const commands = {}, clip = [], toasts = [], reqs = [], tokenReqs = [], removed = [], timers = [], downloads = [], intervals = [], created = [];
    const el = () => { const e = { style: {}, remove() { removed.push(this._t); }, appendChild(c) { (this.kids = this.kids || []).push(c); }, addEventListener(ev, fn) { this.on = fn; }, click() { downloads.push({ href: this.href, name: this.download }); }, set textContent(v) { this._t = v; toasts.push(v); } }; created.push(e); return e; };
    const blobs = [];
    const sandbox = {
        console, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, JSON, Date, WeakSet, Object, Promise, Math, Set, Map, Array, String, Number, Error, RegExp, Blob: class { constructor(parts) { blobs.push(parts.join('')); } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        unsafeWindow: { MessageEvent: ME, addEventListener() {}, prompt: () => opts.prompt },
        document: { body: { appendChild() {} }, createElement: el, createTextNode: (text) => ({ text }), addEventListener() {}, getElementById: (id) => (opts.dom && opts.dom[id]) || null, visibilityState: 'visible' }, location: opts.location, setInterval: (fn) => { intervals.push(fn); return intervals.length; }, clearInterval: (i) => { intervals[i - 1] = null; },
        GM_registerMenuCommand: (n, f) => { commands[n] = f; },
        GM_setClipboard: (t) => clip.push(t),
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        GM_xmlhttpRequest: (o) => {
            if (o.method === 'GET') {
                tokenReqs.push(o);
                const t = opts.tokenRespond ? opts.tokenRespond(o) : { status: 403, responseText: '' };
                Promise.resolve().then(() => (t === 'error' ? o.onerror() : o.onload(t)));
                return;
            }
            reqs.push(o);
            const n = JSON.parse(o.data).records.length;
            const r = opts.respond ? opts.respond(o) : { status: 200, responseText: JSON.stringify({ accepted: n, duplicate: 0, rejected: 0 }) };
            Promise.resolve().then(() => o.onload(r));
        },
    };
    vm.runInNewContext(SRC, sandbox);
    const send = (msg, url) => new ME(typeof msg === 'string' ? msg : JSON.stringify(msg), url || 'wss://api.milkywayidle.com/ws').data;
    return { commands, clip, toasts, send, reqs, tokenReqs, removed, timers, downloads, blobs, intervals, created };
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
    assert.ok(b.toasts.some((t) => /v0.9.1/.test(t)));
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
    await tick();
    const baseline = b.timers.length;
    b.send({ type: 'init_character_data', character: { id: 1 } });
    b.commands['Set helper token']();
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.ok(b.reqs.length >= 1);
    assert.ok(b.toasts.some((t) => /helper not reachable or token wrong/.test(t)));
    assert.ok(b.timers.slice(baseline).some((t) => t.ms >= 2000), 'a retry is scheduled');
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

await test('the snapshot carries selected and fight, kept live by party_updated, actions_updated and action_completed; the page button applies them', () => {
    const store = {};
    const game = boot(store);
    const A = (o) => ({ id: 7, partyID: 0, ordinal: 0, isDone: false, ...o });
    game.send({ type: 'init_character_data', character: { id: 1, name: 'Zed' }, characterSkills: [], characterItems: [], characterActions: [A({ actionHrid: '/actions/combat/zone_a', difficultyTier: 1 })], partyInfo: null });
    let snap = JSON.parse(store.mwicsGroupSnapshot);
    assert.deepEqual(snap.selected, [1]);
    assert.equal(snap.fight.zone, '/actions/combat/zone_a');
    assert.equal(snap.fight.tier, 1);
    assert.equal(snap.fight.source, 'action');
    game.send({ type: 'party_updated', partyInfo: { party: { status: 'battling', actionHrid: '/actions/combat/zone_b', difficultyTier: 3 }, partySlotMap: {} } });
    snap = JSON.parse(store.mwicsGroupSnapshot);
    assert.deepEqual([snap.fight.zone, snap.fight.tier, snap.fight.source], ['/actions/combat/zone_b', 3, 'party']);
    game.send({ type: 'party_updated', partyInfo: { party: { status: 'disbanded' }, partySlotMap: {} } });
    game.send({ type: 'actions_updated', endCharacterActions: [A({ actionHrid: '/actions/combat/zone_a', difficultyTier: 2, isDone: false })] });
    snap = JSON.parse(store.mwicsGroupSnapshot);
    assert.deepEqual([snap.fight.zone, snap.fight.tier], ['/actions/combat/zone_a', 2]);
    game.send({ type: 'actions_updated', endCharacterActions: [A({ isDone: true })] });
    snap = JSON.parse(store.mwicsGroupSnapshot);
    assert.equal(snap.fight.kind, 'idle');
    assert.equal(game.reqs.length, 0, 'nothing is sent');

    game.send({ type: 'actions_updated', endCharacterActions: [A({ actionHrid: '/actions/combat/zone_a', difficultyTier: 2 })] });
    game.commands['Copy group export (party, for Group Combat import)']();
    const copied = JSON.parse(game.clip[game.clip.length - 1]);
    assert.deepEqual(Object.keys(copied), ['1', 'selected', 'fight'], 'Copy group carries selected and fight beside the slots');
    assert.deepEqual(copied.selected, [1]);
    assert.equal(copied.fight.zone, '/actions/combat/zone_a');
    assert.equal(copied['1'].selected, undefined, 'never inside a slot');
    const els = { player1: { checked: false }, player2: { checked: true }, selectZone: { value: 'a', options: [{ value: '/actions/combat/zone_a' }] }, selectDifficulty: { value: '0', options: [{ value: '0' }, { value: '2' }] }, selectDungeon: { value: '', options: [] }, simDungeonToggle: { checked: false, dispatchEvent() {} } };
    const input = { value: '' }, clicks = [];
    const dom = { ...els, buttonImportExport: { closest: () => ({ insertAdjacentElement() {} }) }, inputSetGroupCombatAll: input, buttonImportSet: { click() { clicks.push('import'); } }, 'group-combat-tab': { click() {} } };
    const sim = boot({ ...store }, { location: { hostname: 'ramlock.github.io' }, dom });
    sim.intervals[0]();
    sim.created.find((e) => e.id === 'mwicsImportParty').on();
    assert.deepEqual(Object.keys(JSON.parse(input.value)), ['1'], 'the pasted text carries only the slots');
    assert.deepEqual([els.player1.checked, els.player2.checked, els.selectZone.value, els.selectDifficulty.value], [true, false, '/actions/combat/zone_a', '2']);
});

await test('the version in the header, the settings title and the status agree', () => {
    assert.match(SRC, /@version\s+0.9.1/);
    assert.ok(SRC.includes("const VERSION = '0.9.1'"));
    assert.match(SRC, /@name\s+MWI Combat Tracker\r?\n/);
    assert.match(SRC, /@namespace\s+https:\/\/github.com\/Ramlock\/MWICombatSimulator\r?\n/);
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
    assert.deepEqual(Object.keys(g), ['1', '2', 'selected'], 'the slots, then the selection beside them (no fight known here)');
    assert.deepEqual(g.selected, [1, 2]);
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

const WARN = 'MWI Combat Tracker: no helper token, so nothing is sent to the helper. The recording stays in this browser.';
const TOK = 'fetched-token-0123456789abcdef';
const ok = (token) => () => ({ status: 200, responseText: JSON.stringify({ token }) });

await test('no token, recorder on: the script asks the helper (GET /token, no token header) and, when refused, warns once per page load', async () => {
    const store = {};
    const b = boot(store);
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 1);
    assert.equal(b.tokenReqs[0].method, 'GET');
    assert.equal(b.tokenReqs[0].url, 'http://127.0.0.1:47631/token');
    assert.ok(!b.tokenReqs[0].headers || !Object.keys(b.tokenReqs[0].headers).some((k) => /token/i.test(k)), 'no token header on the ask');
    assert.equal(b.toasts.filter((t) => t === WARN).length, 1, 'the warning shows once');
    // the backoff retries ask again (the token is still empty) and never repeat the warning
    for (let i = 0; i < 3; i++) { const t = b.timers.filter((x) => x.ms >= 2000 && !x.done).pop(); t.done = true; t.fn(); await tick(); await tick(); }
    assert.equal(b.tokenReqs.length, 4, 'one ask at load, then one per backoff retry');
    assert.equal(b.toasts.filter((t) => t === WARN).length, 1, 'still once per page load');
    const waits = b.timers.filter((x) => x.ms >= 2000 && x.ms !== 15000).map((x) => x.ms);
    assert.deepEqual(waits.slice(0, 3), [2000, 4000, 8000], 'the existing 2 s doubling backoff');
    assert.equal(store.mwicsHelperToken, undefined, '403 leaves the token empty');
    assert.equal(b.reqs.length, 0, 'nothing is sent');
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.equal(b.reqs.length, 0, 'still nothing is sent without a token');
    b.commands['Copy combat recording (clipboard)']();
    assert.ok(JSON.parse(b.clip[0]).encounters.length >= 3, 'the recording stays in the browser');
});

await test('recorder off: the script neither asks the helper nor warns', async () => {
    const b = boot({ mwicsRecorderToggles: JSON.stringify({ recorder: false }) });
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 0);
    assert.ok(!b.toasts.includes(WARN));
});

await test('the helper answers: the token is stored, the warning is cleared, the next send carries it', async () => {
    const store = {};
    let answer = { status: 403, responseText: '' };
    const b = boot(store, { tokenRespond: () => answer });
    await tick(); await tick();
    assert.equal(b.toasts.filter((t) => t === WARN).length, 1, 'refused first: warned');
    assert.ok(!b.removed.includes(WARN));
    answer = { status: 200, responseText: JSON.stringify({ token: TOK }) };
    b.timers.filter((x) => x.ms >= 2000).pop().fn();
    await tick(); await tick();
    assert.equal(store.mwicsHelperToken, TOK, 'stored with GM_setValue');
    assert.ok(b.removed.includes(WARN), 'the warning toast is removed');
    const asked = b.tokenReqs.length;
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.ok(b.reqs.length >= 1);
    assert.equal(b.reqs[0].headers['X-MWI-Token'], TOK, 'the fetched token is used as if pasted');
    assert.equal(b.tokenReqs.length, asked, 'no second ask once the token is held');
    b.commands.Status();
    assert.ok(b.toasts.some((x) => /sending to the helper\. Written/.test(x)));
});

await test('the helper answers on the first ask: no warning at all, and sending starts without a reload', async () => {
    const store = {};
    const b = boot(store, { tokenRespond: ok(TOK) });
    await tick(); await tick();
    assert.equal(store.mwicsHelperToken, TOK);
    assert.ok(!b.toasts.includes(WARN));
    assert.equal(b.tokenReqs.length, 1);
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.equal(b.reqs[0].headers['X-MWI-Token'], TOK);
});

await test('a stored token is never asked for again (the manual override stays), and Set helper token replaces a fetched one', async () => {
    const withToken = boot({ mwicsHelperToken: 'pasted-by-hand' }, { tokenRespond: ok(TOK) });
    await tick(); await tick();
    assert.equal(withToken.tokenReqs.length, 0, 'a held token is not replaced by the helper');
    assert.ok(!withToken.toasts.includes(WARN));
    const store = {};
    const b = boot(store, { prompt: 'manual-override', tokenRespond: ok(TOK) });
    await tick(); await tick();
    assert.equal(store.mwicsHelperToken, TOK);
    b.commands['Set helper token']();
    assert.equal(store.mwicsHelperToken, 'manual-override');
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 8; id++) b.send(NB(id));
    await tick(); await tick();
    assert.equal(b.reqs[0].headers['X-MWI-Token'], 'manual-override');
    assert.equal(b.tokenReqs.length, 1);
});

await test('an unreachable helper, a 404 from an older helper and a 200 with no usable token all leave it empty, warn once and keep retrying', async () => {
    for (const respond of ['error', { status: 404, responseText: '' }, { status: 200, responseText: 'not json' }, { status: 200, responseText: '{"token":""}' }, { status: 200, responseText: '{"token":"has space"}' }, { status: 200, responseText: '{}' }]) {
        const store = {};
        const b = boot(store, { tokenRespond: () => respond });
        await tick(); await tick();
        assert.equal(store.mwicsHelperToken, undefined, JSON.stringify(respond));
        assert.equal(b.toasts.filter((t) => t === WARN).length, 1, JSON.stringify(respond));
        assert.ok(b.timers.some((t) => t.ms === 2000), 'a retry is scheduled');
        assert.equal(b.reqs.length, 0);
    }
});

await test('turning the recorder on in Settings asks the helper when no token is held', async () => {
    const store = { mwicsRecorderToggles: JSON.stringify({ recorder: false }) };
    const b = boot(store, { tokenRespond: ok(TOK) });
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 0, 'recorder off at load: no ask');
    b.commands.Settings();
    const row = b.created.find((e) => e.kids && e.kids[1] && e.kids[1].text === 'Combat recorder');
    const cb = row.kids[0];
    cb.checked = true;
    cb.on();
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 1);
    assert.equal(store.mwicsHelperToken, TOK);
});

await test('sending to the helper off: no ask, no warning, no retries; turning it on in Settings asks', async () => {
    const store = { mwicsRecorderToggles: JSON.stringify({ recorder: true, sendToHelper: false }) };
    const b = boot(store, { tokenRespond: ok(TOK) });
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 0, 'helper off at load: no ask');
    assert.ok(!b.toasts.includes(WARN), 'helper off: no warning');
    b.timers.forEach((t) => t.fn && t.fn());
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 0, 'helper off: no retries either');
    b.commands.Settings();
    const row = b.created.find((e) => e.kids && e.kids[1] && /^Send to the helper/.test(e.kids[1].text));
    const cb = row.kids[0];
    cb.checked = true;
    cb.on();
    await tick(); await tick();
    assert.equal(b.tokenReqs.length, 1, 'helper switched on in Settings: the script asks');
    assert.equal(store.mwicsHelperToken, TOK);
});

await test('helper toggle on (or never set), no token, helper refuses: the warning shows once (the case after 0.9.1 unchanged); recorder off or helper off: never', async () => {
    const cases = [
        ['toggle never set', { recorder: true }, true],
        ['toggle on', { recorder: true, sendToHelper: true }, true],
        ['toggle off', { recorder: true, sendToHelper: false }, false],
        ['recorder off, toggle on', { recorder: false, sendToHelper: true }, false],
        ['recorder off, toggle off', { recorder: false, sendToHelper: false }, false],
    ];
    for (const [what, toggles, warns] of cases) {
        const b = boot({ mwicsRecorderToggles: JSON.stringify(toggles) });
        await tick(); await tick();
        assert.equal(b.toasts.filter((t) => t === WARN).length, warns ? 1 : 0, what);
        assert.equal(b.tokenReqs.length, warns ? 1 : 0, what + ': the ask');
    }
    // a held token: never a warning or an ask, whatever the toggle
    for (const sendToHelper of [true, false]) {
        const b = boot({ mwicsHelperToken: 'held', mwicsRecorderToggles: JSON.stringify({ recorder: true, sendToHelper }) });
        await tick(); await tick();
        assert.equal(b.tokenReqs.length, 0);
        assert.ok(!b.toasts.includes(WARN));
    }
});

console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
