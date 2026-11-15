// Test: a press of the what-if window's stage buttons (Accept current winner, Skip) survives Stop then Resume. The core stores each press in the search's own
// folder (presses.json, beside its runs) at the point it took effect, and a resume (the same call on the same store and folder) replays it there through the
// live press's own path, so the resumed search ends that stage at the same round with the same outcome. A new search (its own folder) reads none.
// Runs the whole search on the synthetic scenario (tools/whatif/synthetic.mjs, scenario tools/test/synthetic/scenario.json), with no page.
// Usage: node tools/test/whatif-presses.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { loadScenario, runSynthetic } = await import(pathToFileURL(path.join(root, 'tools/whatif/synthetic.mjs')).href);
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
const quiet = console.log; // the core's own log lines are not this test's output
const run = async (extra, opts) => { console.log = () => {}; try { return await runSynthetic(scenario, extra, opts); } finally { console.log = quiet; } };

// What a search got to, as the window shows it: the stage ends marked by the user, each stage's last round, the foods and drinks picks (accepted as is or
// chosen and checked), the steps and the baseline. Two searches that agree on it reached the same outcome.
const entryState = (e) => (e.unchanged ? 'unchanged' : e.acceptedAsIs ? 'accepted as is' : e.fresh ? 'chosen, checked' : 'chosen');
const view = (r) => ({
    endedByUser: r.result?.endedByUser, endedBySkip: r.result?.endedBySkip,
    rounds: Object.fromEntries([...new Set(r.rounds.map((x) => x.stage))].map((s) => [s, Math.max(...r.rounds.filter((x) => x.stage === s).map((x) => x.round))])),
    foods: Object.fromEntries(Object.entries(r.result?.best?.foods || {}).map(([p, e]) => [p, entryState(e)])),
    drinks: Object.fromEntries(Object.entries(r.result?.best?.drinks || {}).map(([p, e]) => [p, entryState(e)])),
    steps: (r.result?.steps || []).map((s) => s.id ?? (s.members || []).map((m) => m.id).join('+')),
    baselineOps: r.result?.baselineOps,
});
const same = (a, b) => JSON.stringify(view(a)) === JSON.stringify(view(b));
const diff = (a, b) => `${JSON.stringify(view(a))} | ${JSON.stringify(view(b))}`;
// The progress rows' end marks: the stage named by stageEnded, and whether it was a Skip (the window's "ended by you" on that row).
const endsSeen = () => { const m = {}; return { m, onProgress: (p) => { if (p.stageEnded) m[p.stageEnded] = !!p.stageSkipped; } }; };

// A search driven by a list of presses { stage, round, mode } on the published round records (a press on a record lands at the end of that round), stopped
// by `halt(rec)` on a record, or once the stage `haltAfter` has ended (progress.stageEnded). `prior`: the earlier call's store and folder (a resume).
async function search(extra, { presses = [], halt = null, haltAfter = null, prior = null, poolWrap } = {}) {
    let st = null;
    const ends = endsSeen();
    const r = await run(extra, {
        records: prior?.records, aux: prior?.aux, poolWrap,
        onRound: (rec, stop) => {
            st = stop;
            if (rec.provisional) return;
            for (const p of presses) if (rec.stage === p.stage && rec.round === p.round) stop.press(p.mode);
            if (halt?.(rec)) stop.requested = true;
        },
        onProgress: (p) => { ends.onProgress(p); if (haltAfter && p.stageEnded === haltAfter && st) st.requested = true; },
    });
    r.ends = ends.m;
    return r;
}
const atScreen = (rec) => rec.stage === 'screen';
const noSteps = { 'max-steps': 0 };

// ---- One press on the drinks race (the reproduction), Accept and Skip: a press, Stop, Resume ----
for (const mode of ['accept', 'skip']) {
    const r1 = await search(noSteps, { presses: [{ stage: 'drinks', round: 8, mode }], halt: atScreen });
    const r2 = await search(noSteps, { halt: atScreen, prior: r1 });
    check(`drinks ${mode}: the press is stored in the search's folder (presses.json) with its button, stage, race, round and phase`, JSON.stringify(r1.aux.get('presses.json')) === JSON.stringify([{ mode, stage: 'drinks', race: 2, round: 8, phase: 'end' }]), JSON.stringify(r1.aux.get('presses.json')));
    check(`drinks ${mode}: the first search ended the drinks stage by the press after round 8`, r1.result.endedByUser.drinks === 8 && !!r1.result.endedBySkip.drinks === (mode === 'skip'), diff(r1, r1));
    check(`drinks ${mode}: the resumed search ends the drinks stage at the same round with the same outcome (no round 9)`, same(r1, r2) && !r2.rounds.some((x) => x.stage === 'drinks' && x.round > 8), diff(r1, r2));
    check(`drinks ${mode}: the resumed progress marks the drinks row ended by you${mode === 'skip' ? ', a Skip' : ''}`, r2.ends.drinks === (mode === 'skip') && r1.ends.drinks === r2.ends.drinks, JSON.stringify([r1.ends, r2.ends]));
    check(`drinks ${mode}: the resume stores no second copy of the press`, (r2.aux.get('presses.json') || []).length === 1);
}

