// The pick check of the greedy chain (his go 2026-11-11: "Confirm the run, reduce the noise, don't recommend what you can't ensure
// enough"). Pure decisions, no runs: optimize.mjs supplies `measure(k)`, the reading of k fresh seeds per arm.
//
// A reading: { accepted, gain, se, buyerNet?, buyerNetSe?, floor? } (accepted = the search's own accept rule on that measurement:
// acceptBoth on the profit goal, the party test on another). The deciding figure is the buyer's net on the profit goal, the party gain
// on another; `floor` is the smallest gain worth showing in that figure's unit (MIN_GAIN_PCT of the buyer's own profit per day on the
// profit goal, of the party figure on another: core.mjs freshRead), 0 when absent. "The range" is the deciding figure plus and minus z errors.
// The check has four endings (his "approved", 2026-11-15: a check that cannot tell is not a refutation):
//   'pass'   confirmed: accepted (acceptBoth on both figures; the party test on another goal);
//   'loss'   a loss: the whole range is below 0;
//   'small'  too small to matter: the whole range is under the floor;
//   'unsure' too small to tell: none of the three at `max` seeds.
// While none of them holds ('more': the range still reaches the floor and the change is not confirmed) the check takes another block of seeds.
// Only 'pass' accepts a change; each of the other three leaves it out.

import { overPaybackLimit } from '../../src/whatif/payback.mjs';

export const SURE_BLOCK = 16, SURE_MAX = 64;
// The default smallest gain worth showing, in % of the buyer's own profit per day (the search's --min-gain-pct, the window's field).
export const MIN_GAIN_PCT = 0.12;
// The endings a check that left a change out can have (checkPick's `ending`, the result's and the progress record's `ending`); 'slow' is a
// confirmed change that pays back past the payback limit (result.overPayback, not a left-out ending of the check).
export const LEFT_OUT_ENDINGS = ['loss', 'small', 'unsure'];

export const deciding = (reading, goal) => (goal === 'profit' ? { v: reading.buyerNet, se: reading.buyerNetSe } : { v: reading.gain, se: reading.se });

// 'pass', 'loss', 'small', 'unsure', or 'more' (none of them yet: another block of seeds).
export function verdict(reading, k, { z, goal, max = SURE_MAX }) {
    if (reading.accepted) return 'pass';
    const { v, se } = deciding(reading, goal), top = v + z * (se > 0 ? se : 0);
    if (top < 0) return 'loss';
    if (top < (reading.floor > 0 ? reading.floor : 0)) return 'small';
    return k < max ? 'more' : 'unsure';
}

// The range a check's ending is shown with, in the unit the window shows it (the buyer's gain per day on the profit goal, the gain per user
// on another, `n` players): { low, high, floor }. One function for the result, the progress record and the log.
export function rangeOf(reading, { z, goal, n = 1 }) {
    const { v, se } = deciding(reading, goal), per = goal === 'profit' ? 1 : n, e = z * (se > 0 ? se : 0);
    return { low: (v - e) / per, high: (v + e) / per, floor: (reading.floor > 0 ? reading.floor : 0) / per };
}

// Measures at `block` seeds, then more while the verdict says so. Returns { passed, fresh, ending } or null when `measure` returns null
// (a stop or the time limit ended its runs); `ending` is 'pass', one of LEFT_OUT_ENDINGS, or 'slow'. `maxPayback` (days, 0 or none = no limit) with the pick's `cost`: a pick whose fresh
// reading pays back in more than that many days (cost over the fresh buyer's gain) fails like any other (overPaybackLimit).
export async function checkPick(measure, { z, goal, block = SURE_BLOCK, max = SURE_MAX, cost, maxPayback }) {
    for (let k = block; ; k += block) {
        const fresh = await measure(k);
        if (fresh === null) return null;
        const v = verdict(fresh, k, { z, goal, max });
        if (v === 'more') continue;
        const ending = v === 'pass' && overPaybackLimit(cost, fresh.buyerNet, maxPayback) ? 'slow' : v;
        return { passed: ending === 'pass', fresh, ending };
    }
}

