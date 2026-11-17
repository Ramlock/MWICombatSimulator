// Test: the note a what-if chart shows where no change has a figure yet (src/whatif/chartView.mjs). A stage that runs, or the last stage of a stopped
// search (it may run on after Resume), reads chart.noFigures ("... a figure needs yet."); a stage that has ended reads chart.noFiguresEnded ("No change
// reached ..."), since no figure is to come. Which stages have ended: endedStages (the rule main.js passes to the chart host as ctx.ended).
// Runs in node on a small fake DOM: a chart with no figure builds no Chart.js chart, so no canvas is drawn.
// Usage: node tools/test/run-tests.mjs whatif-chart-note.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

class El {
    constructor(tag) { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.style = {}; this.hidden = false; this.text = ''; this.className = ''; this.parent = null; }
    get textContent() { return this.text + this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { for (const c of this.childNodes) c.parent = null; this.childNodes = []; this.text = String(v); }
    get firstChild() { return this.childNodes[0] ?? null; }
    append(...kids) { for (let k of kids) { if (typeof k === 'string') { const s = new El('#text'); s.text = k; k = s; } k.remove(); k.parent = this; this.childNodes.push(k); } }
    replaceChildren(...kids) { this.textContent = ''; this.append(...kids); }
    remove() { if (this.parent) { this.parent.childNodes = this.parent.childNodes.filter((x) => x !== this); this.parent = null; } }
    addEventListener() {}
    getContext() { throw new Error('a chart with no figure must not be drawn'); }
}
globalThis.document = { createElement: (tag) => new El(tag) };

const { createChartHost, endedStages } = await import(pathToFileURL(path.join(root, 'src/whatif/chartView.mjs')).href);
const { buildHistory } = await import(pathToFileURL(path.join(root, 'src/whatif/history.mjs')).href);
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en/common.json'), 'utf8')).whatIf.chart;
const t = (key, o = {}) => { const s = en[key.replace(/^chart\./, '')]; return s == null ? key : s.replace(/\{\{(\w+)\}\}/g, (_, k) => o[k]); };
const stillToCome = t('chart.noFigures', { n: 4 }), noneCame = t('chart.noFiguresEnded', { n: 4 });
check('the two notes exist in en and differ', !!en.noFiguresEnded && stillToCome !== noneCame, JSON.stringify([stillToCome, noneCame]));

// Two stages whose leaders all have fewer fresh runs than a figure needs (2 of 4): foods, then the screen (Change 1).
const row = (id) => ({ id, desc: 'Magic ' + id, player: 'Player 1', cost: 0, status: 'contending', seeds: 2, readingSeeds: 2, tooFew: true, reading: 100, low: 50, high: 150, buyerNet: 50, netLow: 25, netHigh: 75, payback: null });
const rec = (stage, key) => ({ round: 1, stage, simHours: 100, coverage: 0.99, candidates: { total: 2, contending: 2, paused: 0, refuted: 0, locked: 0 }, pools: [{ key, size: 2, contending: 2, paused: 0, sortedBy: 'buyerNet', leaders: [row('a'), row('b')] }] });
const history = buildHistory([rec('foods', 'Player 1:free'), rec('screen', 'free')]);
const container = new El('div');
const host = createChartHost(container, { t, format: (v) => String(v), stageLabel: (s) => s });
const notes = () => Object.fromEntries(container.childNodes.map((st) => [st.dataset.stage, st.childNodes.filter((c) => c.className === 'whatif-chart').map((b) => b.childNodes.find((x) => /whatif-chart-note/.test(x.className))).map((n) => (n.hidden ? '(hidden)' : n.textContent)).join('|')]));
const draw = (running, live, done) => { host.update(history, { running, ended: endedStages(history, { running, live, done }) }); return notes(); };

let n = draw('screen', true, false);
check('running search: the running stage reads the note of figures yet to come, the stage before it (ended) the ended note', n.screen === stillToCome && n.foods === noneCame, JSON.stringify(n));
n = draw(null, true, false); // the screen's end mark names it (main.js: running is null), its pick checks run
check('running search, the last stage ended (its pick checks run): every stage reads the ended note', n.screen === noneCame && n.foods === noneCame, JSON.stringify(n));
n = draw(null, false, false);
check('stopped search: its last stage (it may run on after Resume) reads the note of figures yet to come, the stage before it the ended note', n.screen === stillToCome && n.foods === noneCame, JSON.stringify(n));
n = draw(null, false, true);
check('finished search: every stage reads the ended note', n.screen === noneCame && n.foods === noneCame, JSON.stringify(n));

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
