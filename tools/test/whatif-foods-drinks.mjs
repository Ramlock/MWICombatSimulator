// Test: the foods and the drinks are two levers (before, one lever `consumables`). Four parts: the window's lever list; the search id (a request that ticks
// both hashes as the old `consumables` request did, so a rerun finds the old search's folder, runs and result); the progress plan (parts follow the ticked
// kinds); the core on the synthetic simulation (tools/whatif/synthetic.mjs, scenario tools/test/synthetic/scenario.json): Foods alone runs no drinks stage,
// Drinks alone runs no foods stage, and `consumables` or both ticked gives the same result.
// Usage: node tools/test/whatif-foods-drinks.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const panel = await imp('src/whatif/panel.mjs');
const { searchId } = await imp('tools/whatif/runner/server.mjs');
const { createParts } = await imp('tools/whatif/progress.mjs');
const { loadScenario, runSynthetic } = await imp('tools/whatif/synthetic.mjs');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

// ---- The window's lever list ----
{
    const ids = panel.LEVERS.map((l) => l.id);
    check('levers: foods and drinks are two levers, in that order, right after equip; there is no consumables lever', ids.slice(0, 3).join() === 'equip,foods,drinks' && !ids.includes('consumables'), ids.join());
    check('levers: both start ticked', ['foods', 'drinks'].every((id) => panel.LEVERS.find((l) => l.id === id).def === true));
    const lev = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(readFileSync(path.join(root, 'locales', l, 'common.json'), 'utf8')).whatIf.lever]));
    check('levers: each of foods and drinks has a name and a description in en, pt and zh; no consumables entry is left', ['en', 'pt', 'zh'].every((l) => ['foods', 'drinks'].every((k) => lev[l][k]?.name && lev[l][k]?.desc) && !('consumables' in lev[l])), JSON.stringify(Object.keys(lev.en)));
    check('levers: foods and drinks are named apart in each language', ['en', 'pt', 'zh'].every((l) => lev[l].foods.name !== lev[l].drinks.name));
}

// ---- The search id: the old request and the new both-ticked request are the same search ----
{
    const base = { setups: [{ name: 'Alpha', player: {} }], goal: 'profit', budgets: { Alpha: 1 } };
    const id = (levers) => searchId(levers === undefined ? base : { ...base, levers });
    const old = id(['equip', 'consumables', 'owned']);
    check('search id: an old request (consumables) and a new one with both ticked have the same id, so a rerun finds the old folder, runs and result', id(['equip', 'foods', 'drinks', 'owned']) === old);
    check('search id: only the foods ticked, or only the drinks, is another search, and not the same as the other', id(['equip', 'foods', 'owned']) !== old && id(['equip', 'drinks', 'owned']) !== old && id(['equip', 'foods', 'owned']) !== id(['equip', 'drinks', 'owned']));
    check('search id: neither ticked is another search again', id(['equip', 'owned']) !== old);
    check('search id: a request with no levers list keeps its own id; the body is never changed', id(undefined) === searchId(base) && (() => { const b = { ...base, levers: ['foods', 'drinks'] }; searchId(b); return b.levers.join() === 'foods,drinks'; })());
    check('search id: the order of the other levers still counts (a different list is a different search, as before)', id(['owned', 'equip', 'foods', 'drinks']) !== id(['equip', 'foods', 'drinks', 'owned']));
}

// ---- The progress plan follows the ticked kinds ----
{
    const plan = { stages: [{ k: 8, h: 1 }, { k: 4, h: 1 }], keep: [4], maxSteps: 2, candidates: null };
    const kinds = (parts) => parts.map((p) => p.kind).filter((k) => k === 'foods' || k === 'drinks').join();
    const sync = (k) => createParts({ ...plan, kinds: k }).sync({ stage: 'start' });
    check('plan: both kinds, foods then drinks, come before the screen', kinds(sync(['foods', 'drinks'])) === 'foods,drinks' && sync(['foods', 'drinks'])[2].kind === 'screen');
    check('plan: Foods alone has no drinks part, Drinks alone has no foods part, none has neither', kinds(sync(['foods'])) === 'foods' && kinds(sync(['drinks'])) === 'drinks' && kinds(sync([])) === '' && kinds(createParts(plan).sync({ stage: 'start' })) === '');
    const tf = createParts({ ...plan, kinds: ['foods'] });
    check('plan: a foods stage report makes the foods row run; a drinks stage report with the drinks unticked changes no row', tf.sync({ stage: 'foods', runsPlanned: 4, runsDone: 1 }).find((p) => p.kind === 'foods').state === 'running' && !tf.sync({ stage: 'drinks', runsPlanned: 4, runsDone: 0 }).some((p) => p.kind === 'drinks'));
}

