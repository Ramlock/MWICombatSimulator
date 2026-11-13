// The history of a what-if search as the chart reads it: the finished round records (the runner's `rounds`, one per round, the lines of `rounds.jsonl`) grouped by
// stage and pool, and within a pool by candidate, so the chart is those records side by side. Data shaping only: every figure is a field of a record (the core
// computed it), nothing is estimated here. A live search and a finished one (read from its file) go through this one function.
import { hasFigure } from './figure.mjs';

// The record fields the pool's table is sorted by, by the pool's sort column (`sortedBy`, or `sortPending` while the pool still keeps build order). Which column
// a pool sorts by is the core's choice (`sortRows` in tools/whatif/core.mjs); this table only says where that column's figure and range sit in a row.
// `better`: which direction is the better one (a payback is better the shorter it is; the chart then draws the best at the top).
const COLUMNS = {
    buyerNet: { value: 'buyerNet', low: 'netLow', high: 'netHigh', better: 'higher' },
    reading: { value: 'reading', low: 'low', high: 'high', better: 'higher' },
    payback: { value: 'payback', low: 'paybackLow', high: 'paybackHigh', better: 'lower' },
};
export const columnOf = (col) => COLUMNS[col] ?? COLUMNS.reading;

// The records of one search as one history: a stage that was run again (a resumed search replays its stages from round 1, appending to the same file)
// keeps only its last run, in the order the stages first appeared.
export function lastRuns(records) {
    const order = [], byStage = new Map();
    for (const r of Array.isArray(records) ? records : []) {
        if (!r || typeof r.stage !== 'string' || !Number.isFinite(r.round) || !Array.isArray(r.pools) || r.provisional) continue;
        if (!byStage.has(r.stage)) { order.push(r.stage); byStage.set(r.stage, []); }
        const list = byStage.get(r.stage);
        if (r.round <= (list.length ? list[list.length - 1].round : 0)) list.length = 0; // a round number that does not rise starts the stage again
        list.push(r);
    }
    return order.map((stage) => ({ stage, records: byStage.get(stage) }));
}

// One row's point on its pool's chart, or null when the row has no figure to draw (fewer than FIGURE_MIN_SEEDS reading seeds, or no value).
function pointOf(row, round, cols) {
    if (!hasFigure(row) || row.tooFew) return null;
    const value = row[cols.value];
    if (!Number.isFinite(value)) return null;
    const low = row[cols.low], high = row[cols.high];
    // A payback range with no upper end (the buyer's gain's low end is not above 0: no payback at that end) is open-ended: `openHigh`, the chart lets it run off the edge.
    const openHigh = cols.better === 'lower' && Number.isFinite(low) && !Number.isFinite(high);
    return { round, value, low: Number.isFinite(low) ? low : null, high: Number.isFinite(high) ? high : null, openHigh, seeds: row.readingSeeds ?? null, aside: row.status === 'paused' };
}

// stages: [{ stage, rounds, pools: [{ key, player, kind, col, better, lines, toBeat, latest, latestRound }] }]
//   lines: one per candidate that was among the pool's leaders in some round: { id, desc, player, points: [{ round, value, low, high, openHigh, seeds, aside }],
//          rank (1-based in the latest round, null when not among its leaders), inLatest, lastRound }; the points are the rounds where the candidate had a figure.
//   toBeat: [{ round, value }] per round, the lowest lower end among the leaders that have a figure (for a payback, the highest upper end: the worse end).
//   latest: the latest round's leaders in the table's order: { id, rank, prev (the position in the round before, null when new or not given), value, low, high, openHigh }.
// `firstLook`: the provisional record of the round being run (the first look at a stage's round 1, `provisional: true`), or null. A stage that has no finished round
// yet gets its pools from it, with no lines and `firstLook: true`: the chart shows the first look as bars only. A stage with finished rounds ignores it.
export function buildHistory(records, { firstLook = null } = {}) {
    const stages = lastRuns(records).map(({ stage, records: recs }) => {
        const keys = [];
        for (const r of recs) for (const p of r.pools) if (!keys.includes(p.key)) keys.push(p.key);
        const last = recs[recs.length - 1];
        return { stage, rounds: last.round, firstRound: recs[0].round, lastRound: last.round, firstLook: false, pools: keys.map((key) => poolHistory(key, recs)) };
    });
    if (firstLook && firstLook.provisional === true && typeof firstLook.stage === 'string' && Array.isArray(firstLook.pools) && !stages.some((s) => s.stage === firstLook.stage)) {
        stages.push({ stage: firstLook.stage, rounds: 0, firstRound: firstLook.round, lastRound: 0, firstLook: true, pools: firstLook.pools.map((p) => poolHistory(p.key, [{ ...firstLook, provisional: false }])) });
    }
    return { stages };
}

function poolHistory(key, recs) {
    const text = String(key), at = text.lastIndexOf(':'), player = at >= 0 ? text.slice(0, at) : null, kind = at >= 0 ? text.slice(at + 1) : text;
    const withPool = recs.map((r) => ({ r, p: r.pools.find((q) => q.key === key) })).filter((x) => x.p);
    const col = withPool.map((x) => x.p.sortedBy ?? x.p.sortPending).filter(Boolean).pop() ?? 'reading', cols = columnOf(col);
    const lines = new Map(), toBeat = [];
    for (const { r, p } of withPool) {
        const lows = [];
        for (const row of p.leaders || []) {
            if (row.status === 'refuted') continue;
            let line = lines.get(row.id);
            if (!line) lines.set(row.id, line = { id: row.id, desc: row.desc, player: row.player ?? null, points: [], rank: null, inLatest: false, lastRound: r.round });
            const pt = pointOf(row, r.round, cols);
            line.lastRound = r.round;
            if (pt) {
                line.points.push(pt);
                const worse = cols.better === 'lower' ? (pt.openHigh ? null : pt.high) : pt.low;
                if (Number.isFinite(worse)) lows.push(worse);
            }
        }
        if (lows.length) toBeat.push({ round: r.round, value: cols.better === 'lower' ? Math.max(...lows) : Math.min(...lows) });
    }
    const lastRec = withPool[withPool.length - 1], latestRound = lastRec ? lastRec.r.round : null;
    const latestRows = (lastRec?.p.leaders || []).filter((row) => row.status !== 'refuted');
    const latest = latestRows.map((row, i) => {
        const line = lines.get(row.id), pt = pointOf(row, latestRound, cols);
        line.rank = i + 1; line.inLatest = true;
        return { id: row.id, rank: i + 1, prev: Number.isFinite(row.prev) ? row.prev : null, value: pt?.value ?? null, low: pt?.low ?? null, high: pt?.high ?? null, openHigh: pt?.openHigh ?? false, aside: pt?.aside ?? row.status === 'paused' };
    });
    return { key, player, kind, col, better: cols.better, lines: [...lines.values()].filter((l) => l.points.length), toBeat, latest, latestRound };
}
