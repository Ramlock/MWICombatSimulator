// Test: a winner that fails its pick check brings back what only it had put out (rounds.mjs reopen, core.mjs race fallBack), recursively, in every stage.
// Two parts: the rule on hand-made pools (pure), and whole searches on the synthetic pool (tools/whatif/synthetic.mjs): a foods stage whose search-seed
// winner fails its check and the filling it had put out passes, a Change stage, and a stop and resume across a failed check.
// Usage: node tools/test/run-tests.mjs whatif-fallback.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const R = await imp('tools/whatif/rounds.mjs');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

// ---- Part 1: the rule (pure) ----
const goal = 'profit';
const cand = (id, net, se, extra = {}) => ({ id, desc: id, player: 'A', cost: { cost: 0 }, monotone: false, est: { net, netSe: se, gain: net, se }, ...extra });
const O = (extra = {}) => ({ goal, mult: 3, bars: new Map(), ...extra });
const outs = (list) => list.map((c) => `${c.id}:${c.out ?? '-'}`).join(' ');
check('reopen exists', typeof R.reopen === 'function');
const reopen = (list, f, o = O()) => { f.refuted = true; return typeof R.reopen === 'function' ? R.reopen(list, f, o) : []; };
{
    // w 100 +- 3 puts out r (80 +- 3: 83 < 97); l (-50) is below the current setup.
    const w = cand('w', 100, 1), r = cand('r', 80, 1), l = cand('l', -50, 1), list = [w, r, l];
    R.eliminate(list, O());
    check('setup: the winner puts out the runner-up, the current setup puts out the loser', r.out === 'beaten' && l.out === 'beaten' && !w.out, outs(list));
    const back = reopen(list, w);
    check('winner fails: the runner-up only it had put out comes back', back.length === 1 && back[0] === r && !r.out, outs(list));
    check('winner fails: a change below the current setup stays out', l.out === 'beaten', outs(list));
    const pools = R.eliminate(list, O());
    check('winner fails: the next elimination has the runner-up standing as the pool\'s last candidate', pools[0].changes.length === 1 && pools[0].changes[0] === r && !pools[0].noChange, outs(list));
}
{
    // Recursive: w1 100, w2 90, w3 80 (+- 3 each): w1 puts out w2 and w3, w2 also puts out w3.
    const w1 = cand('w1', 100, 1), w2 = cand('w2', 90, 1), w3 = cand('w3', 80, 1), list = [w1, w2, w3];
    R.eliminate(list, O());
    let back = reopen(list, w1);
    check('recursive: the first winner fails, the second comes back; the third, also put out by the second, stays out', back.map((c) => c.id).join() === 'w2' && w3.out === 'beaten', outs(list));
    back = reopen(list, w2);
    check('recursive: the second winner fails, the third comes back', back.map((c) => c.id).join() === 'w3' && !w3.out, outs(list));
    back = reopen(list, w3);
    const pools = R.eliminate(list, O());
    check('recursive: the third fails too, none left: no change stands (the race reads the pool as no change)', back.length === 0 && pools.every((q) => q.changes.length === 0), JSON.stringify(pools));
}
{
    // A change another standing change still beats stays out: s 95 +- 3 (92..98) stands beside w (97..103); r 80 is below both.
    const w = cand('w', 100, 1), s = cand('s', 95, 1), r = cand('r', 80, 1), list = [w, s, r];
    R.eliminate(list, O());
    const back = reopen(list, w);
    check('another standing change still beats it: it stays out', back.length === 0 && r.out === 'beaten' && !s.out, outs(list));
}
{
    // A cut by the bar (upper end under 1% of the player's profit) or by the payback limit is never lifted.
    const bars = new Map([['A', 10]]), w = cand('w', 100, 1), b = cand('b', 5, 1), p = cand('p', 50, 1, { cost: { cost: 100000 } }), list = [w, b, p];
    R.eliminate(list, O({ bars, payLimit: 365 }));
    const back = reopen(list, w, O({ bars, payLimit: 365 }));
    check('a cut by the bar or the payback limit stays', back.length === 0 && b.out === 'bar' && p.out === 'payback', outs(list));
}
{
    // A tied change comes back with the rest; another player's pool is not reopened (byPlayer).
    const bars = new Map([['A', 10], ['B', 10]]), w = cand('w', 100, 1), t = cand('t', 98, 1), r = cand('r', 80, 1), bw = cand('bw', 100, 1, { player: 'B' }), br = cand('br', 80, 1, { player: 'B' }), list = [w, t, r, bw, br];
    R.eliminate(list, O({ bars, byPlayer: true, order: ['A', 'B'] }));
    check('setup: t tied with w, r and br beaten', t.out === 'tied' && r.out === 'beaten' && br.out === 'beaten', outs(list));
    const back = reopen(list, w, O({ bars, byPlayer: true, order: ['A', 'B'] }));
    check('a tied change comes back; one the tied change itself beats stays out', back.map((c) => c.id).join() === 't' && r.out === 'beaten', outs(list));
    check('another player\'s pool is not reopened', br.out === 'beaten' && !bw.refuted, outs(list));
}

