// The What-if window's live chart: one block per stage and pool, drawn with Chart.js (the page's global, or `opts.Chart`) from the history (history.mjs) through the pure model
// (chartModel.mjs). The ± bars, the bands and the faded ends are the shared base's plugin (src/charts/base.mjs); this file adds the two reference levels, the pulse on a bar whose
// candidate has a run in flight, the slide of the axis, the hover (one line isolated, its table row marked through `onHover`) and the click (`onPick`). Output only.
import { THEME, darkAxis, errorBarsPlugin, withAlpha } from '../charts/base.mjs';
import { poolModel, columnLayout } from './chartModel.mjs';
import { FIGURE_MIN_SEEDS } from './figure.mjs';

const SLIDE_MS = 350, PULSE_MS = 1300, CHART_HEIGHT = 280;

// The two reference levels (0 and the round's to-beat level), drawn under the lines, each with a small label on its left; and the separator before the right-edge column.
const levelsPlugin = {
    id: 'whatifLevels',
    beforeDatasetsDraw(chart) {
        const v = chart.$view, area = chart.chartArea, y = chart.scales.y, x = chart.scales.x;
        if (!v || !y || !x) return;
        const ctx = chart.ctx;
        ctx.save(); ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
        ctx.font = '11px sans-serif'; ctx.textBaseline = 'bottom';
        for (const lv of v.levels) {
            const py = y.getPixelForValue(lv.value);
            if (!(py >= area.top && py <= area.bottom)) continue;
            ctx.strokeStyle = lv.color; ctx.lineWidth = 1; ctx.setLineDash(lv.dash); ctx.beginPath(); ctx.moveTo(area.left, py); ctx.lineTo(area.right, py); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = lv.color; ctx.fillText(lv.text, area.left + 4, py - 2);
        }
        if (Number.isFinite(v.sepX)) {
            const px = x.getPixelForValue(v.sepX);
            ctx.setLineDash([2, 4]); ctx.strokeStyle = THEME.grid; ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
        }
        ctx.restore();
    },
    // The pulse: a ring that grows and fades around the figure mark of each column bar whose candidate has a run in flight.
    afterDatasetsDraw(chart) {
        const v = chart.$view;
        if (!v || !v.pulse.size) return;
        const phase = (Date.now() % PULSE_MS) / PULSE_MS, ctx = chart.ctx;
        chart.data.datasets.forEach((ds, i) => {
            if (!ds.column || !v.pulse.has(ds.id)) return;
            const el = chart.getDatasetMeta(i).data[0];
            if (!el || el.skip) return;
            ctx.save(); ctx.strokeStyle = withAlpha(ds.color, 0.85 * (1 - phase)); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(el.x, el.y, 4 + 7 * phase, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        });
    },
};

// A caption for a figure with its range (the tooltip text): the page's number writer `format`.
const tipOf = (t, format, round, value, low, high) => (Number.isFinite(low) && Number.isFinite(high)
    ? t('chart.tipFigure', { value: format(value), low: format(low), high: format(high), round }) : t('chart.tipFigureOne', { value: format(value), round }));

// The Chart.js datasets of a model: the lines (worst first), then one single-point dataset per column bar (its ± is the bar). `plotPx`: the plot's width estimate.
export function datasetsOf(model, { t, format, labelOf, layout }) {
    const out = model.datasets.map((d) => {
        const last = d.data.length - 1, color = d.dim ? withAlpha(d.color, 0.18) : d.color;
        return {
            type: 'line', id: d.id, label: labelOf({ id: d.id, label: d.label, player: d.player }), data: d.data, borderColor: color, backgroundColor: color, borderWidth: d.width, tension: 0, spanGaps: true,
            borderDash: d.out ? [4, 4] : [], pointRadius: d.data.map((_, i) => (i === last && !d.out ? 2.5 : 0)), pointHoverRadius: 4, pointHitRadius: 8,
            segment: { borderDash: (c) => (d.dashTo[c.p1DataIndex] ? [3, 4] : undefined) },
            errorBand: d.band && !d.dim ? d.band : undefined, errorBandColor: withAlpha(d.color, 0.1),
            tips: d.data.map((p, i) => tipOf(t, format, p.x, p.y, d.band?.[i]?.low, d.band?.[i]?.high)),
        };
    });
    model.column.forEach((c, i) => {
        if (!Number.isFinite(c.value)) return;
        const hover = model.hover, dim = hover !== null && hover !== c.id, color = dim ? withAlpha(c.color, 0.25) : c.color;
        // A payback range open above has no upper end: the bar runs off the top of the chart.
        const high = c.openHigh && model.axis ? model.axis.max + (model.axis.max - model.axis.min) * 10 : c.high;
        out.push({
            type: 'line', id: c.id, column: true, color: c.color, label: labelOf({ id: c.id, label: c.desc, player: c.player }), data: [{ x: layout.xs[i], y: c.value }], showLine: false, pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 8,
            borderColor: color, backgroundColor: color, errorBars: [Number.isFinite(c.low) && Number.isFinite(high) ? { low: c.low, high } : null], errorBarStyle: { color, width: 1.5, cap: 3 },
            tips: [tipOf(t, format, model.latestRound, c.value, c.low, c.openHigh ? NaN : c.high)],
        });
    });
    return out;
}

// Puts `kids` in `parent` in that order; a parent that already holds exactly them is left alone (a canvas moved in the DOM is laid out again).
const setChildren = (parent, kids) => { if (parent.childNodes.length !== kids.length || kids.some((k, i) => parent.childNodes[i] !== k)) parent.replaceChildren(...kids); };

// The host: `container` gets one block per stage and pool, kept across updates (a canvas is never recreated while its pool is shown).
// opts: { t, format, stageLabel(stage), labelOf({ id, label (the candidate's desc), player }) (the shown text), onHover(id|null), onPick(id), Chart (default: the global) }.
export function createChartHost(container, opts) {
    const { t, format } = opts, stages = new Map(), blocks = new Map();
    const ChartCtor = () => opts.Chart || globalThis.Chart;
    const labelOf = (d) => (opts.labelOf ? opts.labelOf(d) : d.label ?? d.id);

    function build(block) {
        const ctx = block.canvas.getContext('2d'), Chart = ChartCtor();
        try { block.chart = new Chart(ctx, {
            type: 'line', data: { datasets: [] }, plugins: [errorBarsPlugin, levelsPlugin],
            options: {
                animation: false, maintainAspectRatio: false, responsive: true, parsing: false, normalized: true,
                interaction: { mode: 'nearest', intersect: true },
                layout: { padding: { right: 6 } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => items[0]?.dataset.label ?? '', label: (item) => item.dataset.tips?.[item.dataIndex] ?? '' } } },
                scales: { x: { type: 'linear', ...darkAxis({ title: t('chart.round') }), ticks: { color: THEME.text, precision: 0, callback: (v) => (Number.isInteger(v) && v <= (block.xMax ?? Infinity) ? v : '') } }, y: darkAxis({}) },
                onHover: (event, els) => {
                    const id = els.length ? block.chart.data.datasets[els[0].datasetIndex]?.id ?? null : null;
                    event.native?.target && (event.native.target.style.cursor = id ? 'pointer' : 'default');
                    // Chart.js replays its last pointer event after every update(): once the pointer has left, that replayed event (the same native event) must not isolate the line again.
                    if (event.native && event.native === block.leftWith) return;
                    block.leftWith = null; block.lastNative = event.native ?? null;
                    if (id !== block.hover) { block.hover = id; draw(block, false); opts.onHover?.(id); }
                },
                onClick: (event, els) => { const id = els.length ? block.chart.data.datasets[els[0].datasetIndex]?.id : null; if (id) opts.onPick?.(id); },
            },
        }); } catch (err) { Chart.getChart?.(block.canvas)?.destroy(); block.chart = null; throw err; } // a half-built chart must not keep the canvas
        // Chart.js calls onHover only inside the plot area: the pointer leaving the canvas (or the page's box around it) clears the isolation here.
        const leave = () => { block.leftWith = block.lastNative; if (block.hover !== null) { block.hover = null; draw(block, false); opts.onHover?.(null); } };
        for (const type of ['mouseleave', 'mouseout', 'pointerleave']) block.chart.canvas.addEventListener(type, leave);
        block.box.addEventListener('mouseleave', leave);
    }

    // Applies the block's pool (with its hover and flying set) to its chart. `slide`: the y axis moves to its new fit over a short time instead of jumping.
    function draw(block, slide) {
        const pool = block.pool, model = poolModel(pool, { hover: block.hover, flying: block.flying });
        const note = block.note, box = block.box;
        const empty = model.mode === 'empty';
        box.hidden = empty;
        note.hidden = !(empty || block.firstLook);
        note.textContent = empty ? t('chart.noFigures', { n: FIGURE_MIN_SEEDS }) : block.firstLook ? t('chart.firstLook') : '';
        if (empty) { block.pulseOff(); return; }
        block.xMax = model.xMax; // read by the x axis' tick labels (also while the chart is being built)
        if (!block.chart) build(block);
        const chart = block.chart, plotPx = Math.max((box.clientWidth || 800) - 70, 200), layout = columnLayout(model.column.length, plotPx, model.xMin, model.xMax);
        const colored = model.column.filter((c) => Number.isFinite(c.value)).length;
        chart.$view = {
            xMax: model.xMax, sepX: colored ? layout.sepX : NaN, pulse: new Set(model.column.filter((c) => c.pulse).map((c) => c.id)),
            levels: [
                { value: 0, text: t('chart.zero'), color: THEME.zero, dash: [] },
                ...(Number.isFinite(model.toBeat) ? [{ value: model.toBeat, text: t('chart.toBeat') + ' ' + format(model.toBeat), color: 'rgba(255, 190, 90, 0.8)', dash: [6, 4] }] : []),
            ],
        };
        chart.data.datasets = datasetsOf(model, { t, format, labelOf, layout });
        const x = chart.options.scales.x, y = chart.options.scales.y;
        x.min = model.xMin; x.max = colored ? layout.xEnd : model.xMax;
        x.ticks.stepSize = Math.max(1, Math.ceil((model.xMax - model.xMin) / 12)); x.ticks.includeBounds = false; // a tick per round (or every few), none at the column's odd end
        const title = (model.better === 'lower' ? t('chart.paybackUp', { col: t('rounds.col.payback') }) : t(model.col === 'buyerNet' ? 'col.buyerGain' : 'col.partyGain'));
        const next = { min: model.axis.min, max: model.axis.max };
        y.reverse = model.reverse; y.title = { display: true, text: title, color: THEME.text };
        y.ticks = { color: THEME.text, includeBounds: false, callback: (v) => format(v) };
        const from = block.axis;
        block.axis = next;
        if (block.slideFrame) { cancelAnimationFrame?.(block.slideFrame); block.slideFrame = 0; }
        if (slide && from && (from.min !== next.min || from.max !== next.max) && typeof requestAnimationFrame === 'function') {
            const t0 = performance.now(), ease = (p) => 1 - (1 - p) ** 3;
            const step = (now) => {
                const p = Math.min((now - t0) / SLIDE_MS, 1), e = ease(p);
                y.min = from.min + (next.min - from.min) * e; y.max = from.max + (next.max - from.max) * e;
                chart.update('none');
                block.slideFrame = p < 1 ? requestAnimationFrame(step) : 0;
            };
            block.slideFrame = requestAnimationFrame(step);
        } else { y.min = next.min; y.max = next.max; chart.update('none'); }
        // The pulse needs a redraw every so often while some bar's candidate has a run in flight.
        if (chart.$view.pulse.size && !block.pulseTimer) block.pulseTimer = setInterval(() => block.chart?.draw(), 90);
        else if (!chart.$view.pulse.size) block.pulseOff();
    }

    function blockFor(stageEl, stage, pool) {
        const id = stage + '|' + pool.key;
        let block = blocks.get(id);
        if (block) return block;
        const el = document.createElement('div');
        el.className = 'whatif-chart'; el.dataset.stage = stage; el.dataset.pool = pool.key;
        const title = document.createElement('div'); title.className = 'small whatif-chart-title';
        const box = document.createElement('div'); box.className = 'whatif-chart-box'; box.style.height = CHART_HEIGHT + 'px';
        const canvas = document.createElement('canvas'); box.append(canvas);
        const note = document.createElement('div'); note.className = 'whatif-dim small whatif-chart-note'; note.hidden = true;
        el.append(title, box, note);
        block = { id, stage, key: pool.key, el, title, box, canvas, note, chart: null, hover: null, flying: new Set(), axis: null, slideFrame: 0, pulseTimer: 0, pool, firstLook: false, pulseOff() { if (this.pulseTimer) { clearInterval(this.pulseTimer); this.pulseTimer = 0; } } };
        blocks.set(id, block);
        return block;
    }

    function dropBlock(block) {
        block.pulseOff(); if (block.slideFrame) cancelAnimationFrame?.(block.slideFrame);
        block.chart?.destroy(); block.el.remove(); blocks.delete(block.id);
    }

    return {
        // history: buildHistory's result. ctx: { running (the stage name that runs now, or null), flying (candidate ids with a run in flight), endedByUser (result.endedByUser) }.
        update(history, ctx = {}) {
            const flying = new Set(ctx.flying || []), wanted = new Set(), order = [];
            const rows = history.stages.map((s) => ({ ...s, note: null }));
            // A stage the user ended before its first round finished has no rounds: its note stands where its chart would, no canvas.
            for (const [stage, n] of Object.entries(ctx.endedByUser || {})) if (n === 0 && !rows.some((s) => s.stage === stage)) rows.push({ stage, pools: [], rounds: 0, firstLook: false, note: t('chart.noRounds', { stage: opts.stageLabel(stage) }) });
            for (const s of rows) {
                let stageEl = stages.get(s.stage);
                if (!stageEl) { stageEl = document.createElement('div'); stageEl.className = 'whatif-chart-stage'; stageEl.dataset.stage = s.stage; stageEl.append(Object.assign(document.createElement('div'), { className: 'whatif-chart-stagehead small' })); stages.set(s.stage, stageEl); }
                const head = stageEl.firstChild, running = ctx.running === s.stage;
                head.replaceChildren(); const b = document.createElement('b'); b.textContent = opts.stageLabel(s.stage); head.append(b);
                head.append(' · ' + (s.rounds ? t(s.rounds === 1 ? 'chart.roundsOne' : 'chart.rounds', { n: s.rounds }) : '') + (running ? (s.rounds ? ' · ' : '') + t('chart.running') : ''));
                if (s.note) { head.textContent = s.note; head.className = 'whatif-chart-stagehead small whatif-dim'; } else head.className = 'whatif-chart-stagehead small';
                wanted.add(s.stage); order.push(stageEl);
                const kids = [head];
                for (const pool of s.pools) {
                    const block = blockFor(stageEl, s.stage, pool);
                    block.pool = pool; block.flying = running ? flying : new Set(); block.firstLook = s.firstLook;
                    block.title.textContent = (pool.player ? pool.player + ' · ' : '') + t('rounds.pool.' + pool.kind);
                    const hadChart = !!block.chart;
                    draw(block, hadChart);
                    kids.push(block.el); wanted.add(block.id);
                }
                setChildren(stageEl, kids);
            }
            setChildren(container, order);
            for (const [stage, el] of [...stages]) if (!wanted.has(stage)) { el.remove(); stages.delete(stage); }
            for (const block of [...blocks.values()]) if (!wanted.has(block.id)) dropBlock(block);
        },
        // Marks the table row of the hovered candidate is main.js's; the host only reports the id.
        clear() { for (const block of [...blocks.values()]) dropBlock(block); stages.clear(); container.replaceChildren(); },
        redraw() { for (const block of blocks.values()) if (block.chart) draw(block, false); },
    };
}
