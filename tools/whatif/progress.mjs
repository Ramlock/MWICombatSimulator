// The what-if search's progress as stacked parts (one row per part of the search). Pure: `createParts(plan)` returns a
// tracker; `sync(progress)` takes the optimizer's progress object (its `stage` string, runs and eta) and returns the
// array of parts for progress.json and the runner.
//
// plan: { stages: [{ k, h }], keep: [n, ...], candidates: n, maxSteps: n } (candidates = the pool entering the screen).
// Every bar is there from the start: the screen, one halving per further stage, a grey 'steps' row (up to maxSteps
// greedy steps) and a grey 'confirmation' row. The waiting halvings carry `runsUpTo` (the pool they would get times
// their seeds; a cached run is not counted, so the real count can be lower). When greedy step k starts it takes the
// 'steps' row's place; a grey 'moreSteps' row ({ stepsLeft: maxSteps - k }, hidden at 0 and once the confirmation has
// started) follows the steps and stays above the grey confirmation. Rows are added as steps start, so the count grows.
// With plan.fillings (the consumables lever on) two parts come first: 'foods' and 'drinks' (Stage F and Stage D, each its
// own three halvings run as one part; the runner reports stage 'foods' / 'drinks' and the part shows the current batch).
// A part: { kind: 'foods'|'drinks'|'screen'|'halving'|'steps'|'step'|'moreSteps'|'confirmation', index, state: 'waiting'|'running'|
// 'done', runsPlanned, runsDone, runsUpTo (waiting halving), candidatesLeft, etaSeconds, maxSteps ('steps'),
// stepsLeft ('moreSteps'), and on a part of a race stage: round, phase ('search' | 'reading'), contending, paused, dropped, simHours
// (the stage's counters: runs and simHours are cumulative over the stage, dropped never falls; contending and paused are the last finished
// round's and may rise and fall, so the window shows them as numbers). A part with a round has no bar: a race stage has no known total. }. A stop leaves the running part running: the rows stay as they were.

