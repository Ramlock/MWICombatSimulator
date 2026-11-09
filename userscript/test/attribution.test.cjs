// Node test for attributeBonuses of userscript/mwics-exporter.user.js (leave-one-out and the even split), synthetic formulas only.
// Run: node userscript/test/attribution.test.cjs
const assert = require('node:assert/strict');
const { attributeBonuses } = require('../mwics-exporter.user.js');

let n = 0;
const test = (name, fn) => { fn(); n++; };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' ' + a + ' vs ' + b);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// base 100 x 1.2 x 1.1 x 1.05, each factor applied when its bonus is on
const mul = (fs) => (on) => fs.reduce((v, f, i) => v * (on[i] ? f : 1), 100);

test('multiplicative chain: leave-one-out over-counts, the even split sums to the final damage', () => {
    const r = attributeBonuses(mul([1.2, 1.1, 1.05]), ['a', 'b', 'c']);
    near(r.full, 138.6, 1e-9); near(r.base, 100, 1e-9);
    near(r.leaveOneOut[0], 138.6 - 115.5, 1e-9); near(r.leaveOneOut[1], 138.6 - 126, 1e-9); near(r.leaveOneOut[2], 138.6 - 132, 1e-9);
    // base (the part no bonus claims) plus the leave-one-out values is 102.67% of the final damage
    near((r.base + sum(r.leaveOneOut)) / r.full, 1.0267, 5e-5);
    near(r.base + sum(r.shapley), r.full, 1e-9, 'even split sums to the final damage');
    assert.equal(r.method, 'exact');
    assert.ok(r.shapley[0] > r.shapley[1] && r.shapley[1] > r.shapley[2], 'order follows size');
    for (let i = 0; i < 3; i++) assert.ok(r.shapley[i] > r.leaveOneOut[i] * 0.5 && r.shapley[i] > 0);
});

test('all-additive formula: both answers agree and sum to the final damage', () => {
    const add = [20, 10, 5];
    const r = attributeBonuses((on) => 100 + add.reduce((s, x, i) => s + (on[i] ? x : 0), 0), ['a', 'b', 'c']);
    for (let i = 0; i < 3; i++) { near(r.leaveOneOut[i], add[i], 1e-9); near(r.shapley[i], add[i], 1e-9); }
    near(r.base + sum(r.leaveOneOut), r.full, 1e-9);
    near(r.base + sum(r.shapley), r.full, 1e-9);
});

test('a two-bonus interaction is split evenly (product term)', () => {
    // f = 10 + 4a + 6b + 8ab: shapley_a = 4 + 8/2, shapley_b = 6 + 8/2; leave-one-out_a = 4 + 8, leave-one-out_b = 6 + 8
    const f = (on) => 10 + (on[0] ? 4 : 0) + (on[1] ? 6 : 0) + (on[0] && on[1] ? 8 : 0);
    const r = attributeBonuses(f, ['a', 'b']);
    near(r.shapley[0], 8, 1e-12); near(r.shapley[1], 10, 1e-12);
    near(r.leaveOneOut[0], 12, 1e-12); near(r.leaveOneOut[1], 14, 1e-12);
});

test('mixed add and multiply with a floor still sums exactly', () => {
    const f = (on) => Math.floor((50 + (on[0] ? 30 : 0)) * (on[1] ? 1.5 : 1) * (1 + (on[2] ? 0.1 : 0) + (on[3] ? 0.05 : 0)) + (on[4] ? 7 : 0));
    const r = attributeBonuses(f, ['a', 'b', 'c', 'd', 'e']);
    near(r.base + sum(r.shapley), r.full, 1e-9);
    assert.equal(r.full, f([true, true, true, true, true]));
});

test('a bonus that changes nothing gets zero in both; no bonuses is the base alone', () => {
    const r = attributeBonuses(mul([1.2, 1, 1.05]), ['a', 'b', 'c']);
    near(r.leaveOneOut[1], 0, 1e-12); near(r.shapley[1], 0, 1e-12);
    const z = attributeBonuses(() => 42, []);
    assert.equal(z.full, 42); assert.equal(z.base, 42); assert.deepEqual(z.shapley, []); assert.equal(z.method, 'exact');
});

test('above the exact limit the orders are sampled; shares still sum to the final damage and the error is reported', () => {
    const fs = Array.from({ length: 24 }, (_, i) => 1 + 0.01 * (i + 1));
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const r = attributeBonuses(mul(fs), fs.map((_, i) => 'b' + i), { rand, samples: 600 });
    assert.equal(r.method, 'sampled'); assert.equal(r.samples, 600); assert.equal(r.stderr.length, 24);
    near(r.base + sum(r.shapley), r.full, 1e-6, 'efficient split');
    // exact value for the same formula from a forced exact run on the first 12 bonuses agrees with a sampled run of those 12
    const f12 = mul(fs.slice(0, 12));
    const ex = attributeBonuses(f12, fs.slice(0, 12).map((_, i) => 'b' + i));
    const sm = attributeBonuses(f12, fs.slice(0, 12).map((_, i) => 'b' + i), { exactMax: 0, rand, samples: 4000 });
    for (let i = 0; i < 12; i++) near(sm.shapley[i], ex.shapley[i], 5 * sm.stderr[i] + 1e-9, 'sampled within 5 standard errors');
});

test('time per evaluation set at 8, 12, 16 and 20 bonuses (printed)', () => {
    const rows = [];
    for (const k of [8, 12, 16, 20]) {
        const fs = Array.from({ length: k }, (_, i) => 1 + 0.01 * (i + 1));
        const f = mul(fs), names = fs.map((_, i) => 'b' + i);
        const t0 = process.hrtime.bigint();
        const reps = k <= 12 ? 20 : 1;
        for (let j = 0; j < reps; j++) attributeBonuses(f, names);
        rows.push(k + ' bonuses: ' + (Number(process.hrtime.bigint() - t0) / 1e6 / reps).toFixed(2) + ' ms per event');
    }
    console.log(rows.join('\n'));
});

console.log(n + ' tests passed');
