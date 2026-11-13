// Test: the shared chart base (src/charts/base.mjs): the ± bar geometry (what is drawn where, what runs off the edge), the band runs, the dark axis and the
// plugin's canvas calls on a fake chart (no browser). Pure; synthetic numbers only.
// Usage: node tools/test/charts-base.mjs        Exit code 0 on pass, 1 on fail.
import { THEME, darkAxis, clipRange, barGeometry, bandRuns, errorBarsPlugin, withAlpha } from '../../src/charts/base.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
// A chart area 100..300 pixels high; value v sits at pixel 300 - v (value 0 at the bottom, 200 at the top).
const area = { left: 50, right: 450, top: 100, bottom: 300 };
const scaleY = (v) => 300 - v;

// ---- clipRange ----
check('clipRange: a range inside the area is unchanged and cut nowhere', JSON.stringify(clipRange(150, 250, area)) === JSON.stringify({ visible: true, yTop: 150, yBottom: 250, cutTop: false, cutBottom: false }));
check('clipRange: the ends are given in either order', clipRange(250, 150, area).yTop === 150 && clipRange(250, 150, area).yBottom === 250);
{
    const c = clipRange(20, 250, area);
    check('clipRange: an end above the area is cut to its edge and flagged', c.yTop === 100 && c.cutTop === true && c.cutBottom === false && c.visible);
    const d = clipRange(150, 900, area);
    check('clipRange: an end below the area is cut to its edge and flagged', d.yBottom === 300 && d.cutBottom === true && d.cutTop === false);
    const e = clipRange(-50, 900, area);
    check('clipRange: both ends beyond the area: the whole height, both flagged', e.yTop === 100 && e.yBottom === 300 && e.cutTop && e.cutBottom);
    check('clipRange: a range wholly above or below the area draws nothing', !clipRange(10, 60, area).visible && !clipRange(320, 400, area).visible);
}

// ---- barGeometry ----
{
    const g = barGeometry({ x: 400, y: 100, low: 60, high: 140 }, scaleY, area, 5);
    check('barGeometry: the bar runs from the high end (top row) to the low end, with caps of the given half-width and the figure mark between', g.visible && g.x === 400 && g.yTop === 160 && g.yBottom === 240 && g.capLeft === 395 && g.capRight === 405 && g.yMid === 200 && !g.cutTop && !g.cutBottom, JSON.stringify(g));
    const h = barGeometry({ x: 400, y: 100, low: -300, high: 140 }, scaleY, area);
    check('barGeometry: a low end far below the chart runs off the bottom edge, flagged, with no bottom cap to draw', h.yBottom === 300 && h.cutBottom && !h.cutTop && h.yTop === 160);
    const i = barGeometry({ x: 400, y: 300, low: 60, high: 140 }, scaleY, area);
    check('barGeometry: a figure itself off the chart has no mark (yMid null) but its visible part still draws', i.visible && i.yMid === null);
    check('barGeometry: no range (low or high missing) is no bar', barGeometry({ x: 400, y: 5, low: null, high: 9 }, scaleY, area) === null && barGeometry({ x: 400, y: 5, low: 1, high: NaN }, scaleY, area) === null);
    check('barGeometry: a bar wholly off the chart is invisible', barGeometry({ x: 400, y: 500, low: 400, high: 600 }, scaleY, area).visible === false);
    const j = barGeometry({ x: 400, y: 100, low: 60, high: 1e15 }, scaleY, area);
    check('barGeometry: a huge open end is cut at the top edge without breaking', j.visible && j.yTop === 100 && j.cutTop);
}

// ---- bandRuns ----
{
    const runs = bandRuns([{ x: 10, low: 10, high: 50 }, { x: 20, low: 20, high: 60 }, null, { x: 40, low: 0, high: 10 }, { x: 50, low: 5, high: 15 }, { x: 60, low: null, high: 1 }, { x: 70, low: 1, high: 2 }], scaleY, area);
    check('bandRuns: a point with no range splits the band into runs; a run of one point draws nothing', runs.length === 2 && runs[0].upper.length === 2 && runs[1].upper.length === 2, JSON.stringify(runs));
    check('bandRuns: upper is the high end (smaller pixel row), lower the low end, in order', runs[0].upper[0].y === 250 && runs[0].lower[0].y === 290 && runs[0].upper[1].x === 20);
    const c = bandRuns([{ x: 1, low: -500, high: 900 }, { x: 2, low: -500, high: 900 }], scaleY, area);
    check('bandRuns: a band beyond the area is cut flat at its edges', c[0].upper[0].y === 100 && c[0].lower[0].y === 300);
}

// ---- darkAxis and colours ----
{
    const a = darkAxis({ title: 'Round', format: (v) => v + '!', min: 1, max: 5 });
    check('darkAxis: the dark theme colours on title, ticks and grid, the fixed range, the tick formatter', a.title.color === THEME.text && a.ticks.color === THEME.text && a.grid.color === THEME.grid && a.min === 1 && a.max === 5 && a.ticks.callback(3) === '3!' && a.title.display);
    check('darkAxis: no title means no title row; no range means the chart fits it', darkAxis({}).title.display === false && !('min' in darkAxis({})) && !('max' in darkAxis({})));
    check('withAlpha: hex, rgb and rgba colours take the alpha; anything else is returned as it is', withAlpha('#ff8000', 0.5) === 'rgba(255, 128, 0, 0.5)' && withAlpha('rgb(1, 2, 3)', 0.25) === 'rgba(1, 2, 3, 0.25)' && withAlpha('rgba(1,2,3,0.9)', 0.1) === 'rgba(1, 2, 3, 0.1)' && withAlpha('red', 0.5) === 'red');
}

// ---- The plugin, on a fake chart: the canvas calls it makes ----
{
    const calls = [];
    const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => calls.push([k, ...a])), set: () => true });
    const el = (x) => ({ x, skip: false });
    const chart = {
        ctx, chartArea: area, scales: { y: { getPixelForValue: scaleY } },
        data: { datasets: [
            { data: [{ x: 100, y: 50 }, { x: 200, y: 80 }], borderColor: '#ff8000', errorBars: [{ low: 20, high: 90 }, null], errorBand: [{ low: 20, high: 90 }, { low: 60, high: 100 }] },
            { data: [{ x: 100, y: 50 }], borderColor: '#00ff00', errorBars: [{ low: 20, high: 90 }] },
        ] },
        isDatasetVisible: (i) => i === 0,
        getDatasetMeta: () => ({ data: [el(100), el(200)] }),
    };
    errorBarsPlugin.beforeDatasetsDraw(chart);
    const fills = calls.filter((c) => c[0] === 'fill').length;
    errorBarsPlugin.afterDatasetsDraw(chart);
    const strokes = calls.filter((c) => c[0] === 'stroke').length, arcs = calls.filter((c) => c[0] === 'arc');
    check('plugin: a visible dataset with a band fills it once; the hidden dataset draws nothing', fills === 1);
    check('plugin: one bar (a bar, two caps) and one figure mark are drawn, for the visible dataset only, and a null bar draws none', strokes === 3 && arcs.length === 1 && arcs[0][1] === 100 && arcs[0][2] === 250, JSON.stringify({ strokes, arcs }));
    check('plugin: a chart with no y scale draws nothing and does not throw', (() => { try { errorBarsPlugin.afterDatasetsDraw({ ...chart, scales: {} }); errorBarsPlugin.beforeDatasetsDraw({ ...chart, scales: {} }); return true; } catch { return false; } })());
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
