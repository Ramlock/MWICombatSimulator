// Node test: the per-player colouring (0.5.0 to 0.5.1) is removed from userscript/mwics-exporter.user.js (0.6.0) and stays removed.
// Run: node userscript/test/tracker.test.cjs
// Covers: no colouring export, no splat or name styling, no colour storage key, no colour Settings section; the recorder takes no onHit.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(SRC, { module: mod, console });

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('no colouring export', () => {
    for (const k of ['TINT', 'createTint', 'tintSlot', 'unitInfo', 'defaultColors']) assert.equal(k in mod.exports, false, k);
    assert.equal(typeof mod.exports.createRecorder, 'function');
});

test('no splat, name or colour-setting code left', () => {
    for (const s of ['CombatUnit_splat', 'CombatUnit_name', 'mwicsTrackerColors', 'MutationObserver', 'Teammate colours', 'onHit', 'boxShadow']) assert.equal(SRC.includes(s), false, s);
});

console.log(n + ' tests passed');
