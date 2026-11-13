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

// The elimination rule (eliminate): the changes plus the current setup (a point at 0) per pool; out by another's lower end, out by the player's bar.
{
    const E = (cands, bars = new Map(), extra = {}) => R.eliminate(cands, { goal, mult: 3, bars, ...extra });
    const ids = (p) => p.changes.map((c) => c.id).join();
    // Out by another's lower end: l is 100 +- 15 (85..115), m 60 +- 15 (45..75): m is out; n 85 +- 9 (76..94) has an upper end (94) above 85: stays.
    let set = [cand('l', 100, 5), cand('m', 60, 5), cand('n', 85, 3)], r = E(set);
    check(set[1].out === 'beaten' && !set[0].out && !set[2].out && ids(r[0]) === 'l,n' && r[0].noChange === false, 'eliminate: a change whose upper end is below another\'s lower end is out; one whose upper end reaches it stays; the current setup is out too', JSON.stringify(r));
    // The last candidate standing: n is now beaten by l when its range falls (the upper end 85 + 3 * 1 = 88 stays above l's lower end 85; at 80 it is out).
    set = [cand('l', 100, 5), cand('n', 77, 1)]; r = E(set);
    check(set[1].out === 'beaten' && ids(r[0]) === 'l' && r[0].noChange === false, 'eliminate: one change left and the current setup out is the last candidate standing');
    // A refuted candidate and a time-only lever take no part.
    set = [cand('l', 100, 5), cand('m', 60, 5, 0, { refuted: true }), cand('t', 500, 1, 0, { timeOnly: true })]; r = E(set);
    check(!set[0].out && ids(r[0]) === 'l' && set[2].out === undefined, 'eliminate: a refuted or time-only candidate neither beats nor is counted');
    // The current setup stays in against a change at -5%..+10% (a range that reaches 0 or below); the change stays in too.
    set = [cand('w', 2.5, 2.5)]; r = E(set);
    check(r[0].noChange === true && ids(r[0]) === 'w', 'eliminate: a change whose range straddles 0 (-5..+10) and the current setup both stay', JSON.stringify(r));
    // Every change out: the current setup alone ends the pool as no change.
    set = [cand('a1', -50, 5), cand('a2', -30, 5)]; r = E(set);
    check(ids(r[0]) === '' && r[0].noChange === true, 'eliminate: a change whose upper end is below 0 is out (the current setup beats it): all out gives no change');
    // The bar: 1% of the player's profit per day; a change whose upper end is below it is out, the current setup is exempt, the edge stays.
    const bars = new Map([['A', 10]]);
    set = [cand('b1', 5, 1), cand('b2', 6.5, 1), cand('b3', 7, 1)]; r = E(set, bars);
    check(set[0].out === 'bar' && set[1].out === 'bar' && !set[2].out, 'eliminate: out by the bar when the upper end (b1 8, b2 9.5) is below 10; b3 (upper end 10, exactly the bar) stays', set.map((c) => c.out).join());
    set = [cand('b1', 5, 1), cand('b2', 6.5, 1)]; r = E(set, bars);
    check(r[0].noChange === true && ids(r[0]) === '', 'eliminate: changes cut by the bar do not beat the current setup (they cannot win, so they cannot beat anyone): no change');
    // A player without a bar above 0 has no such cut.
    set = [cand('c1', 1, 0.1)]; E(set, new Map([['A', 0]]));
    check(!set[0].out, 'eliminate: a bar of 0 or less cuts nothing');
    // byPlayer: a pool per player, each with its own current setup and bar.
    set = [cand('p1', 50, 1, 0, { player: 'A' }), cand('q1', 4, 1, 0, { player: 'B' })]; r = R.eliminate(set, { goal, mult: 3, byPlayer: true, bars: new Map([['A', 10], ['B', 10]]), order: ['A', 'B'] });
    check(r.length === 2 && r[0].player === 'A' && ids(r[0]) === 'p1' && r[0].noChange === false && ids(r[1]) === '' && r[1].noChange === true && set[1].out === 'bar', 'eliminate: byPlayer gives each player his own pool, bar and current setup', JSON.stringify(r.map((p) => [p.key, ids(p), p.noChange])));
    // The payback cut: a paid candidate whose cost over the upper end of the buyer's gain is above the limit (365 days) is out; one just inside stays.
    const P = { payLimit: 365 };
    set = [cand('pa', 96, 1, 36500), cand('pb', 97, 1, 36500)]; r = E(set, new Map(), P);
    check(set[0].out === 'payback' && !set[1].out, 'eliminate: a paid candidate with cost / upper end over 365 days (36500 / 99 = 368.7) is out; one at exactly 365 days (36500 / 100) stays', set.map((c) => c.out).join());
    set = [cand('pc', -5, 1, 100)]; r = E(set, new Map(), P);
    check(set[0].out === 'payback' && r[0].noChange === true && ids(r[0]) === '', 'eliminate: a paid candidate whose upper end is 0 or below counts as over the limit');
    // A free candidate is never cut by the limit, whatever its figures; without a limit (other goals) nothing is cut.
    set = [cand('fa', 0.5, 0.1, 0)]; E(set, new Map(), P);
    check(!set[0].out, 'eliminate: a free candidate is never cut by the payback limit');
    set = [cand('pd', 1, 1, 36500)]; R.eliminate(set, { goal: 'exp', mult: 3, bars: new Map() });
    check(!set[0].out, 'eliminate: no limit (payLimit 0, as on a goal other than profit) cuts nothing');
    // out is kept: a candidate out stays out in a later call.
    set = [cand('l', 100, 5), cand('m', 60, 5)]; E(set); set[0].est = { ...set[0].est, net: 0, gain: 0 }; E(set);
    check(set[1].out === 'beaten', 'eliminate: a candidate that is out never returns inside the race');
}

