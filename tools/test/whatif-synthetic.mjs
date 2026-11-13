// Test: the what-if rules on a synthetic simulation (tools/whatif/synthetic.mjs, scenario tools/test/synthetic/scenario.json). Every change the core builds
// from the scenario's party and prices has a known true gain, cost and noise, so the rule has a known answer in each case: a clear winner, a loser, a tied
// pair, a change under the 1% bar, a paid change that fails the payback limit, one that passes, a pick that fails the fresh-run check, a player whose profit
// is zero or below. Two parts: the elimination rule (rounds.mjs eliminate, pure) on the scenario's true numbers, and the whole search (core.mjs main) on the
// synthetic pool, with no page. The same scenario drives a real-page run (runner `--synthetic`).
// Usage: node tools/test/whatif-synthetic.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const { loadScenario, runSynthetic, applyScenarioToRequest, checkpointFor, createSyntheticPool } = await imp('tools/whatif/synthetic.mjs');
const { eliminate } = await imp('tools/whatif/rounds.mjs');
const { makePricer } = await imp('tools/whatif/prices.mjs');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
const n = scenario.players.length, M = scenario.model, PAY = 365;

// ---- The scenario itself ----
check('scenario: generic names, no coin in any setup, a price snapshot with a timestamp', scenario.players.map((p) => p.name).join() === 'Alice,Bob,Cara' && scenario.players.every((p) => !('coin' in p) && !('coin' in p.player)) && Number.isFinite(scenario.market.timestamp));
{
    const a = checkpointFor(scenario, { variant: 'v', seed: 7, ops: [] }, 50), b = checkpointFor(scenario, { variant: 'v', seed: 7, ops: [] }, 50), c = checkpointFor(scenario, { variant: 'v', seed: 8, ops: [] }, 50);
    check('checkpoint: seeded (same task, same numbers; another seed, another)', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c));
    const up = checkpointFor(scenario, { variant: 'w', seed: 7, ops: [{ op: 'enhance', player: 'Alice', slot: 'body', delta: 2 }] }, 50);
    const loot = (cp) => cp.party.profitAfterTaxPerDay + cp.party.consumablesPerDay;
    check('checkpoint: the party loot is the profit after tax plus its consumables, and an op adds its true gain (up to the noise)', Math.abs(loot(up) - M.lootPerDay - 150_000) < 6 * M.lootSd50 && Math.abs(loot(a) - M.lootPerDay) < 6 * M.lootSd50);
    const fresh = (seed) => loot(checkpointFor(scenario, { variant: 'z', seed, ops: [{ op: 'enhance', player: 'Bob', slot: 'body', delta: 2 }] }, 50));
    const mean = (f, from) => Array.from({ length: 60 }, (_, i) => f(from + i)).reduce((x, y) => x + y, 0) / 60;
    check('checkpoint: a search-seed bonus is on the search seeds (<= 10000) only: Bob body +2 reads +145K there, ~0 on seeds above', mean(fresh, 1) - M.lootPerDay > 100_000 && Math.abs(mean(fresh, 20001) - M.lootPerDay) < 20_000);
    const pool = createSyntheticPool(scenario), r = await pool.run({ variant: 'v', seed: 1, ops: [], checkpoints: [50, 300] });
    check('pool: answers { variant, seed, wallSeconds, checkpoints } with one checkpoint per hour asked; kill() makes it answer null', r.variant === 'v' && r.seed === 1 && r.checkpoints.map((c) => c.simHours).join() === '50,300' && (pool.kill(), await pool.run({ variant: 'v', seed: 2, ops: [], checkpoints: [50] })) === null);
    const body = applyScenarioToRequest({ goal: 'exp', options: { prices: 'x', zone: 'z' }, levers: ['all'] }, scenario);
    check('request: the scenario\'s party, prices, budgets and levers replace the window\'s; the id follows the scenario', body.setups === scenario.players && body.options.marketplace === scenario.market && !('prices' in body.options) && body.options.zone === 'z' && body.goal === 'profit' && body.levers.join() === 'equip,foods,drinks' && body.budgets === scenario.budgets && typeof body.synthetic === 'string');
}

