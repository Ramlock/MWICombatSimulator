// Test: the pure part of the search that keeps refining (tools/whatif/rounds.mjs): the t range, the bounds, the pause test and its
// resume, the lock helpers. No page, no runs, no private data. Usage: node tools/test/whatif-rounds.mjs   Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await import(pathToFileURL(path.join(root, 'tools/whatif/rounds.mjs')).href);
let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const near = (a, b, e) => Math.abs(a - b) <= e;

// The t range: the multipliers the design quotes (99%: 2.95 at 16 seeds, 2.66 at 64, 2.60 at 256), and textbook values.
check(near(R.tMult(0.99, 15), 2.9467, 5e-4) && near(R.tMult(0.99, 63), 2.6561, 5e-4) && near(R.tMult(0.99, 255), 2.5946, 1e-3), 't multiplier at 99%: 15, 63 and 255 degrees of freedom', [R.tMult(0.99, 15), R.tMult(0.99, 63), R.tMult(0.99, 255)].join(' '));
check(near(R.tMult(0.95, 10), 2.2281, 5e-4) && near(R.tMult(0.95, 1e6), 1.96, 2e-3), 't multiplier at 95%: 10 degrees of freedom, and the normal limit');
check(R.tMult(0.99, 3) > R.tMult(0.99, 15) && R.tMult(0.99, 15) > R.tMult(0.99, 63), 'the multiplier falls as the seeds grow');
check(R.dfOf([1, 2, 3, 4], [1, 2, 3, 4], 'paired') === 3 && near(R.dfOf([1, 2, 3, 4], [1, 2, 3, 4], 'unpaired'), 6, 1e-9), 'degrees of freedom: paired n - 1, unpaired Welch (equal spreads, equal counts: 2n - 2)');
check(R.dfOf([1, 2, 3, 4, 5], [10, 20, 30, 40, 50], 'unpaired') < 8, 'Welch: unequal spreads give fewer degrees of freedom than 2n - 2');

// Candidates for the pool tests: a free one (cost 0) and paid ones; the ranked figure is the buyer's net (profit goal), per coin for a paid one.
const cand = (id, q, se, cost = 0, extra = {}) => ({ id, player: 'A', cost: { cost }, monotone: false, est: se === null ? null : { net: q, netSe: se, gain: q, se, accepted: q > 2 * se, score: cost > 0 ? q / cost : q }, ...extra });
const rank = (a, b) => (b.est.score - a.est.score) || (b.est.net - a.est.net);
const goal = 'profit';

// Bounds.
{
    const b = R.bounds(cand('x', 10, 2), goal, 3);
    check(b.v === 10 && b.lo === 4 && b.hi === 16, 'bounds: the figure +- the multiplier x the error');
    const p = R.bounds(cand('p', 10, 2, 100), goal, 3);
    check(near(p.v, 0.1, 1e-12) && near(p.lo, 0.04, 1e-12) && near(p.hi, 0.16, 1e-12), 'bounds: a paid candidate is ranked per coin (payback order), the bounds scale the same way');
    const m = R.bounds(cand('m', -5, 1, 0, { monotone: true }), goal, 3);
    check(m.v === 0 && m.lo === 0 && m.hi === 0, 'bounds: a monotone lever is floored at 0');
    const u = R.bounds(cand('u', 0, null), goal, 3);
    check(u.lo === -Infinity && u.hi === Infinity, 'bounds: a candidate with no estimate is unbounded');
    check(R.bounds({ ...cand('g', 1, 1), est: { gain: 8, se: 1, net: 3, netSe: 1 } }, 'exp', 2).hi === 10, 'bounds: another goal ranks on the gain');
}

// The pause test: a candidate is paused when its upper bound is below the lowest lower bound among the K leaders of its pool.
{
    const free = [cand('f1', 100, 5), cand('f2', 90, 5), cand('f3', 80, 5), cand('f4', 20, 5), cand('f5', 60, 40), cand('f6', 50, 30)];
    const paid = [cand('p1', 50, 5, 100), cand('p2', 48, 5, 100), cand('p3', 47, 5, 100), cand('p4', 5, 1, 100)];
    const all = [...free, ...paid];
    const c = R.contention(all, { K: 3, mult: 3, goal, rank });
    const st = Object.fromEntries(all.map((x) => [x.id, x.status]));
    check(st.f1 === 'contending' && st.f2 === 'contending' && st.f3 === 'contending', 'pause: the K leaders are in contention');
    check(c.pools.find((p) => p.key === 'free').line === 65, 'pause: the line is the lowest lower bound among the leaders (80 - 3 x 5)');
    check(st.f4 === 'paused', 'pause: upper bound 35 is below the line 65');
    check(st.f5 === 'contending', 'pause: a wide candidate (60 +- 120) stays in contention');
    check(st.f6 === 'contending' && st.p1 === 'contending' && st.p2 === 'contending' && st.p3 === 'contending' && st.p4 === 'paused', 'pause: free and paid are two pools (the paid line, 0.32 per coin, does not come from the free ones); a wide candidate stays');
    check(c.contending + c.paused === all.length && c.paused === all.filter((x) => x.status === 'paused').length, 'pause: counts add up');
    check(c.pools.length === 2 && c.pools.map((p) => p.key).join() === 'free,paid', 'two pools, free and paid');
}

