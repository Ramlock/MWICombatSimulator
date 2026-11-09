// The what-if search's progress as stacked parts (one row per part of the search): the screen, each halving, each
// greedy step and the confirmation. Pure: `createParts(plan)` returns a tracker; `sync(progress)` takes the optimizer's
// progress object (its `stage` string, runs and eta) and returns the array of parts for progress.json and the runner.
//
// plan: { stages: [{ k, h }], keep: [n, ...], candidates: n } (candidates = the pool entering the screen).
// Known at the start: the screen and one halving per further stage, the waiting ones with `runsUpTo` (the pool they
// would get times their seeds; a cached run is not counted, so the real count can be lower). Greedy steps and the
// confirmation are added when they start. A part: { kind: 'screen'|'halving'|'step'|'confirmation', index,
// state: 'waiting'|'running'|'done', runsPlanned, runsDone, runsUpTo (waiting only), candidatesLeft, etaSeconds }.
// A stop leaves the running part running: the rows stay as they were.

export function createParts(plan) {
    const { stages, keep = [], candidates } = plan;
    // Pool entering each stage: the screen gets every candidate, each halving the survivors of the one before.
    const pools = [];
    let pool = candidates;
    for (let si = 0; si < stages.length; si++) {
        pools.push(pool);
        if (si < stages.length - 1) pool = Math.min(pool, keep[si] ?? pool);
    }
    const rows = []; // started parts, in order: { kind, index, runsPlanned, runsDone, candidatesLeft, etaSeconds, state }
    const parse = (stage) => {
        if (stage === 'screen') return { kind: 'screen', index: 0 };
        let m = /^halving (\d+)$/.exec(stage);
        if (m) return { kind: 'halving', index: Number(m[1]) };
        m = /^greedy step (\d+)$/.exec(stage);
        if (m) return { kind: 'step', index: Number(m[1]) };
        if (stage === 'confirmation') return { kind: 'confirmation', index: 0 };
        return null;
    };
    const sameRow = (r, k) => r.kind === k.kind && r.index === k.index;
    return {
        sync(progress) {
            const key = parse(progress.stage);
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
            }
            // 'stopped', 'probe' and 'start' change no row.
            for (const r of rows) if (r.state === 'done') { r.runsDone = r.runsPlanned; r.etaSeconds = 0; }
            const out = [];
            for (let si = 0; si < stages.length; si++) {
                const kind = si === 0 ? 'screen' : 'halving';
                const r = rows.find((x) => x.kind === kind && x.index === si);
                out.push(r ? { ...r } : waiting(kind, si, pools[si], stages[si].k));
            }
            for (const r of rows) if (r.kind === 'step' || r.kind === 'confirmation') out.push({ ...r });
            return out;
        },
    };
    function waiting(kind, index, poolSize, seeds) {
        return { kind, index, state: 'waiting', runsPlanned: 0, runsDone: 0, runsUpTo: poolSize * seeds, candidatesLeft: poolSize, etaSeconds: null };
    }
}