// ---- Part 1: the elimination rule on the scenario's true numbers ----
const pricer = makePricer(scenario.market.marketData);
const eff = (player, slot, delta) => scenario.effects.find((e) => e.match.op === 'enhance' && e.match.player === player && e.match.slot === slot && e.match.delta === delta);
const cand = (player, slot, delta, se = 200) => {
    const item = scenario.players.find((p) => p.name === player).player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + slot);
    const cost = pricer.upgrade(item.itemHrid, item.enhancementLevel, item.enhancementLevel + delta).cost, e = eff(player, slot, delta);
    return { id: `${player}:${slot}+${delta}`, player, cost: { cost }, monotone: true, est: { net: e.loot / n, netSe: se } }; // the true buyer's gain per user (no supplies change on a plain enhance)
};
const bars = new Map(scenario.players.map((p) => [p.name, 0.01 * (M.lootPerDay / n - M.supplies[p.name])]));
const outOf = (list, mult = 3) => { eliminate(list, { goal: 'profit', mult, bars, payLimit: PAY }); return Object.fromEntries(list.map((c) => [c.id, c.out])); };
{
    check('zero-or-below player: Cara spends more than her share of the loot, so her bar is not above 0 (no bar)', M.supplies.Cara > M.lootPerDay / n && !(bars.get('Cara') > 0) && bars.get('Alice') > 0 && bars.get('Bob') > 0);
    const out = outOf([cand('Alice', 'body', 2), cand('Alice', 'head', 1), cand('Alice', 'head', 3), cand('Alice', 'legs', 1), cand('Cara', 'head', 1)]);
    check('rule: a clear winner is not out', out['Alice:body+2'] === undefined);
    check('rule: a loser is out: an enhancement cannot lose (monotone), so it reads 0, below the bar and below the winner lower end', out['Alice:legs+1'] === 'bar');
    check('rule: a change under the 1% bar (3K a user, bar 8.5K) is cut by the bar', out['Alice:head+1'] === 'bar');
    check('rule: a paid change that cannot pay back in 365 days even at its upper end is cut by the payback limit', out['Alice:head+3'] === 'payback');
    const tie = outOf([cand('Bob', 'head', 1, 1200), cand('Bob', 'head', 2, 1200)]);
    check('rule: a tied pair (same true gain, ranges 3.6K wide each way, best-case gap under Bob\'s bar) ends on the higher one (shorter payback) and the other is tied', tie['Bob:head+1'] === undefined && tie['Bob:head+2'] === 'tied');
    const wide = outOf([cand('Bob', 'head', 1, 8000), cand('Bob', 'head', 2, 8000)]);
    check('rule: the same pair with wide ranges is not a tie (the error margins are inside the ends)', wide['Bob:head+1'] === undefined && wide['Bob:head+2'] === undefined);
    const cara = outOf([cand('Cara', 'head', 1)]);
    check('rule: a player with no bar is never cut by it (Cara\'s 1K a user change stays standing)', cara['Cara:head+1'] === undefined);
    const pass = outOf([cand('Alice', 'body', 2)]);
    check('rule: a paid change that pays back inside the limit (1M for 50K a user a day = 20 days) stays', pass['Alice:body+2'] === undefined);
}