// Resume: the test runs on every candidate every round; when the leaders are measured more their figures fall and a paused one comes back.
{
    const mk = () => [cand('a', 100, 5), cand('b', 98, 5), cand('c', 96, 5), cand('d', 70, 3)];
    const set = mk();
    R.contention(set, { K: 3, mult: 3, goal, rank });
    check(set[3].status === 'paused', 'resume: before, the candidate is paused (upper 79 < line 81)');
    // The leaders get more seeds: their means fall back (to 85) and their errors stay; the paused one is tested again, untouched.
    for (const x of set.slice(0, 3)) { x.est = { ...x.est, net: 85, score: 85, gain: 85 }; }
    set[3].est = set[3].est; // no new data for it
    R.contention(set, { K: 3, mult: 3, goal, rank });
    check(set[3].status === 'contending', 'resume: after the leaders fall back it is in contention again, with no special case');
    // And a refuted candidate is out of every pool.
    set[0].refuted = true;
    const c2 = R.contention(set, { K: 3, mult: 3, goal, rank });
    check(c2.contending + c2.paused === 3 && set[0].bounds && true, 'a refuted candidate is counted in no pool');
}

// byPlayer (Stage F / D): one pool pair per player.
{
    const set = [cand('x1', 100, 5, 0, { player: 'A' }), cand('x2', 10, 1, 0, { player: 'A' }), cand('y1', 10, 1, 0, { player: 'B' })];
    const c = R.contention(set, { K: 1, mult: 3, goal, byPlayer: true, rank });
    check(c.pools.length === 2 && set[2].status === 'contending' && set[1].status === 'paused', 'byPlayer: B\'s only candidate leads B\'s pool and is not paused by A\'s leader');
}

// Hope and separation (the lock rule).
{
    const set = [cand('l', 100, 5), cand('m', 60, 5), cand('n', 85, 3)];
    check(R.separated(set[0], set, { goal, mult: 3 }) === false, 'separated: a contender whose upper bound (94) reaches the leader\'s lower bound (85) blocks the lock');
    check(R.separated(set[0], [set[0], set[1]], { goal, mult: 3 }) === true, 'separated: when every other upper bound (75) is below the leader\'s lower bound (85) the lock is allowed');
    check(R.separated(set[0], [set[0], { ...set[2], refuted: true }], { goal, mult: 3 }) === true, 'separated: a refuted candidate does not count');
    check(R.anyHope([cand('z', -50, 5)], goal, 3) === false && R.anyHope([cand('z', -50, 5), cand('y', -10, 5)], goal, 3) === true, 'anyHope: false when every upper bound is at or below 0');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
// The pools follow the party's own order, not A to Z: party Zed, Amy, Bob; within a player the free pool before the paid one.
{
    const party = ['Zed', 'Amy', 'Bob'];
    const mine = ['Bob', 'Amy', 'Zed', 'Amy'].flatMap((p, i) => [cand(p + 'f' + i, 5, 1, 0, { player: p }), cand(p + 'p' + i, 5, 1, 100, { player: p })]);
    const c = R.contention(mine, { K: 2, mult: 3, goal, byPlayer: true, rank, order: party });
    check(JSON.stringify(c.pools.map((p) => p.key)) === JSON.stringify(['Zed:free', 'Zed:paid', 'Amy:free', 'Amy:paid', 'Bob:free', 'Bob:paid']), 'party order: pools come out Zed, Amy, Bob (free before paid), not A to Z', c.pools.map((p) => p.key).join());
    const none = R.contention(mine, { K: 2, mult: 3, goal, byPlayer: true, rank });
    check(none.pools.map((p) => p.key)[0] === 'Amy:free', 'party order: with no order given the keys fall back to A to Z (a caller always passes the party)', none.pools.map((p) => p.key).join());
    const sorted = [['Bob:free'], ['Zed:paid'], ['Amy:free'], ['Zed:free']].sort(R.poolSorter(party)).map((x) => x[0]);
    check(sorted.join() === 'Zed:free,Zed:paid,Amy:free,Bob:free', 'party order: poolSorter is the one comparator (the first look uses it too)', sorted.join());
}

process.exit(fails ? 1 : 0);
