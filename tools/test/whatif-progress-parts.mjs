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
const plan = { stages: [{ k: 4, h: 50 }, { k: 4, h: 150 }, { k: 8, h: 300 }], keep: [10, 3], candidates: 40, maxSteps: 20 };
const tr = createParts(plan);
const kinds = (ps) => ps.map((p) => `${p.kind}${p.kind === 'confirmation' ? '' : p.index}:${p.state}`).join(' ');
const P = 'picks0:waiting steps0:waiting confirmation:waiting';

const ps0 = () => createParts(plan).sync({ stage: 'screen', runsPlanned: 1, runsDone: 0 });
let ps = tr.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164, etaSeconds: 900 });
check('start: screen running, both halvings waiting', kinds(ps) === 'screen0:running halving1:waiting halving2:waiting ' + P, kinds(ps));
check('start: waiting halvings carry up-to counts (pool times seeds)', ps[1].runsUpTo === 80 && ps[1].candidatesLeft === 20 && ps[2].runsUpTo === 48 && ps[2].candidatesLeft === 6, JSON.stringify(ps.slice(1)));
// pool entering halving 1 is at most min(40, 2 x keep[0]=10) = 20 candidates (10 free and 10 paid) x 4 seeds = 80
check('start: halving 1 up to 20 candidates x 4 seeds', ps[1].runsUpTo === 80, String(ps[1].runsUpTo));
check('start: the running row has its runs and eta', ps[0].runsPlanned === 164 && ps[0].runsDone === 0 && ps[0].etaSeconds === 900);

ps = tr.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 100, runsPlanned: 164, etaSeconds: 300 });
check('screen midway: runs advance', ps[0].runsDone === 100 && ps[0].etaSeconds === 300);

ps = tr.sync({ stage: 'halving 1', candidatesLeft: 10, runsDone: 0, runsPlanned: 36, etaSeconds: 600 });
check('halving 1 running: screen done and full', kinds(ps) === 'screen0:done halving1:running halving2:waiting ' + P && ps[0].runsDone === 164 && ps[0].runsPlanned === 164 && ps[0].etaSeconds === 0, kinds(ps));
check('halving 1 running: candidates left on the row', ps[1].candidatesLeft === 10);

ps = tr.sync({ stage: 'halving 2', candidatesLeft: 3, runsDone: 5, runsPlanned: 24, etaSeconds: 500 });
check('halving 2 running', kinds(ps) === 'screen0:done halving1:done halving2:running ' + P && ps[1].runsDone === 36, kinds(ps));

