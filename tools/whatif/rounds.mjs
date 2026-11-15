// The pure part of the what-if search that keeps refining (design: the round driver in core.mjs). No I/O, no clock, no globals.
//
// A candidate here is { cost: { cost }, monotone, player, est } where est is estimate()'s result: { net, netSe } on the profit goal,
// { gain, se } on another. The ranked figure of a pool is the buyer's net (profit) or the gain, divided by the cost for a paid
// candidate (the payback order: the larger net per coin first) and as it is for a free one (the buyer's gain order); a monotone
// lever is floored at 0, as in scoreOf.

import { overPaybackLimit } from '../../src/whatif/payback.mjs';

// ---- Student's t (the displayed range is an ordinary t range) ----
function lgamma(x) {
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
    const TINY = 1e-300;
    let c = 1, d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
        const m2 = 2 * m;
        let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d; h *= d * c;
        aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
        d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
}
function ibeta(x, a, b) { // regularized incomplete beta I_x(a, b)
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function tCdf(t, df) {
    const p = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5); // P(T > |t|)
    return t > 0 ? 1 - p : p;
}
// The p-quantile of Student's t with df degrees of freedom (0.5 < p < 1), by bisection on the CDF.
export function tQuantile(p, df) {
    let lo = 0, hi = 1;
    while (tCdf(hi, df) < p && hi < 1e7) hi *= 2;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
}
// The two-sided multiplier of the standard error for a coverage (0.99 -> 99%) at df degrees of freedom.
export const tMult = (coverage, df) => tQuantile(1 - (1 - coverage) / 2, Math.max(1, df));

// The degrees of freedom of a difference of two means: n - 1 for the paired rule, Welch-Satterthwaite for the unpaired one.
export function dfOf(vs, bs, rule) {
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const v2 = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1); };
    if (rule === 'paired') return vs.length - 1;
    const a = v2(vs) / vs.length, b = v2(bs) / bs.length;
    const den = a * a / (vs.length - 1) + b * b / (bs.length - 1);
    return den > 0 ? (a + b) ** 2 / den : vs.length + bs.length - 2;
}

// ---- Bounds and contention ----
// The figure a pool ranks on and its error, from the estimate (null when it has none: fewer than 2 seeds).
export function rankedOf(est, goal) {
    if (!est) return null;
    const q = goal === 'profit' ? est.net : est.gain, se = goal === 'profit' ? est.netSe : est.se;
    return Number.isFinite(q) && Number.isFinite(se) ? { q, se } : null;
}
const scale = (c, x) => (c.monotone ? Math.max(x, 0) : x) / (c.cost.cost > 0 ? c.cost.cost : 1);
// The ranked value and its bounds at `mult` errors. A candidate with no usable estimate is unbounded (always in contention).
export function bounds(c, goal, mult) {
    const r = rankedOf(c.est, goal);
    if (!r) return { v: -Infinity, lo: -Infinity, hi: Infinity };
    return { v: scale(c, r.q), lo: scale(c, r.q - mult * r.se), hi: scale(c, r.q + mult * r.se) };
}
export const poolKey = (c, byPlayer) => `${byPlayer ? c.player + ':' : ''}${c.cost.cost > 0 ? 'paid' : 'free'}`;

