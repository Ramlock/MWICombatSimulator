// Test: the chart's history data (src/whatif/history.mjs): round records grouped by stage, pool and candidate; the 4-seed rule; a payback pool; leaders that
// leave and come back; a resumed search's replayed stages; a stage with no records. Pure, synthetic records only.
// Usage: node tools/test/whatif-history.mjs        Exit code 0 on pass, 1 on fail.
import { buildHistory, lastRuns, columnOf } from '../../src/whatif/history.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

// A free-pool leader row: the buyer's gain `net` with a half-range `half`, on `seeds` reading seeds.
const row = (id, net, half, seeds, extra = {}) => ({ id, desc: 'change ' + id, player: 'Alice', status: 'contending', readingSeeds: seeds, tooFew: seeds === 0, seeds: 40, reading: net * 2, low: net * 2 - half, high: net * 2 + half, buyerNet: net, netLow: net - half, netHigh: net + half, payback: null, ...extra });
const pool = (key, leaders, extra = {}) => ({ key, size: 12, contending: 8, paused: 2, line: null, leaders, sortedBy: 'buyerNet', ...extra });
const rec = (stage, round, pools, extra = {}) => ({ round, stage, simHours: round * 100, pools, ...extra });

// ---- one stage, one pool, leaders coming and going ----
{
    const recs = [
        rec('foods', 1, [pool('Alice:free', [row('a', 100, 80, 2), row('b', 50, 90, 2), row('c', 10, 90, 2)], { sortedBy: null, sortPending: 'buyerNet' })]),
        rec('foods', 2, [pool('Alice:free', [row('a', 110, 60, 4), row('b', 60, 70, 4), row('c', 20, 70, 4)])]),
        rec('foods', 3, [pool('Alice:free', [row('a', 120, 40, 6), row('c', 30, 50, 6), row('d', 15, 50, 2, { status: 'paused' })])]),
        rec('foods', 4, [pool('Alice:free', [row('a', 125, 30, 8), row('b', 55, 30, 8), row('c', 35, 30, 8, { prev: 2 })])]),
    ];
    const h = buildHistory(recs);
    check('one stage and one pool, named by the record, with its player and kind read from the key', h.stages.length === 1 && h.stages[0].stage === 'foods' && h.stages[0].rounds === 4 && h.stages[0].pools.length === 1 && h.stages[0].pools[0].player === 'Alice' && h.stages[0].pools[0].kind === 'free');
    const p = h.stages[0].pools[0], by = (id) => p.lines.find((l) => l.id === id);
    check('the sort column is the pool\'s (the pending column while it is not sorted yet), the better direction higher', p.col === 'buyerNet' && p.better === 'higher');
    check('no figure and no point under 4 reading seeds: round 1 (2 seeds) draws no point, rounds from 4 seeds do', by('a').points.map((x) => x.round).join() === '2,3,4' && by('b').points.map((x) => x.round).join() === '2,4');
    check('a point carries the figure and its range from the buyer\'s gain fields', JSON.stringify(by('a').points[0]) === JSON.stringify({ round: 2, value: 110, low: 50, high: 170, openHigh: false, seeds: 4, aside: false }), JSON.stringify(by('a').points[0]));
    check('a leader that left and came back is one line with a gap in its rounds', by('b').points.map((x) => x.round).join() === '2,4' && by('b').inLatest);
    check('a leader under 4 seeds that is set aside is not drawn (no point at all) and a leader the rows never gave a figure to has no line', by('d') === undefined);
    check('a candidate no longer among the latest leaders: not in latest, no rank, its last round kept', by('c').inLatest && !p.lines.some((l) => !l.inLatest && l.rank !== null));
    check('latest: the latest round\'s leaders in the table\'s order with rank, the previous position the core gave, figure and range', p.latest.length === 3 && p.latest[0].id === 'a' && p.latest[0].rank === 1 && p.latest[2].prev === 2 && p.latest[1].prev === null && p.latest[0].value === 125 && p.latest[0].low === 95 && p.latest[0].high === 155 && p.latestRound === 4);
    check('toBeat: per round, the lowest lower end among the leaders that have a figure (none in round 1)', JSON.stringify(p.toBeat) === JSON.stringify([{ round: 2, value: 20 - 70 }, { round: 3, value: 30 - 50 }, { round: 4, value: 5 }]), JSON.stringify(p.toBeat));
    check('a line the latest round does not list has no rank', (() => { const r2 = buildHistory([...recs, rec('foods', 5, [pool('Alice:free', [row('a', 126, 25, 10)])])]).stages[0].pools[0]; const l = r2.lines.find((x) => x.id === 'b'); return l.rank === null && !l.inLatest && l.lastRound === 4; })());
}

// ---- a set-aside leader with a figure keeps its point, marked ----
{
    const p = buildHistory([rec('screen', 1, [pool('free', [row('a', 100, 10, 8, { status: 'paused' })])])]).stages[0].pools[0];
    check('a set-aside leader that has a figure is drawn, marked aside; a refuted one is not a leader any more', p.lines[0].points[0].aside === true && buildHistory([rec('screen', 1, [pool('free', [row('a', 100, 10, 8, { status: 'refuted' })])])]).stages[0].pools[0].lines.length === 0);
}

