// Node test: several game tabs of userscript/mwics-exporter.user.js sharing one script storage (one fake GM store, one script instance per tab).
// Run: node userscript/test/tabs.test.cjs
// Covers: tabs saving in interleaved order lose nothing and duplicate nothing (encounters, windows, tasks, counters), a window that grew is not
// replaced by an older copy, the sent keys are a union and a tab does not resend what another tab sent, Clear still empties the shared copy,
// and the pure merge rules (caps, null or corrupt stored copy).
// MWICS_SRC=<path> runs the same scenarios on another copy of the script (the check that the loss showed on the code before the merge).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(process.env.MWICS_SRC || path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');
const clock = { t: 1700000000000 };
class FakeDate extends Date { static now() { return clock.t; } }

// One tab: the script run in its own context, sharing `store` with the other tabs. A tab sees what the other tabs saved only when it reads the store.
function boot(store, opts) {
    opts = opts || {};
    class ME { constructor(d, url) { this._d = d; this.currentTarget = { url }; } get data() { return this._d; } }
    const commands = {}, clip = [], toasts = [], reqs = [], pagehide = [], visibility = [];
    const el = () => ({ style: {}, remove() {}, appendChild() {}, addEventListener() {}, click() {}, set textContent(v) { toasts.push(v); } });
    const sandbox = {
        console, setTimeout: () => 0, JSON, Date: FakeDate, WeakSet, Object, Promise, Math, Set, Map, Array, String, Number, Error, RegExp, Blob: class {},
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        unsafeWindow: { MessageEvent: ME, addEventListener: (ev, fn) => { if (ev === 'pagehide') pagehide.push(fn); }, prompt: () => opts.token },
        document: { body: { appendChild() {} }, createElement: el, createTextNode: (text) => ({ text }), addEventListener: (ev, fn) => { if (ev === 'visibilitychange') visibility.push(fn); }, getElementById: () => null, visibilityState: 'visible' },
        GM_registerMenuCommand: (n, f) => { commands[n] = f; },
        GM_setClipboard: (t) => clip.push(t),
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        GM_xmlhttpRequest: (o) => {
            if (o.method === 'GET') { Promise.resolve().then(() => o.onload({ status: 403, responseText: '' })); return; }
            reqs.push(o);
            const n = JSON.parse(o.data).records.length;
            Promise.resolve().then(() => o.onload({ status: 200, responseText: JSON.stringify({ accepted: n, duplicate: 0, rejected: 0 }) }));
        },
    };
    vm.runInNewContext(SRC, sandbox);
    const send = (msg) => { clock.t += 1000; return new ME(JSON.stringify(msg), 'wss://api.milkywayidle.com/ws').data; };
    const tab = { commands, clip, toasts, reqs, send };
    tab.hide = () => { sandbox.document.visibilityState = 'hidden'; visibility.forEach((f) => f()); };
    tab.recorded = () => { clip.length = 0; commands['Copy combat recording (clipboard)'](); return clip.length ? JSON.parse(clip[0]) : null; };
    // late: the tab says nothing (and so sends nothing: the token is shared through storage) until setToken().
    tab.setToken = () => { send({ type: 'init_character_data', character: { id: opts.charId || 1 } }); commands['Set helper token'](); };
    if (opts.token && !opts.late) tab.setToken();
    return tab;
}
const tick = () => new Promise((r) => setImmediate(r));

const unit = (o) => ({ currentHitpoints: 100, maxHitpoints: 100, currentManapoints: 10, maxManapoints: 10, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0, preparingAbilityHrid: '', isPreparingAutoAttack: true, combatDetails: { combatStats: {} }, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0, ...o });
const NB = (id, charId) => ({ type: 'new_battle', battleId: id, combatStartTime: 'x' + charId, players: [unit({ character: { id: charId, name: 'P' + charId } })], monsters: [{ ...unit({}), hrid: '/monsters/m' }] });
const init = (charId, tasks) => ({ type: 'init_character_data', character: { id: charId }, characterQuests: tasks || [] });
const quest = (n) => ({ status: '/quest_status/in_progress', category: '/quest_category/c', monsterHrid: '/monsters/m', goalCount: 10, currentCount: n });
// tab: sends init and battles `ids` (n battles close n-1 encounters)
function fight(tab, charId, ids) { for (const id of ids) tab.send(NB(id, charId)); }
const stored = (store) => ({ enc: JSON.parse(store.mwicsRecorderEncounters || '[]'), win: JSON.parse(store.mwicsRecorderWindows || '{}') });
const battleIds = (encs) => encs.map((e) => e.battleId).sort((a, b) => a - b);

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok - ' + name); }

