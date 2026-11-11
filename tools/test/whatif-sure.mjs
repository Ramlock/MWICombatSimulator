// Test: the pick check of the greedy chain (tools/whatif/sure.mjs, wired in tools/whatif/optimize.mjs): the verdict, the extra
// seeds up to 64, a failed pick replaced by the next best, and how the optimizer wires it (seeds, tags, result fields). Generic
// fixtures only: a scripted `measure` stands in for the fresh runs, so the five cases are exact.
// Usage: node tools/test/whatif-sure.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { verdict, checkPick, firstConfirmed, confirmFillings, SURE_BLOCK, SURE_MAX } = await import(pathToFileURL(path.join(root, 'tools/whatif/sure.mjs')).href);
const { refineTrigger } = await import(pathToFileURL(path.join(root, 'tools/whatif/refine.mjs')).href);
const { joinTriggerDesc } = await import(pathToFileURL(path.join(root, 'tools/whatif/triggers.mjs')).href);
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


// firstConfirmed: onFail is called at once for each failed pick; a check may hand back the refined candidate that is shown and joins.
{
    const seen = [];
    const r = await firstConfirmed([{ id: 'A' }, { id: 'B' }], async (c) => ({ passed: c.id === 'B', fresh: { id: c.id }, cand: { id: c.id + '*' } }), (f) => seen.push(f.cand.id + '/' + f.orig.id));
    check('firstConfirmed: onFail gets the failed pick (the refined candidate and the original) as it fails; the refined one joins', seen.join() === 'A*/A' && r.best.id === 'B*' && r.orig.id === 'B' && r.failed.length === 1);
}

// Foods and drinks: each player's chosen filling is confirmed in party order, each against the baseline that holds the earlier players'.
{
    const mk = (id, player, ok = true) => ({ id, player, ops: [{ op: 'food', player, id }], est: { accepted: ok } });
    // Pool in rank order. P1: f1 passes. P2: f2a fails, f2b (next best) passes. P3: both fail: unchanged. P4: nothing accepted.
    const pool = [mk('f1', 'P1'), mk('f2a', 'P2'), mk('f3a', 'P3'), mk('f2b', 'P2'), mk('f3b', 'P3'), mk('f4', 'P4', false), mk('f2c', 'P2')];
    const passes = new Set(['f1', 'f2b']), asked = [], failed = [];
    const r = await confirmFillings(['P1', 'P2', 'P3', 'P4'], pool, [{ op: 'base' }], async (ops, c) => { asked.push(c.id + ':' + ops.map((o) => o.id ?? o.op).join('+')); return { passed: passes.has(c.id), fresh: { who: c.id } }; }, (f) => failed.push(f.cand.id));
    check('fillings: a filling that passes joins; the next player is checked against a baseline holding it', r.chosen.P1.id === 'f1' && asked[0] === 'f1:base' && asked[1] === 'f2a:base+f1');
    check('fillings: one that fails is replaced by the player\'s next best (f2b after f2a); the rest of his list is not tried', r.chosen.P2.id === 'f2b' && !asked.some((a) => a.startsWith('f2c')) && asked.includes('f2b:base+f1'));
    check('fillings: a player none of whose fillings pass is unchanged (no entry); one with nothing accepted is never checked', !('P3' in r.chosen) && !('P4' in r.chosen) && !asked.some((a) => a.startsWith('f4')) && asked.filter((a) => a.startsWith('f3')).length === 2);
    check('fillings: the failed ones are reported as they fail, in order; the ops of the confirmed ones make the new baseline in party order', failed.join() === 'f2a,f3a,f3b' && JSON.stringify(r.baseOps.map((o) => o.id ?? o.op)) === JSON.stringify(['base', 'f1', 'f2b']) && r.fresh.P2.who === 'f2b');
    check('fillings: a stop ends the stage: null', await confirmFillings(['P1'], [mk('x', 'P1')], [], async () => null) === null);
}

