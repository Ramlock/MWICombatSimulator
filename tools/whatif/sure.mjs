// The pick check of the greedy chain (his go 2026-11-11: "Confirm the run, reduce the noise, don't recommend what you can't ensure
// enough"). Pure decisions, no runs: optimize.mjs supplies `measure(k)`, the reading of k fresh seeds per arm.
//
// A reading: { accepted, gain, se, buyerNet?, buyerNetSe? } (accepted = the search's own accept rule on that measurement:
// acceptBoth on the profit goal, the party test on another). The deciding figure is the buyer's net on the profit goal, the party gain
// on another. A pick that is accepted passes; one whose deciding figure is under z errors but at least z/2 errors gets another block
// of seeds per arm, up to `max`; below z/2 errors, or still not accepted at `max`, it fails.

import { overPaybackLimit } from '../../src/whatif/payback.mjs';

export const SURE_BLOCK = 16, SURE_MAX = 64;

export const deciding = (reading, goal) => (goal === 'profit' ? { v: reading.buyerNet, se: reading.buyerNetSe } : { v: reading.gain, se: reading.se });

// 'pass', 'more' (not confirmed, not clearly out: more seeds) or 'fail'.
export function verdict(reading, k, { z, goal, max = SURE_MAX }) {
    if (reading.accepted) return 'pass';
    const { v, se } = deciding(reading, goal);
    const between = se > 0 && v >= (z / 2) * se && v < z * se;
    return between && k < max ? 'more' : 'fail';
}

// Measures at `block` seeds, then more while the verdict says so. Returns { passed, fresh } or null when `measure` returns null
// (a stop or the time limit ended its runs). `maxPayback` (days, 0 or none = no limit) with the pick's `cost`: a pick whose fresh
// reading pays back in more than that many days (cost over the fresh buyer's gain) fails like any other (overPaybackLimit).
export async function checkPick(measure, { z, goal, block = SURE_BLOCK, max = SURE_MAX, cost, maxPayback }) {
    for (let k = block; ; k += block) {
        const fresh = await measure(k);
        if (fresh === null) return null;
        const v = verdict(fresh, k, { z, goal, max });
        if (v !== 'more') return { passed: v === 'pass' && !overPaybackLimit(cost, fresh.buyerNet, maxPayback), fresh };
    }
}

// The choice among ranked candidates: `ok` is the accepted, affordable candidates in rank order; each is checked in turn (`check(c)`
// returns { passed, fresh } or null, and may add `cand` when what is checked is a refined version of `c`, the one that is shown and
// joins) until one passes. `onFail({ cand, orig, fresh })` is called at once for each pick that fails. Returns { best, orig, fresh,
// failed: [{ cand, orig, fresh }] }, best null when none passed, or null when a check was stopped.
export async function firstConfirmed(ok, check, onFail) {
    const failed = [];
    for (const orig of ok) {
        const r = await check(orig);
        if (r === null) return null;
        const cand = r.cand ?? orig;
        if (r.passed) return { best: cand, orig, fresh: r.fresh, failed };
        failed.push({ cand, orig, fresh: r.fresh });
        onFail?.({ cand, orig, fresh: r.fresh });
    }
    return { best: null, orig: null, fresh: null, failed };
}

// Foods and drinks (one stage): each player's chosen filling is confirmed like a step's pick, in party order, each alone against
// the original setup (`baseOps`, the stage's start), never against the earlier players' confirmed fillings. `pool` is the stage's
// pool in rank order; a player's candidates are his accepted ones. `check(baseOps, c)` is the pick check ({ passed, fresh } or null
// on a stop). A filling that fails is passed to `onFail({ cand, fresh })` and the player's next best is tried; none left leaves
// him unchanged (no entry in `chosen`). `asIs(c)` is true for a pick the user took with "Accept current winner": it joins with no check
// and no fresh reading (`fresh[player]` is null), as it is.
// Returns { baseOps, chosen: { <player>: cand }, fresh: { <player>: reading } }, or null when a check was stopped; its baseOps is
// the given baseOps extended with every chosen filling's ops, which the rest of the search is measured on.
export async function confirmFillings(players, pool, baseOps, check, onFail, isOk = (c) => c.est.accepted, asIs = () => false) {
    const chosen = {}, fresh = {};
    let ops = baseOps;
    for (const p of players) {
        const mine = pool.filter((c) => c.player === p && isOk(c));
        if (!mine.length) continue;
        // A pick the user accepted as it is (`asIs(c)`, the first of his candidates) joins with no check and no fresh reading.
        if (asIs(mine[0])) { chosen[p] = mine[0]; ops = [...ops, ...mine[0].ops]; continue; }
        const picked = await firstConfirmed(mine, (c) => check(baseOps, c), onFail);
        if (picked === null) return null;
        if (!picked.best) continue;
        chosen[p] = picked.best; fresh[p] = picked.fresh;
        ops = [...ops, ...picked.best.ops];
    }
    return { baseOps: ops, chosen, fresh };
}
