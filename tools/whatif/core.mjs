// The what-if search, as a function (docs/codebase/whatif-runner.md): rounds that keep refining every single change still in contention (two pools,
// K leaders each, readings on fresh seeds for the leaders), greedy stacking with a pick check on fresh seeds, one confirmation. It was tools/whatif/optimize.mjs; that file is now the Node shell (command line, files, forked run processes).
// This file imports no fs, process, os or child_process, so any shell can drive it. A shell hands it:
//   settings  { flags, argsText, jobs, pricesFile, pricesKey, setupsDir }: the flags as data (options.mjs; the flags are listed in optimize.mjs),
//             the command line for the report, the run processes to use, the price snapshot's name (opaque; the run processes read it) and
//             its name inside the run keys, the setups folder name (opaque, passed to the run processes)
//   seams     { data, store, pool, sink, stop, hash, sim }:
//     data   { setups, market, pricesTimestamp, exportData, userTrig }: the party, the price snapshot, the exporter JSON, the user's trigger candidates
//     store  load() yields every saved run record; put(record) saves one; readAux(name) / writeAux(name, value) keep need.json and probe.json
//     pool   run(task) resolves with the run's result { variant, seed, wallSeconds, checkpoints }, or null once kill() ended it
//     sink   progress(p), partial(snapshot), round(r), stopped(snapshot), final(snapshot, markdown) -> where the markdown went
//     stop   { requested, done }: requested is true once the user asked to stop; done once he asked the race stage running now to end after its round
//     hash   sha1 hex of a text (the run keys)
//     sim    { runParty, measureNeed, buildDtos, Trigger }: the engine's own functions and Trigger class
// Resolves with { stopped } (stopped: the search ended early, every finished run is in the store, the same call resumes).
import { applyOps } from '../../src/whatif/applyOps.mjs';
import { makePricer, TAX_LABEL } from './prices.mjs';
import { consumableType } from './consumables.mjs';
import { foodFillCands } from './foodfill.mjs';
import { drinkFillCands } from './drinkfill.mjs';
import { dropChainStates } from './pools.mjs';
import { tMult, dfOf, contention, anyHope, separated, bounds, poolKey, poolSorter } from './rounds.mjs';
import { installProbe, summarize, mergeProbes, triggerCands, localCands, effectiveTriggers, triggerText, joinTriggerDesc } from './triggers.mjs';
import { skillCands, skillReport, parseSkillLeft } from './levers/skills.mjs';
import { upgradeCands, LEVER_NAMES as UPGRADE_LEVERS } from './levers/houses.mjs'; // houses, abilitylevels, books (phase 3)
import { parseBudgetList, resolveBudgets, zeroSpend, affordable, pay } from './budgets.mjs';
import { isDominatedSwap } from './dominated.mjs';
import { playerFit, misfit } from './stylefit.mjs';
import { createParts } from './progress.mjs';
import { SURE_BLOCK, SURE_MAX, verdict, checkPick, firstConfirmed, confirmFillings } from './sure.mjs';
import { paybackDays, overPaybackLimit } from '../../src/whatif/payback.mjs';
// A count with its noun, singular for 1 ("1 run", "2 runs").
const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
import { refineTrigger } from './refine.mjs';
import { lootOf, suppliesOf, diffStat as diffStatBy, buyerNet, acceptBoth, scoreOf, rankEst, rankAcceptedFirst } from './buyer.mjs';
import { makeArg, list } from './options.mjs';
import itemDetailMap from '../../src/combatsimulator/data/itemDetailMap.json' with { type: 'json' };
import abilityDetailMap from '../../src/combatsimulator/data/abilityDetailMap.json' with { type: 'json' };
import abilitySlotsLevelRequirementList from '../../src/combatsimulator/data/abilitySlotsLevelRequirementList.json' with { type: 'json' };
import combatStyleDetailMap from '../../src/combatsimulator/data/combatStyleDetailMap.json' with { type: 'json' };