(async () => {
await test('two tabs saving in interleaved order lose nothing and duplicate nothing', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1)); b.send(init(2));
    fight(a, 1, [101, 102, 103]); fight(b, 2, [201, 202, 203]); // A closes 101,102; B closes 201,202
    a.hide(); b.hide();                                           // A saves, then B saves over a copy that never saw A's rows
    fight(a, 1, [104, 105]); fight(b, 2, [204]);                  // A closes 103,104; B closes 203
    b.hide(); a.hide();                                           // opposite order this time
    const s = stored(store);
    assert.deepEqual(battleIds(s.enc), [101, 102, 103, 104, 201, 202, 203]);
    assert.equal(new Set(s.enc.map((e) => e.startedAt + ':' + e.battleId)).size, s.enc.length, 'no duplicate rows');
    assert.equal(s.win.windows.length, 2, 'one window per tab');
    assert.equal(new Set(s.win.windows.map((w) => w.startedAt)).size, 2);
    // a tab opened afterwards loads everything
    const c = boot(store);
    assert.deepEqual(battleIds(c.recorded().encounters), [101, 102, 103, 104, 201, 202, 203]);
});

await test('three tabs, every save order: the shared copy is the union', () => {
    const orders = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]];
    for (const order of orders) {
        const store = {};
        const tabs = [boot(store), boot(store), boot(store)];
        tabs.forEach((t, i) => { t.send(init(i + 1)); fight(t, i + 1, [(i + 1) * 100 + 1, (i + 1) * 100 + 2, (i + 1) * 100 + 3, (i + 1) * 100 + 4]); });
        for (const i of order) tabs[i].hide();
        for (const i of order) tabs[i].hide(); // a second save of an unchanged tab changes nothing
        const s = stored(store);
        assert.deepEqual(battleIds(s.enc), [101, 102, 103, 201, 202, 203, 301, 302, 303], 'order ' + order);
        assert.equal(s.win.windows.length, 3);
    }
});

await test('a tab\'s own record (what the menu copies) is not changed by another tab\'s save, and a save is not duplicated by saving twice', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1)); b.send(init(2));
    fight(a, 1, [101, 102, 103]); fight(b, 2, [201, 202, 203]);
    b.hide(); a.hide(); a.hide(); a.hide();
    assert.deepEqual(battleIds(a.recorded().encounters), [101, 102]);
    assert.deepEqual(battleIds(b.recorded().encounters), [201, 202]);
    assert.equal(stored(store).enc.length, 4);
});

await test('the 20-closed-encounter save merges too', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1)); b.send(init(2));
    fight(b, 2, [201, 202, 203]); b.hide();
    const ids = []; for (let i = 1; i <= 22; i++) ids.push(100 + i);
    fight(a, 1, ids); // no hide: the save at 20 dirty rows
    assert.ok(battleIds(stored(store).enc).includes(201), 'B\'s rows are still there after A\'s periodic save');
    assert.ok(battleIds(stored(store).enc).includes(120));
});

await test('counters add what each tab counted since its last load or save', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1)); b.send(init(2));
    fight(a, 1, [101, 102, 103, 104]); fight(b, 2, [201, 202, 203]); // closed: 3 and 2
    a.hide(); b.hide(); a.hide(); b.hide();
    assert.equal(stored(store).win.stats.closed, 5);
    fight(a, 1, [105]); a.hide();
    assert.equal(stored(store).win.stats.closed, 6);
    const c = boot(store); // a reloaded tab starts from the shared counters and adds only its own
    c.send(init(3)); fight(c, 3, [301, 302]); c.hide();
    assert.equal(stored(store).win.stats.closed, 7);
});

await test('a window that grew is not replaced by an older copy of it', () => {
    const store = {};
    const a = boot(store);
    a.send(init(1)); fight(a, 1, [101, 102, 103]); a.hide();      // window with 2 battles saved
    const b = boot(store);                                         // loads that window (2 battles)
    b.send(init(2)); fight(b, 2, [201, 202]);
    fight(a, 1, [104, 105, 106]); a.hide();                        // the window grows to 5 battles
    b.hide();                                                      // B's save carries its stale copy of A's window
    const w = stored(store).win.windows.filter((x) => x.combatStartTime === 'x1');
    assert.equal(w.length, 1, 'one copy of the window');
    assert.equal(w[0].battles, 5);
    const x2 = stored(store).win.windows.filter((x) => x.combatStartTime === 'x2');
    assert.equal(x2.length, 1);
});