// The tie rule (eliminate, tieOf): the higher change A and each other standing change B are tied when A's upper end minus B's lower end (raw units, 3 errors)
// is below the bar of A's player; the pool ends when every other one is tied (they go out as 'tied').
{
    const E = (cands, bars = new Map([['A', 10]]), extra = {}) => R.eliminate(cands, { goal, mult: 3, bars, ...extra });
    const ids = (p) => p.changes.map((c) => c.id).join();
    // l 100 +- 3 (97..103), b 98 +- 3 (95..101): the best-case gap 103 - 95 = 8 is under the bar 10: tied, the pool ends on the higher mean.
    let set = [cand('b', 98, 1), cand('l', 100, 1)], r = E(set);
    check(set[0].out === 'tied' && !set[1].out && ids(r[0]) === 'l' && r[0].noChange === false, 'tie: two changes whose best-case gap is under the bar end the pool on the higher mean', JSON.stringify(r));
    // Exactly the bar: 103 - 93 = 10 is not under it.
    set = [cand('b', 96, 1), cand('l', 100, 1)]; r = E(set);
    check(!set[0].out && !set[1].out && ids(r[0]) === 'b,l', 'tie: a best-case gap exactly at the bar does not tie', JSON.stringify(r));
    // Wide ranges (+- 30): the gap 130 - 68 = 62 is far over the bar.
    set = [cand('b', 98, 10), cand('l', 100, 10)]; r = E(set);
    check(!set[0].out && !set[1].out && ids(r[0]) === 'b,l', 'tie: wide error margins do not tie');
    // Three standing: one far (c 94 +- 6: 88..100, gap 15) keeps the pool going, and b (tied alone) is not put out either.
    set = [cand('b', 98, 1), cand('c', 94, 2), cand('l', 100, 1)]; r = E(set);
    check(set.every((c) => !c.out) && ids(r[0]) === 'b,c,l', 'tie: three standing with one not tied keeps going, nobody put out', JSON.stringify(r));
    set = [cand('b', 98, 1), cand('c', 99, 1), cand('l', 100, 1)]; r = E(set);
    check(set[0].out === 'tied' && set[1].out === 'tied' && ids(r[0]) === 'l', 'tie: three standing all tied with the higher one end the pool', JSON.stringify(r));
    // No bar above 0 for the player: no tie. A change of another player never ties (a mixed pool).
    set = [cand('b', 98, 1), cand('l', 100, 1)]; r = E(set, new Map());
    check(!set[0].out && !set[1].out, 'tie: a player without a bar never ties');
    set = [cand('b', 98, 1, 0, { player: 'B' }), cand('l', 100, 1)]; r = E(set, new Map([['A', 10], ['B', 10]]));
    check(!set[0].out && !set[1].out && ids(r[0]) === 'b,l', 'tie: a change of another player never ties with A in a pool that mixes players');
    // A paid pool: A is the higher one by the pool's own order (per coin), the gap and the bar are in raw units, whatever the cost.
    set = [cand('p1', 100, 1, 100), cand('p2', 98, 1, 98)]; r = E(set);
    check(set[1].out === 'tied' && !set[0].out && ids(r[0]) === 'p1', 'tie: a paid pool (equal per coin) takes the first of the higher ones, the best-case gap 103 - 95 in raw units against the bar', JSON.stringify(r));
    // The tie is sticky like every other out, and one standing change alone is not a tie.
    set = [cand('l', 100, 1)]; r = E(set);
    check(!set[0].out && ids(r[0]) === 'l', 'tie: one change alone is not a tie');
    // Accept never takes a tied change.
    set = [cand('b', 98, 1), cand('l', 100, 1)]; E(set);
    const takes = R.acceptTakes(set, (c) => c.est.net, { byPlayer: false, players: ['A'], locked: new Map(), cmp: (a, b) => b.est.net - a.est.net });
    check(takes.get('*')?.id === 'l', 'tie: Accept current winner skips the tied change and takes the one still in');
}
// The projection: the rounds needed for the sum of the top two margins to fall under the gap between the means, margins shrinking as 1/sqrt(rounds).
{
    const m = (mean, margin) => ({ mean, margin });
    check(R.roundsToSeparate(m(100, 30), m(80, 30), 10) === 80, 'projection: margins 30 + 30 over a gap 20 after 10 rounds need 80 more (10 * (9 - 1))');
    check(R.roundsToSeparate(m(100, 10), m(80, 8), 10) === 1, 'projection: already apart (sum 18 under the gap 20) is 1 round (the elimination takes it)');
    check(R.roundsToSeparate(m(100, 10.2), m(80, 10), 10) === 1, 'projection: just over (sum 20.2, gap 20) is at least 1 round');
    check(R.roundsToSeparate(m(100, 30), m(100, 30), 10) === null && R.roundsToSeparate(m(100, 30), m(100.0000001, 30), 10) === null, 'projection: no gap between the means cannot be told (shown as more than 999)');
    check(R.roundsToSeparate(m(100, 30), m(99, 30), 10) === null, 'projection: above 999 rounds (10 * (3600 - 1)) cannot be shown as a number');
    check(R.roundsToSeparate(m(100, 30), m(80, 30), 0) === null && R.roundsToSeparate(m(100, 0), m(80, 0), 10) === null, 'projection: no rounds so far or no margins cannot be told');
    // The pool nearest to ending: pools with two or three changes; the smallest number wins; a pool that cannot be told counts as far.
    const P = (...cs) => ({ changes: cs });
    const near = (pools, rounds = 10) => R.nearestSeparation(pools, { goal, mult: 3, rounds });
    const far = P(cand('f1', 100, 10), cand('f2', 99, 10)), close = P(cand('c1', 100, 10), cand('c2', 80, 10)), same = P(cand('s1', 100, 10), cand('s2', 100, 10)), four = P(cand('q1', 100, 10), cand('q2', 80, 10), cand('q3', 70, 10), cand('q4', 60, 10)), one = P(cand('o1', 100, 10));
    check(near([far, close])?.rounds === 80, 'nearest: the pool needing the fewest rounds wins (margins 30 + 30 over a gap 20 at 10 rounds: 80)', JSON.stringify(near([far, close])));
    check(near([same, close])?.rounds === 80 && near([same])?.rounds === null && near([far])?.rounds === null, 'nearest: a pool that cannot be told counts as far; alone it shows as more than 999');
    check(near([four, one]) === null && near([]) === null, 'nearest: a pool of four or more, or one change alone, takes no part; none gives null');
    check(near([P(cand('a', 100, 10), cand('b', 80, 10), cand('c', 85, 10))])?.rounds === 150, 'nearest: three standing use the top two by mean (100 and 85: margins 60 over a gap 15 at 10 rounds: 150)');
}