// ---- a paid pool: the payback, lower is better, an open upper end ----
{
    const paid = (id, pay, lo, hi, seeds = 8) => ({ ...row(id, 50, 10, seeds), payback: pay, paybackLow: lo, paybackHigh: hi });
    const h = buildHistory([rec('greedy step 1', 1, [pool('paid', [paid('p', 40, 30, 55), paid('q', 80, 50, null)], { sortedBy: 'payback' })]), rec('greedy step 1', 2, [pool('paid', [paid('p', 42, 35, 52), paid('q', 78, 55, 120)], { sortedBy: 'payback' })])]);
    const p = h.stages[0].pools[0];
    check('a paid pool reads the payback and its range, lower is better', p.col === 'payback' && p.better === 'lower' && p.kind === 'paid' && p.player === null && p.lines[0].points[0].value === 40 && p.lines[0].points[0].low === 30 && p.lines[0].points[0].high === 55);
    check('a payback range with no upper end is open-ended', p.lines[1].points[0].openHigh === true && p.lines[1].points[0].high === null && p.lines[1].points[1].openHigh === false);
    check('toBeat on a payback pool is the highest upper end (the worse end) of the leaders with a closed range', JSON.stringify(p.toBeat) === JSON.stringify([{ round: 1, value: 55 }, { round: 2, value: 120 }]), JSON.stringify(p.toBeat));
    check('columnOf: an unknown column reads as the party gain', columnOf('nonsense').value === 'reading' && columnOf('payback').low === 'paybackLow');
}

// ---- several stages, several pools, and the stages in order of their first record ----
{
    const recs = [
        rec('foods', 1, [pool('Alice:free', [row('a', 1, 1, 8)]), pool('Bob:free', [row('b', 1, 1, 8)])]),
        rec('drinks', 1, [pool('Alice:free', [row('a', 1, 1, 8)])]),
        rec('foods', 2, [pool('Alice:free', [row('a', 1, 1, 8)]), pool('Bob:free', [row('b', 1, 1, 8)])]),
        rec('screen', 1, [pool('free', [row('x', 1, 1, 8)]), pool('paid', [row('y', 1, 1, 8)])]),
    ];
    const h = buildHistory(recs);
    check('stages in the order they first appeared, each with its pools in the order of their keys', h.stages.map((s) => s.stage).join() === 'foods,drinks,screen' && h.stages[0].pools.map((q) => q.key).join() === 'Alice:free,Bob:free' && h.stages[2].pools.map((q) => q.key).join() === 'free,paid');
    check('a stage\'s rounds count is its last round; a stage with one round says 1', h.stages[0].rounds === 2 && h.stages[1].rounds === 1);
}

// ---- a resumed search: the stage is replayed from round 1, only its last run stays ----
{
    const run = (n) => Array.from({ length: n }, (_, i) => rec('foods', i + 1, [pool('Alice:free', [row('a', 10 * (i + 1), 5, 8)])]));
    const recs = [...run(5), ...run(3), rec('drinks', 1, [pool('Alice:free', [row('a', 1, 1, 8)])])];
    const h = buildHistory(recs);
    check('a stage whose round number does not rise starts again: only the last run is kept (3 rounds, not 8)', h.stages[0].rounds === 3 && h.stages[0].pools[0].lines[0].points.length === 3 && lastRuns(recs)[0].records.length === 3);
    check('a duplicated round (the same number twice in a row) keeps the later one', buildHistory([rec('foods', 1, [pool('free', [row('a', 1, 1, 8)])]), rec('foods', 1, [pool('free', [row('a', 99, 1, 8)])])]).stages[0].pools[0].lines[0].points[0].value === 99);
}

// ---- no records, a provisional record, junk ----
{
    check('no records give no stages', buildHistory([]).stages.length === 0 && buildHistory(null).stages.length === 0 && buildHistory(undefined).stages.length === 0);
    check('a provisional first look and records without a stage, a round or pools are ignored', buildHistory([{ ...rec('foods', 1, [pool('free', [row('a', 1, 1, 8)])]), provisional: true }, { round: 1 }, { stage: 'x', pools: [] }, null, 7]).stages.length === 0);
    check('a pool with no leaders gives a pool with no lines and nothing to beat', (() => { const p = buildHistory([rec('screen', 1, [pool('free', [])])]).stages[0].pools[0]; return p.lines.length === 0 && p.toBeat.length === 0 && p.latest.length === 0; })());
    check('an older record (no sortedBy, no figure fields) reads without throwing and draws no point', (() => { try { const p = buildHistory([rec('screen', 1, [{ key: 'free', leaders: [{ id: 'z', desc: 'old', status: 'contending' }] }])]).stages[0].pools[0]; return p.lines.length === 0 && p.latest.length === 1 && p.latest[0].value === null; } catch { return false; } })());
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