ps = tr.sync({ stage: 'greedy step 1', candidatesLeft: 3, runsDone: 1, runsPlanned: 24, etaSeconds: 100, picksPlanned: 32, picksDone: 32 });
check('greedy step 1 added when it starts', kinds(ps) === 'screen0:done halving1:done halving2:done picks0:waiting step1:running moreSteps1:waiting confirmation:waiting', kinds(ps));
ps = tr.sync({ stage: 'greedy step 2', candidatesLeft: 2, runsDone: 0, runsPlanned: 16, etaSeconds: 80 });
check('greedy step 2 added, step 1 stays full', kinds(ps) === 'screen0:done halving1:done halving2:done picks0:waiting step1:done step2:running moreSteps2:waiting confirmation:waiting' && ps[4].runsDone === 24, kinds(ps));
ps = tr.sync({ stage: 'confirmation', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('confirmation added after the steps', kinds(ps) === 'screen0:done halving1:done halving2:done picks0:done step1:done step2:done confirmation:running', kinds(ps));
const stopped = tr.sync({ stage: 'stopped', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('stopped mid-way: the rows stay as they were', kinds(stopped) === kinds(ps) && stopped.at(-1).runsDone === 2, kinds(stopped));
ps = tr.sync({ stage: 'done', candidatesLeft: 0, runsDone: 16, runsPlanned: 16, etaSeconds: 0 });
check('done: every row done', ps.every((p) => p.state === 'done') && ps.length === 7, kinds(ps));

check('start: the steps row carries the plan max steps', ps0().find((p) => p.kind === 'steps').maxSteps === 20);
{
    const t3 = createParts(plan);
    for (let i = 1; i < 19; i++) t3.sync({ stage: `greedy step ${i}`, runsPlanned: 4, runsDone: 0 });
    t3.sync({ stage: 'greedy step 19', runsPlanned: 4, runsDone: 0 });
    const a = t3.sync({ stage: 'greedy step 19', runsPlanned: 4, runsDone: 1 }).find((p) => p.kind === 'moreSteps');
    check('after step 19 the grey row says 1 more', a?.stepsLeft === 1 && a.state === 'waiting', JSON.stringify(a));
    const b = t3.sync({ stage: 'greedy step 20', runsPlanned: 4, runsDone: 1 });
    check('at step 20 the more-steps row is hidden', !b.some((p) => p.kind === 'moreSteps') && b.at(-1).kind === 'confirmation');
    const c = createParts(plan); c.sync({ stage: 'greedy step 2', runsPlanned: 1, runsDone: 0 });
    const d = c.sync({ stage: 'confirmation', runsPlanned: 1, runsDone: 0 });
    check('once the confirmation starts the more-steps row is gone', !d.some((p) => p.kind === 'moreSteps') && d.at(-1).state === 'running');
}
// No greedy step accepted: no confirmation row, the run ends at the last halving.
const tr2 = createParts(plan);
tr2.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164 });
tr2.sync({ stage: 'halving 1', candidatesLeft: 10, runsDone: 0, runsPlanned: 36 });
tr2.sync({ stage: 'halving 2', candidatesLeft: 3, runsDone: 0, runsPlanned: 24 });
ps = tr2.sync({ stage: 'done', candidatesLeft: 0, runsDone: 24, runsPlanned: 24 });
check('no step accepted: three rows, all done', kinds(ps) === 'screen0:done halving1:done halving2:done picks0:waiting steps0:waiting confirmation:waiting', kinds(ps));
check('probe before the screen: all rows waiting', kinds(createParts(plan).sync({ stage: 'probe' })) === 'screen0:waiting halving1:waiting halving2:waiting ' + P);
check('a single stage plan has the screen only', createParts({ stages: [{ k: 4, h: 50 }], keep: [], candidates: 5, maxSteps: 20 }).sync({ stage: 'screen', runsPlanned: 3, runsDone: 1 }).length === 4);

// Stage F and Stage D (plan.fillings): two parts come first, the pool of the rest is unknown until setCandidates.
{
    const tf = createParts({ ...plan, candidates: null, fillings: true });
    let q = tf.sync({ stage: 'need' });
    check('fillings: foods and drinks first, everything waiting, no up-to counts before the candidates are known', kinds(q) === 'foods0:waiting drinks0:waiting screen0:waiting halving1:waiting halving2:waiting ' + P && q.every((p) => p.runsUpTo === undefined), kinds(q));
    q = tf.sync({ stage: 'foods', candidatesLeft: 120, runsDone: 3, runsPlanned: 480, etaSeconds: 900 });
    check('fillings: foods running with its runs and candidates', kinds(q).startsWith('foods0:running drinks0:waiting screen0:waiting') && q[0].runsPlanned === 480 && q[0].candidatesLeft === 120, kinds(q));
    q = tf.sync({ stage: 'drinks', candidatesLeft: 585, runsDone: 0, runsPlanned: 100 });
    check('fillings: drinks running, foods done and full', kinds(q).startsWith('foods0:done drinks0:running screen0:waiting') && q[0].runsDone === 480, kinds(q));
    tf.setCandidates(40);
    q = tf.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164 });
    check('fillings: after setCandidates the waiting halvings carry up-to counts (up to 2 x keep)', kinds(q) === 'foods0:done drinks0:done screen0:running halving1:waiting halving2:waiting ' + P && q[3].runsUpTo === 80 && q[4].runsUpTo === 48, JSON.stringify(q.slice(3, 5)));
    check('fillings off: the plan has no foods or drinks parts', !tr.sync({ stage: 'foods' }).some((p) => p.kind === 'foods'));
    const fh = panel.renderProgress({ state: 'running', progress: { parts: q } }, t).replace(/<[^>]+>/g, '');
    check('panel: foods and drinks rows are labelled', fh.includes('Best foods') && fh.includes('Best drinks'), fh);
}

