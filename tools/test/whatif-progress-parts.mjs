// Test: the stacked progress parts (tools/whatif/progress.mjs) across a whole search, the runner passing them through,
// and the panel drawing one row per part (src/whatif/panel.mjs renderParts), with the old single line when a progress
// file has no parts. Generic fixtures only.
// Usage: node tools/test/whatif-progress-parts.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createParts } = await imp('tools/whatif/progress.mjs');
const panel = await imp('src/whatif/panel.mjs');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locales = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(read(`locales/${l}/common.json`)).whatIf]));
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const lookup = (o, key) => key.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const tIn = (loc) => (key, params = {}) => { const s = lookup(locales[loc], key); return typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k])) : '#' + key; };
const t = tIn('en');

// 4x50,4x150,8x300 with 40 candidates and keep 10: screen, halving 1, halving 2.
const plan = { stages: [{ k: 4, h: 50 }, { k: 4, h: 150 }, { k: 8, h: 300 }], keep: [10, 3], candidates: 40 };
const tr = createParts(plan);
const kinds = (ps) => ps.map((p) => `${p.kind}${p.kind === 'confirmation' ? '' : p.index}:${p.state}`).join(' ');

let ps = tr.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164, etaSeconds: 900 });
check('start: screen running, both halvings waiting', kinds(ps) === 'screen0:running halving1:waiting halving2:waiting', kinds(ps));
check('start: waiting halvings carry up-to counts (pool times seeds)', ps[1].runsUpTo === 40 && ps[1].candidatesLeft === 10 && ps[2].runsUpTo === 24 && ps[2].candidatesLeft === 3, JSON.stringify(ps.slice(1)));
// pool entering halving 1 is min(40, keep[0]=10) = 10 candidates x 4 seeds = 40
check('start: halving 1 up to 10 candidates x 4 seeds', ps[1].runsUpTo === 40, String(ps[1].runsUpTo));
check('start: the running row has its runs and eta', ps[0].runsPlanned === 164 && ps[0].runsDone === 0 && ps[0].etaSeconds === 900);

ps = tr.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 100, runsPlanned: 164, etaSeconds: 300 });
check('screen midway: runs advance', ps[0].runsDone === 100 && ps[0].etaSeconds === 300);

ps = tr.sync({ stage: 'halving 1', candidatesLeft: 10, runsDone: 0, runsPlanned: 36, etaSeconds: 600 });
check('halving 1 running: screen done and full', kinds(ps) === 'screen0:done halving1:running halving2:waiting' && ps[0].runsDone === 164 && ps[0].runsPlanned === 164 && ps[0].etaSeconds === 0, kinds(ps));
check('halving 1 running: candidates left on the row', ps[1].candidatesLeft === 10);

ps = tr.sync({ stage: 'halving 2', candidatesLeft: 3, runsDone: 5, runsPlanned: 24, etaSeconds: 500 });
check('halving 2 running', kinds(ps) === 'screen0:done halving1:done halving2:running' && ps[1].runsDone === 36, kinds(ps));

