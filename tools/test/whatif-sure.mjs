// Test: the pick check of the greedy chain (tools/whatif/sure.mjs, wired in tools/whatif/optimize.mjs): the verdict, the extra
// seeds up to 64, a failed pick replaced by the next best, and how the optimizer wires it (seeds, tags, result fields). Generic
// fixtures only: a scripted `measure` stands in for the fresh runs, so the five cases are exact.
// Usage: node tools/test/whatif-sure.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { verdict, checkPick, firstConfirmed, SURE_BLOCK, SURE_MAX } = await import(pathToFileURL(path.join(root, 'tools/whatif/sure.mjs')).href);
const { acceptBoth } = await import(pathToFileURL(path.join(root, 'tools/whatif/buyer.mjs')).href);
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const z = 2, goal = 'profit';
// A reading with the buyer's net at `n` errors (error 100) and the party gain at `g` errors, accepted by the search's own rule.
const reading = (n, g = 0, k = 16) => ({ seeds: k, gain: g * 100, se: 100, buyerNet: n * 100, buyerNetSe: 100, accepted: acceptBoth(g * 100, 100, n * 100, 100, z) });

check('block and ceiling are 16 and 64', SURE_BLOCK === 16 && SURE_MAX === 64);
check('verdict: the buyer at 2 errors passes', verdict(reading(2.5), 16, { z, goal }) === 'pass' && verdict(reading(2), 16, { z, goal }) === 'pass');
check('verdict: the party alone at 2 errors passes when the buyer is not a clear loss (the search\'s own rule)', verdict(reading(0, 2.2), 16, { z, goal }) === 'pass' && verdict(reading(-1.5, 2.2), 16, { z, goal }) === 'fail');
check('verdict: the buyer under 1 error fails at once', verdict(reading(0.9), 16, { z, goal }) === 'fail' && verdict(reading(-3), 16, { z, goal }) === 'fail');
check('verdict: the buyer between 1 and 2 errors asks for more seeds', verdict(reading(1), 16, { z, goal }) === 'more' && verdict(reading(1.9), 32, { z, goal }) === 'more');
check('verdict: still between 1 and 2 errors at 64 seeds fails', verdict(reading(1.9), 64, { z, goal }) === 'fail');
check('verdict: no error and no gain fails (nothing to confirm)', verdict({ accepted: false, gain: 0, se: 0, buyerNet: 0, buyerNetSe: 0 }, 16, { z, goal }) === 'fail');
check('verdict: another goal decides on the party gain', verdict({ accepted: false, gain: 150, se: 100, buyerNet: 9999, buyerNetSe: 1 }, 16, { z, goal: 'exp' }) === 'more' && verdict({ accepted: true, gain: 250, se: 100 }, 16, { z, goal: 'exp' }) === 'pass');
check('verdict: z moves both bounds (z 4: 2 to 4 errors is the band)', verdict({ ...reading(3), accepted: false }, 16, { z: 4, goal }) === 'more' && verdict({ ...reading(1.9), accepted: false }, 16, { z: 4, goal }) === 'fail');

// Scripted measures: the reading by seeds per arm. calls records the seeds asked.
const script = (byK) => { const calls = []; return { calls, measure: async (k) => { calls.push(k); return byK[k] ?? byK.default; } }; };
{
    const s = script({ 16: reading(3) });
    const r = await checkPick(s.measure, { z, goal });
    check('case 1, passes: 16 seeds, joins, one measurement', r.passed && r.fresh.seeds === 16 && s.calls.join() === '16', JSON.stringify(s.calls));
}
{
    const s = script({ 16: reading(0.4) });
    const r = await checkPick(s.measure, { z, goal });
    check('case 2, fails at once: below 1 error, 16 seeds only', !r.passed && s.calls.join() === '16');
}
{
    const s = script({ 16: reading(1.4, 0, 16), 32: reading(1.7, 0, 32), 48: reading(2.3, 0, 48) });
    const r = await checkPick(s.measure, { z, goal });
    check('case 3, more seeds then passes: 16, 32 and 48 seeds per arm', r.passed && r.fresh.seeds === 48 && s.calls.join() === '16,32,48', JSON.stringify(s.calls));
}
{
    const s = script({ default: reading(1.5) });
    const r = await checkPick(s.measure, { z, goal });
    check('case 4, still under 2 errors at 64 seeds fails: 16, 32, 48, 64', !r.passed && s.calls.join() === '16,32,48,64', JSON.stringify(s.calls));
}
{
    const s = script({ 16: reading(1.5), 32: reading(0.5) });
    const r = await checkPick(s.measure, { z, goal });
    check('a pick that falls below 1 error at 32 seeds fails there', !r.passed && s.calls.join() === '16,32');
}
check('a stop ends the check: null', await checkPick(async () => null, { z, goal }) === null);

