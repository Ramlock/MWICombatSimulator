// The shared base of the page's Chart.js charts: the dark theme, the axis helper and the ± bar plugin. The What-if window's live chart uses it; the XP-per-hour
// against profit chart can use the same helpers. The geometry (what is drawn where, what runs off the edge) is pure functions, tested in Node
// (`tools/test/charts-base.mjs`); the plugin only turns that geometry into canvas calls. Nothing here knows a what-if field.

export const THEME = {
    text: '#f0f0f0',
    grid: 'rgba(255, 255, 255, 0.12)',
    zero: 'rgba(255, 255, 255, 0.5)',
    dim: 'rgba(160, 170, 185, 0.55)',
};

// One axis in the dark theme. `format(number)` writes the tick labels (the page's own number writer); `min` / `max` fix the range (the caller fits it).
export function darkAxis({ title, format, min, max, position } = {}) {
    return {
        ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(position ? { position } : {}),
        title: { display: !!title, text: title ?? '', color: THEME.text },
        ticks: { color: THEME.text, ...(format ? { callback: (v) => format(v) } : {}) },
        grid: { color: THEME.grid },
    };
}

// A vertical range [low, high] (pixel rows, `top` < `bottom` on the chart area) cut to the area: what is drawn, and which ends ran off the edge.
// `yTop` is the smaller pixel row (the higher value); `cutTop` / `cutBottom` say that end was cut, so the plugin fades it. `visible` is false when the
// whole range is outside the area (a range wholly above or below it draws nothing).
export function clipRange(yA, yB, area) {
    const yTop = Math.min(yA, yB), yBottom = Math.max(yA, yB);
    if (yBottom < area.top || yTop > area.bottom) return { visible: false, yTop, yBottom, cutTop: false, cutBottom: false };
    return { visible: true, yTop: Math.max(yTop, area.top), yBottom: Math.min(yBottom, area.bottom), cutTop: yTop < area.top, cutBottom: yBottom > area.bottom };
}

// One ± bar at pixel column `x`: the vertical line from the low to the high end (cut to the area), the two end caps (half-width `cap`; a cut end has none,
// it runs off the chart) and the figure's own mark row `yMid` (null when the figure itself is off the chart). Returns null for a bar with no finite
// low or high (a figure drawn without a range has no bar). `scaleY(value)` gives the pixel row of a value.
export function barGeometry({ x, y, low, high }, scaleY, area, cap = 4) {
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(x)) return null;
    const c = clipRange(scaleY(low), scaleY(high), area);
    if (!c.visible) return { visible: false, x };
    const mid = Number.isFinite(y) ? scaleY(y) : null;
    return { visible: true, x, yTop: c.yTop, yBottom: c.yBottom, cutTop: c.cutTop, cutBottom: c.cutBottom, yMid: mid !== null && mid >= area.top && mid <= area.bottom ? mid : null, capLeft: x - cap, capRight: x + cap };
}

// The band between a line's low and high ends along its points: runs of consecutive points that have a range (a point with none, or a gap, splits the run).
// Each run is { upper: [{x, y}], lower: [{x, y}] } in pixels, cut to the area (a band's cut is a flat edge at the area's edge). `points`: [{ x, low, high }|null].
export function bandRuns(points, scaleY, area) {
    const runs = []; let run = null;
    const clampY = (v) => Math.min(Math.max(scaleY(v), area.top), area.bottom);
    for (const p of points) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.low) || !Number.isFinite(p.high)) { run = null; continue; }
        if (!run) { run = { upper: [], lower: [] }; runs.push(run); }
        run.upper.push({ x: p.x, y: clampY(Math.max(p.low, p.high)) });
        run.lower.push({ x: p.x, y: clampY(Math.min(p.low, p.high)) });
    }
    return runs.filter((r) => r.upper.length > 1);
}