// ---- One press on a race of changes (the screen), Accept and Skip ----
// Round 14 of the screen: Accept takes one change there (the screen's round 15 shows one acceptable), and the screen has left a change out by its pick
// check by then (the fall-back rule ran); the search is stopped once the screen has ended.
for (const mode of ['accept', 'skip']) {
    const r1 = await search(noSteps, { presses: [{ stage: 'screen', round: 14, mode }], haltAfter: 'screen' });
    const r2 = await search(noSteps, { haltAfter: 'screen', prior: r1 });
    check(`screen ${mode}: the first search ended the screen by the press after round 14`, r1.result.endedByUser.screen === 14 && !!r1.result.endedBySkip.screen === (mode === 'skip'), diff(r1, r1));
    check(`screen ${mode}: the resumed search ends the screen at round 14 with the same outcome`, same(r1, r2) && !r2.rounds.some((x) => x.stage === 'screen' && x.round > 14), diff(r1, r2));
}

// ---- Two presses in one search (two stages), then Stop, Resume ----
{
    const presses = [{ stage: 'foods', round: 3, mode: 'skip' }, { stage: 'drinks', round: 8, mode: 'accept' }];
    const r1 = await search(noSteps, { presses, halt: atScreen });
    const r2 = await search(noSteps, { halt: atScreen, prior: r1 });
    check('two presses: both are stored, in the order they took effect', JSON.stringify((r1.aux.get('presses.json') || []).map((p) => `${p.stage} ${p.round} ${p.mode}`)) === JSON.stringify(['foods 3 skip', 'drinks 8 accept']), JSON.stringify(r1.aux.get('presses.json')));
    check('two presses: the resumed search ends both stages at the same rounds with the same outcome', r1.result.endedByUser.foods === 3 && r1.result.endedByUser.drinks === 8 && same(r1, r2), diff(r1, r2));
}

// ---- A press, Stop, Resume, Stop, Resume again ----
// The first stop comes in the drinks race (round 4), the second at the screen; the third call goes on from the second's folder.
{
    const r1 = await search(noSteps, { presses: [{ stage: 'foods', round: 3, mode: 'skip' }], halt: (rec) => rec.stage === 'drinks' && rec.round === 4 });
    const r2 = await search(noSteps, { halt: atScreen, prior: r1 });
    const r3 = await search(noSteps, { halt: atScreen, prior: r2 });
    const ref = await search(noSteps, { presses: [{ stage: 'foods', round: 3, mode: 'skip' }], halt: atScreen }); // the same press with no stop in between
    check('press, Stop, Resume, Stop, Resume: the first resume keeps the press (foods ended by you during round 4)', r2.result.endedByUser.foods === 3 && r2.result.endedBySkip.foods === true, diff(r2, r2));
    check('press, Stop, Resume, Stop, Resume: the second resume reaches what the same press reaches with no stop', same(r3, ref) && same(r2, ref), `${diff(r2, ref)} || ${diff(r3, ref)}`);
}

// ---- A press that landed during a round's runs (not at its end), then Stop, Resume ----
// The press comes from the pool, on the third finished run of the foods race's round 2: it ends the runs in flight, and the stage ends with the leaders of
// round 1 (phase 'search'). The resume skips that batch (its ended runs were never stored) and ends the stage there.
{
    let st = null, foodsRounds = 0, nRuns = 0, pressed = false;
    const wrap = (p) => ({ run: async (t) => { const r = await p.run(t); if (st && foodsRounds === 1 && !pressed && ++nRuns === 3) { pressed = true; st.press('skip'); } return r; }, drop: p.drop, kill: p.kill });
    const r1 = await run(noSteps, { poolWrap: wrap, onRound: (rec, stop) => { st = stop; if (!rec.provisional && rec.stage === 'foods') foodsRounds++; if (!rec.provisional && atScreen(rec)) stop.requested = true; } });
    const r2 = await search(noSteps, { halt: atScreen, prior: r1 });
    const stored = r1.aux.get('presses.json') || [];
    check('during a round: the press is stored with phase search, at the round it cut (2)', stored.length === 1 && stored[0].phase === 'search' && stored[0].round === 2 && stored[0].mode === 'skip' && stored[0].stage === 'foods', JSON.stringify(stored));
    check('during a round: the resumed search ends the foods stage at the same point with the same outcome', r1.result.endedByUser.foods === 1 && r1.result.endedBySkip.foods === true && same(r1, r2), diff(r1, r2));
}

// ---- A resume of a search with no press, and a new search after one with presses ----
{
    const r1 = await search(noSteps, { halt: atScreen });
    const r2 = await search(noSteps, { halt: atScreen, prior: r1 });
    check('no press: nothing is stored, and the resume reaches the same outcome with no stage ended by you', !r1.aux.has('presses.json') && !r2.aux.has('presses.json') && same(r1, r2) && Object.keys(r2.result.endedByUser).length === 0, diff(r1, r2));
    const p1 = await search(noSteps, { presses: [{ stage: 'drinks', round: 8, mode: 'accept' }], halt: atScreen });
    const fresh = await search(noSteps, { halt: atScreen, prior: { records: p1.records, aux: null } }); // a new search: the same runs reused (--cache-from), its own empty folder
    check('new search: one that reuses the runs of a search with a press reads no press (its drinks race runs past round 8, as with no press)', !fresh.result.endedByUser.drinks && same(fresh, r1) && !fresh.aux.has('presses.json'), diff(fresh, r1));
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