export function createParts(plan) {
    const { stages, keep = [], maxSteps, fillings = false } = plan;
    // Pool entering each stage: the screen gets every candidate, each halving at most the survivors of the one before. A cut keeps
    // "keep" free AND "keep" paid candidates, so up to twice "keep" enter the next stage. Unknown until setCandidates (the rest of the
    // search is built on the foods and drinks Stages F and D choose).
    const poolsOf = () => {
        const pools = [];
        let pool = plan.candidates;
        for (let si = 0; si < stages.length; si++) {
            pools.push(pool);
            if (si < stages.length - 1) pool = pool == null ? null : Math.min(pool, 2 * (keep[si] ?? pool));
        }
        return pools;
    };
    // The part "Confirming the picks" (optimize.mjs confirmPick): one row for the whole greedy phase, its runs counted by the optimizer
    // as distinct runs (progress.picksPlanned / picksDone, never dropping): running while a pick is being checked, grey between two
    // checks, done once the confirmation starts or the search ends. Not a row of `rows`: it comes back to running at every step.
    const picks = { started: false, state: 'waiting', runsPlanned: 0, runsDone: 0, fill: 0 };
    const rows = []; // started parts, in order: { kind, index, runsPlanned, runsDone, candidatesLeft, etaSeconds, state }
    const parse = (stage) => {
        if (stage === 'screen') return { kind: 'screen', index: 0 };
        if (fillings && (stage === 'foods' || stage === 'drinks')) return { kind: stage, index: 0 };
        let m = /^halving (\d+)$/.exec(stage);
        if (m) return { kind: 'halving', index: Number(m[1]) };
        m = /^greedy step (\d+)$/.exec(stage);
        if (m) return { kind: 'step', index: Number(m[1]) };
        if (stage === 'confirmation') return { kind: 'confirmation', index: 0 };
        return null;
    };
    const sameRow = (r, k) => r.kind === k.kind && r.index === k.index;
    return {
        setCandidates(n) { plan.candidates = n; },
        sync(progress) {
            const key = parse(progress.stage), confirming = progress.stage === 'confirming picks';
            if (progress.picksPlanned !== undefined) {
                picks.started = true;
                picks.runsPlanned = Math.max(picks.runsPlanned, progress.picksPlanned);
                picks.runsDone = Math.min(picks.runsPlanned, Math.max(picks.runsDone, progress.picksDone ?? 0));
                picks.fill = Math.max(picks.fill, picks.runsPlanned > 0 ? picks.runsDone / picks.runsPlanned : 0); // never goes back, as a part's
            }
            if (confirming) { for (const r of rows) r.state = 'done'; picks.state = 'running'; }
            else if (progress.stage === 'confirmation' || progress.stage === 'done') { if (picks.started) picks.state = 'done'; }
            else if (key && picks.started) picks.state = 'waiting';
            if (progress.stage === 'done') for (const r of rows) r.state = 'done';
            else if (key) {
                for (const r of rows) if (!sameRow(r, key)) r.state = 'done';
                let row = rows.find((r) => sameRow(r, key));
                if (!row) { row = { ...key, state: 'running', runsPlanned: 0, runsDone: 0, candidatesLeft: null, etaSeconds: null }; rows.push(row); }
                row.state = 'running';
                row.runsPlanned = progress.runsPlanned ?? 0;
                row.runsDone = progress.runsDone ?? 0;
                row.candidatesLeft = progress.candidatesLeft ?? null;
                row.etaSeconds = progress.etaSeconds ?? null;
                // The bar of a part never goes back: a part that runs several batches (each batch restarts its own counts) or whose planned runs grow
                // keeps the highest fraction it has shown (`fill`, 0 to 1); the panel draws the bar from it.
                row.fill = Math.max(row.fill ?? 0, row.runsPlanned > 0 ? Math.min(1, row.runsDone / row.runsPlanned) : 0);
                // The round being run, its phase ('search' | 'reading') and the stage's own totals (see race() in core.mjs): carried only
                // when the stage reports a round, so a part of an older run keeps its shape.
                if (progress.round !== undefined) Object.assign(row, { round: progress.round, phase: progress.phase, contending: progress.stageContending, paused: progress.stagePaused, dropped: progress.stageDropped, runs: progress.stageRuns, simHours: progress.stageSimHours });
            }
            // 'stopped', 'probe' and 'start' change no row.
            for (const r of rows) if (r.state === 'done') { r.runsDone = r.runsPlanned; r.etaSeconds = 0; }
            const out = [];
            if (fillings) for (const kind of ['foods', 'drinks']) {
                const r = rows.find((x) => x.kind === kind);
                out.push(r ? { ...r } : { kind, index: 0, state: 'waiting', runsPlanned: 0, runsDone: 0, candidatesLeft: null, etaSeconds: null });
            }
            for (let si = 0; si < stages.length; si++) {
                const kind = si === 0 ? 'screen' : 'halving';
                const r = rows.find((x) => x.kind === kind && x.index === si);
                out.push(r ? { ...r } : waiting(kind, si, poolsOf()[si], stages[si].k));
            }
            if (picks.state === 'done') picks.runsDone = picks.runsPlanned;
            out.push({ kind: 'picks', index: 0, state: picks.state, runsPlanned: picks.runsPlanned, runsDone: picks.runsDone, fill: picks.fill, etaSeconds: picks.state === 'running' ? (progress.etaSeconds ?? null) : picks.state === 'done' ? 0 : null });
            const steps = rows.filter((r) => r.kind === 'step'), conf = rows.find((r) => r.kind === 'confirmation');
            if (!steps.length) out.push({ kind: 'steps', index: 0, state: 'waiting', maxSteps });
            for (const r of steps) out.push({ ...r });
            const k = steps.length ? steps[steps.length - 1].index : 0, more = maxSteps - k;
            if (steps.length && more > 0 && !conf) out.push({ kind: 'moreSteps', index: k, state: 'waiting', stepsLeft: more });
            out.push(conf ? { ...conf } : { kind: 'confirmation', index: 0, state: 'waiting' });
            return out;
        },
    };
    function waiting(kind, index, poolSize, seeds) {
        return { kind, index, state: 'waiting', runsPlanned: 0, runsDone: 0, ...(poolSize == null ? {} : { runsUpTo: poolSize * seeds }), candidatesLeft: poolSize ?? null, etaSeconds: null };
    }
}