// ---- Part 2: whole searches on the synthetic pool ----
const { loadScenario, runSynthetic } = await imp('tools/whatif/synthetic.mjs');
const base = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
// The core's log goes to console.log: kept here, not printed.
const quiet = async (f) => { const lines = [], orig = console.log; console.log = (...a) => { lines.push(a.join(' ')); }; try { return { res: await f(), log: lines.join('\n') }; } finally { console.log = orig; } };
// The foods stage: Alice's strawberry cake reads far better on the search seeds than it is (searchBonus), so every filling with it wins her race and fails
// its check (a real loss of 90K, more than any other food in the filling makes up); her orange gummy is a real gain (above her bar) that the cake fillings had put out.
const foods = structuredClone(base);
foods.request.levers = ['foods'];
foods.effects = foods.effects.map((e) => (e.match.op === 'food' && e.match.player === 'Alice' && e.match.item === '/items/strawberry_cake' ? { ...e, loot: -90000, supplies: 0, searchBonus: 300000 }
    : e.match.op === 'food' && e.match.player === 'Alice' && e.match.item === '/items/orange_gummy' ? { ...e, loot: 40000 } : e));
const alice = (res) => res.result.best.foods.Alice;
const items = (entry) => (entry?.items || []).map((x) => x.item);
const { res: runF, log: logF } = await quiet(() => runSynthetic(foods, { 'max-steps': 0 }));
const nc = runF.result.notConfirmed.filter((x) => x.player === 'Alice' && x.kind === 'food');
check('foods: the cake fillings fail their check and are listed as not confirmed, each with what came back after it (back)', nc.length > 0 && nc.every((x) => Array.isArray(x.back)) && nc.some((x) => x.back.length > 0), JSON.stringify(nc.map((x) => [x.desc, x.back])));
check('foods: a gummy filling the cake had put out comes back and passes: Alice gets it', !alice(runF).unchanged && items(alice(runF)).includes('/items/orange_gummy') && !items(alice(runF)).includes('/items/strawberry_cake'), JSON.stringify(alice(runF)));
check('foods: the log names what came back and after which failed check', /foods: Alice food: .*strawberry_cake.* left out by its pick check; back in the race: Alice food: /.test(logF), logF.split('\n').filter((l) => /pick check/.test(l)).slice(0, 4).join(' | '));
// A stop in the middle (the first round after a failed check, with candidates back in the race; the stopped result holds only the race's live best, soFar),
// then a resume from the recorded runs: the same result.
let stopped = false;
const { res: part } = await quiet(() => runSynthetic(foods, { 'max-steps': 0 }, { onRound: (rec, stop) => { if (!stopped && rec.stage === 'foods' && rec.candidates.refuted > 0) { stopped = true; stop.requested = true; } } }));
const { res: resumed } = await quiet(() => runSynthetic(foods, { 'max-steps': 0 }, { records: part.records }));
const sig = (res) => JSON.stringify({ best: res.result.best.foods, nc: res.result.notConfirmed.map((x) => [x.id, x.back]) });
check('stop and resume across a failed check: the stop came after one, and the resumed search walks to the same result as the uninterrupted one', stopped && (!part.result.best.foods.Alice || part.result.best.foods.Alice.soFar) && sig(resumed) === sig(runF), (() => { const a = sig(resumed), b = sig(runF); let i = 0; while (i < a.length && a[i] === b[i]) i++; return `${stopped} at ${i}: ${a.slice(i - 150, i + 150)} || ${b.slice(i - 150, i + 150)}`; })());
// A Change stage (the default scenario: Bob's body +2 reads far better on the search seeds than it is): a step winner that fails brings back what it had put out.
const { res: runC } = await quiet(() => runSynthetic(base, {}));
const ncC = runC.result.notConfirmed.filter((x) => x.step !== null && x.step !== undefined);
const backIds = new Set(ncC.flatMap((x) => (x.back || []).map((b) => b.id)));
check('Change stage: a failed winner lists what came back (back), and one that came back is later confirmed as a step', ncC.some((x) => x.back?.length > 0) && runC.result.steps.some((s) => backIds.has(s.id)), JSON.stringify({ back: [...backIds], steps: runC.result.steps.map((s) => s.id) }));

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
