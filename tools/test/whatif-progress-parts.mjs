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
    check('done button: shown once, inside the running race stage\'s label after its counters, and not in a waiting or bar row', (raceHtml.match(/data-whatif-done/g) || []).length === 1 && /<span class="whatif-part-label">.*224.*ruled out.*data-whatif-done/.test(race) && !race.includes('whatif-part-text') && others.every((r) => !r.includes('data-whatif-done')), raceHtml);
    check('done button: its text and tooltip say what it does', race.includes('>Done with this stage, go on<') && race.includes('title="Ends this stage after the round it is in'));
    check('done button: a finished race stage has none', !panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'foods', state: 'done', round: 3, contending: 5, paused: 2, dropped: 1, runs: 224, simHours: 11000 }] } }, t).includes('data-whatif-done'));
    check('done button: the API has the done route', panel.API.done('a b') === '/api/search/a%20b/done');
    for (const l of ['en', 'pt', 'zh']) check(`done button: ${l} has the strings`, ['stageDone', 'stageDoneTip'].every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length) && typeof locales[l].result.endedByUser === 'string' && locales[l].result.endedByUser.includes('{{n}}'));
    const cs = read('tools/whatif/core.mjs'), os = read('tools/whatif/optimize.mjs'), sv = read('tools/whatif/runner/server.mjs');
    check('done: optimize.mjs sets stop.done on the "done" message (and does not kill the pool)', /m === 'done'\) stop\.done = true/.test(os) && /m === 'stop'\) \{ stop\.requested = true; pool\.kill\(\); \}/.test(os));
    check('done: the runner has POST /done that sends "done" over the IPC', /\\\/done\$\//.test(sv) && /c\.send\('done'\)/.test(sv));
    check('done: race() ends after the published round when stop.done is set, with the leaders as --max-rounds returns them, and marks it', /outSink\.round\(rec\);[^]*?const byUser = !!stopSignal\.done;[^]*?endedByUser\[stage\] = roundNo - sinceStart;[^]*?settled \|\| byUser \|\|/.test(cs) && /result\.endedByUser = endedByUser/.test(cs));
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
    // The pick checks go on reporting the same stage name: the row stays done.
    const later = tp.sync({ ...ended, runsDone: 9, runsPlanned: 40 }).find((r) => r.kind === 'screen');
    check('ended stage: later messages of the same stage name (the pick checks) keep it done', later.state === 'done' && later.contending === 271);
    const html = panel.renderParts({ state: 'running', progress: { parts: tp.sync({ ...ended, runsDone: 12, runsPlanned: 40 }) } }, t);
    const rowHtml = html.split('<div class="whatif-part ').slice(1).find((r) => r.includes('data-kind="screen"'));
    const rowText = rowHtml.replace(/<[^>]*>/g, '');
    check('ended stage: drawn as a finished round, 271 and 202, no running word, no done button', rowText.includes('round 1 finished') && rowText.includes('271 still in the running') && rowText.includes('202 set aside') && !rowText.includes('round 1 running') && !rowHtml.includes('data-whatif-done'), rowText);
    // The next stage takes its own row; the ended one is not touched by it.
    const next = tp.sync({ stage: 'greedy step 1', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, stageEnded: 'screen' });
    check('ended stage: the next stage row is running even while the old stageEnded is still in the record', next.find((r) => r.kind === 'step').state === 'running' && next.find((r) => r.kind === 'screen').state === 'done');
    const cs = read('tools/whatif/core.mjs');
    const flat = cs.split(/[\r\n ]+/).join(' ');
    check('core: the progress record takes the round record counts at each round, and the stage end only when it ends (not on a stop)', flat.includes('stageCont = { contending: cont.contending, paused: cont.paused }; report();') && flat.includes('Object.assign(progress, stageCtx(), { stageEnded: stage }); report(); return { locked:') && cs.split('stageEnded: stage').length === 2);
}
check('strings: placeholders match across languages', keys.every((k) => ['pt', 'zh'].every((l) => (locales[l].progress[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.progress[k].match(/\{\{\w+\}\}/g) || []).sort().join())));
const ptHtml = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 2, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, tIn('pt'));
check('strings: pt renders without a missing key', !ptHtml.includes('#'), ptHtml);

process.exit(failed ? 1 : 0);