// The Chart.js plugin. A dataset may carry (all optional):
//   errorBars: [ null | { low, high } ] parallel to its data: a ± bar at that point (the figure is the point's y);
//   errorBarStyle: { color, width, cap }: the bars' look (defaults: the dataset's border colour, 2 px, 4 px caps);
//   errorBand: [ null | { low, high } ] parallel to its data: the shaded band along the line, drawn under the line with `errorBandColor`.
// A bar or band end that runs off the chart area is drawn fading out at the edge. Hidden datasets draw neither.
export const errorBarsPlugin = {
    id: 'errorBars',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea: area, scales } = chart, yScale = scales.y;
        if (!yScale) return;
        const scaleY = (v) => yScale.getPixelForValue(v);
        chart.data.datasets.forEach((ds, i) => {
            if (!ds.errorBand || !chart.isDatasetVisible(i)) return;
            const meta = chart.getDatasetMeta(i);
            const pts = ds.errorBand.map((b, k) => (b && meta.data[k] && !meta.data[k].skip ? { x: meta.data[k].x, low: b.low, high: b.high } : null));
            ctx.save(); ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
            ctx.fillStyle = ds.errorBandColor || 'rgba(255, 255, 255, 0.12)';
            for (const run of bandRuns(pts, scaleY, area)) {
                ctx.beginPath();
                run.upper.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                [...run.lower].reverse().forEach((p) => ctx.lineTo(p.x, p.y));
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
        });
    },
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: area, scales } = chart, yScale = scales.y;
        if (!yScale) return;
        const scaleY = (v) => yScale.getPixelForValue(v);
        chart.data.datasets.forEach((ds, i) => {
            if (!ds.errorBars || !chart.isDatasetVisible(i)) return;
            const meta = chart.getDatasetMeta(i), st = { width: 2, cap: 4, ...(ds.errorBarStyle || {}) };
            const color = st.color || ds.borderColor || THEME.text;
            ctx.save(); ctx.beginPath(); ctx.rect(area.left - st.cap - 1, area.top, area.right - area.left + 2 * st.cap + 2, area.bottom - area.top); ctx.clip();
            ds.errorBars.forEach((b, k) => {
                const el = meta.data[k];
                if (!b || !el || el.skip) return;
                const g = barGeometry({ x: el.x, y: ds.data[k]?.y ?? ds.data[k], low: b.low, high: b.high }, scaleY, area, st.cap);
                if (!g || !g.visible) return;
                ctx.lineWidth = st.width; ctx.strokeStyle = color; ctx.fillStyle = color;
                // A cut end fades out over its last 14 px: the bar runs off the chart.
                const grad = ctx.createLinearGradient(0, g.yTop, 0, g.yBottom);
                const fade = Math.min(14 / Math.max(g.yBottom - g.yTop, 1), 0.5);
                grad.addColorStop(0, withAlpha(color, g.cutTop ? 0.1 : 1)); grad.addColorStop(g.cutTop ? fade : 0, withAlpha(color, 1));
                grad.addColorStop(g.cutBottom ? 1 - fade : 1, withAlpha(color, 1)); grad.addColorStop(1, withAlpha(color, g.cutBottom ? 0.1 : 1));
                ctx.strokeStyle = grad;
                ctx.beginPath(); ctx.moveTo(g.x, g.yTop); ctx.lineTo(g.x, g.yBottom); ctx.stroke();
                ctx.strokeStyle = color;
                if (!g.cutTop) { ctx.beginPath(); ctx.moveTo(g.capLeft, g.yTop); ctx.lineTo(g.capRight, g.yTop); ctx.stroke(); }
                if (!g.cutBottom) { ctx.beginPath(); ctx.moveTo(g.capLeft, g.yBottom); ctx.lineTo(g.capRight, g.yBottom); ctx.stroke(); }
                if (g.yMid !== null) { ctx.beginPath(); ctx.arc(g.x, g.yMid, st.width + 1, 0, Math.PI * 2); ctx.fill(); }
            });
            ctx.restore();
        });
    },
};

// The colour with an alpha, for a '#rrggbb', 'rgb(...)' or 'rgba(...)' string (anything else is returned as it is).
export function withAlpha(color, alpha) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex) { const n = parseInt(hex[1], 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${alpha})`; }
    const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(color);
    return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : color;
}
