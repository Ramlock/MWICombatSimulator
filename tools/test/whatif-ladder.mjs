// Test: the measuring loop of a gain per level (tools/whatif/ladder.mjs) and what it rests on in src/whatif/payback.mjs: the paired
// evenness check and its marks, the knee in payback(), the books and switch changes. Synthetic gains on made-up abilities only; no run.
// Usage: node tools/test/run-tests.mjs whatif-ladder.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import levelTable from '../whatif/levelExperienceTable.json' with { type: 'json' };
import { payback, evenness, levelAt, HORIZON_DAYS } from '../../src/whatif/payback.mjs';
import { measureLadder, firstSteps, booksChangeAt, switchChangeAt, stopOf } from '../whatif/ladder.mjs';

const XP = levelTable.table, TOP = XP.length;
let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.log('FAIL', what, detail); } else console.log('ok  ', what); };
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const mix = (x) => { x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
const gauss = (a, b) => { const r = lcg(mix(mix(a) ^ Math.imul(b + 1, 0x9e3779b1))); r(); const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// A synthetic ability: the true gain of +L levels is perLevel x min(L, knee); a seed's run of a state has its own noise u(L, s) of sd
// sigma, so a seed's gain against the start is g(L) + u(L, s) - u(0, s): two states share the start's noise on the same seed (paired).
function synth({ perLevel, knee = Infinity, sigma, salt = 1 }) {
    const g = (L) => perLevel * Math.min(L, knee);
    const measure = async (levels, k) => {
        const samples = {};
        for (let s = 1; s <= k; s++) samples[s] = g(levels) + sigma * gauss(salt * 1000 + levels, s) - sigma * gauss(salt * 1000, s);
        const v = Object.values(samples), m = v.reduce((a, x) => a + x, 0) / k, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (k - 1));
        return { levels, gain: m, se: sd / Math.sqrt(k), samples };
    };
    return { g, measure };
}
const runsOf = (r) => r.runs.map((x) => `${x.levels}@${x.seeds}`).join(' ');

// ---- payback.mjs: the paired check and its marks ----
{
    // The design's two figures (9.1's table, 24 seeds, ± is twice the error): independent errors, as the books report took them.
    const qa = evenness([{ levels: 10, gain: 10e3, se: 81e3 }, { levels: 20, gain: 155e3, se: 59e3 }]);
    const en = evenness([{ levels: 10, gain: 272e3, se: 49.5e3 }, { levels: 20, gain: 576e3, se: 66e3 }]);
    check(qa.mark === 'assumed' && qa.pairs[0].even && qa.pairs[0].assumed && !qa.flagged, 'evenness: a Quick Aid-like pair passes but could not have failed: marked "evenness assumed", not even');
    check(en.mark === 'even' && !en.pairs[0].assumed, 'evenness: an Entangle-like pair passes and could have failed: even');
    check(evenness([{ levels: 20, gain: 300, se: 50 }]).mark === 'assumed' && evenness([]).mark === null, 'evenness: one step alone is no check: assumed');
    const failed = evenness([{ levels: 10, gain: 300e3, se: 10e3 }, { levels: 20, gain: 310e3, se: 10e3 }]);
    check(failed.mark === 'notEven' && failed.knee.from === 10 && failed.knee.to === 20, 'evenness: a failed pair is "not even", with the knee between the last even step and the failed one');
    // Paired: two states on the same seeds share the start's run, so the true error of their difference is smaller than the independent one.
    const { measure } = synth({ perLevel: 10e3, sigma: 200e3, salt: 3 });
    const a = await measure(10, 64), b = await measure(20, 64);
    const p = evenness([a, b]), ind = evenness([{ ...a, samples: undefined }, { ...b, samples: undefined }]);
    check(p.pairs[0].paired && !ind.pairs[0].paired && p.pairs[0].seDiff < ind.pairs[0].seDiff * 0.9, 'evenness: steps on the same seeds are checked paired, with the smaller true error of their difference', `${p.pairs[0].seDiff} vs ${ind.pairs[0].seDiff}`);
    const m = (x) => x.reduce((s, v) => s + v, 0) / x.length, d = Object.keys(a.samples).map((s) => a.samples[s] - 0.5 * b.samples[s]);
    check(Math.abs(p.pairs[0].diff - m(d)) < 1e-6 && Math.abs(p.pairs[0].seDiff - Math.sqrt(d.reduce((s, v) => s + (v - m(d)) ** 2, 0) / 63 / 64)) < 1e-6, 'evenness: the paired difference is the mean of a - k b per seed, its error sd / sqrt(n)');
    check(evenness([a, { ...b, samples: { 99: 1, 98: 2 } }]).pairs[0].paired === false, 'evenness: steps with no common seeds fall back to independent errors');
}

// ---- payback.mjs: the knee ----
{
    const from = 50, x0 = XP[from - 1], g = 4000, cost = 2e6;
    const lead = (knee) => ({ cost, gain: 0, leads: [{ gainPerLevel: g, knee, with: { xp: XP[from + 10 - 1], perDay: 0 }, without: { xp: x0, perDay: 0 } }] });
    check(payback(lead(undefined), { table: XP }) === cost / (10 * g) && payback(lead(55), { table: XP }) === cost / (5 * g) && payback(lead(200), { table: XP }) === cost / (10 * g), 'payback: levels bought past the knee are worth nothing (10 bought, knee 5 above: paid as 5)');
    // Levels that come by themselves past the knee are worth nothing too: once today's ability reaches the knee, the lead is gone.
    const r = 2000, k = { cost: 1e12, gain: 0, leads: [{ gainPerLevel: g, knee: 55, with: { xp: XP[59], perDay: r }, without: { xp: x0, perDay: r } }] };
    const reach = (XP[54] - x0) / r; // the day today's ability reaches level 55
    let sum = 0; for (let d = 0; d < reach + 400; d++) sum += g * (Math.min(levelAt(XP[59] + r * (d + 0.5), XP), 55) - Math.min(levelAt(x0 + r * (d + 0.5), XP), 55));
    check(payback({ ...k, cost: sum * 0.999 }, { table: XP }) !== null && payback({ ...k, cost: sum * 1.001 }, { table: XP }) === null, 'payback: a lead that casting carries past the knee stops paying there (the sum up to the knee is all it ever pays)');
    check(HORIZON_DAYS === 1825, 'the horizon of "no limit" is 5 years (1825 days)');
}

// ---- The switch change: losing days counted, and a switch that never pays back ----
{
    const bookXp = 500, unit = 1e6, costAt = (L) => unit * (1 + Math.ceil(XP[L - 1] / bookXp - 1e-9)), xpAfter = (L) => Math.ceil(XP[L - 1] / bookXp - 1e-9) * bookXp;
    const base = { dayOne: -20e3, costAt, xpAfter, newPerDay: 200, newPerLevel: 15e3, oldXp: XP[29], oldPerDay: 100, oldPerLevel: 5e3 };
    const at = switchChangeAt(base);
    const day = (ch) => { let cum = 0; for (let t = 0; t < 20000; t++) { const m = t + 0.5; cum += ch.gain + ch.leads.reduce((a, l) => a + l.gainPerLevel * (Math.min(levelAt(l.with.xp + l.with.perDay * m, XP), l.knee ?? Infinity) - Math.min(levelAt(l.without.xp + l.without.perDay * m, XP), l.knee ?? Infinity)), 0); if (cum >= ch.cost) return t + 1; } return null; };
    const p1 = payback(at(1), { table: XP });
    const firstWin = (() => { const ch = at(1); for (let t = 0; t < 20000; t++) { const m = t + 0.5; if (ch.gain + ch.leads.reduce((a, l) => a + l.gainPerLevel * (levelAt(l.with.xp + l.with.perDay * m, XP) - levelAt(l.without.xp + l.without.perDay * m, XP)), 0) > 0) return t; } return null; })();
    check(p1 !== null && Math.ceil(p1) === day(at(1)) && p1 > firstWin, 'switch: the losing days come first and are counted (the same day as a day-by-day sum, after the first winning day)', `${p1} ${day(at(1))} ${firstWin}`);
    const never = switchChangeAt({ ...base, newPerDay: 0 });
    check(payback(never(1), { table: XP }) === null && stopOf({ from: 0, changeAt: never, limit: HORIZON_DAYS, table: XP }).level === 0, 'switch: a new ability that loses on day one and is never cast never pays back; the recommendation is no switch (level 0)');
    const s = stopOf({ from: 0, changeAt: at, limit: HORIZON_DAYS, table: XP });
    check(s.level >= 1 && s.payback === payback(at(s.level), { table: XP }), 'switch: the stopping level counts the first book as the switch itself; its payback is payback() of the whole change', JSON.stringify(s));
}

// ---- The loop ----
const stopLinear = (factor, room) => (p, knee) => Math.max(0, Math.min(room, knee ?? Infinity, Math.floor(p * factor)));
{
    check(firstSteps(180).join() === '10,20' && firstSteps(15).join() === '7,15' && firstSteps(1).join() === '1' && firstSteps(0).length === 0, 'loop: first states +10 and +20, fewer near the top');
    const clear = synth({ perLevel: 30e3, sigma: 20e3, salt: 11 });
    const r1 = await measureLadder({ room: 150, measure: clear.measure, stopAt: stopLinear(7.5 / 30e3, 150) });
    check(runsOf(r1) === '10@16 20@16' && r1.mark === 'even' && r1.levels === 7 && r1.upTo === 7, 'loop: an even gain whose stop lies inside +20 takes today, +10 and +20 only', `${runsOf(r1)} ${JSON.stringify(r1.stops)}`);
    const r2 = await measureLadder({ room: 150, measure: clear.measure, stopAt: stopLinear(70 / 30e3, 150) });
    check(runsOf(r2).startsWith('10@16 20@16 40@16 80@16') && r2.measuredTo >= 80 && r2.levels >= 60 && r2.levels <= r2.measuredTo, 'loop: a stop past +20 brings +40, then +80; nothing recommended past a measured level', `${runsOf(r2)} ${r2.levels}`);
    const r3 = await measureLadder({ room: 30, measure: clear.measure, stopAt: stopLinear(100 / 30e3, 30) });
    check(runsOf(r3).startsWith('10@16 20@16 30@16') && !r3.runs.some((x) => x.levels > 30) && r3.levels === 30, 'loop: the top (level 200, here 30 levels above) ends the doubling (+30, not +40)', runsOf(r3));
    const r4 = await measureLadder({ room: 150, measure: synth({ perLevel: 30e3, knee: 33, sigma: 5e3, salt: 12 }).measure, stopAt: stopLinear(100 / 30e3, 150) });
    check(r4.mark === 'notEven' && r4.knee && r4.knee.from <= 33 && 33 <= r4.knee.to && r4.knee.to - r4.knee.from <= 2 && r4.levels <= r4.knee.from && r4.levels === r4.measuredTo, 'loop: a failed step halves toward the knee; the knee lies inside its bracket and the recommendation stops at the last even step', `${runsOf(r4)} ${JSON.stringify(r4.knee)} ${r4.levels}`);
    const noisy = synth({ perLevel: 7.7e3, sigma: 204e3, salt: 21 });
    const r5 = await measureLadder({ room: 150, measure: noisy.measure, stopAt: () => 0 });
    check(runsOf(r5) === '10@16 20@16' && r5.levels === 0 && r5.upTo === 0, 'loop: no unsettled level, no more runs, however noisy (no end of the range pays back)', runsOf(r5));
    const r6 = await measureLadder({ room: 40, measure: noisy.measure, stopAt: stopLinear(30 / 7.7e3, 40) });
    check(runsOf(r6) === '10@16 20@16 40@16 40@32 40@48 40@64' && r6.levels < r6.upTo && r6.seeds === 64, 'loop: unsettled levels are narrowed by a bigger step first, then by seeds on the largest step up to the ceiling, then shown as a range', `${runsOf(r6)} ${r6.levels}..${r6.upTo}`);
}

// ---- Section 9.1 point 7: a noisy even gain, a clear even one, one that flattens; with books priced and payback() deciding ----
// "If it works", over 300 noise draws each (one draw is one search): the settled-in levels pass the stop the true gain gives in almost
// no draw (an even gain) and never by more than the noise can tell apart (a flattening one: the knee is located only to within margin
// errors over the gain per level); every flattening one is marked not even. The share of even gains marked not even (a pair failing on
// noise alone) is printed, and only guarded against getting worse.
{
    const from = 50, xpNow = XP[from - 1] + 1000, perDay = 50, bookXp = 500, DRAWS = 300;
    const nBooks = (L) => Math.max(0, Math.ceil((XP[L - 1] - xpNow) / bookXp - 1e-9));
    const shape = (unitCost) => ({ costAt: (L) => unitCost * nBooks(L), xpAfter: (L) => xpNow + nBooks(L) * bookXp });
    const stopFn = (sh, limit) => (p, knee) => stopOf({ from, changeAt: booksChangeAt({ xpNow, perDay, ...sh, perLevel: p, knee: knee == null ? undefined : from + knee }), limit, table: XP }).level - from;
    const cases = [
        ['noisy even (Quick Aid-like)', { perLevel: 7.7e3, sigma: 204e3 }, 4e4],
        ['clear even (Entangle-like)', { perLevel: 28.8e3, sigma: 229e3 }, 8e4],
        ['flattening (knee at +25)', { perLevel: 28.8e3, knee: 25, sigma: 229e3 }, 4e4],
    ];
    for (const [name, spec, unitCost] of cases) {
        const stopAt = stopFn(shape(unitCost), 365), truth = stopAt(spec.perLevel, spec.knee ?? null);
        const t = { notEven: 0, over: 0, overBy: 0, reach: 0, bigger: 0, states: 0 };
        for (let salt = 100; salt < 100 + DRAWS; salt++) {
            const r = await measureLadder({ room: TOP - from, measure: synth({ ...spec, salt }).measure, stopAt });
            if (salt === 100) console.log(`  ${name}, one draw: ${JSON.stringify({ runs: runsOf(r), mark: r.mark, knee: r.knee, levels: r.levels, upTo: r.upTo, truth })}`);
            t.notEven += r.mark === 'notEven'; t.over += r.levels > truth; t.overBy = Math.max(t.overBy, r.levels - truth);
            t.reach += r.upTo >= truth || r.upTo === r.measuredTo; t.bigger += r.runs.some((x) => x.levels > 20) || (r.knee && r.knee.to <= 20) || (r.stops.low === r.stops.high && r.stops.centre <= 20); t.states += r.runs.length;
        }
        console.log(`  ${name}: ${JSON.stringify({ ...t, states: +(t.states / DRAWS).toFixed(1), truth })} of ${DRAWS}`);
        if (!spec.knee) {
            check(t.over <= DRAWS * 0.01 && t.reach >= DRAWS * 0.98, `9.1: ${name}: the settled-in levels pass the true gain's stop (${truth}) in at most 1% of draws (${t.over}), the range reaches it in 98% (${t.reach})`);
            check(t.notEven <= DRAWS * 0.3, `9.1: ${name}: marked not even on noise alone in ${t.notEven} of ${DRAWS} (guard: at most 30%)`);
        }
        if (name.startsWith('noisy')) check(t.bigger === DRAWS, `9.1: ${name}: a bigger step is measured to narrow the range in every draw whose +10 and +20 pass and leave levels unsettled`);
        if (spec.knee) check(t.notEven === DRAWS && t.over <= DRAWS * 0.2 && t.overBy <= 3, `9.1: ${name}: always not even; the settled-in levels pass the knee in at most 20% of draws (${t.over}), by at most 3 levels (${t.overBy})`);
    }
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
