// Test: what the What-if chart draws (src/whatif/chartModel.mjs): the axis fit, the rank colours, the right-edge column layout, which lines get a band, the hover, the lines that left
// (grey, dashed), the gaps, the payback pool (reversed axis), the first look (bars only) and the empty pool. Pure, synthetic records only.
// Usage: node tools/test/whatif-chart-model.mjs        Exit code 0 on pass, 1 on fail.
import { poolModel, fitAxis, toBeatNow, rankColor, columnLayout, GREY, BAND_TOP, COLUMN_BAR_PX } from '../../src/whatif/chartModel.mjs';
import { buildHistory } from '../../src/whatif/history.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

const row = (id, net, half, seeds, extra = {}) => ({ id, desc: 'change ' + id, player: 'Alice', status: 'contending', readingSeeds: seeds, tooFew: seeds === 0, seeds: 40, reading: net * 2, low: net * 2 - half, high: net * 2 + half, buyerNet: net, netLow: net - half, netHigh: net + half, payback: null, ...extra });
const pool = (key, leaders, extra = {}) => ({ key, size: 12, contending: 8, paused: 2, line: null, leaders, sortedBy: 'buyerNet', ...extra });
const rec = (stage, round, pools, extra = {}) => ({ round, stage, simHours: round * 100, pools, ...extra });
const poolOf = (recs, opts) => buildHistory(recs, opts).stages[0].pools[0];

// ---- colours ----
{
    check('rankColor: the best is the brightest, the last the dimmest, in between a step each', rankColor(1, 10) === 'rgb(255, 226, 122)' && rankColor(10, 10) === 'rgb(92, 140, 205)' && rankColor(5, 10) !== rankColor(6, 10));
    check('rankColor: a lone leader is the best colour; a rank past the total is clamped', rankColor(1, 1) === rankColor(1, 10) && rankColor(30, 10) === rankColor(10, 10));
}

// ---- the axis fit ----
{
    const pl = poolOf([rec('foods', 4, [pool('Alice:free', [row('a', 1000, 20, 8), row('b', 960, 30, 8), row('c', 940, 10, 8)])])]);
    const ax = fitAxis(pl);
    check('the fit covers every latest bar end with a margin', ax.min < 930 && ax.max > 1020, JSON.stringify(ax));
    check('0 is not in the fit when it is far from the bars (it would flatten them), the 0 line is then off the chart', ax.min > 0, JSON.stringify(ax));
    const near = poolOf([rec('foods', 4, [pool('Alice:free', [row('a', 40, 30, 8), row('b', 20, 30, 8)])])]);
    check('0 is in the fit when the bars reach it or come near', fitAxis(near).min < 0, JSON.stringify(fitAxis(near)));
    check('no leader with a figure: no fit', fitAxis(poolOf([rec('foods', 1, [pool('Alice:free', [row('a', 40, 30, 2)])])])) === null);
    const pay = poolOf([rec('greedy step 1', 3, [pool('paid', [{ ...row('p', 50, 10, 8), payback: 40, paybackLow: 30, paybackHigh: 55 }, { ...row('q', 50, 10, 8), payback: 80, paybackLow: 50, paybackHigh: null }], { sortedBy: 'payback' })])]);
    const pa = fitAxis(pay);
    check('a payback range open above adds no upper end to the fit (its bar runs off the chart)', pa.max < 90 && pa.min < 31, JSON.stringify(pa));
}

// ---- to-beat now ----
{
    const pl = poolOf([rec('foods', 3, [pool('Alice:free', [row('a', 100, 20, 8), row('b', 50, 10, 8)])])]);
    check('toBeatNow: the latest round\'s level', toBeatNow(pl) === 40, String(toBeatNow(pl)));
    check('toBeatNow: none when the latest round has no figure at all', toBeatNow({ toBeat: [{ round: 2, value: 5 }], latestRound: 3 }) === null);
}

