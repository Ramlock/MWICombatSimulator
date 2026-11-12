// Node test: one party snapshot per character and the character picker on the simulator page (userscript/mwics-exporter.user.js).
// Run: node userscript/test/picker.test.cjs
// Covers: each game tab saves its character's snapshot under its own key and in the index, the single snapshot key still holds the latest save,
// one entry per character, the newest 10 kept (the rest blanked); on the simulator page: no picker with none or one character, a picker with
// two or more (label = name, saved <time>; default the most recent), the import reads the chosen character's snapshot, a refresh keeps the choice.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');
const clock = { t: 1700000000000 };
class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }

// A small DOM: elements with children, value, style and handlers.
class Elem {
    constructor(tag) { this.tag = tag; this.kids = []; this.style = {}; this.handlers = {}; this._v = ''; this.className = ''; }
    appendChild(c) { this.kids.push(c); return c; }
    set innerHTML(v) { this.kids = []; this._v = ''; }
    get value() { return this._v; }
    set value(v) { this._v = String(v); }
    addEventListener(ev, fn) { this.handlers[ev] = fn; }
    insertAdjacentElement(pos, e) { this.inserted = [pos, e]; }
    click() { if (this.on) this.on(); }
}

function boot(store, opts) {
    opts = opts || {};
    class ME { constructor(d, url) { this._d = d; this.currentTarget = { url }; } get data() { return this._d; } }
    const commands = {}, toasts = [], created = [], intervals = [], clicks = [];
    const input = { value: '' };
    const rowAnchor = new Elem('row');
    const dom = {
        buttonImportExport: { closest: () => rowAnchor }, inputSetGroupCombatAll: input,
        buttonImportSet: { click() { clicks.push('import:' + input.value); } }, 'group-combat-tab': { click() { clicks.push('tab'); } },
    };
    const sandbox = {
        console, setTimeout: () => 0, JSON, Date: FakeDate, WeakSet, Object, Promise, Math, Set, Map, Array, String, Number, Error, RegExp, Blob: class {},
        unsafeWindow: { MessageEvent: ME, addEventListener() {} },
        document: {
            body: { appendChild() {} },
            createElement: (tag) => { const e = new Elem(tag); Object.defineProperty(e, 'textContent', { set(v) { toasts.push(v); this._t = v; }, get() { return this._t; } }); created.push(e); return e; },
            createTextNode: (text) => ({ text }), addEventListener() {}, getElementById: (id) => dom[id] || null, visibilityState: 'visible',
            documentElement: { lang: 'en' }, // the page's language, which the button label follows (0.9.2)
        },
        location: opts.location, setInterval: (fn) => { intervals.push(fn); return intervals.length; }, clearInterval: (i) => { intervals[i - 1] = null; },
        GM_registerMenuCommand: (n, f) => { commands[n] = f; }, GM_setClipboard() {},
        GM_getValue: (k, d) => (k in store ? store[k] : d), GM_setValue: (k, v) => { store[k] = v; }, GM_xmlhttpRequest() {},
    };
    vm.runInNewContext(SRC, sandbox);
    const send = (msg) => new ME(JSON.stringify(msg), 'wss://api.milkywayidle.com/ws').data;
    return { commands, toasts, created, intervals, clicks, input, dom, rowAnchor, send, sandbox };
}
const tick = (ms) => { clock.t += ms || 60000; };
const game = (store, id, name) => { const g = boot(store); g.send({ type: 'init_character_data', character: { id, name }, characterSkills: [], characterItems: [] }); return g; };
const simPage = (store) => {
    const s = boot(store, { location: { hostname: 'ramlock.github.io' } });
    s.intervals[0]();
    const btn = s.created.find((e) => e.id === 'mwicsImportParty'), pick = s.created.find((e) => e.id === 'mwicsPartyPicker');
    return { ...s, btn, pick, press: () => btn.handlers.click() };
};
const labels = (pick) => pick.kids.map((o) => o.textContent);
const values = (pick) => pick.kids.map((o) => o.value);
const idx = (store) => JSON.parse(store.mwicsGroupSnapshotIndex || '[]');
const fmt = (t) => new FakeDate(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('each game tab saves its character under its own key and in the index; the single key holds the latest save', () => {
    const store = {};
    game(store, 11, 'Ann'); tick();
    game(store, 22, 'Bob'); tick();
    assert.deepEqual(idx(store).map((e) => [e.id, e.name]), [[22, 'Bob'], [11, 'Ann']], 'newest first');
    assert.ok(JSON.parse(store['mwicsGroupSnapshot.11']).group && JSON.parse(store['mwicsGroupSnapshot.22']).group);
    assert.equal(store.mwicsGroupSnapshot, store['mwicsGroupSnapshot.22'], 'the single key is the latest save, same text');
    assert.equal(idx(store)[0].t, JSON.parse(store['mwicsGroupSnapshot.22']).t);
    game(store, 11, 'Ann'); // Ann again: one entry, now the newest
    assert.deepEqual(idx(store).map((e) => e.id), [11, 22]);
    assert.equal(store.mwicsGroupSnapshot, store['mwicsGroupSnapshot.11']);
});

test('the newest 10 characters are kept, an older one is dropped from the index and its snapshot blanked', () => {
    const store = {};
    for (let i = 1; i <= 12; i++) { game(store, 100 + i, 'C' + i); tick(); }
    assert.deepEqual(idx(store).map((e) => e.id), [112, 111, 110, 109, 108, 107, 106, 105, 104, 103]);
    assert.equal(store['mwicsGroupSnapshot.101'], '');
    assert.equal(store['mwicsGroupSnapshot.102'], '');
    assert.ok(JSON.parse(store['mwicsGroupSnapshot.103']).group);
});

test('mergeSnapIndex: one per character, newest first, a stale write does not replace a newer one, junk ignored', () => {
    const m = (() => { const x = { exports: {} }; vm.runInNewContext(SRC, { module: x, console, JSON, Date, Object, Map, Set, Array, String, Number, Math, RegExp, Error, Promise, WeakSet }); return x.exports; })();
    const J = (x) => JSON.parse(JSON.stringify(x));
    assert.deepEqual(J(m.mergeSnapIndex(null, { id: 1, name: 'A', t: 5 }, 10)), { index: [{ id: 1, name: 'A', t: 5 }], dropped: [] });
    assert.deepEqual(J(m.mergeSnapIndex([{ id: 1, name: 'A', t: 9 }], { id: 1, name: 'A2', t: 5 }, 10)).index, [{ id: 1, name: 'A', t: 9 }], 'older write ignored');
    assert.deepEqual(J(m.mergeSnapIndex([{ id: 1, name: 'A', t: 9 }], { id: 1, name: 'A2', t: 9 }, 10)).index, [{ id: 1, name: 'A2', t: 9 }], 'a tie takes the new write (a rename)');
    assert.deepEqual(J(m.mergeSnapIndex([null, 4, { name: 'x' }, { id: 2, t: 3 }], { id: 1, name: 'A', t: 5 }, 10)).index.map((e) => e.id), [1, 2]);
    const r = J(m.mergeSnapIndex([{ id: 1, t: 1 }, { id: 2, t: 2 }, { id: 3, t: 3 }], { id: 4, name: 'D', t: 4 }, 3));
    assert.deepEqual(r.index.map((e) => e.id), [4, 3, 2]);
    assert.deepEqual(r.dropped, [1]);
    assert.equal(m.snapLabel({ id: 7, name: 'Zed', t: 1 }, () => '20:15'), 'Zed, saved 20:15');
    assert.equal(m.snapLabel({ id: 7, name: '', t: 1 }, () => '20:15'), 'Character 7, saved 20:15');
    assert.equal(m.SNAP_KEEP, 10);
});

test('the simulator page: no character or one character shows no picker and imports the single snapshot as before', () => {
    const none = simPage({});
    assert.equal(none.pick.kids.length, 0);
    assert.equal(none.pick.className, 'form-select');
    const store = {};
    game(store, 11, 'Ann');
    const one = simPage(store);
    assert.equal(one.pick.kids.length, 0, 'no options');
    const pickCol = one.created.find((e) => e.kids.includes(one.pick));
    assert.equal(pickCol.style.display, 'none', 'hidden');
    one.press();
    assert.deepEqual(one.clicks.map((c) => c.split(':')[0]), ['tab', 'import']);
    assert.deepEqual(Object.keys(JSON.parse(one.input.value)), ['1']);
});

test('two or more characters: a picker next to the button, the name and the time of the last save, the most recent selected; the import reads the chosen one', () => {
    const store = {};
    game(store, 11, 'Ann'); const tAnn = clock.t; tick();
    game(store, 22, 'Bob'); const tBob = clock.t;
    const sp = simPage(store);
    const pickCol = sp.created.find((e) => e.kids.includes(sp.pick));
    assert.equal(pickCol.style.display, '');
    assert.match(pickCol.className, /\bcol-md-auto\b/);
    assert.deepEqual(labels(sp.pick), ['Bob, saved ' + fmt(tBob), 'Ann, saved ' + fmt(tAnn)]);
    assert.deepEqual(values(sp.pick), ['22', '11']);
    assert.equal(sp.pick.value, '22', 'default: the most recent');
    // each character's snapshot has its own party; mark them apart through the group
    const mark = (id, who) => { const s = JSON.parse(store['mwicsGroupSnapshot.' + id]); s.group = { 1: { player: { name: who } } }; store['mwicsGroupSnapshot.' + id] = JSON.stringify(s); };
    mark(11, 'AnnParty'); mark(22, 'BobParty');
    sp.press();
    assert.equal(JSON.parse(sp.input.value)[1].player.name, 'BobParty');
    sp.pick.value = '11'; sp.clicks.length = 0;
    sp.press();
    assert.equal(JSON.parse(sp.input.value)[1].player.name, 'AnnParty', 'the picked character');
});

test('a refresh keeps the choice, adds a new character, and does not rebuild an open list', () => {
    const store = {};
    game(store, 11, 'Ann'); tick(); game(store, 22, 'Bob');
    const sp = simPage(store);
    sp.pick.value = '11';
    tick(); game(store, 22, 'Bob'); // Bob saved again: labels change, the choice stays
    sp.pick.handlers.mousedown();
    assert.equal(sp.pick.value, '11');
    assert.match(labels(sp.pick)[0], /^Bob, saved /);
    tick(); game(store, 33, 'Cy');
    sp.pick.handlers.focus();
    assert.deepEqual(values(sp.pick), ['33', '22', '11']);
    assert.equal(sp.pick.value, '11');
    // open list: no rebuild
    sp.sandbox.document.activeElement = sp.pick;
    tick(); game(store, 44, 'Di');
    sp.pick.handlers.mousedown();
    assert.deepEqual(values(sp.pick), ['33', '22', '11'], 'the open list stays as it is');
    sp.sandbox.document.activeElement = null;
    sp.pick.handlers.focus();
    assert.deepEqual(values(sp.pick), ['44', '33', '22', '11']);
    // the character picked is no longer kept: back to the most recent
    sp.pick.value = '11';
    for (let i = 0; i < 10; i++) { tick(); game(store, 200 + i, 'X' + i); }
    sp.pick.handlers.focus();
    assert.equal(sp.pick.value, String(209));
});

test('a stale snapshot of the picked character is refused with the age, as the single snapshot is', () => {
    const store = {};
    game(store, 11, 'Ann'); tick(); game(store, 22, 'Bob');
    clock.t += 45 * 60000;
    const sp = simPage(store);
    sp.pick.value = '11';
    sp.press();
    assert.equal(sp.clicks.length, 0);
    assert.ok(sp.toasts.some((t) => /min old/.test(t)));
});

console.log(n + ' passed');