export async function main(settings, seams) {
    const { data, store: runStore, pool: runPool, sink: outSink, stop: stopSignal, hash, sim } = seams;
    const { runParty, measureNeed, buildDtos, Trigger } = sim;
    const arg = makeArg(settings.flags);

    const goal = arg('goal', 'profit');
    const errorRule = arg('error', 'unpaired'); // design revision 6 (main c2ed824), his pick 23:27 BRT
    const baseMult = Number(arg('base-mult', errorRule === 'unpaired' ? 4 : 1));
    const z = Number(arg('z', 2));
    // The search that keeps refining (anytime-search-design.md). Every number below is a named option with the design's proposed value;
    // none is decided (the report lists them as open). Unit of work: one seed of `unit-hours` (50). Round 1 gives every candidate
    // `first-seeds` (2) seeds; each later round gives every candidate still in contention `round-seeds` more.
    const unitH = Number(arg('unit-hours', 50));
    const firstK = Number(arg('first-seeds', 2));
    const roundSeeds = Number(arg('round-seeds', 1));
    const leadersK = Number(arg('leaders', 10)); // K leaders per pool
    const pauseMult = Number(arg('pause-mult', 3)); // errors: a candidate is paused when its upper bound at this many errors is below the leaders' line
    const coverage = Number(arg('coverage', 0.99)); // the displayed range is a t range at this coverage
    const readStep = Number(arg('reading-step', 2)); // reading seeds added per leader per round (0 = none)
    const readMin = Number(arg('reading-min', 8)); // a leader with fewer reading seeds is shown as too few
    const lockRule = String(arg('lock-rule', 'both')); // 'both': reading seeds pass the pick check AND no contender reaches the leader; 'reading': the pick check only
    const maxRounds = Number(arg('max-rounds', 0)); // rounds per race (0 = no limit: the search ends by stop, --max-minutes, or when nothing can still help)
    const finK = Number(arg('confirm-seeds', 16)); // seeds of the pick check, the foods and drinks confirmation, the final confirmation (and a trigger refinement's judgement)
    const finH = Number(arg('confirm-hours', 300)); // their hours per seed: the old last stage's, so a pick is measured as it was before the rounds search (the race itself runs at unit-hours)
    if (!(firstK >= 2 && roundSeeds >= 1 && leadersK >= 1 && pauseMult > 0 && coverage > 0 && coverage < 1 && readStep >= 0 && ['both', 'reading'].includes(lockRule))) throw new Error('rounds options: --first-seeds >= 2, --round-seeds >= 1, --leaders >= 1, --pause-mult > 0, 0 < --coverage < 1, --reading-step >= 0, --lock-rule both|reading');
    if (errorRule === 'unpaired' && firstK < 2) throw new Error('unpaired rule: at least 2 runs per variant (his pick, relaxed from 4)');
    const stages = [{ k: firstK, h: unitH }]; // the one fixed stage left: round 1, today's screen
    const fin = { k: finK, h: finH }; // the measurement of the pick checks, the confirmation and the trigger refinement
    const keep = [];
    const players = list(arg('players', 'Ramlock'));
    const maxUp = Number(arg('max-up', 3));
    const swapsOn = arg('swaps', true) !== false;
    const swapLevels = list(arg('swap-levels', '0,same'));
    const onlySlots = list(arg('slots', null));
    const sellDown = arg('sell-down', false) === true;
    const onlyCands = list(arg('only-candidates', null));
    const maxSteps = Number(arg('max-steps', 20));
    const jobs = settings.jobs;
    const maxMinutes = Number(arg('max-minutes', Infinity));
    const confirmOffset = Number(arg('confirm-seed-offset', 10000));
    // The pick check (confirmPick): seeds above the final confirmation's block (10001..20000), blocks of SURE_BLOCK per arm, at most SURE_MAX.
    const sureOffset = confirmOffset + 10000;
    const setupsDir = settings.setupsDir, pricesFile = settings.pricesFile;
    const options = { comdrop: Number(arg('comdrop', 20)), comexp: Number(arg('comexp', 20)), tier: Number(arg('tier', 4)), zone: arg('zone', '/actions/combat/infernal_abyss'), prices: pricesFile };
    const LEVERS = ['equip', 'consumables', 'owned', 'abilities', 'order', 'triggers', 'skills', ...UPGRADE_LEVERS];
    const skillOpts = { maxUp: Number(arg('skill-up', 2)), left: parseSkillLeft(arg('skill-left', null)), items: itemDetailMap, styles: combatStyleDetailMap };
    // `pairs` is no longer a lever (the foods and drinks race tries whole combinations): an old command line or request that names it still runs, the name is ignored.
    const levers = new Set(String(arg('levers', 'equip')).split(',').flatMap((x) => (x === 'all' ? LEVERS.filter((l) => l !== 'abilitylevels' && l !== 'books') : [x.trim()])).filter((x) => x !== 'pairs'));
    for (const l of levers) if (!LEVERS.includes(l)) throw new Error('unknown lever ' + l + '; levers: ' + LEVERS.join(','));
    // --export: the old single character export (an object with its `name`), or a map { "<player name>": <that player's export> }.
    // Levers that need a player's export never block a search: that player is skipped by the lever (result.skippedNoExport).
    const exportData = data.exportData ?? null;
    const exportMap = exportData && typeof exportData.name !== 'string' ? exportData : null;
    let budget = null, budgetSource;
    const budgetList = parseBudgetList(arg('budgets', null) === true ? null : arg('budgets', null));
    if (arg('budget', null) !== null) { budget = Number(arg('budget')); budgetSource = 'typed'; }
    else if (exportData && !exportMap) { budget = exportData.coin; budgetSource = 'exporter coin'; if (!(budget >= 0)) throw new Error('exporter JSON has no coin'); }
    else if (Object.keys(budgetList).length) budgetSource = 'per player';
    else throw new Error('--budget, --budgets or --export required');
    if (Object.keys(budgetList).length && budget != null) budgetSource = `per player, else ${budgetSource}`;
    const budgets = resolveBudgets(players, budgetList, budget ?? NaN);
    const maxPayback = Number(arg('max-payback', 365));
    if (!(maxPayback >= 0)) throw new Error('--max-payback: a number of days, 0 for no limit');

    const [probeK, probeH] = String(arg('probe', '1x50')).split('x').map(Number);
    const trigOpts = { owners: list(arg('trigger-owners', null)), fixed: list(arg('trigger-fixed', null)) };
    const userTrig = data.userTrig ?? {};
    let probeStore = null; // set by probeBase() before candidates are built
    let needStore = null; // set by needBase() before candidates are built: the party's food need per player (foodfill.mjs)
    const metric = (cp) => (goal === 'exp' ? cp.party.expPerHour : cp.party.profitAfterTaxPerDay);
    const setups0 = data.setups;
    const market = data.market; // the price snapshot's market table
    const pricer = makePricer(market);
    const t0 = Date.now();

    // ---- Run cache and pool ----
    const seedIndex = new Map(); // key -> Set of seeds run for that setup
    const cache = new Map(); // key#seed -> { wallSeconds, hours, byHours: {h: metricsCheckpoint} }
    // --cache-from a.jsonl,b.jsonl: earlier runs.jsonl files read as well (never written), so a new search reuses
    // another search's runs of the same setups without copying them.
    for (const r of runStore.load()) put(r);
    function put(r) {
        const id = r.key + '#' + r.seed;
        const prev = cache.get(id);
        if (prev && prev.hours >= r.hours) return;
        const byHours = {};
        for (const cp of r.checkpoints) byHours[Math.round(cp.simHours)] = cp;
        cache.set(id, { wallSeconds: r.wallSeconds, hours: r.hours, byHours });
        if (!seedIndex.has(r.key)) seedIndex.set(r.key, new Set());
        seedIndex.get(r.key).add(r.seed);
    }
    // The key holds the prices file relative to the checkout, so runs cached in one worktree match in another.
    const keyOptions = { ...options, prices: settings.pricesKey };
    // The snapshot's own time (marketplace.json timestamp, seconds) and where it came from, for result.json (not in the key).
    // "committed": a file of tools/calibration (the repo's saved snapshot); "snapshot": any other file, such as the one the
    // runner saves from the window's request.
    const pricesStamp = data.pricesTimestamp;
    const pricesMeta = { pricesTimestamp: Number.isFinite(pricesStamp) ? pricesStamp : null, pricesSource: keyOptions.prices.startsWith('tools/calibration/') ? 'committed' : 'snapshot' };
    const keyOf = (ops) => hash(JSON.stringify({ s: applyOps(setups0, ops), o: keyOptions })).slice(0, 16);
    const allHours = [...new Set([...stages.map((s) => s.h), fin.h])].sort((a, b) => a - b);
    let stoppedByTime = false;
    const wallLog = []; // per run actually made in this invocation

    // ---- Progress (delivery design section 3): the stage, candidates left, runs of the current batch, seconds per run
    // measured, and the batch's time left from the measured core-seconds per sim hour. The batch is one stage (the
    // screen, a halving, a greedy step, the confirmation); later stages are not in etaSeconds (etaScope: 'stage').
    const progress = { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0, secondsPerRun: null, etaSeconds: null, etaScope: 'stage', elapsedSeconds: 0 };
    let batch = { hoursLeft: 0, wall: 0, done: 0 };
    // The runs of the pick checks, counted as distinct runs (a run is one arm on one seed; a run counted once is never counted again, a
    // cached run is done when it is counted): planned never drops and done never exceeds it. Shown as the part "Confirming the picks".
    const sure = { planned: 0, done: 0, counted: new Set() };
    let partsTracker = null; // stacked parts (progress.mjs), created once the candidates are known
    let stageCtx = null; // the race stage's own counters (race() sets it, clears it at the stage's end): added to every progress message of the stage
    function report(patch = {}) {
        Object.assign(progress, patch, stageCtx ? stageCtx() : {});
        const wall = wallLog.reduce((a, r) => a + r.wallSeconds, 0), hours = wallLog.reduce((a, r) => a + r.h, 0);
        const left = progress.runsPlanned - progress.runsDone;
        progress.secondsPerRun = batch.done ? batch.wall / batch.done : wallLog.length ? wall / wallLog.length : null;
        progress.etaSeconds = left <= 0 ? 0 : hours ? Math.round((wall / hours) * batch.hoursLeft / Math.min(jobs, left)) : null;
        progress.elapsedSeconds = Math.round((Date.now() - t0) / 1000);
        if (sure.planned) { progress.picksPlanned = sure.planned; progress.picksDone = sure.done; }
        if (partsTracker) progress.parts = partsTracker.sync(progress);
        outSink.progress(progress);
    }

    // reqs: [{ops, seed, h, tag}], run in the order given (tasks of equal length keep it). `onRun`: called after each finished run (the first
    // look of round 1 listens: it only reads the cache and the sink, it never feeds a choice).
    async function ensure(reqs, { onRun } = {}) {
        const tasks = [], need = new Map(); // id -> task, at the longest length asked for that run
        for (const r of reqs) {
            const key = keyOf(r.ops), id = key + '#' + r.seed;
            if (cache.get(id)?.byHours[r.h]) continue;
            const t = need.get(id);
            if (t) { t.h = Math.max(t.h, r.h); continue; }
            need.set(id, { variant: key, ops: r.ops, seed: r.seed, options, setupsDir, tag: r.tag, h: r.h });
        }
        for (const t of need.values()) tasks.push({ ...t, checkpoints: allHours.filter((x) => x <= t.h) });
        tasks.sort((a, b) => b.h - a.h); // longest first, so the last wave is short
        batch = { hoursLeft: tasks.reduce((a, t) => a + t.h, 0), wall: 0, done: 0 };
        report({ runsDone: 0, runsPlanned: tasks.length });
        if (!tasks.length) return true;
        if (stopSignal.requested) { stoppedByTime = true; return false; }
        console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${nOf(tasks.length, 'run')}, ${tasks.reduce((a, t) => a + t.h, 0)} sim h`);
        let next = 0;
        // One lane per core: each takes the next task while there is one, no stop was asked and the time limit has not passed.
        const lane = async () => {
            for (;;) {
                if (!(next < tasks.length && !stopSignal.requested && (Date.now() - t0) / 60000 < maxMinutes)) { if (next < tasks.length || stopSignal.requested) stoppedByTime = true; return; }
                const t = tasks[next++];
                const res = await runPool.run(t);
                if (res === null) return; // the pool was killed by a stop request: the run in flight is dropped
                const rec = { key: res.variant, seed: res.seed, hours: t.h, tag: t.tag, wallSeconds: res.wallSeconds, checkpoints: res.checkpoints };
                runStore.put(rec);
                put(rec);
                wallLog.push({ tag: t.tag, h: t.h, wallSeconds: res.wallSeconds });
                batch.hoursLeft -= t.h; batch.wall += res.wallSeconds; batch.done++;
                if (t.tag === 'sure') sure.done++;
                report({ runsDone: progress.runsDone + 1 });
                onRun?.();
            }
        };
        await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, lane));
        return !stoppedByTime && !stopSignal.requested; // a stop kills runs in flight, so this batch is incomplete
    }
    const val = (ops, seed, h) => metric(cache.get(keyOf(ops) + '#' + seed).byHours[h]);
    // The parts of a checkpoint (no new run, same cache); the readers and the buyer's net are in buyer.mjs.
    const cpOf = (ops, seed, h) => cache.get(keyOf(ops) + '#' + seed).byHours[h];
    // The change (variant minus base) and its error, by the same rule as the search's gain. `same`: the base's values on the
    // variant's own seeds, the gain's base (the error keeps `bs`, all the base's seeds).
    const diffStat = (vs, bs, same) => diffStatBy(vs, bs, errorRule, same);
    // The buyer's own payback in days: the price over (his share of the loot gain per user minus the change in his own supplies
    // spend); null unless that net and the price are above 0.
    const paybackOwnOf = (cost, sharedPerUser, supplies) => (goal === 'profit' ? paybackDays(cost, sharedPerUser - supplies) : null);
    // The payback limit the picks are held to: the profit goal only (the other goals have no buyer's gain); 0 = none.
    const payLimit = goal === 'profit' ? maxPayback : 0;
    const seedsFor = (k, off = 0) => Array.from({ length: k }, (_, i) => off + i + 1);
    // Seeds of k samples of a setup at h hours. Paired: the fixed list 1..k (approved 3.3). Unpaired (delta 4, his point
    // 23:14 BRT): any k runs of that setup that reach h, the lowest seeds first, and for the rest the next seeds that
    // setup never ran (a counter), so no run is duplicated. Search seeds stay below --confirm-seed-offset; the final
    // confirmation's "fresh" seeds are above it. Every run's seed is recorded in runs.jsonl.
    function pick(ops, h, k, fresh = false) {
        const lo = fresh ? confirmOffset : 0;
        if (errorRule === 'paired') return seedsFor(k, lo);
        const key = keyOf(ops), hi = fresh ? sureOffset : confirmOffset; // the pick checks' seeds (above sureOffset) are in neither block
        const ran = [...(seedIndex.get(key) || [])].filter((x) => x > lo && x <= hi).sort((a, b) => a - b);
        const out = ran.filter((x) => cache.get(key + '#' + x).byHours[h]).slice(0, k);
        let next = Math.max(lo, ...ran) + 1;
        while (out.length < k) out.push(next++);
        return out;
    }
    const req = (ops, h, k, tag, fresh = false) => pick(ops, h, k, fresh).map((seed) => ({ ops, seed, h, tag }));
    // A variant's runs and, on exactly those seeds, the base's: the gain is the variant against the base on the same seeds ("Compare
    // on the same seeds"), so a base run the variant's seeds need that is not saved yet is run here. The base's own k x baseMult
    // seeds (the error) are requested separately.
    const reqPair = (baseOps, vOps, h, k, tag, fresh = false) => { const v = req(vOps, h, k, tag, fresh); return [...v, ...v.map((r) => ({ ops: baseOps, seed: r.seed, h, tag: 'base' }))]; };

    // ---- The pick check (his go 2026-11-11: confirm each pick before it joins the chain) ----
    // A pick is re-measured on fresh seeds (sureOffset + 1..) against the chain's state at that moment: the arm "chain so far" (baseOps)
    // and the arm "chain + this pick", the same seeds on both. The same seeds block serves every step, so one step's "chain + pick" arm
    // is the next step's "chain so far" arm and the run cache gives it for free.
    const sureSeeds = (k) => Array.from({ length: k }, (_, i) => sureOffset + i + 1);
    // The reading of k seeds per arm, by the search's own rules (the error rule, acceptBoth): the party's shared gain and the buyer's net.
    function freshRead(baseOps, c, k, h) {
        const vOps = [...baseOps, ...c.ops], seeds = sureSeeds(k), n = setups0.length;
        const vcp = seeds.map((s) => cpOf(vOps, s, h)), bcp = seeds.map((s) => cpOf(baseOps, s, h));
        let gain, se, net, netSe, accepted;
        if (goal === 'profit') {
            ({ gain, se } = diffStat(vcp.map(lootOf), bcp.map(lootOf)));
            ({ net, se: netSe } = buyerNet(vcp, bcp, c.player, n, errorRule, z));
            accepted = acceptBoth(gain, se, net, netSe, z);
        } else {
            ({ gain, se } = diffStat(vcp.map(metric), bcp.map(metric)));
            accepted = gain > 0 && gain >= z * se;
        }
        return { seeds: k, seedFrom: seeds[0], seedTo: seeds[k - 1], hours: h, gain, se, gainPerUser: gain / n, sePerUser: se / n, ...(goal === 'profit' ? { buyerNet: net, buyerNetSe: netSe } : {}), accepted };
    }
    // Runs the check (sure.mjs: 16 seeds per arm, more while the pick is between z/2 and z errors, up to 64). Returns { passed, fresh },
    // or null when the time limit or a stop ended the runs.
    async function confirmPick(baseOps, c, fin, label) {
        return checkPick(async (k) => {
            const seeds = sureSeeds(k), vOps = [...baseOps, ...c.ops];
            const reqs = seeds.flatMap((seed) => [{ ops: baseOps, seed, h: fin.h, tag: 'sure' }, { ops: vOps, seed, h: fin.h, tag: 'sure' }]);
            for (const r of reqs) { // a run is planned once; a cached one is done at once
                const id = keyOf(r.ops) + '#' + r.seed;
                if (sure.counted.has(id)) continue;
                sure.counted.add(id); sure.planned++;
                if (cache.get(id)?.byHours[r.h]) sure.done++;
            }
            report({ stage: 'confirming picks', candidatesLeft: 0 });
            if (!await ensure(reqs)) return null;
            const fresh = freshRead(baseOps, c, k, fin.h);
            console.log(`  ${label} check of ${c.desc}: ${k} seeds per arm, gain ${fmt(fresh.gain)} ± ${fmt(fresh.se)}${goal === 'profit' ? `, buyer ${fmt(fresh.buyerNet)} ± ${fmt(fresh.buyerNetSe)}` : ''}, ${fresh.accepted ? 'passes' : 'not confirmed yet'}`);
            return fresh;
        }, { z, goal, cost: c.cost.cost, maxPayback: payLimit });
    }

    // ---- Candidates ----
    const COMBAT_SLOTS = ['head', 'body', 'legs', 'feet', 'hands', 'main_hand', 'two_hand', 'off_hand', 'pouch', 'back', 'neck', 'earrings', 'ring', 'trinket', 'charm'];
    const slotItem = (setups, p, slot) => setups.find((s) => s.name === p).player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + slot);
    const meetsReq = (setup, item) => (item.equipmentDetail.levelRequirements || []).every((r) => (setup.player[r.skillHrid.split('/').pop() + 'Level'] ?? 0) >= r.level);
    // Market swaps no better on any combat stat (dominated.mjs): never offered, listed in result.json `dominated`.
    const dominated = [], dominatedKeys = new Set();
    // Swaps to gear whose only bonuses are another combat style's (or another element's), stylefit.mjs: never offered, the
    // market and owned ones alike, listed in result.json `otherStyle` (each with the style and element it is bound to).
    const otherStyle = [], otherStyleKeys = new Set();
    function styleDrop(fit, item, rec) {
        const bound = misfit(item, fit);
        if (!bound) return false;
        if (!otherStyleKeys.has(rec.desc)) { otherStyleKeys.add(rec.desc); otherStyle.push({ ...rec, bound, wants: fit }); }
        return true;
    }

    // Charms change only EXP, so a profit goal leaves them out (phase 1 measured exactly zero for every charm, docs
    // what-if/phase-1.md in the private repo); --charms keeps them. An EXP goal keeps them.
    const charmsOn = goal === 'exp' || arg('charms', false) === true;
    // Each candidate names the groups it changes (`<player>:<slot>`, `:food<i>`, `:drink<i>`, `:ability<i>`); after a
    // greedy step, candidates touching the accepted change's groups are rebuilt from the new setup.
    function candidatesFor(setups, p, slots) {
        const s = setups.find((x) => x.name === p), out = [], fit = playerFit(s, itemDetailMap);
        for (const slot of slots) {
            if (slot === 'charm' && !charmsOn) continue;
            const it = slotItem(setups, p, slot);
            if (!it) continue;
            const name = it.itemHrid.split('/').pop();
            for (let d = 1; d <= maxUp; d++) {
                const c = pricer.upgrade(it.itemHrid, it.enhancementLevel, it.enhancementLevel + d);
                out.push({ id: `${p}:${slot}+${d}`, kind: 'equip', groups: [`${p}:${slot}`], player: p, slot, monotone: true, desc: `${p} ${slot} ${name} +${it.enhancementLevel} -> +${it.enhancementLevel + d}`, ops: [{ op: 'enhance', player: p, slot, delta: d }], cost: c });
            }
            if (!swapsOn) continue;
            const type = itemDetailMap[it.itemHrid]?.equipmentDetail?.type;
            for (const item of Object.values(itemDetailMap)) {
                if (item.hrid === it.itemHrid || item.equipmentDetail?.type !== type || !meetsReq(s, item)) continue;
                for (const L of [...new Set(swapLevels.map((x) => (x === 'same' ? it.enhancementLevel : Number(x))))]) {
                    const c = pricer.swap(it.itemHrid, it.enhancementLevel, item.hrid, L);
                    if (!c.known) continue; // no seller at this level: not a market swap
                    if (c.cost <= 0 && !sellDown) continue; // frees gold: a sell-down, dropped (design 4.3 item 2)
                    const id = `${p}:${slot}=${item.hrid.split('/').pop()}+${L}`, desc = `${p} ${slot} ${name} +${it.enhancementLevel} -> ${item.hrid.split('/').pop()} +${L}`;
                    if (styleDrop(fit, item, { id, player: p, slot, desc, from: { item: it.itemHrid, level: it.enhancementLevel }, to: { item: item.hrid, level: L } })) continue;
                    if (isDominatedSwap(itemDetailMap[it.itemHrid], it.enhancementLevel, item, L)) {
                        if (!dominatedKeys.has(desc)) { dominatedKeys.add(desc); dominated.push({ id, player: p, slot, desc, from: { item: it.itemHrid, level: it.enhancementLevel }, to: { item: item.hrid, level: L } }); }
                        continue;
                    }
                    out.push({ id, kind: 'equip', groups: [`${p}:${slot}`], player: p, slot, monotone: false, desc, ops: [{ op: 'equip', player: p, slot, item: item.hrid, level: L }], cost: c });
                }
            }
        }
        return out;
    }

    // ---- Phase 2 levers (design 1.1-1.3, 3.6 item 2): loadout tweaks, no gold cost ----
    const short = (h) => h.split('/').pop();
    const FREE = (path, note = '') => ({ cost: 0, known: true, path, mirrors: 0, note });
    const exportFor = (p) => (exportMap ? (exportMap[p] && typeof exportMap[p] === 'object' ? exportMap[p] : null) : exportData && exportData.name === p ? exportData : null);
    // The players a lever skipped for want of their export: lever -> Set(player). The levers that need it: owned, abilities
    // (swaps) and books. Ability levels have a labelled upper-bound cost without it and never skip.
    const skippedNoExport = new Map();
    const skipNoExport = (lever, p) => { if (!skippedNoExport.has(lever)) skippedNoExport.set(lever, new Set()); skippedNoExport.get(lever).add(p); };
    const skippedGroup = () => [...skippedNoExport].map(([lever, ps]) => ({ lever, players: [...ps] }));
    const hasAsk = (h) => market[h]?.['0']?.a > 0; // a consumable with no ask has no expense price (engine.mjs metrics uses 500)
    const combatUse = (it) => it.consumableDetail?.usableInActionTypeMap?.['/action_types/combat'];
    const FOODS = Object.values(itemDetailMap).filter((it) => it.categoryHrid === '/item_categories/food' && combatUse(it) && hasAsk(it.hrid)).map((it) => it.hrid);
    const DRINKS = Object.values(itemDetailMap).filter((it) => it.categoryHrid === '/item_categories/drink' && combatUse(it) && hasAsk(it.hrid)).map((it) => it.hrid);
    // Open food and drink slots, as setupDto.mjs gates them (the pouch): fill every slot and count what the DTO keeps.
    function consumableSlots(setups, p) {
        const t = structuredClone(setups), i = t.findIndex((x) => x.name === p);
        t[i].food = { '/action_types/combat': FOODS.slice(0, 3).map((h) => ({ itemHrid: h })) };
        t[i].drinks = { '/action_types/combat': DRINKS.slice(0, 3).map((h) => ({ itemHrid: h })) };
        const d = buildDtos(t)[i];
        return { food: d.food.filter(Boolean).length, drink: d.drinks.filter(Boolean).length };
    }
    // Foods and drinks are decided before the rest of the search (Stage F, Stage D in main()), each as whole fillings of every open
    // slot of a player: foods from the party's measured need (foodfill.mjs), drinks from the pruned drink pool (drinkfill.mjs). The
    // rest of the search has no food or drink candidates. `setups` are the setups the filling is built on (the baseline so far).
    const typeOf = (h) => consumableType(itemDetailMap[h]);
    const slotList = (setups, p, kind) => {
        const s = setups.find((x) => x.name === p), n = consumableSlots(setups, p)[kind === 'food' ? 'food' : 'drink'];
        return { s, list: Array.from({ length: n }, (_, i) => s[kind === 'food' ? 'food' : 'drinks']['/action_types/combat']?.[i]?.itemHrid || null) };
    };
    function foodStageCands(setups, p) {
        const { s, list } = slotList(setups, p, 'food');
        return foodCands(s, p, list);
    }
    const drinkStats = {}; // player -> pruning counts of Stage D (result.drinkPruning)
    function drinkStageCands(setups, p) {
        const { s, list } = slotList(setups, p, 'drink');
        const { cands, stats } = drinkFillCands(p, { items: itemDetailMap, market, baseline: list, setup: s, goal });
        const r = stats.byRule;
        console.log(`${p} drinks: ${stats.style} style, ${stats.table} drinks with an ask; dropped by main stat ${r.a}, basic attack ${r.b}, profit/exp ${r.c}, dominance ${r.d}; ${stats.kept.length} kept of ${stats.types} types; ${stats.fillings} fillings`);
        drinkStats[p] = { style: stats.style, table: stats.table, dropped: stats.byRule, kept: stats.kept.length, types: stats.types, fillings: stats.fillings };
        return cands;
    }
    function foodCands(s, p, baseline) {
        const need = needStore?.mean[p];
        if (!need) return [];
        const { cands, stats: st } = foodFillCands(p, { items: itemDetailMap, market, baseline, triggerMap: s.triggerMap, need });
        const f = (x) => Math.round(x);
        console.log(st.qualify ? `${p} food: need ${f(need.hp)} HP and ${f(need.mp)} MP per hour; ${st.dominated} of ${st.foods} foods dominated; ${st.qualify} fillings qualify; ${st.left} left after the cheapest 3 per type (current foods kept, the current filling left out)`
            : `${p} food: need ${f(need.hp)} HP and ${f(need.mp)} MP per hour; no filling qualifies, no food-fill candidates`);
        return cands;
    }
    // The need: HP and MP per hour the base party gets from its foods (engine.mjs measureNeed), kept in <out>/need.json for
    // this base and these seeds, like probe.json.
    const NEED_SEEDS = seedsFor(3), NEED_HOURS = 20;
    async function needBase() {
        const key = keyOf([]), n0 = runStore.readAux('need.json');
        if (n0) { const n = n0; if (n.key === key && n.hours === NEED_HOURS && JSON.stringify(n.seeds) === JSON.stringify(NEED_SEEDS)) return n; }
        const t1 = Date.now(), m = await measureNeed({ ...options, setups: setups0, seeds: NEED_SEEDS, hours: NEED_HOURS });
        console.log(`need: ${NEED_SEEDS.length} seeds x ${NEED_HOURS} h, ${((Date.now() - t1) / 1000).toFixed(0)} s`);
        const n = { key, ...m };
        runStore.writeAux('need.json', n);
        return n;
    }
    // Swaps to an item in the exporter's inventory: no gold cost; selling it instead is its only price (after tax).
    function ownedCands(setups, p, slots) {
        const ex = exportFor(p);
        if (!ex) return [];
        const s = setups.find((x) => x.name === p), out = [], seen = new Set(), fit = playerFit(s, itemDetailMap);
        for (const inv of ex.inventory || []) {
            const item = itemDetailMap[inv.itemHrid], type = item?.equipmentDetail?.type?.split('/').pop();
            if (!type || !meetsReq(s, item)) continue;
            const L = inv.enhancementLevel || 0, key = inv.itemHrid + '+' + L;
            if (seen.has(key)) continue;
            seen.add(key);
            const twoHand = type === 'two_hand';
            const slot = twoHand ? 'main_hand' : type; // a two-hand weapon replaces the main hand and empties the off hand
            if (!slots.includes(slot) || (slot === 'charm' && !charmsOn)) continue;
            const it = slotItem(setups, p, slot) || (twoHand ? slotItem(setups, p, 'two_hand') : null);
            if (it && it.itemHrid === inv.itemHrid && it.enhancementLevel === L) continue;
            const desc = `${p} ${slot} ${it ? short(it.itemHrid) + ' +' + it.enhancementLevel : 'empty'} -> owned ${short(inv.itemHrid)} +${L}`;
            if (styleDrop(fit, item, { id: `${p}:${slot}=own:${short(inv.itemHrid)}+${L}`, player: p, slot, desc, from: it ? { item: it.itemHrid, level: it.enhancementLevel } : null, to: { item: inv.itemHrid, level: L } })) continue;
            const sale = pricer.sell(inv.itemHrid, L);
            const note = sale.noBuyer ? 'owned; no buyer' : `owned; selling it instead: ${fmt(sale.value)} ${TAX_LABEL}`;
            const ops = twoHand ? [{ op: 'unequip', player: p, slot: 'main_hand' }, { op: 'unequip', player: p, slot: 'off_hand' }, { op: 'equip', player: p, slot: 'two_hand', item: inv.itemHrid, level: L }]
                : [{ op: 'equip', player: p, slot, item: inv.itemHrid, level: L }];
            const groups = twoHand ? [`${p}:main_hand`, `${p}:off_hand`, `${p}:two_hand`] : [`${p}:${slot}`];
            out.push({ id: `${p}:${slot}=own:${short(inv.itemHrid)}+${L}`, kind: 'owned', groups, player: p, slot, monotone: false, desc, ops, cost: FREE('owned', note) });
        }
        return out;
    }
    // Swaps to a learned ability at its learned level (slot 0 takes special abilities only, src/main.js:807-812), and
    // every order of the other slots.
    function abilityCands(setups, p, withSwaps, withOrder) {
        const s = setups.find((x) => x.name === p), out = [], ex = exportFor(p);
        const ab = s.abilities || [], open = (i) => (s.player.intelligenceLevel ?? 0) >= abilitySlotsLevelRequirementList[i + 1];
        const name = (a) => (a?.abilityHrid ? short(a.abilityHrid) + ' ' + a.level : 'empty');
        if (withSwaps && ex) {
            const held = new Set(ab.map((a) => a?.abilityHrid).filter(Boolean));
            for (let i = 0; i < 5; i++) {
                if (!open(i)) continue;
                for (const l of ex.learnedAbilities || []) {
                    if (held.has(l.abilityHrid) || !abilityDetailMap[l.abilityHrid] || !!abilityDetailMap[l.abilityHrid].isSpecialAbility !== (i === 0)) continue;
                    out.push({ id: `${p}:ability${i}=${short(l.abilityHrid)}`, kind: 'ability', groups: [`${p}:ability${i}`], player: p, monotone: false, desc: `${p} ability ${i + 1} ${name(ab[i])} -> ${short(l.abilityHrid)} ${l.level}`, ops: [{ op: 'ability', player: p, index: i, ability: l.abilityHrid, level: l.level }], cost: FREE('learned') });
                }
            }
        }
        if (withOrder) {
            const slots = [1, 2, 3, 4].filter((i) => open(i) && ab[i]?.abilityHrid);
            const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, k) => perms([...a.slice(0, k), ...a.slice(k + 1)]).map((r) => [x, ...r])));
            for (const pm of perms(slots)) {
                const order = [0, 1, 2, 3, 4];
                slots.forEach((slot, k) => { order[slot] = pm[k]; });
                const moved = order.map((j, i) => (j !== i ? i : -1)).filter((i) => i >= 0);
                if (!moved.length) continue;
                out.push({ id: `${p}:order=${order.join('')}`, kind: 'order', groups: moved.map((i) => `${p}:ability${i}`), player: p, monotone: false, desc: `${p} ability order ${order.slice(1).map((j) => name(ab[j]).split(' ')[0]).join(', ')}`, ops: [{ op: 'abilityOrder', player: p, order }], cost: FREE('loadout tweak') });
            }
        }
        return out;
    }
    function allCandidates(setups, p) {
        if (!exportFor(p)) for (const l of ['owned', 'abilities', 'books']) if (levers.has(l)) skipNoExport(l, p);
        return [
            ...(levers.has('equip') ? candidatesFor(setups, p, openSlots) : []),
            ...(levers.has('owned') ? ownedCands(setups, p, openSlots) : []),
            ...abilityCands(setups, p, levers.has('abilities'), levers.has('order')),
            ...upgradeCands(setups.find((x) => x.name === p), p, levers, { arg, pricer, ex: exportFor(p) }),
            ...(levers.has('triggers') ? triggerCands(setups.find((x) => x.name === p), p, probeStore, { ...trigOpts, user: userTrig[p] }) : []),
            ...(levers.has('skills') ? skillCands(setups, p, skillOpts) : []),
        ];
    }

    // The trigger counter (design 3.5 item 2): runs of the baseline (the original base with the chosen foods and drinks, so the
    // counter and the food-trigger candidates see the new foods) with the probe, cut to percentiles, kept in <out>/probe.json
    // for this baseline. Each probe run must equal the plain run of the same seed (the probe only observes): it is checked
    // against the cached plain run when there is one (tools/test/whatif-triggers.mjs checks it on a generic party).
    async function probeBase(baseOps) {
        const key = keyOf(baseOps), setupsB = applyOps(setups0, baseOps), p0 = runStore.readAux('probe.json');
        if (p0) { const p = p0; if (p.key === key && p.k === probeK && p.h === probeH) return p.store; }
        const stores = [];
        for (const seed of seedsFor(probeK)) {
            let st;
            const t1 = Date.now();
            const res = await runParty({ ...options, setups: setupsB, seed, checkpoints: [probeH], onPlayers: (pls, names) => { st = installProbe(pls, names, players, Trigger); } });
            const cached = cache.get(key + '#' + seed)?.byHours[probeH];
            if (cached && JSON.stringify(cached) !== JSON.stringify(res.checkpoints[0])) throw new Error(`probe changed the run of seed ${seed}: the counter must only observe`);
            console.log(`probe seed ${seed} ${probeH} h: ${((Date.now() - t1) / 1000).toFixed(0)} s, ${cached ? 'equal to the cached plain run' : 'no cached plain run to compare'}`);
            stores.push(summarize(st));
        }
        const store = mergeProbes(stores);
        runStore.writeAux('probe.json', { key, k: probeK, h: probeH, store });
        return store;
    }
    const openSlots = onlySlots || COMBAT_SLOTS;

    // ---- Estimates ----
    function estimate(baseOps, c, st, baseSeeds) {
        const vOps = [...baseOps, ...c.ops], vSeeds = pick(vOps, st.h, st.k), bSeeds = pick(baseOps, st.h, baseSeeds);
        const vs = vSeeds.map((i) => val(vOps, i, st.h));
        const bs = bSeeds.map((i) => val(baseOps, i, st.h));
        // The gain's base: the base on exactly the variant's seeds (its error keeps all of `bs`).
        const bsSame = vSeeds.map((i) => val(baseOps, i, st.h));
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
        let gain, se;
        if (errorRule === 'paired') { const d = vs.map((v, i) => v - bs[i]); gain = mean(d); se = sd(d) / Math.sqrt(d.length); }
        else { gain = mean(vs) - mean(bsSame); se = Math.sqrt(sd(vs) ** 2 / vs.length + sd(bs) ** 2 / bs.length); }
        const vcp = vSeeds.map((i) => cpOf(vOps, i, st.h)), bcp = bSeeds.map((i) => cpOf(baseOps, i, st.h)), bcpSame = vSeeds.map((i) => cpOf(baseOps, i, st.h));
        const shared = diffStat(vcp.map(lootOf), bcp.map(lootOf), bcpSame.map(lootOf)), own = diffStat(vcp.map((cp) => suppliesOf(cp, c.player)), bcp.map((cp) => suppliesOf(cp, c.player)), bcpSame.map((cp) => suppliesOf(cp, c.player)));
        // The party figure on the profit goal is the shared loot gain only, with no one's food or drink in it (Owner: "Gain is per
        // party, cost is per person"). Another goal keeps its own metric and the party test.
        if (goal === 'profit') ({ gain, se } = shared);
        const cost = c.cost.cost;
        const g = c.monotone ? Math.max(gain, 0) : gain; // a monotone lever can only help (3.2 item 1): rank by its size
        const payback = goal === 'profit' && gain > 0 && cost > 0 ? cost / gain : null;
        const acceptedParty = gain > 0 && gain >= z * se; // a zero gain (an EXP-only charm on a profit goal) is never accepted
        // The buyer's net (profit goal): per run q = the party's loot per user minus the buyer's own supplies; the net and its
        // error are the search's own rule on that one series (never the loot error plus the supplies error: they are correlated).
        // Accepted by acceptBoth: one of the party's shared gain and the buyer's net is at least z errors above 0 and the other is not
        // below -(z/2) errors. Another goal keeps the party test and the party score as they were.
        let net, netSe, netSeSame, accepted = acceptedParty, score;
        if (goal === 'profit') {
            ({ net, se: netSe, seSame: netSeSame } = buyerNet(vcp, bcp, c.player, setups0.length, errorRule, z, bcpSame));
            accepted = acceptBoth(gain, se, net, netSe, z);
            score = scoreOf(net, cost, c.monotone); // 1 / the buyer's payback
        } else score = cost <= 0 ? (g > 0 ? Infinity : g) : g / cost;
        const judged = judgeFood(c, vcp, bcp, bcpSame);
        return { judged, stage: `${st.k}x${st.h}`, seeds: vSeeds, baseSeeds: bSeeds, gain, se, shared, own, ...(goal === 'profit' ? { net, netSe, netSeSame } : {}), base: mean(bs), score, payback, accepted: accepted && !judged };
    }
    // The sim as judge for a food filling: refused when, on the same series and error rule as the gain, the party's deaths per
    // hour are higher than the base's by more than z x the error, or its encounters per hour (the kills) are lower by that much.
    // Other candidate kinds are never judged here. Returns 'deaths', 'kills' or null.
    function judgeFood(c, vcp, bcp, bcpSame) {
        if (c.kind !== 'food-fill') return null;
        const d = diffStat(vcp.map((cp) => cp.party.deathsPerHour), bcp.map((cp) => cp.party.deathsPerHour), bcpSame.map((cp) => cp.party.deathsPerHour)), k = diffStat(vcp.map((cp) => cp.encountersPerHour), bcp.map((cp) => cp.encountersPerHour), bcpSame.map((cp) => cp.encountersPerHour));
        return d.gain > z * d.se ? 'deaths' : -k.gain > z * k.se ? 'kills' : null;
    }
    // Order: the buyer's score (1 / his payback), a tie by the larger buyer net, then the larger party gain.
    const rank = (a, b) => rankEst(a.est, b.est);
    const rankFirst = (a, b) => rankAcceptedFirst(a.est, b.est);
    const logCandidates = (n, list) => { for (const c of list) console.log(`  step ${n} candidate: ${c.desc}, gain ${fmt(c.est.gain)} ± ${fmt(c.est.se)}, buyer ${fmt(c.est.net)} ± ${fmt(c.est.netSe)}, ${c.est.accepted ? 'accepted' : c.est.judged ? 'refused (' + c.est.judged + ')' : 'not accepted'}`); };

    // ---- Rounds (anytime-search-design.md) ----
    // One race of a set of candidates against `base` (ops of the baseline so far). Round 1 gives every candidate `firstK` seeds of
    // `unitH` hours (today's screen); each later round gives every candidate that is not paused `roundSeeds` more, plus the base's
    // `baseMult` times as many. After the new seeds: every candidate's figure is estimate() at its own seed count (no second formula),
    // the contention test runs on every candidate (rounds.mjs: two pools, K leaders each, pause below the leaders' lowest lower bound at
    // `pauseMult` errors, a paused one resumes by itself), and the current leaders get `readStep` more READING seeds (sureSeeds: from
    // sureOffset + 1, the pick check's block, never used to choose): the figure shown as a result and its t range come only from those.
    // A round record goes out through outSink.round. The race ends with a lock (the leader's reading seeds pass the pick check's accept
    // rule, and with lockRule 'both' no contender's upper bound reaches its lower bound), with nothing left that could help (no upper
    // bound above 0), or at --max-rounds; a stop or the time limit returns null. `byPlayer`: Stage F / D, one race per player inside
    // the same rounds, each player ends when his own leader locks. Returns { locked, leaders }: locked is a Map player -> candidate
    // (byPlayer) or the candidate / null. A leader that fails the pick check on its reading seeds leaves the race (onRefute).
    let roundNo = 0, liveCands = null, lastRound = null, lastBase = [];
    const endedByUser = {}; // stage -> the round after which the user ended it (result.endedByUser)
    const haveSeeds = (ops, seeds, h) => { const key = keyOf(ops); return seeds.every((s) => cache.get(key + '#' + s)?.byHours[h]); };
    // The reading seeds a candidate has (consecutive from sureOffset + 1, both arms cached).
    function readCount(base, c, h) {
        const vOps = [...base, ...c.ops], bk = keyOf(base), vk = keyOf(vOps);
        let k = 0;
        while (k < 4096 && cache.get(bk + '#' + (sureOffset + k + 1))?.byHours[h] && cache.get(vk + '#' + (sureOffset + k + 1))?.byHours[h]) k++;
        return k;
    }
    // The figure and range of a leader from its k reading seeds: the search's own error rule (freshRead) and an ordinary t range at `coverage`.
    function readingOf(base, c, k, h) {
        const f = freshRead(base, c, k, h), n = setups0.length;
        const vOps = [...base, ...c.ops], seeds = sureSeeds(k);
        const vcp = seeds.map((s) => cpOf(vOps, s, h)), bcp = seeds.map((s) => cpOf(base, s, h));
        const party = goal === 'profit' ? lootOf : metric;
        const m1 = k < 2 ? 0 : tMult(coverage, dfOf(vcp.map(party), bcp.map(party), errorRule));
        // One reading seed gives the figure and no range (a range needs two seeds): low and high are null then.
        const out = k < 2 ? { k, figure: f.gainPerUser, low: null, high: null, accepted: f.accepted, gain: f.gain, se: f.se, sePerUser: f.sePerUser } : { k, figure: f.gainPerUser, low: f.gainPerUser - m1 * f.sePerUser, high: f.gainPerUser + m1 * f.sePerUser, accepted: f.accepted, gain: f.gain, se: f.se, sePerUser: f.sePerUser };
        if (goal === 'profit') {
            const q = (cp) => lootOf(cp) / n - suppliesOf(cp, c.player);
            const m2 = k < 2 ? 0 : tMult(coverage, dfOf(vcp.map(q), bcp.map(q), errorRule));
            Object.assign(out, { net: f.buyerNet, netSe: f.buyerNetSe, netLow: k < 2 ? null : f.buyerNet - m2 * f.buyerNetSe, netHigh: k < 2 ? null : f.buyerNet + m2 * f.buyerNetSe, payback: f.buyerNet > 0 && c.cost.cost > 0 ? paybackDays(c.cost.cost, f.buyerNet) : null });
        }
        return out;
    }
    // today's pick check (sure.mjs verdict) on the reading seeds already in the cache, block by block: 'wait' (the seeds are not all
    // there), 'pass', or 'fail' (slow: it would have passed but pays back past the limit). Runs nothing, so the same rule is applied
    // again by confirmPick later from the same cache.
    function peekCheck(base, c, h) {
        for (let k = SURE_BLOCK; k <= SURE_MAX; k += SURE_BLOCK) {
            const seeds = sureSeeds(k);
            if (!haveSeeds(base, seeds, h) || !haveSeeds([...base, ...c.ops], seeds, h)) return { verdict: 'wait' };
            const fresh = freshRead(base, c, k, h), v = verdict(fresh, k, { z, goal, max: SURE_MAX });
            if (v === 'more') continue;
            const slow = v === 'pass' && overPaybackLimit(c.cost.cost, fresh.buyerNet, payLimit);
            return { verdict: v === 'pass' && !slow ? 'pass' : 'fail', fresh, slow };
        }
        return { verdict: 'wait' };
    }
    // ---- The rows of a round record (the real round's and the first look's: one shape, one order) ----
    // What a foods or drinks candidate changes, slot by slot: the new item of each slot it changes (the panel leaves the other slots blank), with the
    // readable text of its trigger when the candidate sets one (an unchanged trigger is the default and is not said). Others have none: the panel
    // shows their desc. Worked out once per candidate and base.
    // The trigger text the player has in a food slot: that of the item in the slot (its own or the default); the item's own when the slot is empty.
    const slotTrigger = (setup, i, item) => triggerText(effectiveTriggers(setup, setup?.food?.['/action_types/combat']?.[i]?.itemHrid || item));
    function changeOf(base, c) {
        const bk = keyOf(base);
        if (c.changeBase === bk) return c.change;
        const ops = c.ops.filter((o) => o.op === 'food' || o.op === 'drink'), trig = c.ops.filter((o) => o.op === 'trigger');
        c.changeBase = bk;
        if (!ops.length) return (c.change = null);
        const kind = ops[0].op === 'food' ? 'foods' : 'drinks', setup = applyOps(setups0, [...base, ...c.ops]).find((s) => s.name === c.player), now = applyOps(setups0, base).find((s) => s.name === c.player);
        // A slot shows its trigger only when the candidate changes it from the player's current one in that slot (the setup the stage measures on top of).
        // `current`: the item the player has in each slot now (null for an empty one): the panel greys it in a slot the candidate leaves alone.
        const cur = (now?.[kind === 'foods' ? 'food' : 'drinks']?.['/action_types/combat'] || []).map((x) => x?.itemHrid || null);
        return (c.change = { kind, current: cur, slots: ops.map((o) => { const t = kind === 'foods' && trig.some((x) => x.hrid === o.item) ? triggerText(effectiveTriggers(setup, o.item)) : null; return { index: o.index, item: o.item, trigger: t !== null && t !== slotTrigger(now, o.index, o.item) ? t : null }; }) });
    }
    // A range that reaches 0 (the buyer's gain's on the profit goal, the figure's otherwise) is not a result yet: status 'zero', never 'confirmed'.
    const zeroed = (r) => { const lo = goal === 'profit' ? r.netLow : r.low, hi = goal === 'profit' ? r.netHigh : r.high; return r.k >= 2 && Number.isFinite(lo) && Number.isFinite(hi) && lo <= 0 && hi >= 0; };
    // A shared loot gain whose whole range is below 0 (profit goal): the party loses on this row, whatever the buyer's gain reads. Status 'loses' only (the search's choice is unchanged).
    const loses = (r) => goal === 'profit' && r.k >= 2 && Number.isFinite(r.high) && r.high < 0;
    // `r`: the reading { k, figure, low, high, net, netLow, netHigh, payback } or null (none yet).
    function rowShape(base, c, r, { seeds, readingSeeds, few, status, screen }) {
        const has = !!r && r.net !== undefined, searchHours = seeds * unitH, readHours = readingSeeds * unitH;
        return { id: c.id, player: c.player, desc: c.desc, change: changeOf(base, c), cost: c.cost.cost, seeds, readingSeeds, searchHours, readHours, hours: searchHours + readHours, tooFew: !r, few, status: status !== 'refuted' && r && loses(r) ? 'loses' : status !== 'refuted' && r && zeroed(r) ? 'zero' : status, screen,
            reading: r ? r.figure : null, low: r ? r.low : null, high: r ? r.high : null,
            buyerNet: has ? r.net : null, netLow: has ? r.netLow : null, netHigh: has ? r.netHigh : null, payback: r ? r.payback ?? null : null };
    }
    // The order of a pool's table, by one column: a free pool by the buyer's gain (largest first), a paid pool by its payback (shortest first, none
    // last), a goal without a buyer's gain by the figure; a tie by the larger buyer's gain, then the id. Returns the column's name.
    function sortRows(rows, key) {
        const col = goal !== 'profit' ? 'reading' : String(key).endsWith('free') ? 'buyerNet' : 'payback', down = col !== 'payback';
        // The order is the order of what the column shows: a figure whose range reaches 0 is written "≈ 0" (|figure| <= half the range), so it ranks as 0.
        const of = (r) => {
            if (col === 'payback') return r.payback;
            const v = col === 'buyerNet' ? r.buyerNet : r.reading, lo = col === 'buyerNet' ? r.netLow : r.low, hi = col === 'buyerNet' ? r.netHigh : r.high;
            return Number.isFinite(v) && Number.isFinite(lo) && Number.isFinite(hi) && Math.abs(v) <= (hi - lo) / 2 ? 0 : v;
        };
        const tie = (a, b) => ((b.buyerNet ?? b.reading ?? -Infinity) - (a.buyerNet ?? a.reading ?? -Infinity)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        rows.sort((a, b) => { const x = of(a), y = of(b), fx = Number.isFinite(x), fy = Number.isFinite(y); if (fx !== fy) return fx ? -1 : 1; if (fx && x !== y) return down ? y - x : x - y; return tie(a, b); });
        return col;
    }
    // The first look at a race (round 1): a provisional round record from the cache alone, with the candidates that have a first figure (a seed
    // with both arms cached; the figure is the mean of the paired differences, its range from two seeds on). Same rows, same order, same pools as a
    // round record, with `provisional: true` and the count of candidates that have a figure. Read-only: no field of a candidate is set that a
    // choice reads, and nothing here is used to pause, lock or choose.
    function firstLook(cands, base, byPlayer, stage) {
        const bk = keyOf(base), n = setups0.length, party = goal === 'profit' ? lootOf : metric, mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
        const pools = new Map(); let have = 0, total = 0;
        for (const c of cands) {
            if (c.refuted) continue;
            total++;
            const key = poolKey(c, byPlayer), pool = pools.get(key) || pools.set(key, { size: 0, rows: [] }).get(key);
            pool.size++;
            if (c.vkeyBase !== bk) { c.vkeyBase = bk; c.vkey = keyOf([...base, ...c.ops]); }
            const d = [], q = [];
            for (const s of seedIndex.get(c.vkey) || []) {
                if (s > confirmOffset) continue;
                const v = cache.get(c.vkey + '#' + s)?.byHours[unitH], b = cache.get(bk + '#' + s)?.byHours[unitH];
                if (!v || !b) continue;
                d.push((party(v) - party(b)) / n);
                if (goal === 'profit') q.push(lootOf(v) / n - suppliesOf(v, c.player) - (lootOf(b) / n - suppliesOf(b, c.player)));
            }
            const k = d.length;
            if (!k) continue;
            have++;
            const range = (a) => { const m = mean(a); if (k < 2) return { m, low: null, high: null }; const h = tMult(coverage, k - 1) * sd(a) / Math.sqrt(k); return { m, low: m - h, high: m + h }; };
            const g = range(d), r = { k, figure: g.m, low: g.low, high: g.high };
            if (goal === 'profit') { const e = range(q); Object.assign(r, { net: e.m, netLow: e.low, netHigh: e.high, payback: e.m > 0 && c.cost.cost > 0 ? paybackDays(c.cost.cost, e.m) : null }); }
            pool.rows.push(rowShape(base, c, r, { seeds: k, readingSeeds: 0, few: false, status: 'first', screen: g.m }));
        }
        return { provisional: true, round: roundNo, stage, simHours: wallLog.reduce((a, r) => a + r.h, 0), unitHours: unitH, coverage, pauseMult, leadersK, goal, readingMin: readMin, firstLook: { have, total },
            candidates: { total, contending: total, paused: 0, refuted: 0, locked: 0 },
            pools: [...pools].sort(poolSorter(players)).map(([key, p]) => { const sortedBy = sortRows(p.rows, key); return { key, size: p.size, contending: p.size, paused: 0, line: null, rangeWidth: null, sortedBy, leaders: p.rows.slice(0, leadersK) }; }) };
    }
    async function race(cands, base, { stage, byPlayer, onRefute, onRound }) {
        const H = unitH, bk = keyOf(base), n = setups0.length;
        liveCands = cands; lastBase = base;
        for (const c of cands) if (c.raceBase !== bk) { c.raceBase = bk; c.k = 0; c.status = undefined; c.refuted = false; }
        const lockedBy = new Map(); // player (or '*') -> candidate
        stopSignal.done = false; // a press before this stage's first round belongs to no stage that ran: dropped
        const sinceStart = roundNo, hours0 = wallLog.reduce((a, r) => a + r.h, 0), runs0 = wallLog.length;
        // A race stage has no total known in advance, so its progress part shows no bar: only counters that never go down (the round being run,
        // the runs finished in the stage and the simulated hours spent in it, both cumulative over every batch of every round, and the
        // candidates dropped, who never return) and the contention of the last finished round (in contention, paused: plain numbers, they
        // may fall and rise). report() adds them to every progress message of the stage (stageCtx), whichever batch is running.
        const widthPrev = new Map(); // pool key -> the top leader's range width of the last round (item: range width and the one before)
        let stageCont = { contending: cands.length, paused: 0 };
        stageCtx = () => ({ stageContending: stageCont.contending, stagePaused: stageCont.paused, stageDropped: cands.filter((c) => c.refuted).length, stageRuns: wallLog.length - runs0, stageSimHours: wallLog.reduce((a, r) => a + r.h, 0) - hours0 });
        try {
        for (;;) {
            roundNo++;
            const active = cands.filter((c) => !c.refuted && !(byPlayer && lockedBy.has(c.player)));
            const todo = active.filter((c) => c.status !== 'paused');
            for (const c of todo) c.k = c.k ? c.k + roundSeeds : firstK;
            const maxK = Math.max(...active.map((c) => c.k), 0);
            // Each phase of a round is named for what it is: the round being run (from its start), the phase (search seeds of every candidate
            // in contention, reading seeds of the leaders) and the phase's own candidate count; the bar is the phase's runs.
            report({ stage, round: roundNo, phase: 'search', candidatesLeft: todo.length });
            // The order the runs are asked for in: the base's first seed, then seed 1 of every candidate (and the base on it), then seed 2 of every
            // candidate, and so on, then the base's other seeds. Only the order changes (the same runs, the same keys): the first look has a figure of
            // every candidate after the first sweep, long before the last seed of the first candidate would have been done.
            const baseReqs = req(base, H, maxK * baseMult, 'base'), pairs = todo.map((c) => ({ c, pr: reqPair(base, [...base, ...c.ops], H, c.k, 'variant') }));
            const sweeps = Array.from({ length: maxK }, (_, s) => pairs.filter((x) => s < x.c.k).flatMap((x) => [x.pr[s], x.pr[x.c.k + s]]));
            const sweepIds = sweeps.map((sw) => sw.map((r) => keyOf(r.ops) + '#' + r.seed));
            let doneSweeps = 0, lastLook = 0;
            const first = roundNo - sinceStart === 1;
            // The first look (round 1 of a race): a provisional round record per finished sweep and, while a sweep runs, every few seconds. It is
            // read from the cache only, goes to the sink and nowhere else; nothing chooses, pauses or locks from it.
            const look = (force) => {
                const now = Date.now();
                if (!force && now - lastLook < 3000) return;
                lastLook = now;
                outSink.round(firstLook(cands, base, byPlayer, stage));
            };
            const onRun = first ? () => {
                const was = doneSweeps;
                while (doneSweeps < sweepIds.length && sweepIds[doneSweeps].every((id) => cache.get(id)?.byHours[H])) doneSweeps++;
                look(doneSweeps > was);
            } : undefined;
            if (first) look(true);
            if (!await ensure([baseReqs[0], ...sweeps.flat(), ...baseReqs.slice(1)].filter(Boolean), { onRun })) return null;
            for (const c of todo) { c.est = estimate(base, c, { k: c.k, h: H }, c.k * baseMult); c.history = [c.est]; }
            const cont = contention(active, { K: leadersK, mult: pauseMult, goal, byPlayer, rank: rankFirst, order: players });
            const leaders = cont.pools.flatMap((p) => p.leaders);
            if (readStep > 0 && leaders.length) {
                const reqs = leaders.flatMap((c) => sureSeeds(readCount(base, c, H) + readStep).flatMap((seed) => [{ ops: base, seed, h: H, tag: 'read' }, { ops: [...base, ...c.ops], seed, h: H, tag: 'read' }]));
                report({ stage, round: roundNo, phase: 'reading', candidatesLeft: leaders.length });
                if (!await ensure(reqs)) return null;
            }
            // Readings, the pick check on them, the refuted, the locks.
            const read = new Map(), peek = new Map();
            for (const c of leaders) {
                const k = readCount(base, c, H);
                read.set(c, k >= 1 ? readingOf(base, c, k, H) : null);
                peek.set(c, peekCheck(base, c, H));
            }
            for (const c of leaders) {
                const p = peek.get(c);
                if (p.verdict === 'fail') { c.refuted = true; onRefute?.(c, p); }
            }
            const live = leaders.filter((c) => !c.refuted);
            const rows = (p) => p.leaders.map((c) => {
                // The figure shows from the first reading seed and its range from the second (low / high are null with one seed): `few` while the
                // leader has fewer than --reading-min (its status says so), `tooFew` only with no reading seed at all. 'confirmed' (the fresh seeds
                // word) needs --reading-min seeds. 'zero': the range reaches 0 (rowShape).
                const r = read.get(c), few = !!r && r.k < readMin;
                return rowShape(base, c, r, { seeds: c.k, readingSeeds: r ? r.k : 0, few, status: c.refuted ? 'refuted' : few ? 'few' : peek.get(c).verdict === 'pass' ? 'confirmed' : c.status, screen: goal === 'profit' ? c.est.net / n : c.est.gain / n });
            });
            const wallH = wallLog.reduce((a, r) => a + r.h, 0);
            const rec = { round: roundNo, stage, simHours: wallH, simHoursAll: [...cache.values()].reduce((a, r) => a + r.hours, 0), unitHours: H, coverage, pauseMult, leadersK, goal, readingMin: readMin,
                candidates: { total: cands.length, contending: cont.contending, paused: cont.paused, refuted: cands.filter((c) => c.refuted).length, locked: lockedBy.size },
                // rangeWidth: the width (high minus low, per user per day) of the pool's top leader's range; rangeWidthPrev: the same pool's width one round
                // earlier of this race (absent on the stage's first round, or when that round had no range). Computed here once; the panel only prints them.
                pools: cont.pools.map((p) => {
                    const lr = rows(p), sortedBy = sortRows(lr, p.key), t = lr[0], w = t && t.low !== null && t.high !== null ? t.high - t.low : null, was = widthPrev.get(p.key) ?? null;
                    widthPrev.set(p.key, w);
                    return { key: p.key, size: p.size, contending: p.contending, paused: p.paused, line: Number.isFinite(p.line) ? p.line : null, rangeWidth: w, ...(was !== null ? { rangeWidthPrev: was } : {}), sortedBy, leaders: lr };
                }) };
            lastRound = rec;
            stageCont = { contending: cont.contending, paused: cont.paused };
            report(); // the progress row takes the round record's counts now, not the first look's
            outSink.round(rec);
            onRound?.(rec, live);
            const top = rec.pools.map((p) => { const l = p.leaders[0]; return l ? `${p.key} ${l.desc.slice(0, 48)} ${l.tooFew ? `(${l.readingSeeds} reading seeds, too few)` : `${fmt(l.reading)} [${fmt(l.low)}, ${fmt(l.high)}] n=${l.readingSeeds}`}` : `${p.key} none`; }).join('; ');
            console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] round ${roundNo} ${stage}: ${cont.contending} in contention, ${cont.paused} paused, ${rec.candidates.refuted} refuted, ${rec.simHours} sim h; ${top}`);
            // Locks: the leader's reading seeds pass the pick check (peek) and, with lockRule 'both', nobody in its pool reaches its lower bound.
            const sepOpts = { goal, mult: pauseMult, byPlayer };
            const ready = (c) => !c.timeOnly && peek.get(c).verdict === 'pass' && (lockRule === 'reading' || separated(c, active, sepOpts));
            if (byPlayer) {
                for (const p of players) if (!lockedBy.has(p)) { const c = live.filter((x) => x.player === p).sort(rankFirst).find(ready); if (c) lockedBy.set(p, c); }
            } else {
                const c = live.sort(rank).find(ready);
                if (c) lockedBy.set('*', c);
            }
            const settled = byPlayer ? players.every((p) => lockedBy.has(p) || !anyHope(cands.filter((c) => c.player === p && !c.timeOnly), goal, pauseMult)) : lockedBy.size > 0 || !anyHope(cands.filter((c) => !c.timeOnly), goal, pauseMult);
            // "Done with this stage" (stop.done): the race ends here, after the round just published, with the leaders as --max-rounds returns them; a
            // stage that ends this way without the search's own lock is marked in the report (result.endedByUser) as ended by the user.
            const byUser = !!stopSignal.done;
            if (byUser) stopSignal.done = false;
            if (byUser && !settled) endedByUser[stage] = roundNo - sinceStart;
            if (settled || byUser || (maxRounds > 0 && roundNo - sinceStart >= maxRounds)) {
                // The race has ended (by its lock, the round limit or the button): its last figures and its end go to the progress record at
                // once (stageEnded names the stage), so the row stops reading "running" and drops the button however long the pick checks take.
                // A stage that stops (return null) is not ended: it stays the part that was running, drawn halted.
                Object.assign(progress, stageCtx(), { stageEnded: stage });
                report();
                return { locked: byPlayer ? lockedBy : lockedBy.get('*') ?? null, leaders: live };
            }
        }
        } finally { stageCtx = null; }
    }
    // An object keyed by player name, rebuilt in the party's own order (the order of `players`; a key that is no player after them).
    const inParty = (obj) => Object.fromEntries(partyEntries(obj));
    const partyEntries = (obj) => { const at = (k) => { const i = players.indexOf(k); return i < 0 ? players.length : i; }; return Object.entries(obj || {}).sort((a, b) => at(a[0]) - at(b[0])); };
    // One player's entry of result.best: his items in slot order after the stage (a food with the readable text of its trigger, null
    // when it always fires), with the chosen filling's figures at its last stage; no figures and unchanged: true without one.
    // The trigger text of a food only when it differs from the player's own on the setup he came with (the default or his kept one is not repeated).
    const shownTrigger = (setup, i, item) => { const t = triggerText(effectiveTriggers(setup, item)), orig = setups0.find((x) => x.name === setup.name); return t !== null && (!orig || t !== slotTrigger(orig, i, item)) ? t : null; };
    // Each item carries its slot and `same: true` when it is the item (and, for a food, the trigger) the player has in that slot now: the panel
    // greys it, since the slot does not change. `emptySlots`: the slots that hold nothing now and after (the panel says "empty" there).
    const setupSlots = (kind, setup) => setup[kind === 'foods' ? 'food' : 'drinks']?.['/action_types/combat'] || [];
    const bestItems = (kind, setup) => {
        const orig = setups0.find((x) => x.name === setup.name);
        return setupSlots(kind, setup).map((x, i) => (x?.itemHrid ? { item: x.itemHrid, i } : null)).filter(Boolean)
            .map(({ item, i }) => { const trigger = kind === 'foods' ? shownTrigger(setup, i, item) : null; return { item, ...(kind === 'foods' ? { trigger } : {}), slot: i, ...(orig && setupSlots(kind, orig)[i]?.itemHrid === item && trigger === null ? { same: true } : {}) }; });
    };
    const emptySlots = (kind, setup) => setupSlots(kind, setup).map((x, i) => (x?.itemHrid ? -1 : i)).filter((i) => i >= 0);
    // The same entry while the stage still runs (soFar: true): each player's leader as the lock would take it (the best ranked of his live
    // leaders), with the figure and the range of its row in the round record, the data the rounds table shows (no second computation);
    // a leader with too few reading seeds has its items and tooFew: true. The stage's end replaces it with bestEntry's.
    function liveBest(kind, base, rec, live) {
        const rowOf = new Map(rec.pools.flatMap((p) => p.leaders.map((r) => [r.id, r]))), out = {};
        for (const p of players) {
            const c = live.filter((x) => x.player === p).sort(rankFirst)[0], r = c && rowOf.get(c.id);
            if (!r) continue;
            const sp = applyOps(setups0, [...base, ...c.ops]).find((s) => s.name === p), items = bestItems(kind, sp);
            const figures = { readingSeeds: r.readingSeeds, ...(r.tooFew ? { tooFew: true } : { gainPerUser: r.reading, low: r.low, high: r.high, ...(r.buyerNet === null ? {} : { buyerNet: r.buyerNet, netLow: r.netLow, netHigh: r.netHigh }) }) };
            // A leader without a clear gain (the buyer's gain range, the figure's otherwise, does not lie entirely above 0, or it has fewer than
            // --reading-min fresh runs, or the shared loot falls) is not a recommendation: the entry is the final's unchanged form (the player's current
            // items), flagged `unclear`, with the leader's items and figures kept as `candidate` for the panel's tooltip.
            const lo = r.buyerNet === null ? r.low : r.netLow;
            if (r.tooFew || r.readingSeeds < readMin || r.status === 'loses' || !(Number.isFinite(lo) && lo > 0)) {
                const now = applyOps(setups0, base).find((s) => s.name === p);
                out[p] = { ...bestEntry(kind, now, null), soFar: true, unclear: true, ...(r.status === 'loses' ? { loses: true } : {}), candidate: items, ...figures };
                continue;
            }
            // `notFirst`: the pick (by the search's own runs) is not the first row of its pool's table (ordered by the fresh runs); the panel says so.
            const pool = rec.pools.find((q) => q.leaders.some((x) => x.id === r.id)), first = pool?.leaders.find((x) => x.status !== 'refuted');
            out[p] = { soFar: true, ...(first && first.id !== r.id ? { notFirst: true } : {}), items, empty: emptySlots(kind, sp), slots: setupSlots(kind, sp).length, ...figures };
        }
        return out;
    }
    function bestEntry(kind, setup, chosen, fresh) {
        const items = bestItems(kind, setup), empty = emptySlots(kind, setup), slots = setupSlots(kind, setup).length;
        if (!chosen) return { items, empty, slots, unchanged: true };
        const e = chosen.est, n = setups0.length;
        return { items, empty, slots, gain: e.gain, se: e.se, gainPerUser: e.gain / n, sePerUser: e.se / n, ...(e.net !== undefined ? { buyerNet: e.net, buyerNetSe: e.netSe } : {}), ...(e.own ? { ownSuppliesPerDay: e.own.gain } : {}), stage: e.stage, ...(fresh ? { fresh } : {}) };
    }

    // ---- Search ----
    async function search() {
        const result = { args: settings.argsText, goal, errorRule, baseMult, z, stages: stages.map((s) => `${s.k}x${s.h}`), keep, budget, budgets, budgetSource, taxLabel: TAX_LABEL, players, partySize: setups0.length, options: { ...keyOptions, ...pricesMeta, levers: [...levers], maxPaybackDays: maxPayback }, setups: setups0, steps: [], singles: [], apart: [], overBudget: [], overPayback: [], dominated, otherStyle, skippedNoExport: [], notConfirmed: [], pickCheck: { seedsPerBlock: SURE_BLOCK, maxSeeds: SURE_MAX, firstSeed: sureOffset + 1 } };
        result.rounds = { firstSeeds: firstK, roundSeeds, unitHours: unitH, leaders: leadersK, pauseMult, coverage, readingStep: readStep, readingMin: readMin, lockRule, confirmSeeds: finK, confirmHours: finH, maxRounds };
        let baseOps = [], spent = zeroSpend(budgets);
        const fillings = levers.has('consumables');
        partsTracker = createParts({ stages, keep, candidates: null, maxSteps, fillings });
        result.best = { foods: {}, drinks: {} };
        result.endedByUser = endedByUser;
        result.baselineOps = [];
        if (fillings) {
            report({ stage: 'need' }); needStore = await needBase();
            // STAGE F, then STAGE D: the foods and the drinks are decided first, whole fillings of every open slot, each against the
            // baseline so far; all players' choices together are the baseline the rest of the search is measured on.
            for (const kind of ['foods', 'drinks']) {
                const setupsNow = applyOps(setups0, baseOps);
                const fc = players.flatMap((p) => (kind === 'foods' ? foodStageCands(setupsNow, p) : drinkStageCands(setupsNow, p)));
                const flag = kind === 'foods' ? 'food' : 'drink';
                const refute = (c, p) => { // a leader that failed the pick check on its reading seeds leaves the race (as a failed pick does today)
                    result.notConfirmed.push({ ...row(c), step: null, kind: flag, fresh: p.fresh });
                    console.log(`${kind}: ${c.desc} not confirmed on fresh seeds (${p.fresh.seeds} per arm), left out`);
                };
                // Each round the report shows the current best of the stage (soFar), the same data as the rounds table.
                const onRound = (rec, live) => { result.best[kind] = inParty({ ...result.best[kind], ...liveBest(kind, baseOps, rec, live) }); publish(result); };
                const res = await race(fc, baseOps, { stage: kind, byPlayer: true, onRefute: refute, onRound });
                if (!res) return stop(result);
                // Each player's locked filling (his leader whose reading seeds passed the pick check) is confirmed on fresh seeds, in party order,
                // each alone against the stage's start (not the earlier players' confirmed fillings); the runs are the reading seeds, already
                // in the cache. None locked leaves him unchanged (confirmFillings in sure.mjs). baseOps then holds every confirmed filling.
                const fpool = [...res.locked.values()];
                const got = await confirmFillings(players, fpool, baseOps, (ops, c) => confirmPick(ops, c, fin, kind), ({ cand, fresh }) => {
                    result.notConfirmed.push({ ...row(cand), step: null, kind: flag, fresh });
                    console.log(`${kind}: ${cand.desc} not confirmed on fresh seeds (${fresh.seeds} per arm), left out`);
                }, () => true);
                if (!got) return stop(result);
                const chosen = got.chosen;
                baseOps = got.baseOps;
                const after = applyOps(setups0, baseOps);
                for (const p of players) result.best[kind][p] = bestEntry(kind, after.find((s) => s.name === p), chosen[p], got.fresh[p]);
                result.singles.push(...fc.map((c) => ({ ...row(c), stage: flag, hiddenFood: true })));
                console.log(`${kind}: ${players.map((p) => `${p} ${chosen[p] ? chosen[p].desc.slice(p.length + 1) : 'unchanged'}`).join('; ')}`);
                result.baselineOps = baseOps;
                result.drinkPruning = drinkStats;
                publish(result); // snapshot 1 (foods) and 2 (drinks)
            }
        }
        if (levers.has('triggers')) { report({ stage: 'probe' }); probeStore = await probeBase(baseOps); }
        const setupsBase = applyOps(setups0, baseOps);
        let cands = players.flatMap((p) => allCandidates(setupsBase, p));
        if (onlyCands) cands = cands.filter((c) => onlyCands.includes(c.id));
        result.apart = cands.filter((c) => !c.cost.known).map((c) => ({ id: c.id, desc: c.desc, note: c.cost.note }));
        // Priced but over its own player's budget: listed in their own group, never ranked (so a result with no steps says why).
        result.overBudget = cands.filter((c) => c.cost.known && !affordable(c, budgets, null)).map((c) => ({ id: c.id, player: c.player, desc: c.desc, cost: c.cost.cost, ...(c.cost.costBound ? { costBound: c.cost.costBound } : {}), costPath: c.cost.path, note: c.cost.note || '' }));
        cands = cands.filter((c) => c.cost.known && affordable(c, budgets, null)); // each within its own player's budget
        // Monotone levers first (3.2 item 1), then the rest; screen then halving.
        cands.sort((a, b) => (b.monotone - a.monotone));
        result.candidates = cands.length;
        result.candidateList = cands.map((c) => ({ id: c.id, desc: c.desc, cost: c.cost.cost, path: c.cost.path, note: c.cost.note || "" }));
        publish(result); // snapshot 3: the candidates are priced (over-budget list, unknown costs, skipped swaps, the count)
        console.log(`${nOf(cands.length, 'candidate')} within budget, ${result.overBudget.length} priced over budget and ${result.apart.length} with unknown cost listed apart; ${nOf(dominated.length, 'swap')} skipped (no better on any stat), ${nOf(otherStyle.length, 'swap')} skipped (only another style's bonuses)`);

        // The rest of the search runs on the baseline (baseOps: the chosen foods and drinks): a race of every candidate (rounds, two
        // pools, K leaders each) until a pick locks, then the pick joins the baseline and the race goes on from the new baseline.
        partsTracker.setCandidates(cands.length);
        result.timeOnly = cands.filter((c) => c.timeOnly); // time-only levers (skill levels) are shown, never bought
        let cur = cands, singlesDone = false;
        const dead = new Set(); // ids of picks that failed their check: never tried again
        // Greedy stacking on the race's winners.
        // The chain guard (pools.mjs dropChainStates): no candidate may lead back to a state the search has already been in.
        const chain = new Set([keyOf([]), keyOf(baseOps)]);
        const guard = (list) => { const { kept, dropped } = dropChainStates(list, baseOps, keyOf, chain); if (dropped.length) console.log(`  ${dropped.length} candidate(s) lead back to a state already in the chain, dropped: ${dropped.map((c) => c.id).join(', ')}`); return kept; };
        // The trigger refinement (refine.mjs): the owner's local candidates against the chain with the trigger as it stands, never to a state
        // the search has been in (the chain) or the refinement has been in.
        const visitedFor = (c) => new Set([...chain, keyOf([...baseOps, ...c.ops])]);
        const refineAt = (chainOps, c, fin, visited) => refineTrigger(c, {
            locals: (cur) => {
                const at = [...chainOps, ...cur.ops];
                const all = localCands(applyOps(setups0, at).find((x) => x.name === c.player), c.player, probeStore, c.owner);
                const { kept, dropped } = dropChainStates(all, at, keyOf, visited);
                if (dropped.length) console.log(`  ${dropped.length} refinement(s) of ${c.owner.split('/').pop()} lead back to a state already visited, dropped`);
                return kept;
            },
            judge: async (cur, list) => {
                const at = [...chainOps, ...cur.ops];
                if (!await ensure([...req(at, fin.h, fin.k * baseMult, 'base'), ...list.flatMap((l) => reqPair(at, [...at, ...l.ops], fin.h, fin.k, 'variant'))])) return null;
                for (const l of list) l.est = estimate(at, l, fin, fin.k * baseMult);
                return list;
            },
            rank,
            join: (cur, next) => { visited.add(keyOf([...chainOps, ...next.ops])); return { ...next, desc: joinTriggerDesc(cur.desc, next.desc), est: undefined, history: undefined }; },
        });
        for (let step = 0; step <= maxSteps;) { // (the race runs once more after the last step, so the leaders are the ones for the final base; no pick joins past maxSteps)
            const label = `step ${step + 1}`;
            // A leader that fails the pick check on its reading seeds leaves the race: one that pays back past the limit is listed once
            // (result.overPayback), any other is a pick that is not confirmed (result.notConfirmed, never tried again).
            const refuteStep = (c, p) => {
                if (p.slow) { if (!result.overPayback.some((x) => x.id === c.id)) result.overPayback.push({ ...row(c), paybackDays: paybackDays(c.cost.cost, p.fresh.buyerNet) }); }
                else { dead.add(c.id); result.notConfirmed.push({ ...row(c), step: step + 1, fresh: p.fresh }); console.log(`${label}: ${c.desc} not confirmed on fresh seeds (${p.fresh.seeds} per arm), left out`); }
                publish(result);
            };
            const res = await race(cur, baseOps, { stage: step === 0 ? 'screen' : `greedy step ${step}`, byPlayer: false, onRefute: refuteStep });
            if (!res) return stop(result);
            if (!singlesDone) {
                singlesDone = true;
                // The original base (no food or drink change), per user, in the goal's unit: the mean over the base seeds of the confirmation's block.
                // The rows below are measured against the baseline, this figure stays the original base.
                if (!await ensure(req([], fin.h, fin.k * baseMult, 'base'))) return stop(result);
                { const bs = pick([], fin.h, fin.k * baseMult); result.basePerUser = bs.reduce((a, i) => a + val([], i, fin.h), 0) / bs.length / setups0.length; }
                ({ rows: result.singles, notShown: result.singlesNotShown } = singleRows(cands, baseOps, result.singles));
                publish(result); // snapshot 4: the first race has a pick (each change alone, the base)
            }
            logCandidates(step + 1, res.leaders.filter((c) => !c.timeOnly).slice(0, 5));
            // The locked pick joins only once it is confirmed on fresh seeds against the chain as it is now (the same cache as its reading
            // seeds); one that is not is left out (result.notConfirmed, never tried again). No lock ends the chain. A trigger pick is refined
            // first, so the row that is confirmed and shown is the owner's trigger from its value in the chain to its final one.
            const ok = res.locked && step < maxSteps ? [res.locked] : [];
            const checkPickAt = async (c) => {
                let cand = c;
                if (c.kind === 'trigger') {
                    cand = await refineAt(baseOps, c, fin, visitedFor(c));
                    if (cand === null) return null;
                    if (cand !== c) { // the refined change is measured against the chain as one change (the figures the row shows)
                        if (!await ensure([...req(baseOps, fin.h, fin.k * baseMult, 'base'), ...reqPair(baseOps, [...baseOps, ...cand.ops], fin.h, fin.k, 'variant')])) return null;
                        cand.est = estimate(baseOps, cand, fin, fin.k * baseMult);
                        console.log(`  ${label}: ${c.desc} refined to ${cand.desc}, gain ${fmt(cand.est.gain)} ± ${fmt(cand.est.se)}`);
                    }
                }
                const r = await confirmPick(baseOps, cand, fin, label);
                return r && { ...r, cand };
            };
            if (!ok.length) break;
            const picked = await firstConfirmed(ok, checkPickAt, ({ cand, orig, fresh }) => {
                result.notConfirmed.push({ ...row(cand), step: step + 1, fresh });
                console.log(`${label}: ${cand.desc} not confirmed on fresh seeds (${fresh.seeds} per arm), left out`);
                dead.add(orig.id);
                cur = cur.filter((f) => f !== orig);
                publish(result); // snapshot 5: a failed pick
            });
            if (picked === null) return stop(result);
            if (!picked.best) continue; // not confirmed: it left the race, the race goes on without it
            const best = picked.best, bestFresh = picked.fresh;
            spent = pay(spent, best);
            baseOps = [...baseOps, ...best.ops];
            chain.add(keyOf(baseOps));
            result.steps.push({ ...row(best), fresh: bestFresh, kind: best.kind, owner: best.owner, runningCost: Object.values(spent).reduce((a, x) => a + x, 0), runningSpend: { ...spent } });
            console.log(`step ${step + 1}: ${best.desc}, gain ${fmt(best.est.gain)} ± ${fmt(best.est.se)}, cost ${fmt(best.cost.cost)}`);
            publish(result); // snapshot 5: a confirmed step; the row is final
            step++;
            // The race restarts on the new base with the survivors, rebuilt from the new setup (a survivor whose change no longer
            // applies drops out). The accepted change's equipment slots get fresh candidates from the new item, as in
            // phase 1; the other groups it touched keep only their survivors, so a loadout step does not re-add dozens.
            const setupsNow = applyOps(setups0, baseOps), touched = new Set(best.groups);
            const survivors = new Set(cur.filter((c) => c !== picked.orig && !c.timeOnly).map((c) => c.id));
            cur = players.flatMap((p) => allCandidates(setupsNow, p)).filter((c) => !dead.has(c.id) && c.cost.known && affordable(c, budgets, spent) && (
                c.groups.some((g) => touched.has(g)) && c.kind === 'equip' && (best.kind === 'equip' || best.kind === 'owned')
                    ? (c.monotone || !onlyCands || onlyCands.includes(c.id))
                    : c.groups.some((g) => touched.has(g)) && (c.kind === 'trigger' || c.kind === 'food-fill') ? false // stale: built on the owner's old list / old foods
                        : (survivors.has(c.id) && c.id !== best.id && c.id !== picked.orig.id)));
            // (The owner's coordinate-wise rounds ran before the pick was confirmed: refineTrigger.)
            cur = guard(cur).filter((c) => !c.timeOnly);
        }

        // One confirmation on fresh seeds (3.3): the original base against the final result (the chosen foods and drinks and every
        // accepted step), so the combined gain is shown.
        if (baseOps.length) {
            report({ stage: 'confirmation', candidatesLeft: 0 });
            const fs = pick([], fin.h, fin.k * baseMult, true), vs = pick(baseOps, fin.h, fin.k, true);
            // The gain's base is the original base on the result's own seeds (vs); the other base seeds of fs feed the error.
            if (!await ensure([...fs.map((i) => ({ ops: [], seed: i, h: fin.h, tag: 'confirm' })), ...vs.map((i) => ({ ops: [], seed: i, h: fin.h, tag: 'confirm' })), ...vs.map((i) => ({ ops: baseOps, seed: i, h: fin.h, tag: 'confirm' }))])) return stop(result);
            const v = vs.map((i) => val(baseOps, i, fin.h)), b = fs.map((i) => val([], i, fin.h)), bSame = vs.map((i) => val([], i, fin.h));
            const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
            let gain, se;
            if (errorRule === 'paired') { const d = v.map((x, i) => x - b[i]); gain = mean(d); se = sd(d) / Math.sqrt(d.length); }
            else { gain = mean(v) - mean(bSame); se = Math.sqrt(sd(v) ** 2 / v.length + sd(b) ** 2 / b.length); }
            const total = Object.values(spent).reduce((a, x) => a + x, 0);
            const vcp = vs.map((i) => cpOf(baseOps, i, fin.h)), bcp = fs.map((i) => cpOf([], i, fin.h)), bcpSame = vs.map((i) => cpOf([], i, fin.h));
            const shared = diffStat(vcp.map(lootOf), bcp.map(lootOf), bcpSame.map(lootOf)), n = setups0.length;
            if (goal === 'profit') ({ gain, se } = shared); // the party line is the shared loot gain on the fresh runs, like the rows' party figure
            const ownBy = Object.fromEntries(players.map((p) => [p, diffStat(vcp.map((cp) => suppliesOf(cp, p)), bcp.map((cp) => suppliesOf(cp, p)), bcpSame.map((cp) => suppliesOf(cp, p))).gain]));
            const own = goal === 'profit' ? { sharedGainPerUser: shared.gain / n, sharedSePerUser: shared.se / n, sharedSeSamePerUser: shared.seSame / n, ownSuppliesByPlayer: ownBy, paybackOwnByPlayer: Object.fromEntries(players.map((p) => [p, paybackOwnOf(spent[p] || 0, shared.gain / n, ownBy[p])])) } : {};
            const buyerByPlayer = goal === 'profit' ? Object.fromEntries(players.map((p) => { const b = buyerNet(vcp, bcp, p, n, errorRule, z, bcpSame); return [p, { gain: b.net, se: b.se, seSame: b.seSame, payback: spent[p] > 0 && b.net > 0 ? spent[p] / b.net : null }]; })) : undefined;
            result.confirmation = { seeds: { base: fs, result: vs }, gain, se, ...perUser(gain, se), accepted: gain > 0 && gain >= z * se, cost: total, runningSpend: { ...spent }, payback: goal === 'profit' && gain > 0 ? total / gain : null, ...own, ...(buyerByPlayer ? { buyerByPlayer } : {}), ops: baseOps };
        }
        return done(result);
    }

    // Per user: the party figure split equally over the party (the contract's gainPerUser / sePerUser).
    const perUser = (gain, se) => ({ gainPerUser: gain / setups0.length, sePerUser: se / setups0.length });
    function row(c) {
        const est = c.est, n = setups0.length;
        const split = goal === 'profit' && est.shared ? { sharedGainPerUser: est.shared.gain / n, sharedSePerUser: est.shared.se / n, sharedSeSamePerUser: est.shared.seSame / n, ownSuppliesPerDay: est.own.gain, ownSuppliesSe: est.own.se, paybackOwn: paybackOwnOf(c.cost.cost, est.shared.gain / n, est.own.gain) } : {};
        return { ...split, ...(c.timeOnly ? { timeOnly: true } : {}), id: c.id, player: c.player, ops: c.ops, desc: c.desc, ...perUser(c.est.gain, c.est.se), cost: c.cost.cost, ...(c.cost.costBound ? { costBound: c.cost.costBound } : {}), costPath: c.cost.path, note: c.cost.note || '', gain: c.est.gain, se: c.est.se, payback: c.est.payback, score: c.est.score, accepted: c.est.accepted, judged: c.est.judged ?? null, ...(c.est.net !== undefined ? { buyerNet: c.est.net, buyerNetSe: c.est.netSe, buyerNetSeSame: c.est.netSeSame } : {}), lastStage: c.est.stage, stageIndex: c.history?.length ?? 0, history: c.history?.map((h) => ({ stage: h.stage, gain: h.gain, se: h.se, seeds: h.seeds, baseSeeds: h.baseSeeds })) };
    }
    // "Each change alone": only a change with a reading from reading seeds (at least --reading-min of them, on the baseline the race ran from) is a
    // row, and its figures are the reading's (figure, error, buyer's gain, error, payback, accepted by the search's own rule); the others are counted
    // (notShown), never listed. Ordered by the one comparator (rankEst on the reading's own score, net and gain: a free change with a gain first).
    function singleRows(list, base, rest) {
        const picked = [];
        let notShown = 0;
        for (const c of list.filter((x) => x.est)) {
            const k = readCount(base, c, unitH);
            if (k < readMin || k < 2) { notShown++; continue; }
            const r = readingOf(base, c, k, unitH), plain = row(c);
            const cost = c.cost.cost, net = goal === 'profit' ? r.net : undefined;
            const score = goal === 'profit' ? scoreOf(net, cost, c.monotone) : cost <= 0 ? (r.gain > 0 ? Infinity : r.gain) : r.gain / cost;
            const split = net !== undefined && plain.sharedGainPerUser !== undefined ? { sharedGainPerUser: r.figure, sharedSePerUser: r.sePerUser, ownSuppliesPerDay: r.figure - r.net, paybackOwn: paybackOwnOf(cost, r.figure, r.figure - r.net) } : {};
            picked.push({ est: { score, net, gain: r.gain }, row: { ...plain, ...split, gain: r.gain, se: r.se, gainPerUser: r.figure, sePerUser: r.sePerUser, payback: r.payback ?? null, accepted: r.accepted && !c.est.judged, readingSeeds: k, ...(net !== undefined ? { buyerNet: r.net, buyerNetSe: r.netSe } : {}) } });
        }
        return { rows: [...picked.sort((a, b) => rankEst(a.est, b.est)).map((x) => x.row), ...rest], notShown };
    }
    // The report as it stands (his go 2026-11-11: the whole report unfolds live): one function builds it, the live snapshots and the final
    // result both come from it (the final result is the last snapshot plus the parts only the end has: the confirmation, the skills
    // report, the timing). A copy of the arrays the search still appends to; `timeOnly` is the search's own working list, never reported.
    function snapshot(result) {
        const { timeOnly, ...rest } = result;
        return { ...rest, steps: [...result.steps], notConfirmed: [...result.notConfirmed], overPayback: [...result.overPayback], skippedNoExport: skippedGroup() };
    }
    // Hands the snapshot to the sink (the Node shell sends it to the runner when there is an IPC channel).
    function publish(result) {
        outSink.partial(snapshot(result));
    }
    const fmt = (x) => (x == null ? '-' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.abs(x) >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : x.toFixed(1));
    const unit = () => (goal === 'exp' ? 'EXP/h' : 'coin/day ' + TAX_LABEL);

    function timing(result) {
        const runs = [...cache.values()];
        result.timing = { wallMinutes: (Date.now() - t0) / 60000, runsThisCall: wallLog.length, coreHoursThisCall: wallLog.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursThisCall: wallLog.reduce((a, r) => a + r.h, 0), coreHoursAllRuns: runs.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursAllRuns: runs.reduce((a, r) => a + r.hours, 0) };
        result.timing.secondsPerSimHour = result.timing.simHoursAllRuns ? result.timing.coreHoursAllRuns * 3600 / result.timing.simHoursAllRuns : null;
    }
    // The report at a stop is the leaders as they stand: the last round (result.round) and, when the first race has not ended, every
    // candidate's figure so far as the single changes.
    function stop(result) {
        if (lastRound) result.round = lastRound;
        if (liveCands && !result.singles.some((s) => !s.hiddenFood)) ({ rows: result.singles, notShown: result.singlesNotShown } = singleRows(liveCands, lastBase, result.singles));
        timing(result); result.incomplete = true; result.stoppedBy = stopSignal.requested ? 'stop request' : '--max-minutes';
        outSink.stopped(snapshot(result));
        report({ stage: 'stopped' });
        console.log(`stopped by ${result.stoppedBy}; rerun the same command to resume`);
        return { stopped: true }; // the shell exits with code 3
    }
    function done(result) {
        if (lastRound) result.round = lastRound;
        timing(result);
        let skillLines = [];
        if (levers.has('skills')) {
            const bk = keyOf([]);
            const baseCps = pick([], fin.h, fin.k * baseMult).map((s) => cache.get(bk + '#' + s)?.byHours[fin.h]).filter(Boolean);
            const sk = skillReport({ singles: result.singles, cands: result.timeOnly, setups: setups0, players, baseCps, names: setups0.map((s) => s.name), left: skillOpts.left, reqList: abilitySlotsLevelRequirementList, items: itemDetailMap, styles: combatStyleDetailMap, goal, fmt });
            result.skills = sk.json;
            skillLines = sk.lines;
        }
        const L = [`# What-if result`, '', `Run: \`node tools/whatif/optimize.mjs ${result.args}\``, '', `Goal: ${goal === 'exp' ? 'party EXP per hour' : 'party profit per day, ' + TAX_LABEL}. Budget per player: ${partyEntries(budgets).map(([p, b]) => `${p} ${fmt(b)}`).join(', ')} (${budgetSource}). Error rule: ${errorRule}, gain on the same seeds, accept at ${z} se. Rounds: ${firstK} seeds of ${unitH} h for every candidate, then ${roundSeeds} more per round for those not paused; ${leadersK} leaders per pool, paused below the leaders' lower bound at ${pauseMult} errors, ranges at ${(coverage * 100).toFixed(0)}% coverage. Costs ${TAX_LABEL} on every sale.`, ''];
        // The cost path as the report shows it: the note without the upper-bound caveat (the "≤" on the cost carries that).
        const pathMd = (s) => { const note = (s.note || '').replace('; upper bound (XP inside the level unknown)', ''); return s.costPath + (note ? ' (' + note + ')' : ''); };
        // A gain within one error of zero reads "no change" with the real value in brackets (a file has no hover); the error is in the same cell ("value ± se").
        const signed = (v) => (v > 0 ? '+' : '') + fmt(v);
        const gainMd = (v, se) => (Number.isFinite(v) && Number.isFinite(se) && Math.abs(v) < se ? `no change (${signed(v)} ± ${fmt(se)})` : `${fmt(v)} ± ${fmt(se)}`);
        const buyerMd = (s) => (Number.isFinite(s.buyerNet) ? gainMd(s.buyerNet, s.buyerNetSe) : '-');
        const NO_COST = 'N/A'; // a cost of exactly 0 has nothing to pay back (a cost above 0 with no gain keeps "-")
        const paybackMd = (s) => (s.paybackOwn !== undefined ? s.paybackOwn : s.payback)?.toFixed(1) ?? (s.cost === 0 ? NO_COST : '-');
        // Best foods and drinks: one line per player, items in slot order, a food's trigger in brackets; a player left unchanged says so.
        const bestKinds = [['foods', 'Best foods'], ['drinks', 'Best drinks']].filter(([k]) => Object.keys(result.best?.[k] || {}).length);
        if (bestKinds.length) {
            L.push('## Best foods and drinks', '');
            for (const [kind, label] of bestKinds) {
                L.push(`### ${label}${endedByUser[kind] ? ` (ended by you after round ${endedByUser[kind]})` : ''}`, '');
                for (const [p, e] of partyEntries(result.best[kind])) L.push(`- ${p}: ${e.items.map((x) => x.item.split('/').pop() + (x.trigger ? ` (${x.trigger})` : '')).join(', ') || 'none'}${e.unchanged ? ' (no change)' : Number.isFinite(e.buyerNet) ? ` (party gain ${fmt(e.gainPerUser)} ± ${fmt(e.sePerUser)}, buyer's gain ${fmt(e.buyerNet)} ± ${fmt(e.buyerNetSe)} per day${Number.isFinite(e.ownSuppliesPerDay) ? `; ${fmt(e.gainPerUser)} loot share ${e.ownSuppliesPerDay <= 0 ? `+ ${fmt(-e.ownSuppliesPerDay)} food and drink saved` : `- ${fmt(e.ownSuppliesPerDay)} more food and drink bought`}` : ''})` : ''}`);
                L.push('');
            }
            L.push('Everything below is measured on top of these foods and drinks.', '');
        }
        for (const [stage, n] of Object.entries(endedByUser)) if (stage !== 'foods' && stage !== 'drinks') L.push(`The ${stage} stage was ended by you after round ${n}.`, '');
        L.push('## Changes, in order', '','| # | Change | Party gain per user | Buyer\'s gain per day | Cost | Payback days | Running cost | Cost path |', '|---|---|---|---|---|---|---|---|');
        result.steps.forEach((s, i) => L.push(`| ${i + 1} | ${s.desc} | ${gainMd(s.gainPerUser, s.sePerUser)} | ${buyerMd(s)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${paybackMd(s)} | ${fmt(s.runningCost)} | ${pathMd(s)} |`));
        L.push('', "Party gain: the change in the group's shared loot per player per day, before anyone's food and drink. Buyer's gain: that player's share of it plus the change in what they spend on their own food and drink, so a free change can show no party gain and still pay the player by saving food and drink.");
        if (result.confirmation) {
            const c = result.confirmation;
            L.push('', `Confirmation on fresh seeds (base ${c.seeds.base[0]}..${c.seeds.base.at(-1)}, result ${c.seeds.result[0]}..${c.seeds.result.at(-1)}): party gain (the shared loot, before anyone's food and drink) ${Math.abs(c.gainPerUser) < c.sePerUser ? `no change (${signed(c.gainPerUser)} ± ${fmt(c.sePerUser)})` : `${fmt(c.gainPerUser)} ± ${fmt(c.sePerUser)}`} per user per day (${unit()}), cost ${fmt(c.cost)}${c.buyerByPlayer ? '' : c.payback == null && c.cost === 0 ? `, ${NO_COST}` : `, payback ${c.payback?.toFixed(1) ?? '-'} days`}.`);
            if (c.buyerByPlayer) { L.push(''); for (const [p, b] of partyEntries(c.buyerByPlayer)) L.push(`- ${p}: gain ${Math.abs(b.gain) < b.se ? `no change (${signed(b.gain)} ± ${fmt(b.se)})` : `${fmt(b.gain)} ± ${fmt(b.se)}`} per day (${Number.isFinite(c.sharedGainPerUser) && Number.isFinite(c.ownSuppliesByPlayer?.[p]) ? (c.ownSuppliesByPlayer[p] <= 0 ? `${fmt(c.sharedGainPerUser)} loot share + ${fmt(-c.ownSuppliesByPlayer[p])} food and drink saved` : `${fmt(c.sharedGainPerUser)} loot share - ${fmt(c.ownSuppliesByPlayer[p])} more food and drink bought`) : 'loot share and own food and drink'}), ${b.payback == null && c.runningSpend?.[p] === 0 ? NO_COST : `pays back in ${b.payback?.toFixed(1) ?? '-'} days`}`); }
        }
        L.push('', '## Ranked single changes (vs the original base, at the last stage each reached)', '', '| Change | Party gain per user | Buyer\'s gain per day | Cost | Payback days | Cost path |', '|---|---|---|---|---|---|');
        const rowMd = (s) => `| ${s.desc} | ${gainMd(s.gainPerUser, s.sePerUser)} | ${buyerMd(s)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${paybackMd(s)} | ${pathMd(s)} |`;
        for (const s of result.singles) if (!s.hiddenFood) L.push(rowMd(s));
        L.push(...skillLines);
        if (result.overBudget.length) { L.push('', '## Priced, over budget, not ranked', ''); for (const a of result.overBudget) L.push(`- ${a.player}, ${a.desc}: ${a.costBound === 'upper' ? '≤ ' : ''}${fmt(a.cost)}`); }
        if (result.apart.length) { L.push('', '## Unknown cost, not ranked', ''); for (const a of result.apart) L.push(`- ${a.desc}: ${a.note}`); }
        const t = result.timing;
        L.push('', `Timing: ${t.wallMinutes.toFixed(1)} min wall this call, ${t.coreHoursAllRuns.toFixed(2)} core-hours over all cached runs (${t.simHoursAllRuns} sim h, ${t.secondsPerSimHour?.toFixed(2)} s per sim hour).`);
        const where = outSink.final(snapshot(result), L.join('\n') + '\n'); // result.json and result.md
        report({ stage: 'done', candidatesLeft: 0 });
        console.log(`done: ${nOf(result.steps.length, 'step')}; ${where}`);
        return { stopped: false };
    }

    return await search();
}