await test('task lists: each tab\'s are kept, by their time', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1, [quest(1)])); b.send(init(2, [quest(5)]));
    a.send({ type: 'quests_updated', endCharacterQuests: [quest(2)] });
    b.send({ type: 'quests_updated', endCharacterQuests: [quest(6)] });
    a.hide(); b.hide(); a.hide();
    const q = stored(store).win.quests;
    assert.equal(q.length, 4);
    assert.deepEqual(q.map((x) => x.tasks[0].currentCount).sort((x, y) => x - y), [1, 2, 5, 6]);
    assert.deepEqual(q.map((x) => x.t), [...q.map((x) => x.t)].sort((x, y) => x - y), 'in time order');
});

await test('Clear recorded combat data still empties the shared copy', () => {
    const store = {};
    const a = boot(store), b = boot(store);
    a.send(init(1)); b.send(init(2));
    fight(a, 1, [101, 102, 103]); fight(b, 2, [201, 202, 203]); a.hide(); b.hide();
    assert.equal(stored(store).enc.length, 4);
    a.commands['Clear recorded combat data']();
    assert.equal(stored(store).enc.length, 0);
    assert.equal(stored(store).win.windows.length, 0);
    assert.equal(stored(store).win.stats.closed, 0);
    fight(a, 1, [104, 105, 106]); a.hide(); // A records on after the clear: counted from zero
    assert.equal(stored(store).win.stats.closed, 2);
});

await test('the sent keys are a union, and a tab does not resend what another tab sent', async () => {
    const store = {};
    const a = boot(store, { token: 'tok', charId: 1 }), b = boot(store, { token: 'tok', charId: 2 });
    fight(a, 1, [101, 102, 103, 104, 105, 106, 107]); fight(b, 2, [201, 202, 203, 204, 205, 206, 207]);
    a.hide(); await tick(); await tick();
    b.hide(); await tick(); await tick();
    const sentA = a.reqs.flatMap((r) => JSON.parse(r.data).records.map((x) => x.key)), sentB = b.reqs.flatMap((r) => JSON.parse(r.data).records.map((x) => x.key));
    assert.ok(sentA.length > 0 && sentB.length > 0);
    const keys = JSON.parse(store.mwicsSinkSent);
    for (const k of [...sentA, ...sentB]) assert.ok(keys.includes(k), 'sent list lost ' + k);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate key in the sent list');
    // a tab opened later, with both tabs' rows loaded, sends none of them again
    const c = boot(store, { token: 'tok', charId: 3 });
    c.hide(); await tick(); await tick();
    const rowKeys = new Set([...sentA, ...sentB]);
    for (const r of c.reqs) for (const x of JSON.parse(r.data).records) assert.ok(!rowKeys.has(x.key), 'resent ' + x.key);
});

await test('a tab whose rows another tab sent meanwhile drops them from its queue before posting', async () => {
    const store = {};
    const a = boot(store, { token: 'tok', charId: 1 });
    fight(a, 1, [101, 102, 103, 104, 105, 106, 107]);
    a.hide(); // saves the rows, then starts the send (async)
    const b = boot(store, { token: 'tok', charId: 1, late: true }); // loads A's rows while A's send is still in flight: A's keys are not stored as sent yet
    await tick(); await tick();
    assert.ok(a.reqs.length > 0);
    b.setToken(); b.hide(); await tick(); await tick();
    const sentA = new Set(a.reqs.flatMap((r) => JSON.parse(r.data).records.map((x) => x.key)));
    for (const r of b.reqs) for (const x of JSON.parse(r.data).records) assert.ok(!sentA.has(x.key), 'resent ' + x.key);
});

// ---- the pure rules ----
const mod = (() => { const m = { exports: {} }; vm.runInNewContext(SRC, { module: m, console, JSON, Date, Object, Map, Set, Array, String, Number, Math, RegExp, Error, Promise, WeakSet }); return m.exports; })();
// results come from another context: compare them as plain data
if (mod.mergeRecorded) { const mr = mod.mergeRecorded, ms = mod.mergeSent; mod.mergeRecorded = (...a) => JSON.parse(JSON.stringify(mr(...a))); mod.mergeSent = (...a) => JSON.parse(JSON.stringify(ms(...a))); }
const E = (t, id) => ({ startedAt: t, battleId: id, players: [] });
const W = (t, battles, extra) => ({ startedAt: t, endedAt: t + 10, battles, buffEvents: [], ...extra });

