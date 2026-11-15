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
// The stage table (renderParts) as rows: the row's class and kind, and its cells as text (the state chip's text, class and title apart).
const nums = (s) => s.replace(/<span data-num="([^"]+)"[^>]*>[^<]*<\/span>/g, (_, n) => n);
const txt = (s) => nums(s).replace(/<[^>]+>/g, '');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const partRows = (h) => [...h.matchAll(/<tr class="whatif-part whatif-part-(\w+)(?: whatif-part-race)?" data-kind="(\w+)" data-state="(\w+)">([^]*?)<\/tr>/g)].map((m) => {
    const cells = [...m[4].matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((c) => c[1]);
    const chip = cells[2].match(/<span class="whatif-chip whatif-st-(\w+)"(?: title="([^"]*)")?>([^<]*)<\/span>/);
    return { cls: m[1], kind: m[2], state: m[3], mark: cells[0], label: txt(cells[1].replace(/<span class="whatif-help"[^>]*>\?<\/span>/g, '')), tip: unesc((cells[1].match(/data-tip="([^"]*)"/) || [])[1] ?? ''), stKey: chip[1], st: chip[3], stTip: unesc(chip[2] || ''),
        round: txt(cells[3]), runs: txt(cells[4]), hours: txt(cells[5]), cont: txt(cells[6]), paused: txt(cells[7]), dropped: txt(cells[8]), pct: cells[9], detail: cells[10], btns: cells[11], html: m[0] };
});

// 4x50,4x150,8x300 with 40 candidates and keep 10: screen, halving 1, halving 2.
const plan = { stages: [{ k: 4, h: 50 }, { k: 4, h: 150 }, { k: 8, h: 300 }], keep: [10, 3], candidates: 40, maxSteps: 20 };
const tr = createParts(plan);
const kinds = (ps) => ps.map((p) => `${p.kind}${p.kind === 'confirmation' ? '' : p.index}:${p.state}`).join(' ');
const P = 'steps0:waiting confirmation:waiting';

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
check('greedy step 1 added when it starts', kinds(ps) === 'screen0:done halving1:done halving2:done step1:running moreSteps1:waiting confirmation:waiting', kinds(ps));
ps = tr.sync({ stage: 'greedy step 2', candidatesLeft: 2, runsDone: 0, runsPlanned: 16, etaSeconds: 80 });
check('greedy step 2 added, step 1 stays full', kinds(ps) === 'screen0:done halving1:done halving2:done step1:done step2:running moreSteps2:waiting confirmation:waiting' && ps[3].runsDone === 24, kinds(ps));
ps = tr.sync({ stage: 'confirmation', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('confirmation added after the steps', kinds(ps) === 'screen0:done halving1:done halving2:done step1:done step2:done confirmation:running', kinds(ps));
const stopped = tr.sync({ stage: 'stopped', candidatesLeft: 0, runsDone: 2, runsPlanned: 16, etaSeconds: 40 });
check('stopped mid-way: the rows stay as they were', kinds(stopped) === kinds(ps) && stopped.at(-1).runsDone === 2, kinds(stopped));
ps = tr.sync({ stage: 'done', candidatesLeft: 0, runsDone: 16, runsPlanned: 16, etaSeconds: 0 });
check('done: every row done', ps.every((p) => p.state === 'done') && ps.length === 6, kinds(ps));

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
check('no pick: the search ends with the steps part and the confirmation part skipped (never started, will not), the stages that ran done', kinds(ps) === 'screen0:done halving1:done halving2:done steps0:skipped confirmation:skipped', kinds(ps));
check('no pick: a skipped part keeps no up-to count, and the same search before it is done still has them waiting', ps.every((p) => p.runsUpTo === undefined) && tr2.sync({ stage: 'probe' }).filter((p) => p.state === 'waiting').length === 2);
{
    // A search with picks and no accepted step: the picks were checked, a step ran (and was not taken), no confirmation: only the confirmation is skipped.
    const t4 = createParts(plan);
    for (const s of ['screen', 'halving 1', 'halving 2']) t4.sync({ stage: s, runsPlanned: 4, runsDone: 4, candidatesLeft: 3 });
    t4.sync({ stage: 'greedy step 1', runsPlanned: 4, runsDone: 4, candidatesLeft: 3 });
    t4.sync({ stage: 'confirming picks', runsPlanned: 4, runsDone: 4, candidatesLeft: 0, picksPlanned: 32, picksDone: 32 });
    const before = t4.sync({ stage: 'greedy step 2', runsPlanned: 4, runsDone: 1, candidatesLeft: 3 });
    check('picks, no accepted step: before the end the confirmation is only waiting', before.at(-1).state === 'waiting' && before.some((p) => p.kind === 'moreSteps'), kinds(before));
    const end = t4.sync({ stage: 'done', runsPlanned: 4, runsDone: 4, candidatesLeft: 0 });
    check('picks, no accepted step: only the confirmation is skipped (the steps that ran are done), and the more-steps row is gone', kinds(end) === 'screen0:done halving1:done halving2:done step1:done step2:done confirmation:skipped', kinds(end));
    const tfd = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] }); tfd.setCandidates(40);
    const fEnd = tfd.sync({ stage: 'done' });
    check('a done search whose foods and drinks parts never ran (in the plan) skips them too; one that ran keeps them done', kinds(fEnd).startsWith('foods0:skipped drinks0:skipped screen0:skipped') && !kinds(tfd.sync({ stage: 'done' })).includes('waiting'));
    const tfr = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] }); tfr.setCandidates(40);
    tfr.sync({ stage: 'foods', runsPlanned: 4, runsDone: 4 }); tfr.sync({ stage: 'drinks', runsPlanned: 4, runsDone: 4 });
    check('foods and drinks that ran are done, not skipped, when the search ends after them', kinds(tfr.sync({ stage: 'done' })).startsWith('foods0:done drinks0:done screen0:skipped'), kinds(tfr.sync({ stage: 'done' })));
    const html = panel.renderParts({ state: 'done', progress: { parts: end } }, t), skippedRow = partRows(html).find((r) => r.kind === 'confirmation');
    check('window: a skipped confirmation part draws a dash mark, no bar and no open circle, with "Not run: no step was accepted." (the state chip\'s title)', skippedRow.html.includes('whatif-part-skipped') && skippedRow.mark === '–' && !skippedRow.html.includes('○') && !skippedRow.html.includes('progress-bar') && skippedRow.stTip === 'Not run: no step was accepted.', skippedRow.html);
    const html2 = panel.renderParts({ state: 'done', progress: { parts: ps } }, t), rows2 = partRows(html2);
    check('window: the skipped steps part says "Not run: no change was picked.", the confirmation part its own line, the parts that ran stay done', ['steps'].every((k) => rows2.find((r) => r.kind === k).stTip === 'Not run: no change was picked.') && rows2.find((r) => r.kind === 'confirmation').stTip === 'Not run: no step was accepted.' && rows2.filter((r) => r.state === 'done').length === 3 && rows2.every((r) => r.state !== 'waiting'), html2);
    for (const l of ['en', 'pt', 'zh']) check(`window: ${l} has the two skipped lines (a string each, different from each other)`, typeof locales[l].progress.skippedNoPick === 'string' && typeof locales[l].progress.skippedNoStep === 'string' && locales[l].progress.skippedNoPick !== locales[l].progress.skippedNoStep && locales[l].progress.skippedNoPick.length > 0);
}
check('probe before the screen: all rows waiting', kinds(createParts(plan).sync({ stage: 'probe' })) === 'screen0:waiting halving1:waiting halving2:waiting ' + P);
check('a single stage plan has the screen only', createParts({ stages: [{ k: 4, h: 50 }], keep: [], candidates: 5, maxSteps: 20 }).sync({ stage: 'screen', runsPlanned: 3, runsDone: 1 }).length === 3);

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

