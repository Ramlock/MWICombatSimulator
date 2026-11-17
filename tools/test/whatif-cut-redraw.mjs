// Test: the what-if window follows a round's cut at once (row 155, defects 4 and 5). When a round's runs are in, the elimination rule rules changes out
// (core.mjs race: eliminate), then the leaders are checked (the reading phase, which can take minutes). From the cut on: the progress record's "In the
// running" and "Set aside" (stageContending, stagePaused) are that round's counts, so they add up with "Ruled out" (stageDropped, counted live); and in
// round 1 the first look goes out again with only the changes still standing, so the table drops the ones ruled out before the leaders' check.
// Runs one search on the synthetic scenario (tools/whatif/synthetic.mjs, scenario tools/test/synthetic/scenario.json), up to the first record of Change 1.
// Usage: node tools/test/run-tests.mjs whatif-cut-redraw.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { loadScenario, runSynthetic } = await import(pathToFileURL(path.join(root, 'tools/whatif/synthetic.mjs')).href);
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));

// Every progress message and round record, in the order the core sent them.
const events = [];
const quiet = console.log; // the core's own log lines are not this test's output
console.log = () => {};
try {
    await runSynthetic(scenario, { 'max-steps': 0 }, {
        onRound: (rec, stop) => { events.push({ rec }); if (!rec.provisional && rec.stage === 'screen') stop.requested = true; },
        onProgress: (p) => events.push({ p }),
    });
} finally { console.log = quiet; }

const records = events.map((e, i) => ({ ...e, i })).filter((e) => e.rec && !e.rec.provisional);
check('the search sent round records of more than one stage', new Set(records.map((e) => e.rec.stage)).size >= 2, JSON.stringify([...new Set(records.map((e) => e.rec.stage))]));

// (4) Between the cut and the round's record, the progress carries that round's counts: every reading-phase message of a round has the record's
// In the running and Set aside, and In the running + Set aside + Ruled out is no more than the stage's candidates.
let compared = 0, moved = 0, bad = [];
for (const { rec, i } of records) {
    const same = (p) => p.stage === rec.stage && p.round === rec.round;
    const msgs = events.slice(0, i).filter((e) => e.p && same(e.p));
    const roundStart = msgs.find((e) => e.p.phase === 'search')?.p, reading = msgs.filter((e) => e.p.phase === 'reading').map((e) => e.p);
    for (const p of reading) {
        compared++;
        if (roundStart && roundStart.stageContending !== rec.candidates.contending) moved++;
        if (p.stageContending !== rec.candidates.contending || p.stagePaused !== rec.candidates.paused || p.stageContending + p.stagePaused + p.stageDropped > p.stageCandidates) bad.push({ stage: rec.stage, round: rec.round, cont: p.stageContending, paused: p.stagePaused, dropped: p.stageDropped, total: p.stageCandidates, recCont: rec.candidates.contending, recPaused: rec.candidates.paused });
    }
}
check(`while the leaders are checked, In the running and Set aside are the round's own counts and add up with Ruled out (${compared} reading-phase messages, ${moved} after a round whose cut changed the count)`, compared > 0 && moved > 0 && bad.length === 0, JSON.stringify(bad.slice(0, 5)));

// (5) Round 1 of a race whose cut ruled changes out: a first look goes out after the cut (after the first progress message that counts the ruled-out
// changes), and it holds only the changes still standing (its total is the stage's candidates less those ruled out).
let cutStages = 0; bad = [];
for (const { rec, i } of records.filter((e) => e.rec.round === 1 && e.rec.candidates.out > 0)) {
    cutStages++;
    const before = events.slice(0, i).map((e, j) => ({ ...e, j }));
    const cutMsg = before.find((e) => e.p && e.p.stage === rec.stage && e.p.round === 1 && e.p.stageDropped >= rec.candidates.out);
    const look = before.filter((e) => e.rec && e.rec.provisional && e.rec.stage === rec.stage && e.rec.round === 1).pop();
    const shown = look ? look.rec.pools.reduce((a, p) => a + p.leaders.length, 0) : -1;
    if (!cutMsg || !look || look.j < cutMsg.j || look.rec.firstLook.total !== cutMsg.p.stageCandidates - cutMsg.p.stageDropped || shown > look.rec.firstLook.total)
        bad.push({ stage: rec.stage, out: rec.candidates.out, cutAt: cutMsg?.j ?? null, lookAt: look?.j ?? null, lookTotal: look?.rec.firstLook.total ?? null, standing: cutMsg ? cutMsg.p.stageCandidates - cutMsg.p.stageDropped : null, shown });
}
check(`round 1: after the cut the first look goes out again with only the changes still standing (${cutStages} stages whose round 1 ruled changes out)`, cutStages > 0 && bad.length === 0, JSON.stringify(bad));

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