// The bar of each player (buyer.mjs barsFrom, the function core.mjs and a script on saved runs both use): 1% of his own loot-per-user-minus-supplies mean.
{
    const B = await import(pathToFileURL(path.join(root, 'tools/whatif/buyer.mjs')).href);
    const cp = (profit, cons, a, b) => ({ party: { profitAfterTaxPerDay: profit, consumablesPerDay: cons }, players: { A: { consumablesPerDay: a }, B: { consumablesPerDay: b } } });
    const cps = [cp(900, 100, 10, 30), cp(1100, 100, 30, 10)], bars = B.barsFrom(cps, { players: ['A', 'B'], n: 2, goal: 'profit', metric: null, fraction: 0.01 });
    // loot 1000 and 1200, mean 1100, per user 550; A's supplies mean 20: 530; B's 20: 530; 1% = 5.3
    check(near(bars.get('A'), 5.3, 1e-9) && near(bars.get('B'), 5.3, 1e-9), 'barsFrom: 1% of the loot per user minus his own supplies, the mean over the checkpoints', [...bars].join(' '));
    const bx = B.barsFrom([{ party: { expPerHour: 200 } }, { party: { expPerHour: 400 } }], { players: ['A'], n: 2, goal: 'exp', metric: (c) => c.party.expPerHour, fraction: 0.01 });
    check(near(bx.get('A'), 3, 1e-9), 'barsFrom: on another goal the party figure');
    check(B.barsFrom([], { players: ['A'], n: 2, goal: 'profit', fraction: 0.01 }).size === 0, 'barsFrom: no checkpoints, no bars');
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

// "Accept current winner": which leader each pool without a lock would take (acceptTakes), then the pick check decides (firstConfirmed, sure.mjs).
{
    const S = await import(pathToFileURL(path.join(root, 'tools/whatif/sure.mjs')).href);
    const L = (id, player, gain, extra = {}) => ({ id, player, gain, ...extra });
    const gainOf = (c) => c.gain, cmp = (a, b) => b.gain - a.gain;
    const live = [L('a1', 'A', 3), L('a2', 'A', 9), L('b1', 'B', -2), L('b2', 'B', 0), L('c1', 'C', 5, { timeOnly: true })];
    const t1 = R.acceptTakes(live, gainOf, { byPlayer: true, players: ['A', 'B', 'C'], locked: new Map(), cmp });
    check(t1.size === 1 && t1.get('A').id === 'a2', 'accept: a player with a positive leader takes his best; one whose leaders are all at or below 0, or time-only, takes none', [...t1.keys()].join());
    const t2 = R.acceptTakes(live, gainOf, { byPlayer: true, players: ['A', 'B', 'C'], locked: new Map([['A', live[0]]]), cmp });
    check(t2.size === 0, 'accept: a pool that already locked keeps its pick (it is not in the takes)');
    const t3 = R.acceptTakes(live, gainOf, { byPlayer: false, players: [], locked: new Map(), cmp });
    check(t3.size === 1 && t3.get('*').id === 'a2', 'accept: a stage with one pool takes the best positive leader under the key *');
    check(R.acceptTakes(live, gainOf, { byPlayer: false, players: [], locked: new Map([['*', live[0]]]), cmp }).size === 0, 'accept: a stage whose single pool locked takes nothing');
    check(R.acceptTakes([L('x', 'A', -1), L('y', 'A', 0)], gainOf, { byPlayer: false, players: [], locked: new Map(), cmp }).size === 0, 'accept: no leader with a gain above 0 (no change leads): nothing is taken, so the window shows only Skip');
    check(R.acceptTakes([L('x', 'A', null), L('y', 'A', NaN)], gainOf, { byPlayer: true, players: ['A'], locked: new Map(), cmp }).size === 0, 'accept: a leader with no reading yet (no gain figure) is never taken');
    // Accept with the elimination rule: a candidate that is out is never taken, even with the better mean; the one still in is.
    const withOut = [L('o1', 'A', 9, { out: 'bar' }), L('o2', 'A', 4)];
    const t4 = R.acceptTakes(withOut, gainOf, { byPlayer: true, players: ['A'], locked: new Map(), cmp });
    check(t4.size === 1 && t4.get('A').id === 'o2', 'accept: of two positive leaders the one that is out (higher mean) is skipped and the one still in is taken');
    check(R.acceptTakes([L('o3', 'A', 9, { out: 'payback' }), L('o4', 'A', 5, { out: 'beaten' })], gainOf, { byPlayer: true, players: ['A'], locked: new Map(), cmp }).size === 0, 'accept: every positive leader out (bar, payback, beaten): nothing is taken');
    // The taken leader goes through the same pick check as any lock: one that fails it is not chosen.
    const z = 2.5;
    const fresh = (accepted, v, se) => ({ accepted, buyerNet: v, buyerNetSe: se, gain: v, se });
    const pass = await S.checkPick(async () => fresh(true, 10, 2), { z, goal: 'profit', cost: 0 });
    const loss = await S.checkPick(async () => fresh(false, -3, 2), { z, goal: 'profit', cost: 0 });
    const out = await S.firstConfirmed([live[1]], async () => loss);
    check(pass.passed === true && loss.passed === false && out.best === null && out.failed.length === 1, 'accept: a taken leader that fails the fresh-run check is not chosen (best null, listed as failed): that pool ends as no change');
    const ok = await S.firstConfirmed([live[1]], async () => pass);
    check(ok.best === live[1], 'accept: a taken leader that passes the fresh-run check is chosen');
}

// The window's figure rule, shared with the core (src/whatif/figure.mjs): Accept is offered only for a leader whose figure is shown as a figure.
{
    const F = await import(pathToFileURL(path.join(root, 'src/whatif/figure.mjs')).href);
    check(F.showsFigure({ status: 'ok', readingSeeds: 4 }) === true && F.showsFigure({ status: 'ok', readingSeeds: 20 }) === true, 'showsFigure: four or more seeds and a clear range is shown');
    check(F.showsFigure({ status: 'ok', readingSeeds: 3 }) === false && F.showsFigure({ status: 'ok', readingSeeds: 2 }) === false, 'showsFigure: under four seeds is not shown');
    check(F.showsFigure({ status: 'zero', readingSeeds: 20 }) === false, 'showsFigure: a range that reaches 0 (written as ≈ 0) is not shown');
    check(F.showsFigure({ status: 'ok', readingSeeds: 20, tooFew: true }) === false, 'showsFigure: a row flagged too few is not shown');
    check(F.showsFigure({ status: 'first', seeds: 6 }) === true && F.showsFigure({ status: 'first', seeds: 3 }) === false, 'showsFigure: a first-look row counts its own seeds');
}

process.exit(fails ? 1 : 0);