// ---- Part 2: the whole search on the synthetic pool ----
const t0 = Date.now();
const run = await runSynthetic(scenario);
const res = run.result, steps = res.steps, step = (i) => steps[i];
const opsOf = (s) => (s.ops ?? s.est?.ops ?? []);
const hasOp = (s, player, slot, delta) => JSON.stringify(s).includes(`"player":"${player}","slot":"${slot}","delta":${delta}`);
console.log(`     (full search: ${run.runs} synthetic runs, ${run.rounds.length} rounds, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
// The rows' order in every round record of the whole search: a pool with no row at 4 seeds (src/whatif/figure.mjs) stays in build order with sortedBy null (and its
// column in sortPending); otherwise the rows with a figure sort by the column, best first, and the rows without follow in build order. Display order only.
{
    const { hasFigure } = await imp('src/whatif/figure.mjs');
    const builtUp = (rows) => rows.every((l, i) => i === 0 || rows[i - 1].built <= l.built);
    const good = (p) => { const fig = p.leaders.filter(hasFigure), rest = p.leaders.filter((l) => !hasFigure(l)); return fig.length === 0 ? p.sortedBy === null && ['buyerNet', 'payback', 'reading'].includes(p.sortPending) && builtUp(p.leaders) : ['buyerNet', 'payback', 'reading'].includes(p.sortedBy) && p.leaders.slice(0, fig.length).every(hasFigure) && builtUp(rest) && p.sortPending === undefined; };
    const pools = run.rounds.flatMap((r) => r.pools);
    check('order: in every round record each pool follows the rule (build order and sortedBy null while no row has 4 seeds; rows with a figure first, the rest in build order)', pools.length > 0 && pools.every(good) && pools.every((p) => p.leaders.every((l) => Number.isInteger(l.built))), String(pools.filter((p) => !good(p)).length));
    check('order: a pool still in build order (sortedBy null) has no range width and no "was" (no figure under 4 seeds, so none from a build-order row); a sorted pool keeps its width where it had a range', pools.filter((p) => p.sortedBy === null).every((p) => p.rangeWidth === null && p.rangeWidthPrev === undefined) && pools.some((p) => p.sortedBy !== null && Number.isFinite(p.rangeWidth)));
    check('order: the search shows both cases (some pool still in build order, some already sorted)', pools.some((p) => p.sortedBy === null) && pools.some((p) => p.sortedBy !== null && p.leaders.some((l) => !hasFigure(l))) || pools.some((p) => p.sortedBy === null) && pools.some((p) => p.sortedBy !== null));
}
check('search: finished by itself, not stopped; no real engine run was asked for (the trigger lever is off)', run.outcome.stopped === false && res.options.levers.join() === 'equip,foods,drinks');
check('search: a clear winner is the first step (Alice body +2)', hasOp(step(0), 'Alice', 'body', 2), JSON.stringify(step(0).desc ?? step(0).id));
check('search: every step pays back inside 365 days and was confirmed on fresh seeds', steps.length >= 2 && steps.every((s) => s.fresh && s.fresh.accepted && (s.payback === undefined || s.payback === null || s.payback <= PAY + 1)), JSON.stringify(steps.map((s) => s.payback)));
check('search: the losers (Alice legs) are never taken', !steps.some((s) => hasOp(s, 'Alice', 'legs', 1) || hasOp(s, 'Alice', 'legs', 2) || hasOp(s, 'Alice', 'legs', 3)));
check('search: the change under the 1% bar (Alice head +1) and the one past the payback limit (Alice head +3) are never taken', !steps.some((s) => hasOp(s, 'Alice', 'head', 1) || hasOp(s, 'Alice', 'head', 3)));
check('search: the tied pair gives one step on Bob\'s head, not both at once', steps.filter((s) => s.player === 'Bob' && /head/.test(JSON.stringify(s.desc ?? ''))).length >= 1 && hasOp(step(1), 'Bob', 'head', 1));
const failed1 = res.notConfirmed.find((x) => hasOp(x, 'Bob', 'body', 2));
check('search: the pick that looks good on the search seeds and fails on fresh ones (Bob body +2) is refuted and listed with its fresh reading', !!failed1 && failed1.fresh && failed1.fresh.accepted === false && !steps.some((s) => hasOp(s, 'Bob', 'body', 2)));
check('search: the paying change of the player with a profit at zero or below (Cara body +2) can still be taken', steps.some((s) => hasOp(s, 'Cara', 'body', 2)));
const foods = res.best.foods, drinks = res.best.drinks;
check('search: foods and drinks decided first, per player: Alice and Bob have a winner, Cara (every filling loses for her) is unchanged', !foods.Alice.unchanged && !foods.Bob.unchanged && foods.Cara.unchanged && !drinks.Alice.unchanged && !drinks.Bob.unchanged && drinks.Cara.unchanged);
check('search: both stages ended by their own lock, nobody pressed a button', !res.endedByUser.foods && !res.endedByUser.drinks);
check('search: the pick check names the player among those checked (player 1 of 2, player 2 of 2) on the foods and drinks rows', [...run.seen.checkingWho].includes('foods 1 of 2') && [...run.seen.checkingWho].includes('foods 2 of 2') && [...run.seen.checkingWho].includes('drinks 2 of 2'), JSON.stringify([...run.seen.checkingWho]));
check('search: the projection ("about N more rounds to separate") had a number while two or three changes stood', [...run.seen.separate].some((x) => Number.isFinite(x) && x >= 1), JSON.stringify([...run.seen.separate]));
const { createCountingPool } = await imp('tools/whatif/node-shell.mjs');
let coldCounter = null;
const run2 = await runSynthetic(scenario, {}, { poolWrap: (p) => (coldCounter = createCountingPool(p, () => {}, 50)) }); // the second full search: the determinism check and the replay counter's cold search in one
check('search: seeded and deterministic (a second run takes the same steps, picks and number of runs)', JSON.stringify(run2.result.steps.map((s) => s.id ?? s.desc)) === JSON.stringify(steps.map((s) => s.id ?? s.desc)) && run2.runs === run.runs && JSON.stringify(run2.result.best) === JSON.stringify(res.best));

// ---- Replay counter (node-shell.mjs createCountingPool): the runs that reach the pool are the store's misses ----
{

    const { walk, gauss } = await imp('tools/whatif/synthetic.mjs');
    check('replay counter: a run readings at different hours agree (one draw per run, shrunk by sqrt(50/h)), so a run recorded at one length answers a reading of another length', Math.abs(walk('t', 200) * 2 - walk('t', 50)) < 1e-9 && walk('t', 50) === gauss('t'));
    let counter = null;
    const cold = run2; counter = coldCounter;
    check('replay counter: on an empty store every run is a real simulation, and the counter equals the runs that reached the pool', counter.count() === cold.runs && cold.runs > 0 && Object.values(counter.byTag()).reduce((a, b) => a + b, 0) === cold.runs, `${counter.count()} vs ${cold.runs}`);
    const warm = await runSynthetic(scenario, { 'max-steps': 0 }, { records: cold.records, onRound: (rec, stop) => { if (rec.stage === 'foods' && rec.round === 3) stop.done = 'skip'; }, poolWrap: (p) => (counter = createCountingPool(p, () => {}, 50)) }); // a short search (the foods stage ended by Skip after round 3) on the primed store
    check('replay counter: a search on a store holding the first search runs counts exactly the runs that reached the pool (the core first look reads every cached seed, so it takes its own path and is not a 0-run replay)', counter.count() === warm.runs && warm.records.length >= cold.records.length, `${counter.count()} ${warm.runs}`);
    const lines = []; const c3 = createCountingPool({ run: async () => ({}), kill() {} }, (l) => lines.push(l), 2);
    for (let i = 0; i < 5; i++) await c3.run({ tag: 'x' });
    check('replay counter: logs "N real simulations so far" every 50 (here 2) with a timestamp, and the summary names the total', lines.length === 2 && /^\d{4}-\d\d-\d\dT.* 2 real simulations so far/.test(lines[0]) && /5 real simulations in this search \(x 5\)/.test(c3.summary()), JSON.stringify(lines));
}

// ---- The payback list: scenario-payback.json (make-scenario.mjs --slow): every paid change loses except Cara legs +3, which pays back in 400 days ----
{
    const slow = await runSynthetic(loadScenario(path.join(root, 'tools/test/synthetic/scenario-payback.json')));
    check('payback list: the one paid change left standing that pays back in 400 days (Cara legs +3) is refused by the pick check for the 365-day limit, listed under overPayback with its days, and no step is taken', slow.result.steps.length === 0 && slow.result.overPayback.length === 1 && slow.result.overPayback[0].id === 'Cara:legs+3' && slow.result.overPayback[0].paybackDays > 365, JSON.stringify(slow.result.overPayback.map((x) => [x.desc, x.paybackDays])));
}

// ---- The two buttons ----
{
    const press = (stage, round, mode) => { let pressed = false; return (rec, stop) => { if (rec.stage === stage && rec.round === round) { stop.done = mode; pressed = true; } else if (pressed && rec.stage === 'screen') stop.requested = true; }; }; // after the button, the search is stopped when the Screen starts (the Screen of a no-step search has no lock to end it by)
    const skip = await runSynthetic(scenario, { 'max-steps': 0 }, { onRound: press('foods', 3, 'skip') });
    check('button: Skip on the foods stage ends it after that round with nothing taken ("ended by you after round 3")', skip.result.endedByUser.foods === 3 && Object.values(skip.result.best.foods).every((e) => e.unchanged) && skip.rounds.filter((r) => r.stage === 'foods').length === 3);
    const accept = await runSynthetic(scenario, { 'max-steps': 0 }, { onRound: press('drinks', 8, 'accept') });
    check('button: Accept current winner on the drinks stage ends it after that round, taking the best leader of each pool that has a clear positive reading, then the pick check decides it', accept.result.endedByUser.drinks === 8 && accept.rounds.filter((r) => r.stage === 'drinks').length === 8 && !accept.result.best.drinks.Alice.unchanged);
}

process.exit(failed ? 1 : 0);