// ---- The core: which stages run ----
const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
// The search is stopped when the Screen starts (after the foods and drinks stages): a search with no steps has no lock to end its Screen by, and only the stages before it are looked at.
const go = (levers) => runSynthetic(scenario, { levers, 'max-steps': 0 }, { onRound: (rec, stop) => { if (rec.stage === 'screen') stop.requested = true; } });
const stagesOf = (r) => new Set(r.rounds.map((x) => x.stage));
const partKinds = (r) => (r.lastProgress?.parts || []).map((p) => p.kind).filter((k) => k === 'foods' || k === 'drinks').join();
// The names of the levers and the wall time are the only things allowed to differ between two runs of the same search.
const strip = (r) => { const x = JSON.parse(JSON.stringify(r.result)); delete x.args; delete x.timing; delete x.options.levers; return JSON.stringify(x); };
{
    const t0 = Date.now();
    const foodsOnly = await go('equip,foods'), drinksOnly = await go('equip,drinks'), both = await go('equip,foods,drinks'), old = await go('equip,consumables');
    console.log(`     (4 searches, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    check('core: Foods alone runs a foods stage and no drinks stage; the drinks stay as set up (no entry changed, no drink op in the baseline)', stagesOf(foodsOnly).has('foods') && !stagesOf(foodsOnly).has('drinks') && !foodsOnly.result.baselineOps.some((o) => o.op === 'drink') && Object.keys(foodsOnly.result.best.drinks).length === 0 && Object.keys(foodsOnly.result.best.foods).length === 3 && !foodsOnly.result.singles.some((s) => s.stage === 'drink'));
    check('core: Drinks alone runs a drinks stage and no foods stage; the foods stay as set up (no food op in the baseline)', stagesOf(drinksOnly).has('drinks') && !stagesOf(drinksOnly).has('foods') && !drinksOnly.result.baselineOps.some((o) => o.op === 'food') && Object.keys(drinksOnly.result.best.foods).length === 0 && Object.keys(drinksOnly.result.best.drinks).length === 3 && !drinksOnly.result.singles.some((s) => s.stage === 'food'));
    check('core: the stage rows follow what runs: foods only, drinks only, both in the order foods then drinks', partKinds(foodsOnly) === 'foods' && partKinds(drinksOnly) === 'drinks' && partKinds(both) === 'foods,drinks', [partKinds(foodsOnly), partKinds(drinksOnly), partKinds(both)].join(' | '));
    const order = both.rounds.map((x) => x.stage).filter((s) => s === 'foods' || s === 'drinks');
    check('core: both ticked run foods before drinks', order.indexOf('foods') >= 0 && order.lastIndexOf('foods') < order.indexOf('drinks'));
    check('core: `consumables` (the old name) reads as both: the same result as foods and drinks ticked, down to the number of runs', strip(old) === strip(both) && old.runs === both.runs && old.result.options.levers.join() === 'equip,foods,drinks', `${old.runs} vs ${both.runs}; ${old.result.options.levers.join()}`);
    check('core: a lever list that says consumables and foods does not run the foods twice', JSON.stringify([...stagesOf(await go('equip,consumables,foods'))].sort()) === JSON.stringify([...stagesOf(both)].sort()));
    const none = await go('equip');
    check('core: a list with neither runs no foods or drinks stage and has no best', !stagesOf(none).has('foods') && !stagesOf(none).has('drinks') && !Object.keys(none.result.best.foods).length && !Object.keys(none.result.best.drinks).length && partKinds(none) === '');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
