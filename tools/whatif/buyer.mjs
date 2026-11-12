// The buyer's side of a change (profit goal), as pure functions of the saved checkpoints so a test can run them.
// The party's loot income after tax (profit after tax plus its consumables, there is no post-tax income field) and one
// player's own consumables spend per day.
export const lootOf = (cp) => cp.party.profitAfterTaxPerDay + cp.party.consumablesPerDay;
export const suppliesOf = (cp, name) => cp.players?.[name]?.consumablesPerDay ?? 0;

// The elimination bar of each player (rounds.mjs eliminate): `fraction` of his own figure under the unchanged setup, the mean over the base's checkpoints `cps`
// (one per seed), in the unit the buyer's gain is measured in: on the profit goal the party's loot per user minus his own supplies, per day; on another goal
// the party figure `metric` reads. `n` = the party's size. Pure, so core.mjs and a script reading saved runs use the same function.
export function barsFrom(cps, { players, n, goal, metric, fraction }) {
    const bars = new Map();
    if (!cps.length) return bars;
    const mean = (f) => cps.reduce((a, cp) => a + f(cp), 0) / cps.length;
    for (const p of players) bars.set(p, fraction * (goal === 'profit' ? mean((cp) => lootOf(cp) / n - suppliesOf(cp, p)) : mean(metric)));
    return bars;
}

// The change (variant minus base) and its error, by the search's error rule on one series: paired = the mean of the
// per-seed differences and sd(differences) / sqrt(n); unpaired = the gain and sqrt(sv^2/kv + sb^2/kb) with `bs` (all the base's
// seeds) feeding the error. The unpaired gain is mean(variant) - mean(base on the variant's own seeds): `bsSame`, the base's values
// on exactly the seeds the variant ran (the owner's pick "Compare on the same seeds"); with no `bsSame` it is mean(bs). `seSame` is
// the error if the base's variance were taken over those seeds only (reported next to `se`, never used).
export function diffStat(vs, bs, rule, bsSame) {
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    if (rule === 'paired') { const d = vs.map((v, i) => v - bs[i]); return { gain: mean(d), se: sd(d) / Math.sqrt(d.length) }; }
    const same = bsSame || bs;
    return { gain: mean(vs) - mean(same), se: Math.sqrt(sd(vs) ** 2 / vs.length + sd(bs) ** 2 / bs.length), seSame: Math.sqrt(sd(vs) ** 2 / vs.length + sd(same) ** 2 / same.length) };
}

// The buyer's net for a change bought by `player`: per run q = (the party's loot per user, over `n` players) minus the
// buyer's own supplies per day; the net and its error are diffStat of that one series (never the loot error plus the
// supplies error: the two move together). Accepted when the net is above 0 by `z` errors. `vcp` / `bcp`: the variant's and
// the base's checkpoints, in seed order; `bcpSame` (optional): the base's checkpoints on the variant's own seeds (see diffStat).
export function buyerNet(vcp, bcp, player, n, rule, z, bcpSame) {
    const q = (cp) => lootOf(cp) / n - suppliesOf(cp, player);
    const { gain: net, se, seSame } = diffStat(vcp.map(q), bcp.map(q), rule, bcpSame && bcpSame.map(q));
    return { net, se, seSame, accepted: net > 0 && net >= z * se };
}

// The score: the net over the price, which is 1 / the buyer's payback (a free change with a net above 0 is Infinity). A
// monotone lever can only help (3.2 item 1), so its net is floored at 0.
export const scoreOf = (net, cost, monotone) => { const used = monotone ? Math.max(net, 0) : net; return cost <= 0 ? (used > 0 ? Infinity : used) : used / cost; };

// The order: the larger score first (the smaller buyer payback), a tie by the larger buyer net, then the larger party gain.
// `est` carries score, net (none on a goal that is not profit: read as 0) and gain.
// A total order, with no NaN hole: a free change with a gain (score Infinity) comes first and the free ones are ranked by the buyer's gain
// (net, then the party gain); the rest (they cost something, or gain nothing) by score, then net, then gain. A missing or NaN figure sorts last.
const down = (x, y) => { const p = Number.isNaN(x) || x == null ? -Infinity : x, q = Number.isNaN(y) || y == null ? -Infinity : y; return p === q ? 0 : p > q ? -1 : 1; };
export const rankEst = (a, b) => {
    const fa = a.score === Infinity, fb = b.score === Infinity;
    if (fa !== fb) return fa ? -1 : 1;
    return (fa ? 0 : down(a.score, b.score)) || down(a.net ?? 0, b.net ?? 0) || down(a.gain, b.gain);
};
// The same order with the rows that pass the accept rule first (used to cut each stage's pool).
export const rankAcceptedFirst = (a, b) => (Number(b.accepted) - Number(a.accepted)) || rankEst(a, b);

// The profit goal's acceptance: one of the two figures (the party's shared loot gain and the buyer's net) is above 0 by at least
// z errors, and the other is not a clear loss: at least -(z / 2) errors (so a pure cost cut, or a change that does not touch the
// group at all, passes when the buyer's side is clear). gain/se are the party's (totals; only the ratio matters),
// net/netSe the buyer's. At z = 0 neither may be below 0 and one must be above 0.
export const acceptBoth = (gain, se, net, netSe, z) => {
    const clear = (v, e) => v > 0 && v >= z * e, notLoss = (v, e) => v >= -(z / 2) * e;
    return (clear(gain, se) && notLoss(net, netSe)) || (clear(net, netSe) && notLoss(gain, se));
};