// The part "Confirming the picks": one row for the whole greedy phase, its counts the optimizer's (distinct runs, never dropping).
{
    const tp = createParts(plan);
    const at = (stage, extra = {}) => tp.sync({ stage, runsPlanned: 4, runsDone: 0, candidatesLeft: 0, ...extra }).find((p) => p.kind === 'picks');
    check('picks: waiting and empty before any check', at('halving 2').state === 'waiting' && at('halving 2').runsPlanned === 0);
    let p = at('confirming picks', { picksPlanned: 32, picksDone: 10 });
    check('picks: running with its counts while a pick is checked', p.state === 'running' && p.runsPlanned === 32 && p.runsDone === 10, JSON.stringify(p));
    const all = tp.sync({ stage: 'confirming picks', runsPlanned: 4, runsDone: 0, picksPlanned: 32, picksDone: 10 });
    check('picks: the row before it (a step row) is done while a pick is checked', all.filter((r) => r.state === 'running').length === 1, kinds(all));
    p = at('confirming picks', { picksPlanned: 48, picksDone: 20 });
    check('picks: planned grows with more seeds', p.runsPlanned === 48 && p.runsDone === 20);
    p = at('confirming picks', { picksPlanned: 40, picksDone: 60 });
    check('picks: planned never drops and done never exceeds it', p.runsPlanned === 48 && p.runsDone === 48, JSON.stringify(p));
    p = at('greedy step 1', { picksPlanned: 48, picksDone: 48 });
    check('picks: between two checks the row is grey with its counts', p.state === 'waiting' && p.runsDone === 48 && p.runsPlanned === 48, JSON.stringify(p));
    p = at('confirming picks', { picksPlanned: 64, picksDone: 50 });
    check('picks: running again at the next step', p.state === 'running' && p.runsPlanned === 64);
    p = at('confirmation', { picksPlanned: 64, picksDone: 60 });
    check('picks: done and full once the confirmation starts', p.state === 'done' && p.runsDone === 64, JSON.stringify(p));
    const h = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'picks', index: 0, state: 'running', runsPlanned: 32, runsDone: 10, etaSeconds: 60 }, { kind: 'picks', index: 0, state: 'waiting', runsPlanned: 32, runsDone: 32 }] } }, t).replace(/<[^>]+>/g, '');
    check('picks: the panel labels the row and shows its runs', h.includes('Confirming the picks') && h.includes('10 / 32 runs') && h.includes('32 / 32 runs'), h);
    check('picks: pt and zh labels exist', ['pt', 'zh'].every((l) => locales[l].progress.partPicks && locales[l].progress.partPicks !== locales.en.progress.partPicks));
}

