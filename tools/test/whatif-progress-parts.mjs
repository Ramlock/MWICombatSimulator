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
    // The race of greedy step k is the row "Change k+1" (the screen is change 1): after it maxSteps - k - 1 changes can still be chosen.
    const e = createParts(plan).sync({ stage: 'greedy step 1', runsPlanned: 4, runsDone: 1 }).find((p) => p.kind === 'moreSteps');
    check('max 20, the row of greedy step 1 ("Change 2") is running: the grey row says up to 18 more, not 19', e?.stepsLeft === 18 && e.state === 'waiting', JSON.stringify(e));
    for (let i = 1; i < 18; i++) t3.sync({ stage: `greedy step ${i}`, runsPlanned: 4, runsDone: 0 });
    t3.sync({ stage: 'greedy step 18', runsPlanned: 4, runsDone: 0 });
    const a = t3.sync({ stage: 'greedy step 18', runsPlanned: 4, runsDone: 1 }).find((p) => p.kind === 'moreSteps');
    check('at the row "Change 19" the grey row says 1 more', a?.stepsLeft === 1 && a.state === 'waiting', JSON.stringify(a));
    const b = t3.sync({ stage: 'greedy step 19', runsPlanned: 4, runsDone: 1 });
    check('at the row "Change 20" (the last change that can be chosen) the more-steps row is hidden', !b.some((p) => p.kind === 'moreSteps') && b.at(-1).kind === 'confirmation');
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
check('no pick: the search ends with the picks part, the steps part and the confirmation part skipped (never started, will not), the stages that ran done', kinds(ps) === 'screen0:done halving1:done halving2:done picks0:skipped steps0:skipped confirmation:skipped', kinds(ps));
check('no pick: a skipped part keeps no up-to count, and the same search before it is done still has them waiting', ps.every((p) => p.runsUpTo === undefined) && tr2.sync({ stage: 'probe' }).filter((p) => p.state === 'waiting').length === 3);
{
    // A search with picks and no accepted step: the picks were checked, a step ran (and was not taken), no confirmation: only the confirmation is skipped.
    const t4 = createParts(plan);
    for (const s of ['screen', 'halving 1', 'halving 2']) t4.sync({ stage: s, runsPlanned: 4, runsDone: 4, candidatesLeft: 3 });
    t4.sync({ stage: 'greedy step 1', runsPlanned: 4, runsDone: 4, candidatesLeft: 3 });
    t4.sync({ stage: 'confirming picks', runsPlanned: 4, runsDone: 4, candidatesLeft: 0, picksPlanned: 32, picksDone: 32 });
    const before = t4.sync({ stage: 'greedy step 2', runsPlanned: 4, runsDone: 1, candidatesLeft: 3 });
    check('picks, no accepted step: before the end the confirmation is only waiting', before.at(-1).state === 'waiting' && before.some((p) => p.kind === 'moreSteps'), kinds(before));
    const end = t4.sync({ stage: 'done', runsPlanned: 4, runsDone: 4, candidatesLeft: 0 });
    check('picks, no accepted step: only the confirmation is skipped (picks and the steps that ran are done), and the more-steps row is gone', kinds(end) === 'screen0:done halving1:done halving2:done picks0:done step1:done step2:done confirmation:skipped', kinds(end));
    const tfd = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] }); tfd.setCandidates(40);
    const fEnd = tfd.sync({ stage: 'done' });
    check('a done search whose foods and drinks parts never ran (in the plan) skips them too; one that ran keeps them done', kinds(fEnd).startsWith('foods0:skipped drinks0:skipped screen0:skipped') && !kinds(tfd.sync({ stage: 'done' })).includes('waiting'));
    const tfr = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] }); tfr.setCandidates(40);
    tfr.sync({ stage: 'foods', runsPlanned: 4, runsDone: 4 }); tfr.sync({ stage: 'drinks', runsPlanned: 4, runsDone: 4 });
    check('foods and drinks that ran are done, not skipped, when the search ends after them', kinds(tfr.sync({ stage: 'done' })).startsWith('foods0:done drinks0:done screen0:skipped'), kinds(tfr.sync({ stage: 'done' })));
    const html = panel.renderParts({ state: 'done', progress: { parts: end } }, t), skippedRow = html.split('<div class="whatif-part ').slice(1).find((r) => r.includes('data-kind="confirmation"'));
    check('window: a skipped confirmation part draws a dash mark, no bar and no open circle, with "Not run: no step was accepted."', skippedRow.includes('whatif-part-skipped') && skippedRow.includes('>–<') && !skippedRow.includes('○') && !skippedRow.includes('progress-bar') && skippedRow.includes('Not run: no step was accepted.'), skippedRow);
    const html2 = panel.renderParts({ state: 'done', progress: { parts: ps } }, t), rows2 = html2.split('<div class="whatif-part ').slice(1);
    check('window: the skipped picks and steps parts say "Not run: no change was picked.", the confirmation part its own line, the parts that ran stay done', ['picks', 'steps'].every((k) => rows2.find((r) => r.includes(`data-kind="${k}"`)).includes('Not run: no change was picked.')) && rows2.find((r) => r.includes('data-kind="confirmation"')).includes('Not run: no step was accepted.') && rows2.filter((r) => r.includes('data-state="done"')).length === 3 && rows2.every((r) => !r.includes('data-state="waiting"')), html2);
    for (const l of ['en', 'pt', 'zh']) check(`window: ${l} has the two skipped lines (a string each, different from each other)`, typeof locales[l].progress.skippedNoPick === 'string' && typeof locales[l].progress.skippedNoStep === 'string' && locales[l].progress.skippedNoPick !== locales[l].progress.skippedNoStep && locales[l].progress.skippedNoPick.length > 0);
}
check('probe before the screen: all rows waiting', kinds(createParts(plan).sync({ stage: 'probe' })) === 'screen0:waiting halving1:waiting halving2:waiting ' + P);
check('a single stage plan has the screen only', createParts({ stages: [{ k: 4, h: 50 }], keep: [], candidates: 5, maxSteps: 20 }).sync({ stage: 'screen', runsPlanned: 3, runsDone: 1 }).length === 4);