// The contention test, on every candidate, every round. Two pools (free, paid; per player when `byPlayer`), K leaders each by
// `rank(a, b)` over the candidates (best first). A candidate is paused when its upper bound at `mult` errors is below the lowest
// lower bound among its pool's leaders; a leader is never paused; a candidate with no estimate yet is in contention. Sets
// `c.status` ('contending' | 'paused') and `c.bounds`; a candidate with `c.refuted` is left out of every pool and counted in none.
// Returns { pools: [{ key, leaders, line, contending, paused, size }], contending, paused }.
// The one order of the pool groups (rounds table, first look): the players in the party's own order (`order`, the names), a key without a
// player after them, and within a player the free pool before the paid one.
export const poolSorter = (order = []) => {
    const at = (key) => { const s = String(key), i = order.indexOf(s.includes(':') ? s.slice(0, s.lastIndexOf(':')) : ''); return i < 0 ? order.length : i; };
    return (a, b) => (at(a[0]) - at(b[0])) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
};
export function contention(cands, { K, mult, goal, byPlayer = false, rank, order = [] }) {
    const groups = new Map();
    for (const c of cands) {
        if (c.refuted) continue;
        c.bounds = bounds(c, goal, mult);
        const key = poolKey(c, byPlayer);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const pools = [];
    let contending = 0, paused = 0;
    for (const [key, list] of [...groups].sort(poolSorter(order))) {
        const ranked = list.filter((c) => c.est).sort((a, b) => rank(a, b));
        const leaders = ranked.slice(0, K);
        const line = leaders.length ? Math.min(...leaders.map((c) => c.bounds.lo)) : -Infinity;
        let nc = 0, np = 0;
        for (const c of list) {
            c.status = !leaders.includes(c) && c.est && c.bounds.hi < line ? 'paused' : 'contending';
            if (c.status === 'paused') np++; else nc++;
        }
        contending += nc; paused += np;
        pools.push({ key, leaders, line, contending: nc, paused: np, size: list.length });
    }
    return { pools, contending, paused };
}

// What the window's "Accept current winner" would take: in each pool that has no lock yet (a player's, or the stage's single one '*'), its best live
// leader (by `cmp`, the order the lock uses) whose mean net gain (`gainOf`) is above 0, never a time-only lever and never a candidate the elimination
// rule put out (`out`: beaten, under the bar or over the payback limit). A Map pool key -> candidate. The mean alone decides here; the pick check
// that follows every stage pick is what stops a clear loss (the caller does not lock without it).
export function acceptTakes(live, gainOf, { byPlayer, players, locked, cmp }) {
    const best = (list) => list.filter((c) => !c.timeOnly && !c.out && gainOf(c) > 0).sort(cmp)[0] ?? null;
    const takes = new Map();
    if (byPlayer) { for (const p of players) if (!locked.has(p)) { const c = best(live.filter((x) => x.player === p)); if (c) takes.set(p, c); } }
    else if (!locked.has('*')) { const c = best(live); if (c) takes.set('*', c); }
    return takes;
}

// ---- Elimination (the owner, 2026-11-12) ----
// "A candidate stops being a valid candidate when its high end is below another candidate's low end. A leader is locked by being the last
// candidate standing." Per pool, the candidates are the changes plus the CURRENT setup, one candidate like the others: a point at gain 0 (the
// race's gains are paired against the unchanged setup, so its range is [0, 0]). A change is out when
//  - its upper end (bounds(), the pool's own unit and `mult` errors) is below another candidate's lower end (paused ones and the current setup
//    included; a candidate cut by the bar below does not count as another candidate: it cannot win, so it cannot beat anyone), or
//  - its upper end is below the bar of its player: 1% of his own profit per day under the unchanged setup (`bars`: player -> bar, in the unit of
//    rankedOf(); a player without a bar above 0 has no such cut). The current setup is exempt: a change must still beat it.
//  - (profit goal, a paid candidate) its cost over the upper end of the buyer's gain goes over the payback limit (`payLimit`, days; 0 = none):
//    even its best case cannot pay back in time. A free candidate is never cut this way.
// `out` is kept on the candidate ('beaten' | 'bar' | 'payback' | 'tied'), who never returns inside the race (the caller clears it when a new race starts) but for
// a 'tied' one, who returns when its A goes out (releaseTied), and a 'beaten' or 'tied' one of a pool whose winner fails its pick check (reopen below); the
// current setup is worked out again every round. A refuted candidate (it failed the pick check) and a time-only lever (never picked) take no
// part. Returns one entry per pool, in the pool order: { key, player, changes: the changes still standing, noChange: the current setup is
// standing, size }. A pool with one change and no current setup has its last candidate standing; one with the current setup alone ends as
// "no change".
export const CURRENT = Object.freeze({ current: true });
const spanOf = (c, goal, mult) => (c === CURRENT ? { lo: 0, hi: 0 } : bounds(c, goal, mult));
// The upper end in the unit of rankedOf() (not per coin); a monotone lever is floored at 0 as in bounds().
const rawHi = (c, goal, mult) => { const r = rankedOf(c.est, goal); if (!r) return Infinity; const hi = r.q + mult * r.se; return c.monotone ? Math.max(hi, 0) : hi; };
// The lower end in the same unit (a monotone lever floored at 0 as in bounds()); -Infinity with no usable estimate.
const rawLo = (c, goal, mult) => { const r = rankedOf(c.est, goal); if (!r) return -Infinity; const lo = r.q - mult * r.se; return c.monotone ? Math.max(lo, 0) : lo; };
// The tie rule (the owner, 2026-11-12: "your proposal seems fair", "Build it with no time limit"; changed with his approval on 2026-11-14). In a pool with two
// or more changes still standing, the higher one A (the pool's own order, bounds().v) and each other standing change B are tied when the best-case gap is below
// the bar of A's player (the 1% bar of the cut above) in both directions: A's upper end minus B's lower end, and B's upper end minus A's lower end. A change far
// above A in raw gain (A leads per coin, B gains much more) is no tie. The pool ends when every other standing change is tied with A: they go out as 'tied', each
// keeping the A it was tied with (`tiedTo`), and A is its pick (the pick check follows as for any pick). A tied change comes back into the race when its A goes
// out for any reason (the bar, the payback limit, beaten, tied with another) or is refuted by the pick check: releaseTied() below, the one place that does it.
// The gaps and the bar are in the unit of rankedOf() (the buyer's net, not per coin), like the bar cut; the error margins are inside the ends, so a wide range is
// no tie. A change of another player than A's never ties (a pool that mixes players, as the screen stage's, keeps going on it); no bar above 0 (or an end with no
// estimate) means no tie. The current setup takes no part.
function tieOf(list, { goal, mult, bars }) {
    const live = list.filter((c) => !c.out);
    if (live.length < 2) return;
    const A = live.reduce((a, c) => (bounds(c, goal, mult).v > bounds(a, goal, mult).v ? c : a));
    const bar = bars.get(A.player), hi = rawHi(A, goal, mult);
    if (!(bar > 0) || !Number.isFinite(hi)) return;
    const others = live.filter((c) => c !== A);
    const lo = rawLo(A, goal, mult);
    if (others.every((b) => b.player === A.player && hi - rawLo(b, goal, mult) < bar && rawHi(b, goal, mult) - lo < bar)) for (const b of others) { b.out = 'tied'; b.tiedTo = A; }
}
// The changes set aside as 'tied' whose A has gone out (any `out`) or been refuted come back: their `out` is cleared. Used by eliminate() after every cut
// and by the race after the pick check refutes a leader. Returns the changes that came back.
export function releaseTied(cands) {
    const back = [];
    for (const c of cands) if (c.out === 'tied' && c.tiedTo && (c.tiedTo.out || c.tiedTo.refuted)) { c.out = undefined; c.tiedTo = undefined; back.push(c); }
    return back;
}
// The rounds still needed to separate the top two standing changes (A, B: { mean, margin } in the unit above, `margin` the half width at `mult` errors) after
// `rounds` rounds of the race: both margins shrink as 1/sqrt(rounds), so the sum of the margins S falls under the gap D between the means after
// n more rounds when S * sqrt(rounds / (rounds + n)) < D, n > rounds * (S^2 / D^2 - 1). Returns the whole number of rounds (at least 1), or null when
// it cannot be told (no gap, no margins, or no rounds) or is above `cap` (the display says "more than 999").
export function roundsToSeparate(a, b, rounds, cap = 999) {
    const S = a.margin + b.margin, D = Math.abs(a.mean - b.mean);
    if (!(S > 0) || !(D > 0) || !(rounds >= 1) || !Number.isFinite(S) || !Number.isFinite(D)) return null;
    if (S < D) return 1; // already apart: the elimination takes the lower one this round
    const n = Math.ceil(rounds * (S * S / (D * D) - 1));
    return n > cap ? null : Math.max(1, n);
}
// The pool nearest to ending, for the stage row: over the pools eliminate() returned, those with two or three changes standing (a lone one is its pick,
// four or more are far from it) each give the rounds to separate their top two (by the pool's own order); the smallest wins, a pool that cannot be told or is
// above the cap counts as infinitely far. Returns null when no pool qualifies, else { rounds: the whole number, or null for "more than 999" }.
export function nearestSeparation(pools, { goal, mult, rounds, cap = 999 }) {
    let best = null;
    for (const p of pools) {
        if (p.changes.length < 2 || p.changes.length > 3) continue;
        const [a, b] = [...p.changes].sort((x, y) => bounds(y, goal, mult).v - bounds(x, goal, mult).v), ra = rankedOf(a.est, goal), rb = rankedOf(b.est, goal);
        const n = ra && rb ? roundsToSeparate({ mean: ra.q, margin: mult * ra.se }, { mean: rb.q, margin: mult * rb.se }, rounds, cap) : null;
        if (best === null || (n !== null && (best.rounds === null || n < best.rounds))) best = { rounds: n };
    }
    return best;
}
function cutOf(c, { goal, mult, bars, payLimit }) {
    const hi = rawHi(c, goal, mult);
    if (!Number.isFinite(hi)) return null; // no usable estimate yet: unbounded, never cut
    const bar = bars.get(c.player);
    if (bar > 0 && hi < bar) return 'bar';
    // Even its best case cannot pay back in time (the pick check's own definition, payback.mjs: an upper end of 0 or less is over the limit);
    // a free candidate is never cut here, and a goal without a limit (payLimit 0) cuts nothing.
    if (goal === 'profit' && c.cost.cost > 0 && overPaybackLimit(c.cost.cost, hi, payLimit)) return 'payback';
    return null;
}
export function eliminate(cands, { goal, mult, byPlayer = false, bars = new Map(), payLimit = 0, order = [] }) {
    const groups = new Map();
    for (const c of cands) {
        if (c.refuted || c.timeOnly) continue;
        const key = poolKey(c, byPlayer);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const pools = [];
    for (const [key, list] of [...groups].sort(poolSorter(order))) {
        // A tied change whose A went out (or was refuted) comes back before the cuts, and again after them while any A falls, so it is judged this round.
        let standing, beatenBy;
        releaseTied(list);
        do {
            for (const c of list) if (!c.out) c.out = cutOf(c, { goal, mult, bars, payLimit }) ?? undefined;
            standing = [CURRENT, ...list.filter((c) => c.out !== 'bar' && c.out !== 'payback')];
            const span = new Map(standing.map((c) => [c, spanOf(c, goal, mult)])), st = standing;
            beatenBy = (c) => st.some((e) => e !== c && span.get(e).lo > spanOf(c, goal, mult).hi);
            for (const c of list) if (!c.out && beatenBy(c)) c.out = 'beaten';
        } while (releaseTied(list).length);
        tieOf(list, { goal, mult, bars });
        pools.push({ key, player: byPlayer ? list[0].player : null, changes: list.filter((c) => !c.out), noChange: !beatenBy(CURRENT), size: list.length });
    }
    return pools;
}

// ---- A failed pick check (the owner, 2026-11-15: "When a winner fails its check, every combination that only the winner had put out comes back, and
// the race goes on without it, until one passes or none is left." "Combinations cut for being worse than the current setup stay out." "Same rule for every
// stage") ----
// `failed` has just failed its pick check (in the race, or after its lock) and is refuted by the caller. Every change of its pool (poolKey) cut as 'beaten'
// or 'tied' has its cut lifted and the pool is judged again by eliminate() on the estimates as they stand, without `failed`: what only `failed` had put
// out stands again; what another change, or the current setup, still beats goes back out ('beaten'); a cut by the bar or the payback limit is never
// lifted. Recursive by itself: the next winner that fails brings back what only it had put out. A change that comes back has its contention status cleared
// (it is in contention until the next contention test says otherwise). `opts` are eliminate()'s, with the caller's own bars. Pure: estimates only, so a
// replay of the stored runs takes the same decision. Returns the changes that came back, in the pool's order.
export function reopen(cands, failed, opts) {
    const key = poolKey(failed, opts.byPlayer);
    const pool = cands.filter((c) => c !== failed && !c.refuted && !c.timeOnly && poolKey(c, opts.byPlayer) === key);
    const lifted = pool.filter((c) => c.out === 'beaten' || c.out === 'tied');
    if (!lifted.length) return [];
    for (const c of lifted) { c.out = undefined; c.tiedTo = undefined; }
    eliminate(pool, opts);
    const back = lifted.filter((c) => !c.out);
    for (const c of back) c.status = undefined;
    return back;
}

// ---- Accept together (design: the private repo's docs/proposals/what-if-accept-together.md, approved 2026-11-14) ----
// The owner: "Maybe we should have a mode where all leading changes are tested together and then accepted together when the tool can't decide between
// them?" A race that picks one change per step ends with a set when, this round, (1) two or more changes stand (eliminate()'s pools, every pool together)
// and every one of them is a clear gain (`clear(c)`: a leader whose reading seeds pass the pick check, as the lock's own sure()); (2) changes of one slot
// (overlapping `groups`) are resolved at once: two levels of one item take the higher level, two items the larger estimate (rankedOf()'s mean, not per
// coin); (3) the search cannot decide: for every pair of one pool (the race compares changes only inside a pool: a free and a paid change never separate,
// so such a pair counts as undecided) the rounds the race still needs to separate them, in its own unit (per coin, bounds() at `mult` errors) and
// uncapped, are more than the `rounds` it has run; equal means never separate. A set whose member ids are in `failed` (its check failed in this race) is
// not offered again. `levelOf(c)` -> { item, level } or null: the item a change puts in its slot and its level.
// A trigger change counts as not clear (the owner's pick, 2026-11-14: "keep trigger changes out of sets"): its pick is refined before its check, which a set does not do.
// Pure: estimates and the caller's cached readings only, so a replay of the stored runs takes the same decision.
// Returns null (the race goes on as today) or { set: the changes in id order, slotLosers: the changes dropped by the slot rule }. A set of one is the slot
// rule leaving one change: it is that pool's pick, as a lone lock is.
export const setKey = (list) => list.map((c) => c.id).sort().join(' + ');
const overlaps = (a, b) => a.groups?.some((g) => b.groups?.includes(g));
export function slotWinner(a, b, { goal, levelOf = () => null }) {
    const la = levelOf(a), lb = levelOf(b);
    if (la && lb && la.item === lb.item && la.level !== lb.level) return la.level > lb.level ? a : b;
    const qa = rankedOf(a.est, goal)?.q ?? -Infinity, qb = rankedOf(b.est, goal)?.q ?? -Infinity;
    return qa !== qb ? (qa > qb ? a : b) : (a.id < b.id ? a : b);
}
export function undecided(a, b, { goal, mult, rounds }) {
    if (poolKey(a, false) !== poolKey(b, false)) return true;
    const ba = bounds(a, goal, mult), bb = bounds(b, goal, mult);
    const A = { mean: ba.v, margin: (ba.hi - ba.lo) / 2 }, B = { mean: bb.v, margin: (bb.hi - bb.lo) / 2 };
    if (A.mean === B.mean) return true;
    const n = roundsToSeparate(A, B, rounds, Infinity);
    return n !== null && n > rounds;
}
export function togetherOf(pools, { goal, mult, rounds, clear, levelOf, failed = new Set() }) {
    const standing = pools.flatMap((p) => p.changes);
    if (standing.length < 2 || !standing.every((c) => c.kind !== 'trigger' && clear(c))) return null; // a trigger change is never in a set (the owner, 2026-11-14): while one stands, the race goes on as today
    let set = [...standing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const slotLosers = [];
    for (let again = true; again;) {
        again = false;
        for (let i = 0; i < set.length && !again; i++) for (let j = i + 1; j < set.length && !again; j++) {
            if (!overlaps(set[i], set[j])) continue;
            const loser = slotWinner(set[i], set[j], { goal, levelOf }) === set[i] ? set[j] : set[i];
            slotLosers.push(loser); set = set.filter((c) => c !== loser); again = true;
        }
    }
    if (set.length >= 2) {
        for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (!undecided(set[i], set[j], { goal, mult, rounds })) return null;
        if (failed.has(setKey(set))) return null;
    }
    return { set, slotLosers };
}

// The groups when a set does not fit the budgets (design section 4). Budgets are per player: for each player whose members do not all fit what he has
// left (`left(player)`), his maximal fitting subsets; with two or more players short, the products of each one's; the other players' members join every
// group. A group dominated by another (summed gain no higher and cost no lower, `gainOf(c)` the estimate's mean) falls out; the rest are ranked by summed
// gain (the owner's same-slot rule carried over: the larger total gain) and cut at `max` (4). Returns [] when every member fits (no groups needed), else the
// groups, each a list of members; one group left wins without a race.
export function budgetGroups(set, { left, gainOf, max = 4 }) {
    const cost = (c) => Math.max(c.cost.cost, 0), sum = (g, f) => g.reduce((a, c) => a + f(c), 0);
    const byPlayer = new Map();
    for (const c of set) { if (!byPlayer.has(c.player)) byPlayer.set(c.player, []); byPlayer.get(c.player).push(c); }
    const options = [];
    let short = false;
    for (const [p, mine] of byPlayer) {
        if (sum(mine, cost) <= left(p)) { options.push([mine]); continue; }
        short = true;
        const fits = [];
        for (let mask = 1; mask < 1 << mine.length; mask++) { const s = mine.filter((_, i) => mask & (1 << i)); if (sum(s, cost) <= left(p)) fits.push(s); }
        const maximal = fits.filter((s) => !fits.some((t) => t.length > s.length && s.every((c) => t.includes(c))));
        options.push(maximal.length ? maximal : [[]]);
    }
    if (!short) return [];
    let groups = [[]];
    for (const opts of options) groups = groups.flatMap((g) => opts.map((o) => [...g, ...o]));
    groups = groups.filter((g) => g.length);
    const g = (x) => sum(x, gainOf), k = (x) => sum(x, cost);
    const kept = groups.filter((x) => !groups.some((y) => y !== x && g(y) >= g(x) && k(y) <= k(x) && (g(y) > g(x) || k(y) < k(x))));
    return kept.sort((a, b) => g(b) - g(a) || k(a) - k(b)).slice(0, max);
}