// ---- the column layout ----
{
    const l = columnLayout(10, 900, 1, 21);
    check('the column bars stand past the last round, in order, COLUMN_BAR_PX apart on screen', l.xs.length === 10 && l.xs[0] > 21 && l.xs.every((x, i) => i === 0 || x > l.xs[i - 1]) && l.sepX > 21 && l.sepX < l.xs[0] && l.xEnd > l.xs[9]);
    // The axis runs from xMin to xEnd over the plot's width: the bars' spacing in pixels is COLUMN_BAR_PX whatever the number of rounds.
    const px = (lay, xMin, plotPx) => (lay.xs[1] - lay.xs[0]) * plotPx / (lay.xEnd - xMin);
    check('the pixel spacing of the bars is COLUMN_BAR_PX whatever the number of rounds', Math.abs(px(l, 1, 900) - COLUMN_BAR_PX) < 1e-6 && Math.abs(px(columnLayout(10, 900, 1, 6), 1, 900) - COLUMN_BAR_PX) < 1e-6, `${px(l, 1, 900)} ${px(columnLayout(10, 900, 1, 6), 1, 900)}`);
    check('no bars: the column takes only its gap', columnLayout(0, 900, 1, 5).xs.length === 0);
}

// ---- a pool with lines, bands, hover, leaving and coming back ----
{
    const recs = [
        rec('foods', 1, [pool('Alice:free', [row('a', 100, 80, 2), row('b', 50, 90, 2)], { sortedBy: null, sortPending: 'buyerNet' })]),
        rec('foods', 2, [pool('Alice:free', [row('a', 110, 60, 4), row('b', 60, 70, 4), row('c', 20, 70, 4), row('d', 15, 50, 4), row('e', 12, 50, 4)])]),
        rec('foods', 3, [pool('Alice:free', [row('a', 120, 40, 6), row('c', 30, 50, 6), row('d', 15, 50, 6, { status: 'paused' }), row('e', 10, 20, 6)])]),
        rec('foods', 4, [pool('Alice:free', [row('a', 125, 30, 8), row('b', 55, 30, 8), row('c', 35, 30, 8), row('e', 12, 20, 8)])]),
        rec('foods', 5, [pool('Alice:free', [row('a', 126, 25, 10), row('c', 36, 25, 10), row('b', 56, 25, 10), row('e', 14, 15, 10)])]),
    ];
    const m = poolModel(poolOf(recs), { flying: ['c'] });
    check('mode lines: two points exist', m.mode === 'lines' && m.xMin === 2 && m.xMax === 5, JSON.stringify([m.mode, m.xMin, m.xMax]));
    check('the datasets are the lines the latest leaders have, the worst drawn first, the line that left (d) first of all', m.datasets.map((d) => d.id).join() === 'd,e,b,c,a', m.datasets.map((d) => d.id).join());
    const by = (id) => m.datasets.find((d) => d.id === id);
    check('a line that is not among the latest leaders is grey and dashed (out), the others take their rank colour', by('d').out && by('d').color === GREY && !by('a').out && by('a').color === rankColor(1, 4));
    check('only the top BAND_TOP lines have a band (and no band for a line that left, rank null)', m.datasets.filter((d) => d.band).map((d) => d.id).sort().join() === ['a', 'b', 'c'].join() && BAND_TOP === 3, m.datasets.filter((d) => d.band).map((d) => d.id).join());
    check('a gap or an aside point dashes the segment into it: b has rounds 2 and 4, so its second segment is dashed; d is aside in round 3', by('b').dashTo.join() === 'false,true,false', by('b').dashTo.join());
    check('a point segment between consecutive rounds is solid', by('a').dashTo.every((x) => x === false));
    const h = poolModel(poolOf(recs), { hover: 'e' });
    check('hover: the hovered line is wider and has a band; every other line is dim (and loses its band)', h.datasets.find((d) => d.id === 'e').band !== null && h.datasets.find((d) => d.id === 'e').width === 3 && h.datasets.filter((d) => d.id !== 'e').every((d) => d.dim) && h.datasets.find((d) => d.id === 'e').dim === false);
    check('the column: the latest round\'s leaders in the table\'s order, rank colours, the pulse on the candidate with a run in flight', m.column.map((c) => c.id).join() === 'a,c,b,e' && m.column[1].pulse === true && m.column.filter((c) => c.pulse).length === 1 && m.column[0].color === rankColor(1, 4) && m.column[0].desc === 'change a');
    check('axis fit and levels: the to-beat is the lowest lower end of the latest round', m.toBeat === 14 - 15 && m.zero === 0 && m.axis.min < m.toBeat, JSON.stringify([m.toBeat, m.axis]));
    check('an ascending figure: the axis is not reversed', m.reverse === false && m.better === 'higher');
}