// The choice among ranked candidates: `ok` is the accepted, affordable candidates in rank order; each is checked in turn (`check(c)`
// returns { passed, fresh, ending } or null, and may add `cand` when what is checked is a refined version of `c`, the one that is shown and
// joins) until one passes. `onFail({ cand, orig, fresh, ending })` is called at once for each pick its check left out. Returns { best, orig, fresh,
// failed: [{ cand, orig, fresh, ending }] }, best null when none passed, or null when a check was stopped.
export async function firstConfirmed(ok, check, onFail) {
    const failed = [];
    for (const orig of ok) {
        const r = await check(orig);
        if (r === null) return null;
        const cand = r.cand ?? orig;
        if (r.passed) return { best: cand, orig, fresh: r.fresh, failed };
        failed.push({ cand, orig, fresh: r.fresh, ending: r.ending });
        onFail?.({ cand, orig, fresh: r.fresh, ending: r.ending });
    }
    return { best: null, orig: null, fresh: null, failed };
}

// Foods and drinks (one stage): each player's chosen filling is confirmed like a step's pick, in party order, each alone against
// the original setup (`baseOps`, the stage's start), never against the earlier players' confirmed fillings. `pool` is the stage's
// pool in rank order; a player's candidates are his accepted ones. `check(baseOps, c)` is the pick check ({ passed, fresh } or null
// on a stop). A filling its check left out is passed to `onFail({ cand, fresh, ending })` and the player's next best is tried; none left leaves
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

// The check of a set accepted together (design section 3): the set against the base as one change, by checkPick on the confirm seeds, then each
// member left out once on the same seeds. `measure(variant, against, k)` is the reading of base + every `variant` member's ops against base + every
// `against` member's ops on k fresh seeds per arm (`against` empty: against the base), its accept rule per buyer (each player who buys a member in
// variant and not in against: acceptBoth at z and the payback limit on his own cost), its deciding figure the weakest buyer's; null on a stop.
// m's marginal is the set against "set minus m", paired on the same seeds, under the same verdict at the set's seeds; a member whose marginal fails
// leaves the set (it is not refuted). One leaving: the reduced set is "set minus m", whose runs the leave-out already made, checked from them (no new
// run). Two or more leaving: the reduced set gets one more checkPick. Returns { passed, ending, set, fresh, marginals: Map member -> reading, left: [members] }
// (`ending`: the set's check's; when every member left, the last member's marginal's),
// or null on a stop. A set that fails refutes no one (the caller keeps it by setKey so it is not offered again in the race).
export async function checkSet(members, measure, { z, goal, block = SURE_BLOCK, max = SURE_MAX }) {
    const whole = await checkPick((k) => measure(members, [], k), { z, goal, block, max, cost: 0, maxPayback: 0 });
    if (whole === null) return null;
    if (!whole.passed) return { passed: false, ending: whole.ending, set: members, fresh: whole.fresh, marginals: new Map(), left: [] };
    const k = whole.fresh.seeds, marginals = new Map(), left = [];
    for (const m of members) {
        const r = await measure(members, members.filter((x) => x !== m), k);
        if (r === null) return null;
        marginals.set(m, r);
        if (verdict(r, k, { z, goal, max: k }) !== 'pass') left.push(m);
    }
    if (!left.length) return { passed: true, ending: 'pass', set: members, fresh: whole.fresh, marginals, left };
    const rest = members.filter((m) => !left.includes(m));
    if (!rest.length) return { passed: false, ending: verdict(marginals.get(members[members.length - 1]), k, { z, goal, max: k }), set: members, fresh: whole.fresh, marginals, left };
    const again = left.length === 1
        ? await checkPick((kk) => measure(rest, [], kk), { z, goal, block: k, max: k, cost: 0, maxPayback: 0 })
        : await checkPick((kk) => measure(rest, [], kk), { z, goal, block, max, cost: 0, maxPayback: 0 });
    if (again === null) return null;
    return { passed: again.passed, ending: again.ending, set: rest, fresh: again.fresh, marginals, left };
}