// Stage F and Stage D (plan.fillings): two parts come first, the pool of the rest is unknown until setCandidates.
{
    const tf = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
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
    check('picks: the panel labels the row and shows its runs', h.includes('Re-checking each chosen change') && h.includes('10 / 32 runs') && h.includes('32 / 32 runs'), h);
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
check('panel: done row text', plain.includes('Change 1') && /80 \/ 80 runs · done/.test(plain), plain);
check('panel: running row text and options left', plain.includes('Narrowing down, round 1 · 10 options left') && /36 \/ 80 runs · 0:03:55 left/.test(plain), plain);
check('panel: waiting row says up to N runs', plain.includes('Narrowing down, round 2 · 3 options left') && plain.includes('up to 24 runs'), plain);
check('panel: placeholder labels', plain.includes('Choosing changes one at a time: up to 20, stops when none helps') && plain.includes('Final check: only if a change is chosen'), plain);
const more = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 1, state: 'done', runsPlanned: 4 }, { kind: 'moreSteps', index: 1, state: 'waiting', stepsLeft: 19 }] } }, t).replace(/<[^>]+>/g, '');
check('panel: more changes row, and a step row is named by the change it looks for (index + 1)', more.includes('More changes: up to 19 more') && more.includes('Change 2'), more);
const marks = [...html.matchAll(/<span class="whatif-part-mark">([^<]*)<\/span>/g)].map((m) => m[1]);
check('panel: one icon cell per row, same family, no colour emoji', marks.length === 5 && marks.every((m) => /^[\u2713\u25B6\u25CB]\uFE0E?$/.test(m)), JSON.stringify(marks));
check('panel: icon column has one fixed width and rows start with it', /\.whatif-part-mark \{[^}]*width: 1\.5em/.test(read('index.html')) && /\.whatif-part \{[^}]*grid-template-columns: 1\.5em /.test(read('index.html')));
check('panel: small line seconds per run and elapsed, no whole-search time', plain.includes('Seconds per run 241.46') && plain.includes('elapsed 1:12:30') && !/whole|total time/i.test(plain), plain);
check('panel: bars at 100, 45 and 0 percent', ['width: 100%', 'width: 45%', 'width: 0%'].every((w) => html.includes(w)));
check('panel: numbers keep their raw value', html.includes('data-num="36"') && html.includes('title="241.4567"'));
const stoppedHtml = panel.renderProgress({ state: 'stopped', progress: { stage: 'stopped', parts: [{ kind: 'screen', index: 0, state: 'running', runsPlanned: 10, runsDone: 4, etaSeconds: 5 }] } }, t);
check('panel: stopped keeps the rows and their figures, but nothing reads or is marked running (item 27)', stoppedHtml.includes('whatif-part-halted') && stoppedHtml.replace(/<[^>]+>/g, '').includes('4 / 10 runs') && !stoppedHtml.includes('whatif-part-running') && !/Running/.test(stoppedHtml), stoppedHtml);
// Old progress (no parts): today's single line.
const old = panel.renderProgress({ state: 'running', progress: { stage: 'screen', candidatesLeft: 120, runsDone: 30, runsPlanned: 120, secondsPerRun: 12.5, etaSeconds: 3725 } }, t);
check('old progress without parts: the single line unchanged', !old.includes('whatif-part') && old.includes('width: 25%') && old.includes('1:02:05') && old.includes('candidates left'));
check('empty parts array: the single line', !panel.renderProgress({ state: 'running', progress: { stage: 'screen', parts: [], runsPlanned: 1, runsDone: 0 } }, t).includes('whatif-part'));