ps = tr.sync({ stage: 'greedy step 1', candidatesLeft: 3, runsDone: 1, runsPlanned: 24, etaSeconds: 100 });
check('greedy step 1 added when it starts', kinds(ps) === 'screen0:done halving1:done halving2:done step1:running', kinds(ps));
ps = tr.sync({ stage: 'greedy step 2', candidatesLeft: 2, runsDone: 0, runsPlanned: 16, etaSeconds: 80 });
check('greedy step 2 added, step 1 stays full', kinds(ps) === 'screen0:done halving1:done halving2:done step1:done step2:running' && ps[3].runsDone === 24, kinds(ps));
ps = tr.sync({ stage: 'confirmation', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('confirmation added after the steps', kinds(ps) === 'screen0:done halving1:done halving2:done step1:done step2:done confirmation:running', kinds(ps));
const stopped = tr.sync({ stage: 'stopped', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('stopped mid-way: the rows stay as they were', kinds(stopped) === kinds(ps) && stopped.at(-1).runsDone === 2, kinds(stopped));
ps = tr.sync({ stage: 'done', candidatesLeft: 0, runsDone: 16, runsPlanned: 16, etaSeconds: 0 });
check('done: every row done', ps.every((p) => p.state === 'done') && ps.length === 6, kinds(ps));

// No greedy step accepted: no confirmation row, the run ends at the last halving.
const tr2 = createParts(plan);
tr2.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164 });
tr2.sync({ stage: 'halving 1', candidatesLeft: 10, runsDone: 0, runsPlanned: 36 });
tr2.sync({ stage: 'halving 2', candidatesLeft: 3, runsDone: 0, runsPlanned: 24 });
ps = tr2.sync({ stage: 'done', candidatesLeft: 0, runsDone: 24, runsPlanned: 24 });
check('no step accepted: three rows, all done', kinds(ps) === 'screen0:done halving1:done halving2:done', kinds(ps));
check('probe before the screen: all rows waiting', kinds(createParts(plan).sync({ stage: 'probe' })) === 'screen0:waiting halving1:waiting halving2:waiting');
check('a single stage plan has the screen only', createParts({ stages: [{ k: 4, h: 50 }], keep: [], candidates: 5 }).sync({ stage: 'screen', runsPlanned: 3, runsDone: 1 }).length === 1);

// The optimizer wires it into progress.json; the runner passes progress on unchanged.
check('optimizer: createParts after the candidates, parts in progress', /partsTracker = createParts\(/.test(read('tools/whatif/optimize.mjs')) && /progress\.parts = partsTracker\.sync\(progress\)/.test(read('tools/whatif/optimize.mjs')));
check('runner: progress object is passed through whole (no field picked)', /s\.handle\.onProgress = \(p\) => \{ s\.progress = p; \}/.test(read('tools/whatif/runner/server.mjs')));

// Panel: one row per part, the right classes and texts.
const html = panel.renderProgress({ state: 'running', progress: { stage: 'halving 1', candidatesLeft: 10, runsDone: 36, runsPlanned: 80, secondsPerRun: 241, etaSeconds: 235, elapsedSeconds: 4350, parts: [
    { kind: 'screen', index: 0, state: 'done', runsPlanned: 80, runsDone: 80, candidatesLeft: 40, etaSeconds: 0 },
    { kind: 'halving', index: 1, state: 'running', runsPlanned: 80, runsDone: 36, candidatesLeft: 10, etaSeconds: 235 },
    { kind: 'halving', index: 2, state: 'waiting', runsPlanned: 0, runsDone: 0, runsUpTo: 24, candidatesLeft: 3, etaSeconds: null },
] } }, t);
const rows = [...html.matchAll(/<div class="whatif-part whatif-part-(\w+)"/g)].map((m) => m[1]);
check('panel: one row per part with its state class', rows.join(' ') === 'done running waiting', rows.join(' '));
const plain = html.replace(/<span class="whatif-part-mark">[^<]*<\/span>/g, (m) => m).replace(/<[^>]+>/g, '');
check('panel: title is Running · stage 2', plain.includes('Running · stage 2'), plain);
check('panel: done row text', plain.includes('Screen') && /80 \/ 80 runs · done/.test(plain), plain);
check('panel: running row text and options left', plain.includes('Halving 1 · 10 options left') && /36 \/ 80 runs · 0:03:55 left/.test(plain), plain);
check('panel: waiting row says up to N runs', plain.includes('Halving 2 · 3 options left') && plain.includes('up to 24 runs'), plain);
check('panel: marks check, play, none', html.includes('✓') && html.includes('▶'));
check('panel: small line seconds per run and elapsed, no whole-search time', plain.includes('Seconds per run 241') && plain.includes('elapsed 1:12:30') && !/whole|total time/i.test(plain), plain);
check('panel: bars at 100, 45 and 0 percent', ['width: 100%', 'width: 45%', 'width: 0%'].every((w) => html.includes(w)));
check('panel: numbers keep their raw value', html.includes('data-num="36"') && html.includes('data-num="241"'));
const stoppedHtml = panel.renderProgress({ state: 'stopped', progress: { stage: 'stopped', parts: [{ kind: 'screen', index: 0, state: 'running', runsPlanned: 10, runsDone: 4, etaSeconds: 5 }] } }, t);
check('panel: stopped keeps the rows', stoppedHtml.includes('whatif-part-running'));
// Old progress (no parts): today's single line.
const old = panel.renderProgress({ state: 'running', progress: { stage: 'screen', candidatesLeft: 120, runsDone: 30, runsPlanned: 120, secondsPerRun: 12.5, etaSeconds: 3725 } }, t);
check('old progress without parts: the single line unchanged', !old.includes('whatif-part') && old.includes('width: 25%') && old.includes('1:02:05') && old.includes('candidates left'));
check('empty parts array: the single line', !panel.renderProgress({ state: 'running', progress: { stage: 'screen', parts: [], runsPlanned: 1, runsDone: 0 } }, t).includes('whatif-part'));

// Strings in en, pt, zh.
const keys = ['stageN', 'partScreen', 'partHalving', 'partStep', 'partConfirmation', 'optionsLeft', 'runsOf', 'upTo', 'timeLeft', 'done', 'secondsPerRunCap', 'elapsed'];
for (const l of ['en', 'pt', 'zh']) check(`strings: ${l} has every progress key`, keys.every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length), l);
check('strings: placeholders match across languages', keys.every((k) => ['pt', 'zh'].every((l) => (locales[l].progress[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.progress[k].match(/\{\{\w+\}\}/g) || []).sort().join())));
const ptHtml = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 2, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, tIn('pt'));
check('strings: pt renders without a missing key', !ptHtml.includes('#'), ptHtml);

process.exit(failed ? 1 : 0);
