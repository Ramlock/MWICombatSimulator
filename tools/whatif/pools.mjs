// Pure pool helpers of the what-if search (optimize.mjs): the cut between stages and the per-player choice of Stage F and D.
// No page, no optimizer globals, no side effects.

// The cut to the next stage. `pool` is already sorted best first (rankAcceptedFirst). Keeps the first `n` free candidates
// (cost 0) AND the first `n` paid ones (cost above 0) and returns their union in the pool's order: free changes (loadout
// tweaks, trigger terms, skill levels) are many and would take every place, so the paid ones (equipment, houses, books)
// would never reach the long measurement. With `byPlayer` the same cut is made for each player (Stage F and Stage D, where
// each player's best filling is wanted, so one player's fillings cannot crowd out another's).
export function cutPool(pool, n, byPlayer = false) {
    const kept = new Set();
    for (const who of byPlayer ? [...new Set(pool.map((c) => c.player))] : [null]) {
        const mine = pool.filter((c) => who === null || c.player === who);
        for (const paid of [false, true]) for (const c of mine.filter((x) => (x.cost.cost > 0) === paid).slice(0, n)) kept.add(c);
    }
    return pool.filter((c) => kept.has(c));
}

// The chain guard of the greedy steps. `chain` holds the run key of every state the search has been in (the original base,
// the foods and drinks baseline, the state after each accepted step). A candidate whose resulting state (the base so far plus
// its ops, keyed by `keyOf`, which hashes the applied setup, so a full-list trigger op applied last-wins counts as the state it
// produces) is already in the chain is dropped before it is estimated. Why: an accepted change becomes the base, and the old
// state, rebuilt as a candidate (a trigger term back to its old value, an item swapped back), is measured on its own low seeds
// against the base's more numerous seeds; two states that simulate alike then show the same gain in both directions and the
// search flips between them forever. Returns { kept, dropped }, each in the input's order.
export function dropChainStates(cands, baseOps, keyOf, chain) {
    const kept = [], dropped = [];
    for (const c of cands) (chain.has(keyOf([...baseOps, ...c.ops])) ? dropped : kept).push(c);
    return { kept, dropped };
}

// Stage F / Stage D: each player's best filling is the first accepted one of his in the sorted pool; a player with none accepted
// has no entry (his current items stay). Returns { <player>: candidate }.
export function bestPerPlayer(pool, players) {
    const out = {};
    for (const p of players) {
        const best = pool.find((c) => c.player === p && c.est.accepted);
        if (best) out[p] = best;
    }
    return out;
}
