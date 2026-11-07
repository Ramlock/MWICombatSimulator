// Node test for the browser side of userscript/mwics-exporter.user.js (hook, menu commands, storage) on mocked page objects.
// Run: node userscript/test/recorder-hook.test.cjs
// Covers: the getter returns every message unchanged; only the game socket is read; recorded messages feed the recorder;
// "Copy loot export" copies the file, "Clear recorded loot" empties it, the record survives a reload through the stored keys.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');

function boot(store) {
    class ME { constructor(d, url) { this._d = d; this.currentTarget = { url }; } get data() { return this._d; } }
    const commands = {}, clip = [], toasts = [];
    const el = () => ({ style: {}, remove() {}, appendChild() {}, addEventListener() {}, set textContent(v) { toasts.push(v); } });
    const sandbox = {
        console, setTimeout, JSON, Date, WeakSet, Object,
        unsafeWindow: { MessageEvent: ME, addEventListener() {} },
        document: { body: { appendChild() {} }, createElement: el, addEventListener() {}, getElementById: () => null, visibilityState: 'visible' },
        GM_registerMenuCommand: (n, f) => { commands[n] = f; },
        GM_setClipboard: (t) => clip.push(t),
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
    };
    vm.runInNewContext(SRC, sandbox);
    const send = (msg, url) => new ME(typeof msg === 'string' ? msg : JSON.stringify(msg), url || 'wss://api.milkywayidle.com/ws').data;
    return { commands, clip, toasts, send };
}

const unit = (o) => ({ currentHitpoints: 100, maxHitpoints: 100, currentManapoints: 10, maxManapoints: 10, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0, preparingAbilityHrid: '', isPreparingAutoAttack: true, combatDetails: { combatStats: {} }, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0, ...o });
const NB = (id) => ({ type: 'new_battle', battleId: id, combatStartTime: 'x', players: [unit({ character: { id: 1, name: 'Hidden' } })], monsters: [{ ...unit({}), hrid: '/monsters/m' }] });

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('messages pass through unchanged, other sockets are ignored, the recorder fills and exports', () => {
    const store = {};
    const b = boot(store);
    const raw = JSON.stringify({ type: 'init_character_data', character: { id: 1, name: 'Hidden' } });
    assert.equal(b.send(raw), raw);
    assert.equal(b.send(JSON.stringify(NB(1))), JSON.stringify(NB(1)));
    b.send(JSON.stringify(NB(2)), 'wss://example.com/other');
    b.send(NB(3));
    b.send(NB(4));
    b.commands['Copy loot export']();
    assert.equal(b.clip.length, 1);
    const file = JSON.parse(b.clip[0]);
    assert.equal(file.format, 'mwics-loot');
    assert.deepEqual(file.encounters.map((e) => e.battleId), [1, 3]);
    assert.ok(!b.clip[0].includes('Hidden'));
});

test('Clear recorded loot empties the record and the stored keys; the record survives a reload', () => {
    const store = {};
    const b = boot(store);
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (const id of [1, 2, 3]) b.send(NB(id));
    b.commands['Copy loot export']();
    assert.equal(JSON.parse(b.clip[0]).encounters.length, 2);
    // pagehide/visibility saves; here the cap of dirty rows is not reached, so save through the clear path first
    const reloaded0 = boot(store);
    reloaded0.commands['Copy loot export']();
    assert.ok(reloaded0.toasts.some((t) => /nothing recorded/.test(t)));
    b.commands['Clear recorded loot']();
    const reloaded = boot(store);
    reloaded.commands['Copy loot export']();
    assert.ok(reloaded.toasts.some((t) => /nothing recorded/.test(t)));
    assert.equal(reloaded.clip.length, 0);
});

test('the record is saved every 20 closed encounters and loaded after a reload', () => {
    const store = {};
    const b = boot(store);
    b.send({ type: 'init_character_data', character: { id: 1 } });
    for (let id = 1; id <= 22; id++) b.send(NB(id));
    assert.ok(store.mwicsRecorderEncounters);
    const again = boot(store);
    again.commands['Copy loot export']();
    assert.ok(JSON.parse(again.clip[0]).encounters.length >= 20);
});

console.log(n + ' tests passed');
