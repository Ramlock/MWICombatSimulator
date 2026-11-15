// What one pool's chart draws, as plain data (no canvas, no Chart.js): from a pool of the history (`buildHistory`, history.mjs) to the datasets, the right-edge column
// of the latest round's ± bars, the axis fit and the two reference levels. Pure, tested in Node (`tools/test/whatif-chart-model.mjs`); the view (chartView.mjs) turns it into
// canvas calls. Every figure is a field of the history; the only numbers made here are the axis fit and the colours.
import { THEME } from '../charts/base.mjs';

// The lines that get a ± band: the best BAND_TOP by their latest rank, and the line under the mouse.
export const BAND_TOP = 3;
export const GREY = THEME.dim;
const BEST = [255, 226, 122], WORST = [92, 140, 205];

// The colour of a rank: the best brightest, fading toward blue-grey at the last of `total` leaders.
export function rankColor(rank, total) {
    const f = total > 1 ? Math.min(Math.max((rank - 1) / (total - 1), 0), 1) : 0;
    const c = BEST.map((b, i) => Math.round(b + (WORST[i] - b) * f));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// The axis range that fits the latest round: the ends of every latest bar (a payback range open above has no upper end: it runs off the edge), with 0 and the to-beat level
// included when they are within one span of the bars (a level far away would flatten the bars, so it stays off the chart), plus a margin. null when no leader has a figure yet.
export function fitAxis(pool) {
    const ends = [];
    for (const l of pool.latest || []) {
        if (!Number.isFinite(l.value)) continue;
        ends.push(l.value);
        if (Number.isFinite(l.low)) ends.push(l.low);
        if (Number.isFinite(l.high)) ends.push(l.high);
    }
    if (!ends.length) return null;
    let lo = Math.min(...ends), hi = Math.max(...ends);
    const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9);
    const levels = [0, toBeatNow(pool)].filter((v) => Number.isFinite(v) && v >= lo - span && v <= hi + span);
    if (levels.length) { lo = Math.min(lo, ...levels); hi = Math.max(hi, ...levels); }
    const pad = Math.max(hi - lo, 1e-9) * 0.06;
    return { min: lo - pad, max: hi + pad };
}

// The to-beat level of the latest round (null when the latest round has none).
export function toBeatNow(pool) {
    const last = (pool.toBeat || [])[(pool.toBeat || []).length - 1];
    return last && last.round === pool.latestRound ? last.value : null;
}

// The right-edge column shares the chart's x axis: its bars stand at rounds past the last one. `plotPx`: the plot's width in pixels (an estimate is enough: the chart is
// laid out again on a resize), `count`: the number of bars. Returns the x of each bar, of the separator between the lines and the column, and the axis end that holds all of them.
export const COLUMN_BAR_PX = 11, COLUMN_GAP_PX = 18;
export function columnLayout(count, plotPx, xMin, xMax) {
    const rounds = Math.max(xMax - xMin, 1), colPx = count * COLUMN_BAR_PX, linePx = Math.max(plotPx - colPx - COLUMN_GAP_PX, plotPx * 0.3), perRound = linePx / rounds;
    return {
        xs: Array.from({ length: count }, (_, i) => xMax + (COLUMN_GAP_PX + COLUMN_BAR_PX * (i + 0.5)) / perRound),
        sepX: xMax + COLUMN_GAP_PX / 2 / perRound,
        xEnd: xMax + (COLUMN_GAP_PX + colPx) / perRound,
    };
}

// One pool's chart. `opts.hover`: the candidate id under the mouse (its line is isolated and gets a band), `opts.flying`: the ids of the candidates with a run in flight.
// mode: 'empty' (no leader has a figure: nothing to draw), 'bars' (only the right-edge column: no line has two points yet, the first look and the first rounds) or 'lines'.
// datasets: one per line, the worst drawn first so the best are on top: { id, label, data: [{ x: round, y }], color, width, dim (another line is hovered), out (not among the
//   latest leaders: grey and dashed), dashTo (per point: the segment into it is dashed: an aside or a gap), band: [null | { low, high }] (only for the top lines and the hovered one) }.
// column: the latest round's leaders in the table's order: { id, rank, prev, color, value, low, high, openHigh, aside, pulse }.
export function poolModel(pool, opts = {}) {
    const hover = opts.hover ?? null, flying = opts.flying instanceof Set ? opts.flying : new Set(opts.flying || []);
    const axis = fitAxis(pool), total = (pool.latest || []).length;
    const base = { key: pool.key, player: pool.player, kind: pool.kind, better: pool.better, reverse: pool.better === 'lower', col: pool.col, latestRound: pool.latestRound, hover, axis, zero: 0, toBeat: toBeatNow(pool), xMin: 0, xMax: 0, datasets: [], column: [] };
    if (!axis) return { ...base, mode: 'empty' };
    const first = Math.min(...(pool.lines.length ? pool.lines.map((l) => l.points[0].round) : [pool.latestRound ?? 1])), last = Math.max(pool.latestRound ?? first, first);
    base.xMin = first; base.xMax = last > first ? last : first + 1;
    const lineOf = new Map(pool.lines.map((l) => [l.id, l]));
    base.column = pool.latest.map((l) => ({ id: l.id, desc: lineOf.get(l.id)?.desc ?? null, player: lineOf.get(l.id)?.player ?? pool.player, rank: l.rank, prev: l.prev, color: l.aside ? GREY : rankColor(l.rank, total), value: l.value, low: l.low, high: l.high, openHigh: l.openHigh, aside: l.aside, pulse: flying.has(l.id) }));
    const drawn = pool.lines.filter((l) => l.points.length > 1 || l.inLatest);
    const lines = drawn.some((l) => l.points.length > 1);
    const order = [...drawn].sort((a, b) => (a.inLatest === b.inLatest ? (b.rank ?? 0) - (a.rank ?? 0) : a.inLatest ? 1 : -1));
    const datasets = lines ? order.map((l) => {
        const out = !l.inLatest, isHover = hover === l.id, band = isHover || (l.rank !== null && l.rank <= BAND_TOP);
        const pts = l.points;
        return {
            id: l.id, label: l.desc, player: l.player, data: pts.map((p) => ({ x: p.round, y: p.value })), color: out ? GREY : rankColor(l.rank, total), width: isHover ? 3 : l.rank !== null && l.rank <= BAND_TOP ? 1.8 : 1.2,
            dim: hover !== null && !isHover, out, dashTo: pts.map((p, i) => i > 0 && (p.aside || pts[i - 1].aside || p.round - pts[i - 1].round > 1)),
            // an open payback range (openHigh: no upper end) runs off the chart's worse edge (high Infinity), faded there as the bars are
            band: band ? pts.map((p) => (Number.isFinite(p.low) && (Number.isFinite(p.high) || p.openHigh) ? { low: p.low, high: Number.isFinite(p.high) ? p.high : Infinity } : null)) : null,
        };
    }) : [];
    return { ...base, mode: lines ? 'lines' : 'bars', datasets };
}