// No bar goes back, in any stage, and the counters of a race stage only grow. The real message sequence of a search is fed through the tracker
// and the panel one message at a time: rounds of a race stage (a search batch of 103 runs, a reading batch of 30 leaders' runs, a search batch
// again), a greedy step that is itself a race, a greedy step of two batches (each batch restarts its own run counts), the pick check whose planned runs
// grow, the confirmation of two batches. After every message each row's bar (width) must be at least what it was, a race stage's running row has no
// bar, its counters (runs, simulated hours, dropped) never fall and its label names the phase in words.
{
    const tp = createParts({ stages: [{ k: 4, h: 50 }, { k: 4, h: 150 }], keep: [10], candidates: 103, maxSteps: 20 });
    const seq = [];
    let stageRuns = 0, hours = 0, picksPlanned = 0, picksDone = 0;
    const batch = (n, extra) => { const at = (d) => ({ runsDone: d, runsPlanned: n, etaSeconds: n - d, ...(typeof extra === 'function' ? extra(d) : extra) }); for (let d = 0; d < n; d += Math.max(1, Math.floor(n / 6))) seq.push(at(d)); seq.push(at(n)); };
    const race = (stage, rounds) => {
        let runs = 0, h = 0, round = 0;
        for (const r of rounds) {
            round++;
            const ctx = () => ({ stage, round, candidatesLeft: r.n, stageContending: r.cont, stagePaused: r.paused, stageDropped: r.dropped });
            const run = (n, phase) => { const base = runs, hb = h; batch(n, (d) => ({ phase, ...ctx(), stageRuns: base + d, stageSimHours: hb + d * 50 })); runs += n; h += n * 50; };
            run(r.n, 'search'); run(r.reads, 'reading');
        }
    };
    race('screen', [{ n: 103, reads: 30, cont: 103, paused: 0, dropped: 0 }, { n: 40, reads: 30, cont: 40, paused: 63, dropped: 2 }, { n: 12, reads: 30, cont: 12, paused: 91, dropped: 5 }]);
    race('halving 1', [{ n: 12, reads: 12, cont: 12, paused: 0, dropped: 0 }, { n: 5, reads: 12, cont: 5, paused: 7, dropped: 1 }]);
    race('greedy step 1', [{ n: 24, reads: 10, cont: 24, paused: 0, dropped: 0 }, { n: 9, reads: 10, cont: 9, paused: 15, dropped: 3 }]);
    batch(30, { stage: 'confirming picks', picksPlanned: 32, picksDone: 10 }); batch(30, { stage: 'confirming picks', picksPlanned: 48, picksDone: 48 });
    batch(24, { stage: 'greedy step 2' }); batch(16, { stage: 'greedy step 2' }); batch(8, { stage: 'greedy step 2' });
    batch(30, { stage: 'confirming picks', picksPlanned: 80, picksDone: 60 });
    batch(16, { stage: 'confirmation' }); batch(16, { stage: 'confirmation' });
    seq.push({ stage: 'done', runsDone: 16, runsPlanned: 16 });
    const widths = new Map(), counters = new Map();
    const bad = [], phaseWords = [];
    for (const m of seq) {
        const st = { state: 'running', progress: { ...m, parts: tp.sync(m) } };
        const html = panel.renderParts(st, t);
        const seen = new Map();
        for (const mm of html.matchAll(/<div class="whatif-part whatif-part-(\w+)(?: whatif-part-race)?" data-kind="(\w+)"[^>]*>([^]*?)(?:<span class="whatif-part-text">([^]*?)<\/span>)?<\/div>/g)) {
            const key = mm[2] + '#' + (seen.set(mm[2], (seen.get(mm[2]) ?? 0) + 1), seen.get(mm[2]));
            const w = mm[3].match(/width: ([\d.]+)%/), isRace = mm[1] === 'running' && mm[3].includes('whatif-no-bar'); // the stage that runs now (a done or halted race row has no bar either, but its counters are final)
            if (w) { if (widths.has(key) && Number(w[1]) < widths.get(key)) bad.push(`${key} bar ${widths.get(key)} -> ${w[1]} at ${JSON.stringify(m)}`); widths.set(key, Number(w[1])); }
            if (isRace && mm[3].includes('progress-bar')) bad.push(`${key} race row has a bar`);
            if (isRace) {
                const nums = [...mm[3].matchAll(/data-num="([\d.]+)"/g)].map((x) => Number(x[1])).slice(-3), prev = counters.get(key);
                if (prev && nums.some((v, i) => v < prev[i])) bad.push(`${key} counters ${prev} -> ${nums}`);
                counters.set(key, nums);
                phaseWords.push(/searching the candidates still in the running|checking the leaders on fresh runs/.test(mm[3]));
            }
        }
    }
    check('sequence: no row\'s bar ever goes back across rounds, greedy steps, the pick check and the confirmation', bad.length === 0, bad.slice(0, 3).join(' | '));
    check('sequence: a running race row has no bar, counters that only grow, and the phase named in words', phaseWords.length > 20 && phaseWords.every(Boolean) && counters.size >= 3);
    check('sequence: the runs and simulated hours counters end above where they began and "dropped" did rise', [...counters.values()].some((c) => c[0] > 100 && c[1] > 5000 && c[2] >= 3), JSON.stringify([...counters.values()]));
    check('sequence: contention is shown as plain numbers (it may fall, no bar for it)', !/contending[^]*progress-bar/.test(panel.renderParts({ state: 'running', progress: { parts: tp.sync({ stage: 'screen', round: 4, phase: 'search', runsDone: 1, runsPlanned: 9, stageContending: 3, stagePaused: 9, stageDropped: 1, stageRuns: 5, stageSimHours: 10 }) } }, t).match(/data-kind="screen"[^]*?<\/div>/)?.[0] ?? ''));
}