// ---- before lines: the first rounds are bars only ----
{
    const first = rec('foods', 1, [pool('Alice:free', [row('a', 100, 80, 8, { status: 'first' }), row('b', 50, 90, 8, { status: 'first' })], { sortedBy: null })], { provisional: true });
    const h = buildHistory([], { firstLook: first });
    check('buildHistory with a first look and no finished round: a stage with no rounds, marked first look, the pool from the provisional record', h.stages.length === 1 && h.stages[0].firstLook === true && h.stages[0].rounds === 0 && h.stages[0].pools.length === 1);
    const m = poolModel(h.stages[0].pools[0]);
    check('mode bars: the column only, no datasets; the bars are from the first look\'s rows', m.mode === 'bars' && m.datasets.length === 0 && m.column.length === 2 && m.xMax > m.xMin);
    check('a stage that has finished rounds ignores a provisional record of the same stage', buildHistory([rec('foods', 1, [pool('Alice:free', [row('a', 1, 1, 8)])])], { firstLook: first }).stages[0].firstLook === false);
    check('a provisional that is not marked provisional is ignored (a finished record is never a first look)', buildHistory([], { firstLook: { ...first, provisional: false } }).stages.length === 0);
    const one = poolModel(poolOf([rec('foods', 2, [pool('Alice:free', [row('a', 100, 20, 8)])])]));
    check('one finished round, one point each: still bars only', one.mode === 'bars' && one.datasets.length === 0);
    const none = poolModel(poolOf([rec('foods', 1, [pool('Alice:free', [row('a', 100, 20, 2)], { sortedBy: null })])]));
    check('nothing has a figure: mode empty, no axis (the note, no canvas)', none.mode === 'empty' && none.axis === null && none.datasets.length === 0);
}

// ---- a paid pool ----
{
    const paid = (id, pay, lo, hi) => ({ ...row(id, 50, 10, 8), payback: pay, paybackLow: lo, paybackHigh: hi });
    const recs = [
        rec('greedy step 1', 1, [pool('paid', [paid('p', 40, 30, 55), paid('q', 80, 50, null)], { sortedBy: 'payback' })]),
        rec('greedy step 1', 2, [pool('paid', [paid('p', 42, 35, 52), paid('q', 78, 55, 120)], { sortedBy: 'payback' })]),
    ];
    const m = poolModel(poolOf(recs));
    check('a paid pool: the axis is reversed (shorter payback at the top: up is better) and the column keeps the open upper end flagged', m.reverse === true && m.better === 'lower' && m.col === 'payback' && m.mode === 'lines' && m.column.every((c) => c.openHigh === false));
    const open = poolModel(poolOf([recs[0]]));
    check('an open payback range is flagged on the column bar (the view runs it off the edge)', open.column.find((c) => c.id === 'q').openHigh === true);
    const qBand = (m.lines || m.datasets || []).find((l) => l.id === 'q')?.band;
    check('an open payback range has a band too: its open end is Infinity (drawn to the edge and faded), the closed round a plain range', qBand?.[0]?.high === Infinity && Number.isFinite(qBand?.[0]?.low) && Number.isFinite(qBand?.[1]?.high), JSON.stringify(qBand));
}

console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
