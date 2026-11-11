// The pick check of the greedy chain (his go 2026-11-11: "Confirm the run, reduce the noise, don't recommend what you can't ensure
// enough"). Pure decisions, no runs: optimize.mjs supplies `measure(k)`, the reading of k fresh seeds per arm.
//
// A reading: { accepted, gain, se, buyerNet?, buyerNetSe? } (accepted = the search's own accept rule on that measurement:
// acceptBoth on the profit goal, the party test on another). The deciding figure is the buyer's net on the profit goal, the party gain
// on another. A pick that is accepted passes; one whose deciding figure is under z errors but at least z/2 errors gets another block
// of seeds per arm, up to `max`; below z/2 errors, or still not accepted at `max`, it fails.

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
// (a stop or the time limit ended its runs).
export async function checkPick(measure, { z, goal, block = SURE_BLOCK, max = SURE_MAX }) {
    for (let k = block; ; k += block) {
        const fresh = await measure(k);
        if (fresh === null) return null;
        const v = verdict(fresh, k, { z, goal, max });
        if (v !== 'more') return { passed: v === 'pass', fresh };
    }
}

// The greedy step's choice: `ok` is the accepted, affordable candidates in rank order; each is checked in turn (`check(c)` returns
// { passed, fresh } or null) until one passes. Returns { best, fresh, failed: [{ cand, fresh }] }, best null when none passed, or null
// when a check was stopped.
export async function firstConfirmed(ok, check) {
    const failed = [];
    for (const cand of ok) {
        const r = await check(cand);
        if (r === null) return null;
        if (r.passed) return { best: cand, fresh: r.fresh, failed };
        failed.push({ cand, fresh: r.fresh });
    }
    return { best: null, fresh: null, failed };
}