// "Done with this stage, go on": the button is on the race stage that runs now, on its own line after the counters, and nowhere else.
{
    const raceHtml = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'foods', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, runs: 224, simHours: 11000 }, { kind: 'screen', state: 'waiting', runsUpTo: 9 }, { kind: 'step', index: 1, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, t);
    const rows = raceHtml.split('<div class="whatif-part ').slice(1);
    const race = rows.find((r) => r.includes('data-kind="foods"')), others = rows.filter((r) => !r.includes('data-kind="foods"'));
    const buttons = (html) => [...html.matchAll(/data-whatif-done="(\w+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}:${m[2]}`);
    check('two buttons: with no pool that Accept would take, only "Skip this stage" is shown, once, inside the running race stage\'s label after its counters, and not in a waiting or bar row', buttons(raceHtml).join('|') === 'skip:Skip this stage' && /<span class="whatif-part-label">.*224.*ruled out.*data-whatif-done="skip"/.test(race) && !race.includes('whatif-part-text') && others.every((r) => !r.includes('data-whatif-done')), raceHtml);
    const both = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 }, { kind: 'halving', index: 1, state: 'waiting', runsUpTo: 9 }] } }, t);
    check('two buttons: with a pool Accept would take, "Accept current winner" comes first and "Skip this stage" second, on the stage line', buttons(both).join('|') === 'accept:Accept current winner|skip:Skip this stage' && /ruled out.*data-whatif-done="accept".*data-whatif-done="skip"/.test(both), both);
    check('two buttons: the tooltips say what each does (accept: positive leader, checked on fresh runs; skip: a locked pool keeps its pick)', both.includes('title="Ends this stage after the round it is in. Where nothing has locked yet, it takes the best leader') && both.includes('A pool that has already locked keeps its pick'));
    check('two buttons: a finished or stopped race stage has none', ['done', 'running'].every((s, i) => !panel.renderParts({ state: i ? 'stopped' : 'running', progress: { parts: [{ kind: 'foods', state: s, round: 3, contending: 5, paused: 2, dropped: 1, acceptable: 2, runs: 224, simHours: 11000 }] } }, t).includes('data-whatif-done')));
    check('two buttons: the API has the done route', panel.API.done('a b') === '/api/search/a%20b/done');
    for (const l of ['en', 'pt', 'zh']) check(`two buttons: ${l} has the strings, the skip label names no stage, and the old ones are gone`, ['stageAccept', 'stageAcceptTip', 'stageSkip', 'stageSkipTip', 'stageFinishing'].every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length) && !locales[l].progress.stageSkip.includes('{{stage}}') && !('stageDone' in locales[l].progress) && !('stageDoneTip' in locales[l].progress) && typeof locales[l].result.endedByUser === 'string' && locales[l].result.endedByUser.includes('{{n}}'));
    for (const l of ['pt', 'zh']) { const h = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 }] } }, tIn(l)); check(`two buttons: ${l} renders both without a missing key`, buttons(h).length === 2 && !h.includes('#progress.'), h); }
    // After a press: the pressed button stays drawn by every redraw (the state is in the markup), both buttons disabled; only Accept carries the note.
    const screenRow = { kind: 'screen', index: 0, state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 };
    const drawn = (pressed, row = screenRow) => panel.renderParts({ state: 'running', progress: { parts: [row] } }, t, pressed);
    const none = drawn(null), acc = drawn({ key: 'screen:0', mode: 'accept' }), skp = drawn({ key: 'screen:0', mode: 'skip' }), other = drawn({ key: 'step:1', mode: 'accept' });
    check('two buttons: nothing pressed, nothing disabled and no note; a press on another part changes nothing here', !none.includes('disabled') && !none.includes('data-whatif-note') && other === none);
    check('two buttons: Accept pressed: both buttons disabled and the note "Finishing the current round" next to them', (acc.match(/disabled/g) || []).length === 2 && acc.includes('data-whatif-note="accept">Finishing the current round<'), acc);
    check('two buttons: Accept pressed stays drawn when the pool it would take is gone (acceptable 0 on the next poll)', drawn({ key: 'screen:0', mode: 'accept' }, { ...screenRow, acceptable: 0 }) === acc);
    check('two buttons: Skip pressed: both disabled and no note (Skip ends the stage at once)', (skp.match(/disabled/g) || []).length === 2 && !skp.includes('data-whatif-note'), skp);
    check('two buttons: the same state gives the same markup twice (a redraw can keep the node); the buttons carry their part', drawn({ key: 'screen:0', mode: 'accept' }) === acc && /data-whatif-done="accept" data-whatif-part="screen:0"/.test(none));
    for (const l of ['pt', 'zh']) check(`two buttons: ${l} draws the note without a missing key`, !panel.renderParts({ state: 'running', progress: { parts: [screenRow] } }, tIn(l), { key: 'screen:0', mode: 'accept' }).includes('#progress.'));
    const cs = read('tools/whatif/core.mjs'), os = read('tools/whatif/optimize.mjs'), sv = read('tools/whatif/runner/server.mjs'), mj = read('src/main.js');
    check('two buttons: optimize.mjs sets stop.done to the mode of the { done } message (and does not kill the pool)', /m\?\.done === 'accept' \|\| m\?\.done === 'skip'\) stop\.done = m\.done/.test(os) && /m === 'stop'\) \{ stop\.requested = true; pool\.kill\(\); \}/.test(os));
    check('two buttons: the runner has POST /done that reads the mode (a bad one is a 400) and sends { done: mode } over the IPC', /\\\/done\$\//.test(sv) && /c\.send\(\{ done: mode \}\)/.test(sv) && /mode !== 'accept' && mode !== 'skip'\) return send\(res, 400/.test(sv) && /s\.handle\.done\(mode\)/.test(sv));
    check('two buttons: the window posts the clicked button\'s mode and keeps the press in its state (drawn by every redraw)', /JSON\.stringify\(\{ mode: pressed\.mode \}\)/.test(mj) && /whatIf\.pressed = pressed; whatIfDrawProgress\(\)/.test(mj) && /whatIfRenderProgress\(whatIf\.status, whatIfT, whatIf\.pressed\)/.test(mj));
    check('two buttons: race() ends after the published round when stop.done is set, through the one end path, with the leaders as --max-rounds returns them, and marks it', /outSink\.round\(rec\);[^]*?const mode = stopSignal\.done, byUser = !!mode;[^]*?endedByUser\[stage\] = roundNo - sinceStart;[^]*?settled \|\| byUser \|\|/.test(cs) && /result\.endedByUser = endedByUser/.test(cs));
    check('two buttons: accept locks what acceptTakes returns for the pools without a lock, skip locks nothing, and both read the one `takes`', /const takes = acceptTakes\(live, gainOf, \{ byPlayer, players, locked: lockedBy, cmp: byPlayer \? rankFirst : rank \}\);/.test(cs) && /const accepted = mode === 'accept' \? takes : new Map\(\);/.test(cs) && /for \(const \[k, c\] of accepted\) lockedBy\.set\(k, c\);/.test(cs) && /stageAcceptable: stageCont\.acceptable/.test(cs) && /stageCont\.acceptable = takes\.size/.test(cs));
    check('two buttons: an accepted pick joins as it is (no refinement, no pick check, no fresh reading, marked), in the greedy steps and in foods and drinks; a pick the search locked still goes through the check', /const asIs = ok\.length > 0 && res\.accepted\.includes\(res\.locked\);/.test(cs) && /const picked = asIs \? \{ best: res\.locked, orig: res\.locked, fresh: null, failed: \[\] \} : await firstConfirmed\(/.test(cs) && /\.\.\.\(asIs \? \{ acceptedAsIs: true \} : \{ fresh: bestFresh \}\)/.test(cs) && /\(c\) => asIs\.has\(c\)\);/.test(cs) && /accepted: \[\.\.\.accepted\.values\(\)\]|endStage\(live, \[\.\.\.accepted\.values\(\)\](, [^)]*)?\)/.test(cs) && /if \(!picked\.best\) continue;/.test(cs));
    check('two buttons: Accept is offered for a leader whose figure is shown, by the one helper the window shares (showsFigure), read by the core\'s gainOf', /import \{ hasFigure, showsFigure \} from '\.\.\/\.\.\/src\/whatif\/figure\.mjs'/.test(cs) && /const gainOf = \(c\) => \{ const r = read\.get\(c\); return r && showsFigure\(rowFor\(c\)\)/.test(cs));
    check('two buttons: Skip stops the lanes (ensure, skippable) and ends the stage with its own outcome, never false; the stage end is one function', /async function ensure\(reqs, \{ onRun, skippable = false \} = \{\}\)/.test(cs) && /const SKIPPED = Symbol\('skipped'\)/.test(cs) && /searched === SKIPPED\) return skipEnd\(stageRound\)/.test(cs) && /read1 === SKIPPED\) return skipEnd\(stageRound\)/.test(cs) && cs.split('const endStage = ').length === 2 && !/pool\.kill\(\)/.test(cs.slice(cs.indexOf('async function ensure'), cs.indexOf('const SKIPPED'))));
    check('two buttons: there are few stop.done readers: the stage start\'s clear, the end-of-round read and reset, the lanes\' skip test Skip\'s reset and the comment naming it', cs.split('stopSignal.done').length === 7, String(cs.split('stopSignal.done').length));
    check('round numbers count inside the stage (a stage\'s first round is round 1): the record, the progress and the first look use stageRound, never the run-wide roundNo', /const stageRound = roundNo - sinceStart;/.test(cs) && !/round: roundNo/.test(cs) && /firstLook\(cands, base, byPlayer, stage, stageRound\)/.test(cs) && /\{ stage, round: stageRound, phase: 'search'/.test(cs) && /\{ stage, round: stageRound, phase: 'reading'/.test(cs) && /const rec = \{ round: stageRound,/.test(cs));
    check('elimination: race() runs eliminate() on the not-refuted candidates each round after the estimates, drops what is out from the round (active, contention), reads the last standing, locks only a lone change that passes the pick check, settles when no change is left; the bar comes from the cached base runs (barsOf); no separated / anyHope left', /const standing = eliminate\(cands\.filter/.test(cs) && /contention\(active\.filter\(\(c\) => !c\.out\)/.test(cs) && /const lastStanding = /.test(cs) && /const resolved = /.test(cs) && /function barsOf\(base, count\)/.test(cs) && /const BAR_FRACTION = 0\.01;/.test(cs) && !/separated|anyHope/.test(cs.replace(/\/\/[^\n]*/g, '')));
    check('elimination payback cut: eliminate() gets the same payLimit the pick check uses (0 off the profit goal)', /bars: barsOf\(base, maxK \* baseMult\), payLimit, order: players/.test(cs) && /const payLimit = goal === 'profit' \? maxPayback : 0;/.test(cs));
    check('the end of a stage publishes the report at once (onEnd), so the ended-by-you mark shows before the pick checks; both race calls pass it', /onEnd\?\.\(\);[^\n]*\n\s*Object\.assign\(progress, stageCtx\(\), \{ stageEnded: stage \}, bySkip \? \{ stageSkipped: true \} : \{\}\)/.test(cs) && (cs.match(/onEnd: \(\) => publish\(result\)/g) || []).length === 2);
    check('done: a press before a stage\'s first round is dropped (race() clears the flag at its start)', /stopSignal\.done = false; \/\/ a press before/.test(cs));
}
// Item 24 in the core: a leader without a clear gain gives the final's unchanged form, flagged; one with a clear gain gives its items.
{
    const cs = read('tools/whatif/core.mjs');
    check('best so far: an unclear leader (too few fresh runs, range reaching 0, shared loot falling) gets bestEntry(..., null) flagged unclear, the candidate kept', /if \(r\.tooFew \|\| r\.readingSeeds < readMin \|\| r\.status === 'loses' \|\| !\(Number\.isFinite\(lo\) && lo > 0\)\) \{[^]*?bestEntry\(kind, now, null\), soFar: true, unclear: true[^]*?candidate: items/.test(cs));
    check('party order: contention gets the players, the first look sorts with poolSorter, the best and the report text follow partyEntries', /order: players \}\)/.test(cs) && /\.sort\(poolSorter\(players\)\)/.test(cs) && /result\.best\[kind\] = inParty\(/.test(cs) && /partyEntries\(result\.best\[kind\]\)/.test(cs) && /partyEntries\(c\.buyerByPlayer\)/.test(cs) && !/\.sort\(\(a, b\) => \(a\[0\] < b\[0\]/.test(cs));
}

// Strings in en, pt, zh.
const keys =['partOf', 'partSteps', 'partMoreSteps', 'partConfirmationWaiting', 'partScreen', 'partHalving', 'partStep', 'partPicks', 'partConfirmation', 'optionsLeft', 'runsOf', 'upTo', 'timeLeft', 'done', 'secondsPerRunCap', 'elapsed'];
for (const l of ['en', 'pt', 'zh']) check(`strings: ${l} has every progress key`, keys.every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length), l);
// A race stage that has ended (stageEnded) is a done row with the last round record's counts, whatever message comes next (the pick checks keep
// reporting the same stage name); a stage that stopped is not ended.
{
    const tp = createParts({ stages: [{ k: 4, h: 50 }, { k: 4, h: 150 }], keep: [10], candidates: 473, maxSteps: 20 });
    const during = { stage: 'screen', round: 1, phase: 'reading', runsDone: 5, runsPlanned: 40, candidatesLeft: 20, stageContending: 473, stagePaused: 0, stageDropped: 0, stageRuns: 900, stageSimHours: 45000 };
    const live = tp.sync(during).find((r) => r.kind === 'screen');
    check('ended stage: while it runs the row is running with the counts it was given', live.state === 'running' && live.contending === 473 && live.paused === 0);
    const ended = { ...during, stageContending: 271, stagePaused: 202, stageRuns: 986, stageSimHours: 49000, stageEnded: 'screen' };
    const row = tp.sync(ended).find((r) => r.kind === 'screen');
    check('ended stage: the row is done with the last round record counts (271 in the running, 202 set aside), not the first look ones', row.state === 'done' && row.contending === 271 && row.paused === 202 && row.runs === 986 && row.simHours === 49000, JSON.stringify(row));
    // The projection (stageSeparate: the pool nearest to ending): after the "still in the running" count of the running stage; "more than 999" for a null; none without one.
    const sepText = (sep, lang = 'en') => { const rr = tp.sync({ ...during, stageContending: 2, stagePaused: 1, ...(sep !== undefined ? { stageSeparate: sep } : {}) }); return panel.renderParts({ state: 'running', progress: { parts: rr } }, tIn(lang)).split('<div class="whatif-part ').slice(1).find((x) => x.includes('data-kind="screen"')).replace(/<[^>]*>/g, ''); };
    check('projection: the running row says "about 80 more rounds to separate" right after the still-in-the-running count', sepText({ rounds: 80 }).includes('2 still in the running · about 80 more rounds to separate · 1 set aside'), sepText({ rounds: 80 }));
    check('projection: one round is singular, a null is "more than 999", none shows nothing', sepText({ rounds: 1 }).includes('about 1 more round to separate') && !sepText({ rounds: 1 }).includes('rounds to separate') && sepText({ rounds: null }).includes('2 still in the running · more than 999 more rounds to separate · 1 set aside') && !sepText(null).includes('separate') && !sepText().includes('separate'));
    for (const l of ['en', 'pt', 'zh']) check(`projection: ${l} has the three strings and the stage label takes the placeholder`, ['separateRounds', 'separateRoundsOne', 'separateFar'].every((k) => typeof locales[l].progress[k] === 'string') && locales[l].progress.stageLabel.includes('{{separate}}') && locales[l].progress.separateRounds.includes('{{n}}') && locales[l].progress.separateRoundsOne.includes('{{n}}'));
    const csS = read('tools/whatif/core.mjs');
    check('projection: core hands the nearest pool\'s figure (nearestSeparation over the elimination pools, this round of the stage) to the stage record', /separate: nearestSeparation\(standing, \{ goal, mult: pauseMult, rounds: stageRound \}\)/.test(csS) && /stageSeparate: stageCont\.separate \?\? null/.test(csS));
    // The pick checks go on reporting the same stage name: the row stays done.
    const later =tp.sync({ ...ended, runsDone: 9, runsPlanned: 40 }).find((r) => r.kind === 'screen');
    check('ended stage: later messages of the same stage name (the pick checks) keep it done', later.state === 'done' && later.contending === 271);
    const html = panel.renderParts({ state: 'running', progress: { parts: tp.sync({ ...ended, runsDone: 12, runsPlanned: 40 }) } }, t);
    const rowHtml = html.split('<div class="whatif-part ').slice(1).find((r) => r.includes('data-kind="screen"'));
    const rowText = rowHtml.replace(/<[^>]*>/g, '');
    check('ended stage: drawn as a finished round, 271 and 202, no running word, no done button', rowText.includes('round 1 finished') && rowText.includes('271 still in the running') && rowText.includes('202 set aside') && !rowText.includes('round 1 running') && !rowHtml.includes('data-whatif-done'), rowText);
    // The next stage takes its own row; the ended one is not touched by it.
    const next = tp.sync({ stage: 'greedy step 1', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, stageEnded: 'screen' });
    check('ended stage: the next stage row is running even while the old stageEnded is still in the record', next.find((r) => r.kind === 'step').state === 'running' && next.find((r) => r.kind === 'screen').state === 'done');
    check('two buttons: the progress row carries the count of pools Accept would take (0 when the record has none)', tp.sync({ ...during, stageAcceptable: 2 }).find((r) => r.kind === 'screen').acceptable === 2 && tp.sync(during).find((r) => r.kind === 'screen').acceptable === 0);
    // The pick check of an ended foods or drinks stage shows on that stage's own row (checking + its own run counts); the picks part and the later stages stay waiting.
    {
        const tf = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
        const endedF = { stage: 'foods', round: 2, phase: 'search', runsDone: 5, runsPlanned: 40, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 3, stageRuns: 90, stageSimHours: 400, stageEnded: 'foods' };
        tf.sync(endedF);
        const ck = tf.sync({ ...endedF, stage: 'confirming picks', candidatesLeft: 0, checking: 'foods', picksPlanned: 32, picksDone: 5 });
        const fr = ck.find((r) => r.kind === 'foods');
        check('pick check on the stage row: the foods row stays done and carries checking with its own run counts (5 of 32)', fr.state === 'done' && fr.checking === true && fr.checkPlanned === 32 && fr.checkDone === 5, JSON.stringify(fr));
        check('pick check on the stage row: the picks part is not running (no "part k of n" after the later stages), the drinks and screen rows keep waiting', ck.find((r) => r.kind === 'picks').state === 'waiting' && ck.find((r) => r.kind === 'picks').runsPlanned === 0 && ck.find((r) => r.kind === 'drinks').state === 'waiting' && ck.find((r) => r.kind === 'screen').state === 'waiting', kinds(ck));
        const htmlC = panel.renderParts({ state: 'running', progress: { parts: ck } }, t);
        const foodsHtml = htmlC.split('<div class="whatif-part ').slice(1).find((x) => x.includes('data-kind="foods"')), foodsText = foodsHtml.replace(/<[^>]*>/g, '');
        check('pick check on the stage row: the row reads "checking the accepted picks on fresh runs · 5 / 32 runs" in place of "done", marked as running, and the title has no part number', foodsText.includes('checking the accepted picks on fresh runs · 5 / 32 runs') && !foodsText.includes('· done') && foodsHtml.includes('data-state="running"') && !/part \d+ of/.test(htmlC.replace(/<[^>]*>/g, '')) && htmlC.includes('Running'), foodsText);
        // With the player named (progress.checkingWho): the stage's total stays, the row adds "player N of M".
        const ckW = tf.sync({ ...endedF, stage: 'confirming picks', candidatesLeft: 0, checking: 'foods', checkingWho: { index: 3, of: 3 }, picksPlanned: 64, picksDone: 48 });
        const frW = ckW.find((r) => r.kind === 'foods'), textW = panel.renderParts({ state: 'running', progress: { parts: ckW } }, t).split('<div class="whatif-part ').slice(1).find((x) => x.includes('data-kind="foods"')).replace(/<[^>]*>/g, '');
        check('pick check on the stage row: the row names the player ( "player 3 of 3 · 48 / 64 runs"), the total is the stage\'s so far', frW.checkWho.index === 3 && frW.checkWho.of === 3 && frW.checkPlanned === 64 && frW.checkDone === 48 && textW.includes('checking the accepted picks on fresh runs · player 3 of 3 · 48 / 64 runs'), textW);
        for (const l of ['en', 'pt', 'zh']) check(`pick check on the stage row: ${l} has the player-of-total string`, ['{{n}}', '{{of}}', '{{runs}}'].every((p) => locales[l].progress.checkingPicksOf.includes(p)));
        check('pick check on the stage row: core names the player (index among the players with a pick, of that count) for foods and drinks only', /confirmPick\(ops, c, fin, kind, \{ index: checkers\.indexOf\(c\.player\) \+ 1, of: checkers\.length \}\)/.test(read('tools/whatif/core.mjs')) && /checkingWho: who \?\? null/.test(read('tools/whatif/core.mjs')));
        // The first block of every player's check is planned up front: the first message of the check already carries the whole first-block total (64 for three players).
        const tU = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
        tU.sync(endedF);
        const first = tU.sync({ ...endedF, stage: 'confirming picks', candidatesLeft: 0, checking: 'foods', checkingWho: { index: 1, of: 3 }, picksPlanned: 64, picksDone: 0 });
        const textU = panel.renderParts({ state: 'running', progress: { parts: first } }, t).split('<div class="whatif-part ').slice(1).find((x) => x.includes('data-kind="foods"')).replace(/<[^>]*>/g, '');
        check('pick check on the stage row: the first player already shows the whole total ("player 1 of 3 · 0 / 64 runs")', textU.includes('player 1 of 3 · 0 / 64 runs'), textU);
        const csU = read('tools/whatif/core.mjs');
        check('pick check on the stage row: core plans every player\'s first block before the first check starts, with the same planning the check itself uses', /for \(const p of checkers\) planSure\(sureReqs\(baseOps, fpool\.find\(\(c\) => c\.player === p\), SURE_BLOCK, fin\.h\)\);/.test(csU) && /const reqs = sureReqs\(baseOps, c, k, fin\.h\);\s*planSure\(reqs\);/.test(csU));
        const after = tf.sync({ stage: 'drinks', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, stageEnded: 'foods', picksPlanned: 32, picksDone: 32 });
        check('pick check on the stage row: once the next stage runs the foods row is plain done again', after.find((r) => r.kind === 'foods').checking === false && after.find((r) => r.kind === 'foods').state === 'done' && !panel.renderParts({ state: 'running', progress: { parts: after } }, t).includes('checking the accepted'));
        const ck2 = tf.sync({ stage: 'confirming picks', candidatesLeft: 0, checking: 'drinks', stageEnded: 'drinks', round: 1, picksPlanned: 80, picksDone: 36, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1 });
        check('pick check on the stage row: the drinks check counts from its own start (36 - 32 of 80 - 32)', ck2.find((r) => r.kind === 'drinks').checkPlanned === 48 && ck2.find((r) => r.kind === 'drinks').checkDone === 4 && ck2.find((r) => r.kind === 'foods').checking === false, JSON.stringify(ck2.find((r) => r.kind === 'drinks')));
        // A greedy step's pick check keeps the picks part (the whole greedy phase's row), as before.
        const g = createParts(plan); g.sync({ stage: 'screen', runsDone: 3, runsPlanned: 9, stageEnded: 'screen', round: 1 });
        check('pick check of a greedy step still shows as the picks part', g.sync({ stage: 'confirming picks', checking: 'step 1', picksPlanned: 32, picksDone: 5 }).find((r) => r.kind === 'picks').state === 'running');
        // The picks part counts the greedy phase's checks only: the global counts a foods or drinks check leaves stay on every later message and must not fill it.
        {
            const stg = (stage, extra = {}) => ({ stage, round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, ...extra });
            const pk = (ps) => ps.find((r) => r.kind === 'picks');
            const flat = (p) => `${p.state} fill ${p.fill ?? 0} runs ${p.runsDone}/${p.runsPlanned}`;
            const tg = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
            tg.sync(stg('foods', { stageEnded: 'foods' }));
            tg.sync(stg('confirming picks', { stageEnded: 'foods', checking: 'foods', checkingWho: { index: 1, of: 3 }, candidatesLeft: 0, picksPlanned: 64, picksDone: 0 }));
            const midF = tg.sync(stg('confirming picks', { stageEnded: 'foods', checking: 'foods', checkingWho: { index: 3, of: 3 }, candidatesLeft: 0, picksPlanned: 64, picksDone: 64 }));
            check('picks part: during the foods check it stays waiting with no bar', flat(pk(midF)) === 'waiting fill 0 runs 0/0', flat(pk(midF)));
            const d1 = tg.sync(stg('drinks', { picksPlanned: 64, picksDone: 64 }));
            check("picks part: drinks round 1 still carrying the foods check's 64 / 64 leaves it waiting, fill 0, runs 0 (no filled bar)", flat(pk(d1)) === 'waiting fill 0 runs 0/0', flat(pk(d1)));
            const d2 = tg.sync(stg('drinks', { round: 2, picksPlanned: 64, picksDone: 64 }));
            check('picks part: and so does every later message of the drinks stage', flat(pk(d2)) === 'waiting fill 0 runs 0/0' && d2.find((r) => r.kind === 'drinks').state === 'running', flat(pk(d2)));
            // The drinks check adds 56 runs (the global counts go to 120 planned), then the Screen runs with the counts still on every message.
            tg.sync(stg('confirming picks', { stageEnded: 'drinks', checking: 'drinks', checkingWho: { index: 1, of: 3 }, candidatesLeft: 0, picksPlanned: 120, picksDone: 64 }));
            const endD = tg.sync(stg('confirming picks', { stageEnded: 'drinks', checking: 'drinks', checkingWho: { index: 3, of: 3 }, candidatesLeft: 0, picksPlanned: 120, picksDone: 120 }));
            check('picks part: during the drinks check it stays waiting with no bar', flat(pk(endD)) === 'waiting fill 0 runs 0/0', flat(pk(endD)));
            const scr = tg.sync({ stage: 'screen', round: 1, phase: 'search', runsDone: 2, runsPlanned: 90, candidatesLeft: 30, picksPlanned: 120, picksDone: 120 });
            check('drinks -> screen: the Screen row running with 120 / 120 on its messages: the picks part is waiting, fill 0, runs 0', scr.find((r) => r.kind === 'screen').state === 'running' && flat(pk(scr)) === 'waiting fill 0 runs 0/0', flat(pk(scr)));
            const g1 = tg.sync({ stage: 'confirming picks', checking: 'step 1', picksPlanned: 152, picksDone: 125 });
            check('greedy step: the first check of the greedy phase counts from 0 (32 planned, 5 done), running', pk(g1).state === 'running' && pk(g1).runsPlanned === 32 && pk(g1).runsDone === 5 && Math.abs(pk(g1).fill - 5 / 32) < 1e-9, flat(pk(g1)));
            const gEnd = tg.sync({ stage: 'greedy step 2', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, picksPlanned: 152, picksDone: 152 });
            check('greedy step: between two checks the part is waiting with its own totals (32 / 32), and the foods row is unaffected', pk(gEnd).state === 'waiting' && pk(gEnd).runsPlanned === 32 && pk(gEnd).runsDone === 32 && gEnd.find((r) => r.kind === 'foods').state === 'done', flat(pk(gEnd)));
            // Only the drinks ticked: drinks -> its check -> screen.
            const td = createParts({ ...plan, candidates: null, kinds: ['drinks'] });
            td.sync(stg('drinks', { stageEnded: 'drinks' }));
            td.sync(stg('confirming picks', { stageEnded: 'drinks', checking: 'drinks', checkingWho: { index: 1, of: 1 }, candidatesLeft: 0, picksPlanned: 16, picksDone: 16 }));
            const sd = td.sync({ stage: 'screen', round: 1, phase: 'search', runsDone: 2, runsPlanned: 90, candidatesLeft: 30, picksPlanned: 16, picksDone: 16 });
            check('drinks alone -> screen: the picks part has no bar (waiting, fill 0, 0 / 0) and there is no foods row', flat(pk(sd)) === 'waiting fill 0 runs 0/0' && !sd.some((r) => r.kind === 'foods'), flat(pk(sd)));
            const sg = td.sync({ stage: 'confirming picks', checking: 'step 1', picksPlanned: 20, picksDone: 19 });
            check('drinks alone: the first greedy check counts from 0 (4 planned, 3 done)', pk(sg).state === 'running' && pk(sg).runsPlanned === 4 && pk(sg).runsDone === 3, flat(pk(sg)));
        }
        for (const l of ['en', 'pt', 'zh']) check(`pick check on the stage row: ${l} has the string with its runs slot`, typeof locales[l].progress.checkingPicks === 'string' && locales[l].progress.checkingPicks.includes('{{runs}}'));
    }
    const cs = read('tools/whatif/core.mjs');
    const flat = cs.split(/[\r\n ]+/).join(' ');
    check('core: the progress record takes the round record counts at each round, and the stage end only when it ends (not on a stop)', flat.includes('stageCont = { contending: cont.contending, paused: cont.paused, separate: nearestSeparation(standing, { goal, mult: pauseMult, rounds: stageRound }) }; report();') && flat.includes('Object.assign(progress, stageCtx(), { stageEnded: stage }, bySkip ? { stageSkipped: true } : {}); report(); return { locked:') && cs.split('stageEnded: stage').length === 2 && /finally \{[^}]*for \(const k of STAGE_FIELDS\) delete progress\[k\]/.test(cs));
}
// A stage the user ended with Skip: its row is done and marked `skipped` (its round was cut: "round N · ended by you"), kept by the later messages; an Accept's row is not marked.
{
    const race = { round: 1, phase: 'search', stageContending: 2, stagePaused: 0, stageDropped: 0, stageRuns: 5, stageSimHours: 20, stageAcceptable: 0, stageSeparate: null };
    const sk = createParts({ ...plan, kinds: ['foods'] });
    sk.sync({ stage: 'foods', ...race });
    const ended = sk.sync({ stage: 'foods', ...race, stageEnded: 'foods', stageSkipped: true }).find((p) => p.kind === 'foods');
    const later = sk.sync({ stage: 'screen', runsPlanned: 1, runsDone: 0 }).find((p) => p.kind === 'foods');
    check('skipped stage: the row is done and skipped, and stays so once the next stage starts', ended.state === 'done' && ended.skipped === true && later.state === 'done' && later.skipped === true, JSON.stringify([ended, later]));
    const ac = createParts({ ...plan, kinds: ['foods'] });
    ac.sync({ stage: 'foods', ...race });
    check('accepted stage: the row is done and not marked skipped', ac.sync({ stage: 'foods', ...race, stageEnded: 'foods' }).find((p) => p.kind === 'foods').skipped === undefined);
    check('a row of a stage with no stage fields (the confirmation) has no round', !('round' in createParts(plan).sync({ stage: 'confirmation', runsPlanned: 1, runsDone: 0 }).at(-1)));
}
// Picks left out inside the race (progress.picksLeftOut: the pick check on the leaders' reading seeds, no run of its own): the picks part ends done with the count, never skipped.
{
    const lo = createParts(plan);
    lo.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164 });
    lo.sync({ stage: 'screen', picksLeftOut: 9, runsDone: 5, runsPlanned: 164 });
    const fin = lo.sync({ stage: 'done', picksLeftOut: 9, runsDone: 164, runsPlanned: 164 });
    const pk = fin.find((p) => p.kind === 'picks'), plain = createParts(plan);
    plain.sync({ stage: 'screen', candidatesLeft: 40, runsDone: 0, runsPlanned: 164 });
    const none = plain.sync({ stage: 'done', runsDone: 164, runsPlanned: 164 }).find((p) => p.kind === 'picks');
    check('picks left out in the race: the part is done with leftOut at the end of the search', pk.state === 'done' && pk.leftOut === 9 && pk.runsPlanned === 0, JSON.stringify(pk));
    check('no pick checked or left out: the part has no leftOut (the window reads it as not run)', none.leftOut === undefined && none.state !== 'done', JSON.stringify(none));
}
check('strings: placeholders match across languages', keys.every((k) => ['pt', 'zh'].every((l) => (locales[l].progress[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.progress[k].match(/\{\{\w+\}\}/g) || []).sort().join())));
const ptHtml = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 2, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, tIn('pt'));
check('strings: pt renders without a missing key', !ptHtml.includes('#'), ptHtml);

process.exit(failed ? 1 : 0);