if (mod.mergeRecorded) {
    await test('mergeRecorded: null or empty stored copy gives this tab\'s rows; a row in both appears once; rows come out in time order', () => {
        const mine = { encounters: [E(3, 3), E(1, 1)], windows: [W(1, 1)], quests: [{ t: 2, tasks: [] }], stats: { closed: 2 } };
        assert.deepEqual(mod.mergeRecorded(null, mine, {}).encounters.map((e) => e.battleId), [1, 3]);
        assert.equal(mod.mergeRecorded({}, mine, {}).stats.closed, 2);
        const both = mod.mergeRecorded({ encounters: [E(1, 1), E(2, 2)], windows: [W(1, 1)], quests: [{ t: 2, tasks: [] }], stats: { closed: 5 } }, mine, { closed: 0 });
        assert.deepEqual(both.encounters.map((e) => e.battleId), [1, 2, 3]);
        assert.equal(both.windows.length, 1);
        assert.equal(both.quests.length, 1);
        assert.equal(both.stats.closed, 7);
    });
    await test('mergeRecorded: junk in the stored copy is ignored, not thrown on', () => {
        const mine = { encounters: [E(1, 1)], windows: [], quests: [], stats: { closed: 1 } };
        const r = mod.mergeRecorded({ encounters: [null, 5, 'x', E(2, 2)], windows: 'no', quests: null, stats: null }, mine, {});
        assert.deepEqual(r.encounters.map((e) => e.battleId), [1, 2]);
        assert.deepEqual(r.windows, []);
    });
    await test('mergeRecorded: the caps keep the newest rows', () => {
        const { REC } = mod;
        const many = []; for (let i = 0; i < REC.MAX_ENCOUNTERS; i++) many.push(E(i * 2, i * 2));
        const mine = { encounters: [E(1, 1), E(REC.MAX_ENCOUNTERS * 2 + 1, 99999)], windows: [], quests: [], stats: {} };
        const r = mod.mergeRecorded({ encounters: many }, mine, {});
        assert.equal(r.encounters.length, REC.MAX_ENCOUNTERS);
        assert.equal(r.encounters[r.encounters.length - 1].battleId, 99999);
        assert.ok(!r.encounters.some((e) => e.battleId === 0), 'the oldest went');
    });
    await test('mergeRecorded: of two copies of a window the one that saw more battles wins, then more buffs, then the later end; a tie keeps this tab\'s', () => {
        const pick = (a, b) => mod.mergeRecorded({ windows: [a] }, { encounters: [], windows: [b], quests: [], stats: {} }, {}).windows[0];
        assert.equal(pick(W(1, 5), W(1, 2)).battles, 5);
        assert.equal(pick(W(1, 2), W(1, 5)).battles, 5);
        assert.equal(pick(W(1, 2, { buffEvents: [1, 2] }), W(1, 2)).buffEvents.length, 2);
        assert.equal(pick(W(1, 2, { endedAt: 99 }), W(1, 2, { endedAt: 50 })).endedAt, 99);
        assert.equal(pick(W(1, 2, { zone: 'old' }), W(1, 2, { zone: 'mine' })).zone, 'mine');
    });
    await test('mergeRecorded: counters add only this tab\'s growth over its base; never go down', () => {
        const mine = { encounters: [], windows: [], quests: [], stats: { closed: 10, negativeDiffs: 1 } };
        const r = mod.mergeRecorded({ stats: { closed: 30, negativeDiffs: 0 } }, mine, { closed: 8, negativeDiffs: 3 });
        assert.equal(r.stats.closed, 32);
        assert.equal(r.stats.negativeDiffs, 0, 'a counter that was reset below its base adds nothing');
    });
    await test('mergeSent: union, stored first, newest max kept, non-strings dropped', () => {
        assert.deepEqual(mod.mergeSent(['a', 'b'], ['b', 'c'], 10), ['a', 'b', 'c']);
        assert.deepEqual(mod.mergeSent(null, ['x'], 10), ['x']);
        assert.deepEqual(mod.mergeSent(['a', 1, null, 'b'], undefined, 10), ['a', 'b']);
        assert.deepEqual(mod.mergeSent(['a', 'b', 'c'], ['d', 'e'], 3), ['c', 'd', 'e']);
    });
}

console.log(n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
