// The buyer's side of a change (profit goal), as pure functions of the saved checkpoints so a test can run them.
// The party's loot income after tax (profit after tax plus its consumables, there is no post-tax income field) and one
// player's own consumables spend per day.
export const lootOf = (cp) => cp.party.profitAfterTaxPerDay + cp.party.consumablesPerDay;
export const suppliesOf = (cp, name) => cp.players?.[name]?.consumablesPerDay ?? 0;

// The change (variant minus base) and its error, by the search's error rule on one series: paired = the mean of the
// per-seed differences and sd(differences) / sqrt(n); unpaired = mean(variant) - mean(base) and sqrt(sv^2/kv + sb^2/kb).
export function diffStat(vs, bs, rule) {
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    if (rule === 'paired') { const d = vs.map((v, i) => v - bs[i]); return { gain: mean(d), se: sd(d) / Math.sqrt(d.length) }; }
    return { gain: mean(vs) - mean(bs), se: Math.sqrt(sd(vs) ** 2 / vs.length + sd(bs) ** 2 / bs.length) };
}

// The buyer's net for a change bought by `player`: per run q = (the party's loot per user, over `n` players) minus the
// buyer's own supplies per day; the net and its error are diffStat of that one series (never the loot error plus the
// supplies error: the two move together). Accepted when the net is above 0 by `z` errors. `vcp` / `bcp`: the variant's and
// the base's checkpoints, in seed order.
export function buyerNet(vcp, bcp, player, n, rule, z) {
    const q = (cp) => lootOf(cp) / n - suppliesOf(cp, player);
    const { gain: net, se } = diffStat(vcp.map(q), bcp.map(q), rule);
    return { net, se, accepted: net > 0 && net >= z * se };
}

// The score: the net over the price, which is 1 / the buyer's payback (a free change with a net above 0 is Infinity). A
// monotone lever can only help (3.2 item 1), so its net is floored at 0.
export const scoreOf = (net, cost, monotone) => { const used = monotone ? Math.max(net, 0) : net; return cost <= 0 ? (used > 0 ? Infinity : used) : used / cost; };

// The order: the larger score first (the smaller buyer payback), a tie by the larger buyer net, then the larger party gain.
// `est` carries score, net (none on a goal that is not profit: read as 0) and gain.
export const rankEst = (a, b) => (b.score - a.score) || ((b.net ?? 0) - (a.net ?? 0)) || (b.gain - a.gain);

// The profit goal's acceptance: the party's gain and the buyer's net must both be above 0 by at least z/2 errors, and at
// least one of the two by z errors (so neither can be a net loss, and one is clearly real). `gain`/`se` are the party's
// (totals; only the ratio matters), `net`/`netSe` the buyer's. At z = 0 it is both above 0.
export const acceptBoth = (gain, se, net, netSe, z) => gain > 0 && net > 0 && gain >= (z / 2) * se && net >= (z / 2) * netSe && (gain >= z * se || net >= z * netSe);
