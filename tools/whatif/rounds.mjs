// The pure part of the what-if search that keeps refining (design: the round driver in core.mjs). No I/O, no clock, no globals.
//
// A candidate here is { cost: { cost }, monotone, player, est } where est is estimate()'s result: { net, netSe } on the profit goal,
// { gain, se } on another. The ranked figure of a pool is the buyer's net (profit) or the gain, divided by the cost for a paid
// candidate (the payback order: the larger net per coin first) and as it is for a free one (the buyer's gain order); a monotone
// lever is floored at 0, as in scoreOf.

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
// leader (by `cmp`, the order the lock uses) whose mean net gain (`gainOf`) is above 0, never a time-only lever. A Map pool key -> candidate. The
// mean alone decides here; the pick check that follows every stage pick is what stops a clear loss (the caller does not lock without it).
export function acceptTakes(live, gainOf, { byPlayer, players, locked, cmp }) {
    const best = (list) => list.filter((c) => !c.timeOnly && gainOf(c) > 0).sort(cmp)[0] ?? null;
    const takes = new Map();
    if (byPlayer) { for (const p of players) if (!locked.has(p)) { const c = best(live.filter((x) => x.player === p)); if (c) takes.set(p, c); } }
    else if (!locked.has('*')) { const c = best(live); if (c) takes.set('*', c); }
    return takes;
}

// Whether any candidate could still be worth taking: an upper bound above 0.
export const anyHope = (cands, goal, mult) => cands.some((c) => !c.refuted && bounds(c, goal, mult).hi > 0);

// "No contender's upper bound reaches the leader's lower bound": every other candidate of the leader's pool (paused ones too) has an
// upper bound below the leader's lower bound.
export function separated(leader, cands, { goal, mult, byPlayer = false }) {
    const key = poolKey(leader, byPlayer), lo = bounds(leader, goal, mult).lo;
    return cands.every((c) => c === leader || c.refuted || poolKey(c, byPlayer) !== key || bounds(c, goal, mult).hi < lo);
}