// A trigger moved twice: refined before it joins, one row (200 -> 3000), confirmed as one change.
{
    // Candidates are { id, desc, ops, est:{accepted} }. The pick is 200 -> 4600. Round 1 offers 4600 -> 3000 (accepted) and 4600 -> 5200 (not);
    // round 2 (from 3000) offers 3000 -> 3400 (not accepted): the refinement ends.
    const cand = (id, desc, accepted, score = 1) => ({ id, kind: 'trigger', player: 'P', desc, ops: [{ op: 'trigger', id }], est: { accepted, score } });
    const first = cand('t0', 'P rain trigger: all_enemies current_hp >= 200 -> 4600', true);
    const rounds = [[cand('t1', 'P rain trigger: all_enemies current_hp >= 4600 -> 3000', true), cand('t1b', 'P rain trigger: all_enemies current_hp >= 4600 -> 5200', false)], [cand('t2', 'P rain trigger: all_enemies current_hp >= 3000 -> 3400', false)]];
    const log = []; let round = 0;
    const out = await refineTrigger(first, {
        locals: (cur) => { log.push('locals ' + cur.id); return rounds[round++] || []; },
        judge: async (cur, list) => { log.push('judge ' + cur.id + ' x' + list.length); return list; },
        rank: (a, b) => b.est.score - a.est.score,
        join: (cur, next) => ({ ...next, desc: joinTriggerDesc(cur.desc, next.desc), est: undefined }),
    });
    check('trigger refined: one candidate, the owner\'s trigger from its value in the chain to its final value', out.desc === 'P rain trigger: all_enemies current_hp >= 200 -> 3000' && out.id === 't1' && out.ops[0].id === 't1', out.desc);
    check('trigger refined: rounds run until none is accepted (the pick, then 4600, then 3000)', log.join(' | ') === 'locals t0 | judge t0 x2 | locals t1 | judge t1 x1', log.join(' | '));
    const same = await refineTrigger(first, { locals: () => [], judge: async () => { throw new Error('no runs'); }, rank: () => 0, join: () => { throw new Error('no join'); } });
    check('trigger refined: nothing to try, or none accepted: the pick as it was', same === first && await refineTrigger(first, { locals: () => [cand('x', 'x', false)], judge: async (c, l) => l, rank: () => 0, join: () => { throw new Error('no join'); } }) === first);
    check('trigger refined: a stop in the runs ends it: null', await refineTrigger(first, { locals: () => [cand('x', 'x', true)], judge: async () => null, rank: () => 0, join: () => null }) === null);
}

// How the optimizer wires it.
const opt = fs.readFileSync(path.join(root, 'tools/whatif/optimize.mjs'), 'utf8');
check('optimizer: fresh seeds start above the final confirmation\'s block (10001..20000)', /const sureOffset = confirmOffset \+ 10000;/.test(opt) && /sureSeeds = \(k\) => Array\.from\(\{ length: k \}, \(_, i\) => sureOffset \+ i \+ 1\)/.test(opt) && /hi = fresh \? sureOffset : confirmOffset/.test(opt));
check('optimizer: both arms on the same fresh seeds, tagged sure', /\{ ops: baseOps, seed, h: fin\.h, tag: 'sure' \}, \{ ops: vOps, seed, h: fin\.h, tag: 'sure' \}/.test(opt));
check('optimizer: the greedy step takes the first confirmed pick; failures go to notConfirmed with their step as they fail, and leave the finalists', /firstConfirmed\(ok, checkPickAt, /.test(opt) && /confirmPick\(baseOps, cand, fin, label\)/.test(opt) && /result\.notConfirmed\.push\(\{ \.\.\.row\(cand\), step: step \+ 1, fresh \}\)/.test(opt) && /finalists = finalists\.filter\(\(f\) => f !== orig\)/.test(opt));
check('optimizer: a trigger pick is refined before it is confirmed (refineTrigger), measured as one change against the chain, and nothing merges at the end', /cand = await refineAt\(baseOps, c, fin, visitedFor\(c\)\)/.test(opt) && /cand\.est = estimate\(baseOps, cand, fin/.test(opt) && !/mergeTriggerSteps/.test(opt) && !/if \(best\.kind === 'trigger'\) finalists\.push/.test(opt));
check('optimizer: foods and drinks are confirmed per player on fresh seeds (confirmFillings); failures go to notConfirmed with kind food or drink, and best carries the fresh reading', /confirmFillings\(players, fpool, baseOps, /.test(opt) && /result\.notConfirmed\.push\(\{ \.\.\.row\(cand\), step: null, kind: flag, fresh \}\)/.test(opt) && /bestEntry\(kind, after\.find\(\(s\) => s\.name === p\), chosen\[p\], got\.fresh\[p\]\)/.test(opt) && !/bestPerPlayer/.test(opt));
check('optimizer: a step carries its fresh reading; result.steps is pushed to in one place', /result\.steps\.push\(\{ \.\.\.row\(best\), fresh: bestFresh,/.test(opt) && (opt.match(/result\.steps\.push\(/g) || []).length === 1);
check('optimizer: five snapshot points (foods and drinks, candidates priced, last halving, a step, a failed pick), all through publish, one snapshot function', (opt.match(/publish\(result\);/g) || []).length === 5 && /process\.send\(\{ type: 'partial', result: snapshot\(result\) \}\)/.test(opt) && (opt.match(/function snapshot\(/g) || []).length === 1);
check('optimizer: the progress counts distinct runs once, a cached run done at once, picksPlanned and picksDone in the progress', /sure\.counted\.has\(id\)/.test(opt) && /if \(cache\.get\(id\)\?\.byHours\[r\.h\]\) sure\.done\+\+/.test(opt) && /if \(t\.tag === 'sure'\) sure\.done\+\+/.test(opt) && /progress\.picksPlanned = sure\.planned/.test(opt));
check('optimizer: the final confirmation block is unchanged (original base, seeds 10001.., tag confirm)', /pick\(\[\], fin\.h, fin\.k \* baseMult, true\), vs = pick\(baseOps, fin\.h, fin\.k, true\)/.test(opt));

process.exit(failed ? 1 : 0);