// The optimizer wires it into progress.json; the runner passes progress on unchanged.
check('optimizer: createParts after the candidates, parts in progress', /partsTracker = createParts\(/.test(read('tools/whatif/core.mjs')) && /progress\.parts = partsTracker\.sync\(progress\)/.test(read('tools/whatif/core.mjs')));
check('runner: progress object is passed through whole (no field picked)', /s\.handle\.onProgress = \(p\) => \{ s\.progress = p; \}/.test(read('tools/whatif/runner/server.mjs')));

// Panel: one row per part, the right classes and texts.
const html = panel.renderProgress({ state: 'running', progress: { stage: 'halving 1', candidatesLeft: 10, runsDone: 36, runsPlanned: 80, secondsPerRun: 241.4567, etaSeconds: 235, elapsedSeconds: 4350, parts: [
    { kind: 'screen', index: 0, state: 'done', runsPlanned: 80, runsDone: 80, candidatesLeft: 40, etaSeconds: 0 },
    { kind: 'halving', index: 1, state: 'running', runsPlanned: 80, runsDone: 36, candidatesLeft: 10, etaSeconds: 235 },
    { kind: 'halving', index: 2, state: 'waiting', runsPlanned: 0, runsDone: 0, runsUpTo: 24, candidatesLeft: 3, etaSeconds: null },
    { kind: 'steps', index: 0, state: 'waiting', maxSteps: 20 },
    { kind: 'confirmation', index: 0, state: 'waiting' },
] } }, t);
const rows = [...html.matchAll(/<div class="whatif-part whatif-part-(\w+)"/g)].map((m) => m[1]);
check('panel: one row per part with its state class', rows.join(' ') === 'done running waiting waiting waiting', rows.join(' '));
const plain = html.replace(/<span class="whatif-part-mark">[^<]*<\/span>/g, (m) => m).replace(/<[^>]+>/g, '');
check('panel: title is Running · part 2 of 5', plain.includes('Running · part 2 of 5'), plain);
check('panel: done row text', plain.includes('Screen') && /80 \/ 80 runs · done/.test(plain), plain);
check('panel: running row text and options left', plain.includes('Halving 1 · 10 options left') && /36 \/ 80 runs · 0:03:55 left/.test(plain), plain);
check('panel: waiting row says up to N runs', plain.includes('Halving 2 · 3 options left') && plain.includes('up to 24 runs'), plain);
check('panel: placeholder labels', plain.includes('Greedy steps: up to 20, stops when none helps') && plain.includes('Confirmation: only if a step is accepted'), plain);
const more = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 1, state: 'done', runsPlanned: 4 }, { kind: 'moreSteps', index: 1, state: 'waiting', stepsLeft: 19 }] } }, t).replace(/<[^>]+>/g, '');
check('panel: more greedy steps row', more.includes('More greedy steps: up to 19 more'), more);
const marks = [...html.matchAll(/<span class="whatif-part-mark">([^<]*)<\/span>/g)].map((m) => m[1]);
check('panel: one icon cell per row, same family, no colour emoji', marks.length === 5 && marks.every((m) => /^[\u2713\u25B6\u25CB]\uFE0E?$/.test(m)), JSON.stringify(marks));
check('panel: icon column has one fixed width and rows start with it', /\.whatif-part-mark \{[^}]*width: 1\.5em/.test(read('index.html')) && /\.whatif-part \{[^}]*grid-template-columns: 1\.5em /.test(read('index.html')));
check('panel: small line seconds per run and elapsed, no whole-search time', plain.includes('Seconds per run 241.46') && plain.includes('elapsed 1:12:30') && !/whole|total time/i.test(plain), plain);
check('panel: bars at 100, 45 and 0 percent', ['width: 100%', 'width: 45%', 'width: 0%'].every((w) => html.includes(w)));
check('panel: numbers keep their raw value', html.includes('data-num="36"') && html.includes('title="241.4567"'));
const stoppedHtml = panel.renderProgress({ state: 'stopped', progress: { stage: 'stopped', parts: [{ kind: 'screen', index: 0, state: 'running', runsPlanned: 10, runsDone: 4, etaSeconds: 5 }] } }, t);
check('panel: stopped keeps the rows', stoppedHtml.includes('whatif-part-running'));
// Old progress (no parts): today's single line.
const old = panel.renderProgress({ state: 'running', progress: { stage: 'screen', candidatesLeft: 120, runsDone: 30, runsPlanned: 120, secondsPerRun: 12.5, etaSeconds: 3725 } }, t);
check('old progress without parts: the single line unchanged', !old.includes('whatif-part') && old.includes('width: 25%') && old.includes('1:02:05') && old.includes('candidates left'));
check('empty parts array: the single line', !panel.renderProgress({ state: 'running', progress: { stage: 'screen', parts: [], runsPlanned: 1, runsDone: 0 } }, t).includes('whatif-part'));

// Strings in en, pt, zh.
const keys = ['partOf', 'partSteps', 'partMoreSteps', 'partConfirmationWaiting', 'partScreen', 'partHalving', 'partStep', 'partPicks', 'partConfirmation', 'optionsLeft', 'runsOf', 'upTo', 'timeLeft', 'done', 'secondsPerRunCap', 'elapsed'];
for (const l of ['en', 'pt', 'zh']) check(`strings: ${l} has every progress key`, keys.every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length), l);
check('strings: placeholders match across languages', keys.every((k) => ['pt', 'zh'].every((l) => (locales[l].progress[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.progress[k].match(/\{\{\w+\}\}/g) || []).sort().join())));
const ptHtml = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 2, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, tIn('pt'));
check('strings: pt renders without a missing key', !ptHtml.includes('#'), ptHtml);

process.exit(failed ? 1 : 0);