// Each row carries its own pick check (progress.checkingStage names the row): Searching, then "Checking the winner" with the change named and its runs, then Done;
// a winner its check left out (progress.checkFailed) is named on its row, and the row goes back to Searching when its race goes on. No shared re-check row.
{
    const tp = createParts(plan);
    const race = (stage, extra = {}) => ({ stage, round: 2, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 5, stageCandidates: 20, stageContending: 5, stagePaused: 1, stageDropped: 14, stageRuns: 40, stageSimHours: 100, ...extra });
    tp.sync(race('screen', { stageEnded: 'screen' }));
    let q = tp.sync(race('greedy step 1'));
    check('check on its row: no part of kind picks exists', !q.some((r) => r.kind === 'picks'), kinds(q));
    const what = { player: 'Player 2', desc: 'Weapon +5 -> +7' };
    q = tp.sync({ ...race('greedy step 1', { stageEnded: 'greedy step 1' }), stage: 'confirming picks', checking: 'step 2', checkingStage: 'greedy step 1', checkingWhat: what, picksPlanned: 32, picksDone: 10 });
    const st1 = q.find((r) => r.kind === 'step' && r.index === 1);
    check('check on its row: the step row carries the check, the change and its runs (10 / 32); the screen row does not', st1.checking === true && st1.checkWhat.desc === what.desc && st1.checkPlanned === 32 && st1.checkDone === 10 && !q.find((r) => r.kind === 'screen').checking, JSON.stringify(st1));
    const pr = partRows(panel.renderParts({ state: 'running', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('check on its row: the window reads "Checking the winner", running, names the change and "10 / 32 runs" in Details', pr.st === 'Checking the winner' && pr.state === 'running' && pr.html.includes('Weapon') && txt(pr.html).includes('10 / 32 runs'), pr.html);
    const fail = { stage: 'greedy step 1', ...what, seeds: 16, gainPerUser: -3, sePerUser: 2 };
    q = tp.sync({ stage: 'confirming picks', checking: 'step 2', checkingStage: 'greedy step 1', checkingWhat: what, picksPlanned: 32, picksDone: 32, checkFailed: fail });
    q = tp.sync(race('greedy step 1', { round: 3, checkFailed: fail, stageBack: 3 }));
    const back = q.find((r) => r.kind === 'step' && r.index === 1), prB = partRows(panel.renderParts({ state: 'running', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('failed winner: the row keeps it (once) and goes back to Searching, its Details say it was left out and the search goes on', back.state === 'running' && !back.checking && back.failed.length === 1 && prB.st === 'Searching' && txt(prB.html).includes('Left out by its check, the search goes on:') && prB.html.includes('Weapon'), prB.html);
    check('failed winner: the row carries the changes that came back into its race (stageBack) and Details say so ("3 candidates returned to the race")', back.back === 3 && txt(prB.html).includes('3 candidates returned to the race'), prB.html);
    q = tp.sync({ stage: 'done' });
    const prD = partRows(panel.renderParts({ state: 'done', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('failed winner, row done: "Left out by its check:", no candidate in the running nor set aside, the bar at 100 %', prD.cls === 'done' && txt(prD.html).includes('Left out by its check:') && prD.cont === '' && prD.paused === '' && prD.html.includes('width: 100%') && !txt(prD.html).includes('returned to the race'), prD.html);
    const next = tp.sync({ ...race('greedy step 2'), checkFailed: undefined });
    check('check on its row: a check of a later row starts its runs from 0', tp.sync({ stage: 'confirming picks', checkingStage: 'greedy step 2', checkingWhat: what, picksPlanned: 48, picksDone: 36 }).find((r) => r.kind === 'step' && r.index === 2).checkDone === 4 && next.length > 0);
}
// The check's four endings on the row (progress.checkFailed carries ending, range and goal: core.mjs leftOutByCheck): a change too small to tell is
// never worded as left out by a failed check; each left-out change's tip says which ending it was, with its range.
{
    const tp = createParts(plan);
    const race = (stage, extra = {}) => ({ stage, round: 2, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 5, stageCandidates: 20, stageContending: 5, stagePaused: 1, stageDropped: 14, stageRuns: 40, stageSimHours: 100, ...extra });
    tp.sync(race('screen', { stageEnded: 'screen' }));
    const what = { player: 'Player 2', desc: 'Weapon +5 -> +7' };
    const loss = { stage: 'greedy step 1', ...what, seeds: 16, gainPerUser: -9, sePerUser: 2, ending: 'loss', range: { low: -13, high: -5, floor: 40 }, goal: 'profit' };
    const unsure = { stage: 'greedy step 1', player: 'Player 2', desc: 'Ring +1 -> +2', seeds: 64, gainPerUser: 20, sePerUser: 15, ending: 'unsure', range: { low: -10, high: 50, floor: 40 }, goal: 'profit' };
    tp.sync(race('greedy step 1'));
    let q = tp.sync(race('greedy step 1', { round: 3, checkFailed: loss }));
    let pr = partRows(panel.renderParts({ state: 'running', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('endings: a loss heads the row as left out by its check, its tip says "a loss" with its range', txt(pr.html).includes('Left out by its check, the search goes on:') && pr.html.includes('data-ending="loss"') && pr.html.includes('+7: a loss: -13 to -5, on fresh runs (16 per side)'), pr.html);
    q = tp.sync(race('greedy step 1', { round: 4, checkFailed: unsure }));
    pr = partRows(panel.renderParts({ state: 'running', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('endings: too small to tell heads the row apart ("Too small to tell, the search goes on:"), never as failed; both tips stay, each with its ending', txt(pr.html).includes('Too small to tell, the search goes on:') && !txt(pr.html).includes('Left out by its check') && pr.html.includes('data-ending="unsure"') && pr.html.includes('+2: too small to tell: -10 to 50, on fresh runs (64 per side)') && pr.html.includes('a loss: -13 to -5'), pr.html);
    q = tp.sync({ stage: 'done' });
    pr = partRows(panel.renderParts({ state: 'done', progress: { parts: q } }, t)).find((r) => r.kind === 'step');
    check('endings: a done row whose last winner was too small to tell reads "Too small to tell:"', txt(pr.html).includes('Too small to tell:'), pr.html);
    const tp2 = createParts(plan);
    tp2.sync(race('screen', { stageEnded: 'screen' }));
    const small = { ...loss, ending: 'small', range: { low: -20, high: 30, floor: 40 } };
    tp2.sync(race('greedy step 1'));
    const q2 = tp2.sync(race('greedy step 1', { round: 3, checkFailed: small })), pr2 = partRows(panel.renderParts({ state: 'running', progress: { parts: q2 } }, t)).find((r) => r.kind === 'step');
    check('endings: too small to matter says "under X a day for sure" with its range', pr2.html.includes('too small to matter: under 40 a day for sure (-20 to 30)'), pr2.html);
    const old = { stage: 'greedy step 1', ...what, seeds: 16, gainPerUser: -3, sePerUser: 2 };
    const tp3 = createParts(plan); tp3.sync(race('screen', { stageEnded: 'screen' })); tp3.sync(race('greedy step 1'));
    const pr3 = partRows(panel.renderParts({ state: 'running', progress: { parts: tp3.sync(race('greedy step 1', { round: 3, checkFailed: old })) } }, t)).find((r) => r.kind === 'step');
    check('endings: a record from before the endings (no ending) reads as before', txt(pr3.html).includes('Left out by its check, the search goes on:') && pr3.html.includes('+7: left out by its check, on fresh runs (16 per side)'), pr3.html);
    const core = fs.readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
    check('endings: core reports the ending, its range and the goal on checkFailed (one path, leftOutByCheck), from every check', /checkFailed: \{ stage: at, \.\.\.whatOf\(list\), \.\.\.checkOf\(fresh, ending\), goal,/.test(core) && (core.match(/leftOutByCheck\(at, \[c\], got\.fresh, got\.ending\)|leftOutByCheck\(stage, \[c\], peek\.get\(c\)\.fresh, e\)|leftOutByCheck\(at, got\.set, got\.fresh, got\.ending\)/g) || []).length === 3);
}
// The bar: candidates ruled out over all candidates of the row, a %; not time.
{
    const bar = (row) => partRows(panel.renderParts({ state: 'running', progress: { parts: [row] } }, t))[0];
    const b = bar({ kind: 'screen', index: 0, state: 'running', round: 2, phase: 'search', candidates: 40, contending: 30, paused: 0, dropped: 10, runs: 50, simHours: 100 });
    check('bar: 10 of 40 ruled out is 25 %, drawn as a bar and a figure', b.html.includes('width: 25%') && txt(b.html).includes('25%'), b.html);
    check('bar: the header has a help mark saying it counts changes, not time', panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', index: 0, state: 'running', round: 1 }] } }, t).includes(t('progress.col.progressTip').replace(/'/g, '&#39;')) || panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', index: 0, state: 'running', round: 1 }] } }, t).includes('not time'));
    const w = bar({ kind: 'screen', index: 0, state: 'waiting', runsUpTo: 9 });
    check('bar: a waiting row has none', !w.html.includes('whatif-pct-in'), w.html);
}
// The runs of a resumed round kept from the record (progress.runsKept): on the row of that stage and round, gone at the next round.
{
    const tk = createParts(plan);
    const m = (round, extra = {}) => ({ stage: 'screen', round, phase: 'search', runsDone: 1, runsPlanned: 1146, stageCandidates: 40, stageContending: 40, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, ...extra });
    let r = tk.sync(m(1, { runsKept: { kept: 989, total: 1146, stage: 'screen', round: 1 } })).find((x) => x.kind === 'screen');
    const pr = partRows(panel.renderParts({ state: 'running', progress: { parts: [r] } }, t))[0];
    check('runs kept: the row says "989 of 1,146 runs kept from before the stop"', txt(pr.html).includes('989 of 1,146 runs kept from before the stop') || txt(pr.html).includes('989 of 1146 runs kept from before the stop'), txt(pr.html));
    r = tk.sync(m(2)).find((x) => x.kind === 'screen');
    check('runs kept: gone at the next round; a fresh search has none', !r.kept && !createParts(plan).sync(m(1)).find((x) => x.kind === 'screen').kept, JSON.stringify(r));
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
const rows = partRows(html).map((r) => r.cls);
check('panel: one row per part with its state class', rows.join(' ') === 'done running waiting waiting waiting', rows.join(' '));
const plain = html.replace(/<span class="whatif-part-mark">[^<]*<\/span>/g, (m) => m).replace(/<[^>]+>/g, '');
// The state word is in the window's state chip (whatif-window.mjs); the part count is the head's Stage figure.
check('panel: the head says Stage 2 / 5', plain.startsWith('Search progressStage 2 / 5'), plain);
const pr0 = partRows(html);
check('panel: done row text, no "done" (the tick says it) in its label or runs cell', pr0[0].label === 'Change 1' && pr0[0].runs === '80 / 80' && pr0[0].mark === '✓' && !/done/i.test(pr0[0].label + pr0[0].runs), JSON.stringify(pr0[0]));
check('panel: running row text and options left (its runs, the time left in its state chip, the options left in the In the running cell)', pr0[1].label === 'Narrowing down, round 1' && pr0[1].cont === '10' && pr0[1].runs === '36 / 80' && pr0[1].stTip === '0:03:55 left', JSON.stringify(pr0[1]));
check('panel: waiting row says up to N runs (its state chip\'s title) and its options left', pr0[2].label === 'Narrowing down, round 2' && pr0[2].cont === '3' && pr0[2].stTip === 'up to 24 runs', JSON.stringify(pr0[2]));
check('panel: placeholder labels (their sentences are the label\'s help mark)', pr0[3].tip === 'Choosing changes one at a time: up to 20, stops when none helps' && pr0[4].tip === 'Final check: only if a change is chosen', JSON.stringify([pr0[3].tip, pr0[4].tip]));
const more = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 1, state: 'done', runsPlanned: 4 }, { kind: 'moreSteps', index: 1, state: 'waiting', stepsLeft: 19 }] } }, t).replace(/<[^>]+>/g, '');
check('panel: more changes row, and a step row is named by the change it looks for (index + 1)', more.includes('More changes: up to 19 more') && more.includes('Change 2'), more);
const marks = [...html.matchAll(/<td class="whatif-part-mark">([^<]*)<\/td>/g)].map((m) => m[1]);
check('panel: one icon cell per row, same family, no colour emoji', marks.length === 5 && marks.every((m) => /^[\u2713\u25B6\u25CB]\uFE0E?$/.test(m)), JSON.stringify(marks));
check('panel: icon column has one fixed width and rows start with it', /\.whatif-parts-table td\.whatif-part-mark \{[^}]*width: 1\.75em/.test(read('index.html')) && pr0.every((r) => r.html.startsWith('<tr class="whatif-part') && r.html.indexOf('<td class="whatif-part-mark">') < r.html.indexOf('<td class="whatif-part-label">') && r.html.indexOf('<td class="whatif-part-mark">') === r.html.indexOf('>') + 1));
const headText = txt(html.match(/<div class="whatif-parts-head">([^]*?)<\/div>/)[1]);
check('panel: small line seconds per run and elapsed, no whole-search time (in the head line; the label "Final check of the whole set" is a stage name)', headText.includes('Seconds per run 241.46') && headText.includes('elapsed 1:12:30') && !/whole|total time/i.test(headText), headText);
check('panel: numbers keep their raw value', html.includes('data-num="36"') && html.includes('title="241.4567"'));
const stoppedHtml = panel.renderProgress({ state: 'stopped', progress: { stage: 'stopped', parts: [{ kind: 'screen', index: 0, state: 'running', runsPlanned: 10, runsDone: 4, etaSeconds: 5 }] } }, t);
check('panel: stopped keeps the rows and their figures, but nothing reads or is marked running (item 27)', stoppedHtml.includes('whatif-part-halted') && partRows(stoppedHtml)[0].runs === '4 / 10' && !stoppedHtml.includes('whatif-part-running') && !/Running/.test(stoppedHtml), stoppedHtml);
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
        for (const pr of partRows(html)) {
            const key = pr.kind + '#' + (seen.set(pr.kind, (seen.get(pr.kind) ?? 0) + 1), seen.get(pr.kind));
            const w = pr.html.match(/width: ([\d.]+)%/), isRace = pr.cls === 'running' && pr.html.includes('whatif-part-race'); // the stage that runs now (a done or halted race row has no bar either, but its counters are final)
            if (w) { if (widths.has(key) && Number(w[1]) < widths.get(key)) bad.push(`${key} bar ${widths.get(key)} -> ${w[1]} at ${JSON.stringify(m)}`); widths.set(key, Number(w[1])); }
            if (isRace && pr.html.includes('progress-bar')) bad.push(`${key} race row has a bar`);
            if (isRace) {
                const nums = [Number(pr.runs || 0), Number(pr.hours || 0), Number(pr.dropped || 0)], prev = counters.get(key); // a count of 0 is an empty cell
                if (prev && nums.some((v, i) => v < prev[i])) bad.push(`${key} counters ${prev} -> ${nums}`);
                counters.set(key, nums);
                phaseWords.push([t('progress.st.searching'), t('progress.st.checking')].includes(pr.st));
            }
        }
    }
    check('sequence: no row\'s bar ever goes back across rounds, greedy steps, the pick check and the confirmation', bad.length === 0, bad.slice(0, 3).join(' | '));
    check('sequence: a running race row has no bar, counters that only grow, and the phase named in words', phaseWords.length > 20 && phaseWords.every(Boolean) && counters.size >= 3);
    check('sequence: the runs and simulated hours counters end above where they began and "dropped" did rise', [...counters.values()].some((c) => c[0] > 100 && c[1] > 5000 && c[2] >= 3), JSON.stringify([...counters.values()]));
    const contRow = partRows(panel.renderParts({ state: 'running', progress: { parts: tp.sync({ stage: 'screen', round: 4, phase: 'search', runsDone: 1, runsPlanned: 9, stageContending: 3, stagePaused: 9, stageDropped: 1, stageRuns: 5, stageSimHours: 10 }) } }, t)).find((r) => r.kind === 'screen');
    check('sequence: contention is shown as plain numbers (it may fall, no bar for it)', contRow.cont === '3' && !contRow.html.includes('progress-bar'), JSON.stringify(contRow));
}

// "Done with this stage, go on": the button is on the race stage that runs now, on its own line after the counters, and nowhere else.
{
    const raceHtml = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'foods', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, runs: 224, simHours: 11000 }, { kind: 'screen', state: 'waiting', runsUpTo: 9 }, { kind: 'step', index: 1, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, t);
    const rows = partRows(raceHtml);
    const race = rows.find((r) => r.kind === 'foods'), others = rows.filter((r) => r.kind !== 'foods');
    const buttons = (html) => [...html.matchAll(/data-whatif-done="(\w+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}:${m[2]}`);
    check('two buttons: with no pool that Accept would take, only "Skip this stage" is shown, once, inside the running race stage\'s label after its counters, and not in a waiting or bar row', buttons(raceHtml).join('|') === 'skip:Skip this stage' && race.runs === '224' && race.dropped === '1' && race.btns.includes('data-whatif-done="skip"') && race.html.indexOf('224') < race.html.indexOf('data-whatif-done="skip"') && !race.html.includes('whatif-part-text') && others.every((r) => !r.html.includes('data-whatif-done')), raceHtml);
    const both = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 }, { kind: 'halving', index: 1, state: 'waiting', runsUpTo: 9 }] } }, t);
    check('two buttons: with a pool Accept would take, "Accept current winner" comes first and "Skip this stage" second, on the stage line', buttons(both).join('|') === 'accept:Accept current winner|skip:Skip this stage' && partRows(both)[0].dropped === '1' && /data-whatif-done="accept"[^]*data-whatif-done="skip"/.test(partRows(both)[0].btns) && partRows(both)[0].html.indexOf('224') < partRows(both)[0].html.indexOf('data-whatif-done="accept"'), both);
    check('two buttons: the tooltips say what each does (both end now and lose the runs going; accept: positive leader whose figure is shown, not checked on fresh runs; skip: a locked pool keeps its pick)', both.includes('title="Ends this stage now; the runs already going are stopped and their work is lost. A pool with no lock takes its best leader above 0 net gain whose figure is shown') && both.includes('A locked pool keeps its pick; the others stay unchanged.'));
    check('two buttons: a finished or stopped race stage has none', ['done', 'running'].every((s, i) => !panel.renderParts({ state: i ? 'stopped' : 'running', progress: { parts: [{ kind: 'foods', state: s, round: 3, contending: 5, paused: 2, dropped: 1, acceptable: 2, runs: 224, simHours: 11000 }] } }, t).includes('data-whatif-done')));
    check('two buttons: the API has the done route', panel.API.done('a b') === '/api/search/a%20b/done');
    for (const l of ['en', 'pt', 'zh']) check(`two buttons: ${l} has the strings, the skip label names no stage, and the old ones are gone`, ['stageAccept', 'stageAcceptTip', 'stageSkip', 'stageSkipTip'].every((k) => typeof locales[l].progress[k] === 'string' && locales[l].progress[k].length) && !locales[l].progress.stageSkip.includes('{{stage}}') && !('stageFinishing' in locales[l].progress) && !('stageDone' in locales[l].progress) && !('stageDoneTip' in locales[l].progress) && typeof locales[l].result.endedByUser === 'string' && locales[l].result.endedByUser.includes('{{n}}'));
    for (const l of ['pt', 'zh']) { const h = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'screen', state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 }] } }, tIn(l)); check(`two buttons: ${l} renders both without a missing key`, buttons(h).length === 2 && !h.includes('#progress.'), h); }
    // After a press: the pressed button stays drawn by every redraw (the state is in the markup), both buttons disabled; no note (both end the stage at once).
    const screenRow = { kind: 'screen', index: 0, state: 'running', round: 3, phase: 'search', contending: 5, paused: 2, dropped: 1, acceptable: 1, runs: 224, simHours: 11000 };
    const drawn = (pressed, row = screenRow) => panel.renderParts({ state: 'running', progress: { parts: [row] } }, t, pressed);
    const none = drawn(null), acc = drawn({ key: 'screen:0', mode: 'accept' }), skp = drawn({ key: 'screen:0', mode: 'skip' }), other = drawn({ key: 'step:1', mode: 'accept' });
    check('two buttons: nothing pressed, nothing disabled and no note; a press on another part changes nothing here', !none.includes('disabled') && !none.includes('data-whatif-note') && other === none);
    check('two buttons: Accept pressed: both buttons disabled, the pressed one reads "Accepting…" (class whatif-pending) with its own tooltip, and no note (Accept ends the stage at once, like Skip)', (acc.match(/disabled/g) || []).length === 2 && /<button[^>]*whatif-pending[^>]*data-whatif-done="accept"[^>]*disabled>Accepting…<\/button>/.test(acc) && !/whatif-pending[^>]*data-whatif-done="skip"/.test(acc) && !acc.includes('Finishing the current round') && !acc.includes('data-whatif-note'), acc);
    check('two buttons: Accept pressed stays drawn when the pool it would take is gone (acceptable 0 on the next poll)', drawn({ key: 'screen:0', mode: 'accept' }, { ...screenRow, acceptable: 0 }) === acc);
    check('two buttons: Skip pressed: both disabled, the pressed one reads "Skipping…" (class whatif-pending), no note (Skip ends the stage at once)', (skp.match(/disabled/g) || []).length === 2 && /<button[^>]*whatif-pending[^>]*data-whatif-done="skip"[^>]*disabled>Skipping…<\/button>/.test(skp) && !skp.includes('Finishing the current round') && !skp.includes('data-whatif-note'), skp);
    check('two buttons: the same state gives the same markup twice (a redraw can keep the node); the buttons carry their part', drawn({ key: 'screen:0', mode: 'accept' }) === acc && /data-whatif-done="accept" data-whatif-part="screen:0"/.test(none));
    const stopping = panel.renderParts({ state: 'running', progress: { parts: [screenRow] } }, t, null, true);
    check('two buttons: while Stopping both are drawn in place with their own labels, disabled, none pending', stopping === none.replace(/(data-whatif-part="screen:0" title="[^"]*")>/g, '$1 disabled>') && (stopping.match(/ disabled>/g) || []).length === 2 && !stopping.includes('whatif-pending'), stopping);
    check('two buttons: renderProgress passes Stopping through', panel.renderProgress({ state: 'running', progress: { parts: [screenRow] } }, t, null, true) === panel.renderProgress({ state: 'running', progress: { parts: [screenRow] } }, t, null, false).replace(/(data-whatif-part="screen:0" title="[^"]*")>/g, '$1 disabled>'));
    for (const l of ['pt', 'zh']) check(`two buttons: ${l} draws a pressed Accept without a missing key`, !panel.renderParts({ state: 'running', progress: { parts: [screenRow] } }, tIn(l), { key: 'screen:0', mode: 'accept' }).includes('#progress.'));
    const cs = read('tools/whatif/core.mjs'), os = read('tools/whatif/optimize.mjs'), sv = read('tools/whatif/runner/server.mjs'), mj = read('src/main.js');
    check('two buttons: optimize.mjs hands the mode of the { done } message to the core\'s press (and does not kill the pool)', /m\?\.done === 'accept' \|\| m\?\.done === 'skip'\) stop\.press\?\.\(m\.done\)/.test(os) && /m === 'stop'\) \{ stop\.requested = true; pool\.kill\(\); \}/.test(os));
    check('two buttons: the runner has POST /done that reads the mode (a bad one is a 400) and sends { done: mode } over the IPC', /\\\/done\$\//.test(sv) && /c\.send\(\{ done: mode \}\)/.test(sv) && /mode !== 'accept' && mode !== 'skip'\) return send\(res, 400/.test(sv) && /s\.handle\.done\(mode\)/.test(sv));
    check('two buttons: the window posts the clicked button\'s mode and keeps the press in its state (drawn by every redraw)', /JSON\.stringify\(\{ mode: pressed\.mode \}\)/.test(mj) && /whatIf\.pressed = pressed; whatIfDrawProgress\(\)/.test(mj) && /whatIfRenderProgress\(whatIf\.status, whatIfT, whatIf\.pressed, whatIf\.pending === 'stopping', whatIfNames\(\)\)/.test(mj));
    check('two buttons: race() ends after the published round when stop.done is set, through the one end path, with the leaders as --max-rounds returns them, and marks it', /outSink\.round\(rec\);[^]*?const mode = stopSignal\.done, byUser = !!mode;[^]*?endedByUser\[stage\] = roundNo - sinceStart;[^]*?settled \|\| byUser \|\|/.test(cs) && /result\.endedByUser = endedByUser/.test(cs));
    check('two buttons: accept locks what acceptTakes returns for the pools without a lock, skip locks nothing, and both read the one `takes`; a race that ends with a set accepted together or its budget groups locks nothing more', /const takes = acceptTakes\(live, gainOf, \{ byPlayer, players, locked: lockedBy, cmp: byPlayer \? rankFirst : rank \}\);/.test(cs) && /const accepted = mode === 'accept' && !together && !groupsOut \? takes : new Map\(\);/.test(cs) && /for \(const \[k, c\] of accepted\) lockedBy\.set\(k, c\);/.test(cs) && /stageAcceptable: stageCont\.acceptable/.test(cs) && /stageCont\.acceptable = takes\.size/.test(cs));
    check('two buttons: an accepted pick joins as it is (no refinement, no pick check, no fresh reading, marked), in the greedy steps and in foods and drinks; a pick the search locked still goes through the check', /const asIs = ok\.length > 0 && res\.accepted\.includes\(res\.locked\);/.test(cs) && /const picked = asIs \? \{ best: res\.locked, orig: res\.locked, fresh: null, failed: \[\] \} : await firstConfirmed\(/.test(cs) && /\.\.\.\(asIs \? \{ acceptedAsIs: true \} : \{ fresh \}\)/.test(cs) && /\(c\) => asIs\.has\(c\)\);/.test(cs) && /accepted: \[\.\.\.accepted\.values\(\)\]|endStage\(live, \[\.\.\.accepted\.values\(\)\](, [^)]*)?\)/.test(cs) && /if \(!picked\.best\) continue;/.test(cs));
    check('two buttons: Accept is offered for a leader whose figure is shown, by the one helper the window shares (showsFigure), read by the core\'s gainOf', /import \{ hasFigure, showsFigure \} from '\.\.\/\.\.\/src\/whatif\/figure\.mjs'/.test(cs) && /const gainOf = \(c\) => \{ const r = read\.get\(c\); return r && showsFigure\(rowFor\(c\)\)/.test(cs));
    check('two buttons: a press stops the lanes (ensure, skippable) and ends the runs in flight through the pool\'s drop (one mechanism: press -> dropRuns, set only while a race batch runs), never the pool\'s kill; the stage ends with its own outcome, never false; the stage end is one function', /async function ensure\(reqs, \{ onRun, skippable = false \} = \{\}\)/.test(cs) && /const BY_USER = Symbol\('byUser'\)/.test(cs) && /searched === BY_USER\) return userEnd\(stageRound, 'search'\)/.test(cs) && /read1 === BY_USER\) return userEnd\(stageRound, 'reading'\)/.test(cs) && cs.split('const endStage = ').length === 2 && /stopSignal\.press = \(mode\) => \{ stopSignal\.done = mode; dropRuns\?\.\(\); \};/.test(cs) && /if \(skippable\) dropRuns = \(\) => runPool\.drop\(\);/.test(cs) && /finally \{ if \(skippable\) dropRuns = null; \}/.test(cs) && cs.split('runPool.drop').length === 2 && !/(run)?[pP]ool\.kill\(\)/.test(cs.slice(cs.indexOf('async function ensure'), cs.indexOf('const BY_USER'))));
    check('two buttons: there are few stop.done readers: the press, the comment naming it, the lanes\' test, the stage start\'s clear, userEnd\'s read and reset, the end-of-round read and reset', cs.split('stopSignal.done').length === 9, String(cs.split('stopSignal.done').length));
    check('two buttons: a press during a round\'s runs ends the stage at once through userEnd: Skip with nothing taken, Accept with what the last finished round offered (prevTakes, kept with prevLive)', /const accepted = mode === 'accept' \? prevTakes : new Map\(\);/.test(cs) && /return endStage\(prevLive, \[\.\.\.accepted\.values\(\)\], mode === 'skip'\);/.test(cs) && /prevLive = live; prevTakes = takes;/.test(cs));
    check('round numbers count inside the stage (a stage\'s first round is round 1): the record, the progress and the first look use stageRound, never the run-wide roundNo', /const stageRound = roundNo - sinceStart;/.test(cs) && !/round: roundNo/.test(cs) && /firstLook\(cands, base, byPlayer, stage, stageRound\)/.test(cs) && /\{ stage, round: stageRound, phase: 'search'/.test(cs) && /\{ stage, round: stageRound, phase: 'reading'/.test(cs) && /const rec = \{ round: stageRound,/.test(cs));
    check('elimination: race() runs eliminate() on the not-refuted candidates each round after the estimates, drops what is out from the round (active, contention), reads the last standing, locks only a lone change that passes the pick check, settles when no change is left; the bar comes from the cached base runs (barsOf); no separated / anyHope left', /const standing = eliminate\(cands\.filter/.test(cs) && /contention\(active\.filter\(\(c\) => !c\.out\)/.test(cs) && /const lastStanding = /.test(cs) && /const resolved = /.test(cs) && /function barsOf\(base, count\)/.test(cs) && /const BAR_FRACTION = 0\.01;/.test(cs) && !/separated|anyHope/.test(cs.replace(/\/\/[^\n]*/g, '')));
    check('elimination payback cut: eliminate() gets the same payLimit the pick check uses (0 off the profit goal)', /const barsNow = barsOf\(base, maxK \* baseMult\);/.test(cs) && /bars: barsNow, payLimit, order: players/.test(cs) && /const payLimit = goal === 'profit' \? maxPayback : 0;/.test(cs));
    check('the end of a stage publishes the report at once (onEnd), so the ended-by-you mark shows before the pick checks; every race call passes it (foods and drinks, the greedy step, its budget groups)', /onEnd\?\.\(\);[^\n]*\n\s*Object\.assign\(progress, stageCtx\(\), \{ stageEnded: stage \}, bySkip \? \{ stageSkipped: true \} : \{\}\)/.test(cs) && (cs.match(/onEnd: \(\) => publish\(result\)/g) || []).length === 3);
    check('done: a press before a stage\'s first round is dropped (race() clears the flag at its start)', /stopSignal\.done = false; \/\/ a press before/.test(cs));
}
// Item 24 in the core: a leader without a clear gain gives the final's unchanged form, flagged; one with a clear gain gives its items.
{
    const cs = read('tools/whatif/core.mjs');
    check('best so far: an unclear leader (too few fresh runs, range reaching 0, shared loot falling) gets bestEntry(..., null) flagged unclear, the candidate kept', /if \(r\.tooFew \|\| r\.readingSeeds < readMin \|\| r\.status === 'loses' \|\| !\(Number\.isFinite\(lo\) && lo > 0\)\) \{[^]*?bestEntry\(kind, now, null\), soFar: true, unclear: true[^]*?candidate: items/.test(cs));
    check('party order: contention gets the players, the first look sorts with poolSorter, the best and the report text follow partyEntries', /order: players \}\)/.test(cs) && /\.sort\(poolSorter\(players\)\)/.test(cs) && /result\.best\[kind\] = inParty\(/.test(cs) && /partyEntries\(result\.best\[kind\]\)/.test(cs) && /partyEntries\(c\.buyerByPlayer\)/.test(cs) && !/\.sort\(\(a, b\) => \(a\[0\] < b\[0\]/.test(cs));
}

// Strings in en, pt, zh.
const keys =['partOf', 'partSteps', 'partMoreSteps', 'partConfirmationWaiting', 'partScreen', 'partHalving', 'partStep', 'partConfirmation', 'optionsLeft', 'runsOf', 'upTo', 'timeLeft', 'done', 'secondsPerRunCap', 'elapsed'];
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
    const sepRow = (sep, lang = 'en') => { const rr = tp.sync({ ...during, stageContending: 2, stagePaused: 1, ...(sep !== undefined ? { stageSeparate: sep } : {}) }); return partRows(panel.renderParts({ state: 'running', progress: { parts: rr } }, tIn(lang))).find((x) => x.kind === 'screen'); };
    check('projection: the running row says "about 80 more rounds to separate" (its state chip\'s title), beside the still-in-the-running count 2 and the set-aside count 1', sepRow({ rounds: 80 }).stTip === 'about 80 more rounds to separate' && sepRow({ rounds: 80 }).cont === '2' && sepRow({ rounds: 80 }).paused === '1', JSON.stringify(sepRow({ rounds: 80 })));
    check('projection: one round is singular, a null is "more than 999", none shows nothing', sepRow({ rounds: 1 }).stTip === 'about 1 more round to separate' && !sepRow({ rounds: 1 }).stTip.includes('rounds to separate') && sepRow({ rounds: null }).stTip === 'more than 999 more rounds to separate' && sepRow({ rounds: null }).cont === '2' && sepRow({ rounds: null }).paused === '1' && !sepRow(null).stTip.includes('separate') && !sepRow().stTip.includes('separate'));
    for (const l of ['en', 'pt', 'zh']) check(`projection: ${l} has the three strings and the stage label takes the placeholder`, ['separateRounds', 'separateRoundsOne', 'separateFar'].every((k) => typeof locales[l].progress[k] === 'string') && ['contendingCount', 'pausedCount', 'droppedCount', 'endedByYou'].every((k) => typeof locales[l].progress[k] === 'string') && locales[l].progress.separateRounds.includes('{{n}}') && locales[l].progress.separateRoundsOne.includes('{{n}}'));
    const csS = read('tools/whatif/core.mjs');
    check('projection: core hands the nearest pool\'s figure (nearestSeparation over the elimination pools, this round of the stage) to the stage record', /separate: nearestSeparation\(standing, \{ goal, mult: pauseMult, rounds: stageRound \}\)/.test(csS) && /stageSeparate: stageCont\.separate \?\? null/.test(csS));
    // The pick checks go on reporting the same stage name: the row stays done.
    const later =tp.sync({ ...ended, runsDone: 9, runsPlanned: 40 }).find((r) => r.kind === 'screen');
    check('ended stage: later messages of the same stage name (the pick checks) keep it done', later.state === 'done' && later.contending === 271);
    const html = panel.renderParts({ state: 'running', progress: { parts: tp.sync({ ...ended, runsDone: 12, runsPlanned: 40 }) } }, t);
    const rowEnded = partRows(html).find((r) => r.kind === 'screen');
    check('ended stage: drawn as a finished stage (one round: no round cell), no In the running nor Set aside count (its race is over), a done row not a running one, no done button', rowEnded.round === '' && rowEnded.cont === '' && rowEnded.paused === '' && rowEnded.cls === 'done' && rowEnded.st === t('progress.st.done') && !rowEnded.html.includes('data-whatif-done'), JSON.stringify(rowEnded));
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
        check('pick check on the stage row: no part of kind picks, the drinks and screen rows keep waiting', !ck.some((r) => r.kind === 'picks') && ck.find((r) => r.kind === 'drinks').state === 'waiting' && ck.find((r) => r.kind === 'screen').state === 'waiting', kinds(ck));
        const htmlC = panel.renderParts({ state: 'running', progress: { parts: ck } }, t);
        const foodsRow = partRows(htmlC).find((x) => x.kind === 'foods'), foodsText = foodsRow.stTip;
        check('pick check on the stage row: the row reads "Checking the winner" (its tooltip "checking the winner on fresh runs · 5 / 32 runs") in place of "done", marked as running, and the title has no part number', foodsRow.st === 'Checking the winner' && foodsText.includes('checking the winner on fresh runs · 5 / 32 runs') && foodsRow.st !== t('progress.st.done') && foodsRow.html.includes('data-state="running"') && !/Stage \d+ \/ \d+/.test(txt(htmlC)) && htmlC.includes('whatif-st-running'), foodsText);
        // With the player named (progress.checkingWho): the stage's total stays, the row adds "player N of M".
        const ckW = tf.sync({ ...endedF, stage: 'confirming picks', candidatesLeft: 0, checking: 'foods', checkingWho: { index: 3, of: 3 }, picksPlanned: 64, picksDone: 48 });
        const frW = ckW.find((r) => r.kind === 'foods'), textW = partRows(panel.renderParts({ state: 'running', progress: { parts: ckW } }, t)).find((x) => x.kind === 'foods').stTip;
        check('pick check on the stage row: the row names the player ( "player 3 of 3 · 48 / 64 runs"), the total is the stage\'s so far', frW.checkWho.index === 3 && frW.checkWho.of === 3 && frW.checkPlanned === 64 && frW.checkDone === 48 && textW.includes('checking the winner on fresh runs · player 3 of 3 · 48 / 64 runs'), textW);
        for (const l of ['en', 'pt', 'zh']) check(`pick check on the stage row: ${l} has the player-of-total string`, ['{{n}}', '{{of}}', '{{runs}}'].every((p) => locales[l].progress.checkingWinnerOf.includes(p)));
        check('pick check on the stage row: core names the player (index among the players with a pick, of that count) for foods and drinks only', /confirmPick\(ops, c, fin, kind, \{ index: checkers\.indexOf\(c\.player\) \+ 1, of: checkers\.length \}\)/.test(read('tools/whatif/core.mjs')) && /measureArms\(baseOps, c, k, fin\.h, label, who \?\? null, at, whatOf\(\[c\]\)\)\)/.test(read('tools/whatif/core.mjs')));
        // The first block of every player's check is planned up front: the first message of the check already carries the whole first-block total (64 for three players).
        const tU = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
        tU.sync(endedF);
        const first = tU.sync({ ...endedF, stage: 'confirming picks', candidatesLeft: 0, checking: 'foods', checkingWho: { index: 1, of: 3 }, picksPlanned: 64, picksDone: 0 });
        const textU = partRows(panel.renderParts({ state: 'running', progress: { parts: first } }, t)).find((x) => x.kind === 'foods').stTip;
        check('pick check on the stage row: the first player already shows the whole total ("player 1 of 3 · 0 / 64 runs")', textU.includes('player 1 of 3 · 0 / 64 runs'), textU);
        const csU = read('tools/whatif/core.mjs');
        check('pick check on the stage row: core plans every player\'s first block before the first check starts, with the same planning the check itself uses', /for \(const p of checkers\) planSure\(sureReqs\(start, fpool\.find\(\(c\) => c\.player === p\), SURE_BLOCK, fin\.h\)\);/.test(csU) && /const reqs = sureReqs\(against, c, k, h\);\s*planSure\(reqs\);/.test(csU) && /measureArms\(baseOps, c, k, fin\.h,/.test(csU));
        const after = tf.sync({ stage: 'drinks', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, stageEnded: 'foods', picksPlanned: 32, picksDone: 32 });
        check('pick check on the stage row: once the next stage runs the foods row is plain done again', after.find((r) => r.kind === 'foods').checking === false && after.find((r) => r.kind === 'foods').state === 'done' && !panel.renderParts({ state: 'running', progress: { parts: after } }, t).includes('checking the winner'));
        const ck2 = tf.sync({ stage: 'confirming picks', candidatesLeft: 0, checking: 'drinks', stageEnded: 'drinks', round: 1, picksPlanned: 80, picksDone: 36, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1 });
        check('pick check on the stage row: the drinks check counts from its own start (36 - 32 of 80 - 32)', ck2.find((r) => r.kind === 'drinks').checkPlanned === 48 && ck2.find((r) => r.kind === 'drinks').checkDone === 4 && ck2.find((r) => r.kind === 'foods').checking === false, JSON.stringify(ck2.find((r) => r.kind === 'drinks')));
        // A greedy step's pick check is drawn on its own row (checkingStage), counted from its own start: the global counts a foods or drinks check leaves never fill it.
        {
            const stg = (stage, extra = {}) => ({ stage, round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, candidatesLeft: 9, stageContending: 9, stagePaused: 0, stageDropped: 0, stageRuns: 1, stageSimHours: 1, ...extra });
            const tg = createParts({ ...plan, candidates: null, kinds: ['foods', 'drinks'] });
            tg.sync(stg('foods', { stageEnded: 'foods' }));
            tg.sync(stg('confirming picks', { stageEnded: 'foods', checking: 'foods', checkingStage: 'foods', candidatesLeft: 0, picksPlanned: 64, picksDone: 64 }));
            tg.sync(stg('drinks', { stageEnded: 'drinks', picksPlanned: 64, picksDone: 64 }));
            tg.sync(stg('confirming picks', { stageEnded: 'drinks', checking: 'drinks', checkingStage: 'drinks', candidatesLeft: 0, picksPlanned: 120, picksDone: 120 }));
            const scr = tg.sync({ stage: 'screen', round: 1, phase: 'search', runsDone: 2, runsPlanned: 90, candidatesLeft: 30, picksPlanned: 120, picksDone: 120 });
            check('drinks -> screen: no row is checking while the screen searches, and no picks part', scr.every((r) => !r.checking) && !scr.some((r) => r.kind === 'picks'), kinds(scr));
            const g1 = tg.sync({ stage: 'confirming picks', checking: 'step 1', checkingStage: 'screen', picksPlanned: 152, picksDone: 125 }), sr = g1.find((r) => r.kind === 'screen');
            check('greedy step: the screen row\'s check counts from 0 (32 planned, 5 done), on the screen row only', sr.checking && sr.checkPlanned === 32 && sr.checkDone === 5 && g1.filter((r) => r.checking).length === 1, JSON.stringify(sr));
            const gEnd = tg.sync({ stage: 'greedy step 1', round: 1, phase: 'search', runsDone: 1, runsPlanned: 9, picksPlanned: 152, picksDone: 152 });
            check('greedy step: once the next race runs the screen row is plain done and the foods row is unaffected', !gEnd.find((r) => r.kind === 'screen').checking && gEnd.find((r) => r.kind === 'screen').state === 'done' && gEnd.find((r) => r.kind === 'foods').state === 'done');
        }
        for (const l of ['en', 'pt', 'zh']) check(`pick check on the stage row: ${l} has the string with its runs slot`, typeof locales[l].progress.checkingWinnerTip === 'string' && locales[l].progress.checkingWinnerTip.includes('{{runs}}'));
    }
    const cs = read('tools/whatif/core.mjs');
    const flat = cs.split(/[\r\n ]+/).join(' ');
    check('core: the progress record takes the round record counts at each round, and the stage end only when it ends (not on a stop)', flat.includes('stageCont = { contending: cont.contending, paused: cont.paused, separate: nearestSeparation(standing, { goal, mult: pauseMult, rounds: stageRound }) }; report();') && flat.includes('Object.assign(progress, stageCtx(), { stageEnded: stage }, bySkip ? { stageSkipped: true } : {}); report(); return { locked:') && cs.split('stageEnded: stage').length === 2 && /finally \{[^}]*for \(const k of STAGE_FIELDS\) if \(!STAGE_END\.includes\(k\)\) delete progress\[k\]/.test(cs));
    check('core: the end mark (stageEnded, stageSkipped) outlives the race for the pick checks under its name; it goes when the next race starts and at the confirmation and the end', /const STAGE_END = \['stageEnded', 'stageSkipped'\];/.test(cs) && /if \(patch\.stage === 'confirmation' \|\| patch\.stage === 'done'\) for \(const k of STAGE_END\) delete progress\[k\];/.test(cs) && /stopSignal\.done = false; \/\/ a press before[^\n]*\n\s*for \(const k of STAGE_END\) delete progress\[k\];/.test(cs));
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
check('core: no picksLeftOut field (a winner its check left out is named on its row, checkFailed)', !read('tools/whatif/core.mjs').includes('picksLeftOut') && !read('tools/whatif/progress.mjs').includes('picksLeftOut'));
check('strings: placeholders match across languages', keys.every((k) => ['pt', 'zh'].every((l) => (locales[l].progress[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.progress[k].match(/\{\{\w+\}\}/g) || []).sort().join())));
const ptHtml = panel.renderProgress({ state: 'running', progress: { parts: [{ kind: 'step', index: 2, state: 'running', runsPlanned: 4, runsDone: 1, etaSeconds: 9 }] } }, tIn('pt'));
check('strings: pt renders without a missing key', !ptHtml.includes('#'), ptHtml);

process.exit(failed ? 1 : 0);