// Case 5: the best pick fails, the next best is tried, the failed one is listed.
{
    const by = { A: [reading(0.2)], B: [reading(1.5), reading(2.4)], C: [reading(3)] };
    const asked = [];
    const one = async (c) => { asked.push(c.id); const seq = by[c.id]; let i = 0; return checkPick(async () => seq[Math.min(i++, seq.length - 1)], { z, goal }); };
    const r = await firstConfirmed([{ id: 'A' }, { id: 'B' }, { id: 'C' }], one);
    check('case 5, replaced: A fails, B (after more seeds) joins, C is not tried', r.best.id === 'B' && r.failed.map((f) => f.cand.id).join() === 'A' && asked.join() === 'A,B', asked.join());
    check('case 5: the failed pick keeps its fresh reading', r.failed[0].fresh.buyerNet === 20 && r.fresh.buyerNet === 240);
    const none = await firstConfirmed([{ id: 'A' }, { id: 'A2' }], async () => ({ passed: false, fresh: reading(0) }));
    check('every pick fails: none joins, all listed, the chain ends', none.best === null && none.failed.length === 2);
    check('a stop in a check ends the choice: null', await firstConfirmed([{ id: 'A' }], async () => null) === null);
    check('nothing accepted: an empty choice', (await firstConfirmed([], async () => { throw new Error('no'); })).best === null);
}

// How the optimizer wires it.
const opt = fs.readFileSync(path.join(root, 'tools/whatif/optimize.mjs'), 'utf8');
check('optimizer: fresh seeds start above the final confirmation\'s block (10001..20000)', /const sureOffset = confirmOffset \+ 10000;/.test(opt) && /sureSeeds = \(k\) => Array\.from\(\{ length: k \}, \(_, i\) => sureOffset \+ i \+ 1\)/.test(opt) && /hi = fresh \? sureOffset : confirmOffset/.test(opt));
check('optimizer: both arms on the same fresh seeds, tagged sure', /\{ ops: baseOps, seed, h: fin\.h, tag: 'sure' \}, \{ ops: vOps, seed, h: fin\.h, tag: 'sure' \}/.test(opt));
check('optimizer: the greedy step takes the first confirmed pick; failures go to notConfirmed with their step', /firstConfirmed\(ok, \(c\) => confirmPick\(baseOps, c, fin, step \+ 1\)\)/.test(opt) && /result\.notConfirmed\.push\(\{ \.\.\.row\(cand\), step: step \+ 1, fresh \}\)/.test(opt) && /finalists = finalists\.filter\(\(f\) => f !== cand\)/.test(opt));
check('optimizer: a step carries its fresh reading, the merged step its own', /result\.steps\.push\(\{ \.\.\.row\(best\), fresh: bestFresh,/.test(opt) && /steps\[i\] = \{ \.\.\.row\(cand\), fresh: chk\.fresh,/.test(opt));
check('optimizer: the progress counts distinct runs once, a cached run done at once, picksPlanned and picksDone in the progress', /sure\.counted\.has\(id\)/.test(opt) && /if \(cache\.get\(id\)\?\.byHours\[r\.h\]\) sure\.done\+\+/.test(opt) && /if \(t\.tag === 'sure'\) sure\.done\+\+/.test(opt) && /progress\.picksPlanned = sure\.planned/.test(opt));
check('optimizer: the final confirmation block is unchanged (original base, seeds 10001.., tag confirm)', /pick\(\[\], fin\.h, fin\.k \* baseMult, true\), vs = pick\(baseOps, fin\.h, fin\.k, true\)/.test(opt));

process.exit(failed ? 1 : 0);
