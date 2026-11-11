// What-if optimizer core, phase 1 (docs/proposals/what-if.md 3.2-3.4, 3.6 item 1): equipment levers, priced from
// per-level market entries and the Mirror path after 4% market tax (prices.mjs), searched by a screen of every
// single change, successive halving and greedy stacking, with one fresh-seed confirmation at the end.
//
// Usage: node tools/whatif/optimize.mjs --out <dir> [options]
//   --players Ramlock            whose equipment is open (comma list); each change is costed to its player
//   --levers equip               comma list of equip (phase 1: +N and market swaps), consumables (the foods and the drinks
//                                are decided FIRST, each as whole fillings of every open slot: Stage F picks each player's
//                                best food filling, Stage D his best drink filling (drinkfill.mjs, pruned by his rules); the
//                                two become the baseline every other change is measured on; result.best says what they are;
//                                without it there is no Stage F or D and the current foods and drinks are the baseline),
//                                pairs (kept for old command lines: it produces nothing now, drinks are fillings),
//                                triggers (each numeric term over its grid, structure changes; design 3.5),
//                                owned (items in the exporter's
//                                inventory), abilities (learned, at their learned level), order (ability order),
//                                skills (each trained combat skill +1..+skill-up; days to reach, never stacked),
//                                houses, abilitylevels, books (phase 3, tools/whatif/levers/houses.mjs; its flags
//                                --house-rooms, --house-up, --ability-steps, --book-levels; a cost that is only an
//                                upper bound carries costBound: 'upper' in its row and prints as "≤"); all
//   --skill-up 2  --skill-left P1:stamina=300.5K,magic=1.2M;P2:...   experience left to the next level (levers/skills.mjs)
//   --charms                     keep charm candidates on a profit goal (left out by default: they change only EXP)
//   --goal profit|exp            party profit per day after tax, or party EXP per hour (1.8)
//   --budget <coin> | --export <exporter JSON>   budget: typed, else `coin` of the exporter JSON (3.1); every
//                                player's budget unless --budgets names that player
//   --budgets A=1.5M,B=200K      a budget per player (budgets.mjs): each change is paid from its own player's coin,
//                                each step records every player's running spend (result.json steps[].runningSpend)
//   --low-priority               run this process and every run process at the lowest priority (Windows: idle class)
//   --stages 4x50,4x150,8x300    seeds x sim hours per stage: screen, halvings; the last is the finalist stage
//   --keep 40,10                 candidates kept after each stage but the last. In the rest of the search the cut keeps this many free
//                                (cost 0) AND this many paid candidates and the pool is their union (390 free tweaks would
//                                otherwise take every place); in Stage F and Stage D it is kept per player
//   --error unpaired|paired      default unpaired (design revision 6). paired: se of per-seed differences, base on the variant's seed count (3.3 up to
//                                revision 5); unpaired: sqrt(sv^2/kv + sb^2/kb) with the base on --base-mult x seeds, each new
//                                run on the next seed its setup never ran (delta 4, with his point of 23:14 BRT); the unpaired
//                                GAIN is the variant against the base on the variant's own seeds (his pick "Compare on the same seeds")
//   --base-mult <n>              base seeds per variant seed (they feed the error); default 1 when paired, 4 when unpaired
//   --z 2                        profit goal: the party's shared loot gain or the buyer's net is above 0 by z errors, and the other is not below -(z/2) errors (acceptBoth)
//   --max-up 3                   enhance levers +1..+max-up per slot
//   --swaps / --no-swaps         market swaps of each slot's item (same equipment type, level requirement met)
//   --swap-levels 0,same         levels a swapped-in item is bought at ("same" = the current item's level)
//   --sell-down                  also keep swaps that free gold (dropped by default, design 4.3 item 2)
//   --slots ring,neck            restrict the open slots
//   --only-candidates a,b        restrict to these candidate ids (a pilot)
//   --max-steps 20  --jobs <n>  --max-minutes <n> (stop issuing runs after n minutes; rerun resumes)
//   --confirm-seed-offset 10000  --setups <dir>  --prices <marketplace.json>
//   --cache-from <runs.jsonl,...> earlier searches' run caches, read only (runs are keyed by setup, so any match counts)
//   Triggers (design 3.5): --probe 1x50 (base seeds x sim hours the counter records; kept in <out>/probe.json)
//   --trigger-owners toxic_pollen,star_fruit_gummy   search only these owners' triggers (hrid or its last part;
//                                the last part avoids Git Bash rewriting a leading /)   --trigger-fixed <owners>  skip these
//   --trigger-cands <json>       the user's own candidates, { "<player>": { "<owner hrid>": [[terms], ...] } };
//                                they replace the generated ones for that owner
//   --comdrop 20 --comexp 20 --tier 4 --zone /actions/combat/infernal_abyss
// Every run is cached in <out>/runs.jsonl by (resulting setups, options, seed); a rerun with the same args
// resumes. Results: <out>/result.json and <out>/result.md. Exit code 3 = stopped (by --max-minutes or a stop
// request), rerun. Progress goes to <out>/progress.json and, when started with an IPC channel (the runner,
// tools/whatif/runner/), as { type: 'progress', progress } messages; the message 'stop' ends the search cleanly: no
// new runs, the runs in flight are dropped, runs.jsonl keeps every finished run, and the same command resumes.
// Every run process takes this process's priority.
import { fork } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { readParty, applyOps } from './variants.mjs';
import { loadMarket, makePricer, TAX_LABEL } from './prices.mjs';
import { DEFAULT_PRICES, buildDtos, root, measureNeed } from './engine.mjs';
import { consumableType } from './consumables.mjs';
import { foodFillCands } from './foodfill.mjs';
import { drinkFillCands } from './drinkfill.mjs';
import { cutPool, bestPerPlayer, dropChainStates } from './pools.mjs';
import { installProbe, summarize, mergeProbes, triggerCands, localCands, effectiveTriggers, triggerText, joinTriggerDesc } from './triggers.mjs';
import { runParty } from './engine.mjs';
import { skillCands, skillReport, parseSkillLeft } from './levers/skills.mjs';
import { upgradeCands, LEVER_NAMES as UPGRADE_LEVERS } from './levers/houses.mjs'; // houses, abilitylevels, books (phase 3)
import { parseBudgetList, resolveBudgets, zeroSpend, affordable, pay } from './budgets.mjs';
import { isDominatedSwap } from './dominated.mjs';
import { createParts } from './progress.mjs';
import { lootOf, suppliesOf, diffStat as diffStatBy, buyerNet, acceptBoth, scoreOf, rankEst, rankAcceptedFirst } from './buyer.mjs';
const { default: Trigger } = await import(new URL('../../src/combatsimulator/trigger.js', import.meta.url));

const json = async (f) => (await import(new URL('../../src/combatsimulator/data/' + f, import.meta.url), { with: { type: 'json' } })).default;
const itemDetailMap = await json('itemDetailMap.json');
const abilityDetailMap = await json('abilityDetailMap.json');
const abilitySlotsLevelRequirementList = await json('abilitySlotsLevelRequirementList.json');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return process.argv.includes('--no-' + name) ? false : def;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const list = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);

const OUT = arg('out');
if (!OUT) throw new Error('--out required');
mkdirSync(OUT, { recursive: true });
const goal = arg('goal', 'profit');
const errorRule = arg('error', 'unpaired'); // design revision 6 (main c2ed824), his pick 23:27 BRT
const baseMult = Number(arg('base-mult', errorRule === 'unpaired' ? 4 : 1));
const z = Number(arg('z', 2));
const stages = String(arg('stages', '4x50,4x150,8x300')).split(',').map((s) => { const [k, h] = s.split('x').map(Number); return { k, h }; });
const keep = list(arg('keep', '40,10')).map(Number);
if (errorRule === 'unpaired' && stages.some((s) => s.k < 4)) throw new Error('unpaired rule: at least 4 runs per variant at every stage (design 3.3)');
const players = list(arg('players', 'Ramlock'));
const maxUp = Number(arg('max-up', 3));
const swapsOn = arg('swaps', true) !== false;
const swapLevels = list(arg('swap-levels', '0,same'));
const onlySlots = list(arg('slots', null));
const sellDown = arg('sell-down', false) === true;
const onlyCands = list(arg('only-candidates', null));
const maxSteps = Number(arg('max-steps', 20));
const jobs = Number(arg('jobs', os.availableParallelism()));
const maxMinutes = Number(arg('max-minutes', Infinity));
const confirmOffset = Number(arg('confirm-seed-offset', 10000));
const setupsDir = arg('setups', undefined);
const pricesFile = arg('prices', DEFAULT_PRICES);
const options = { comdrop: Number(arg('comdrop', 20)), comexp: Number(arg('comexp', 20)), tier: Number(arg('tier', 4)), zone: arg('zone', '/actions/combat/infernal_abyss'), prices: pricesFile };
const LEVERS = ['equip', 'consumables', 'pairs', 'owned', 'abilities', 'order', 'triggers', 'skills', ...UPGRADE_LEVERS];
const combatStyleDetailMap = await json('combatStyleDetailMap.json');
const skillOpts = { maxUp: Number(arg('skill-up', 2)), left: parseSkillLeft(arg('skill-left', null)), items: itemDetailMap, styles: combatStyleDetailMap };
const levers = new Set(String(arg('levers', 'equip')).split(',').flatMap((x) => (x === 'all' ? LEVERS : [x.trim()])));
for (const l of levers) if (!LEVERS.includes(l)) throw new Error('unknown lever ' + l + '; levers: ' + LEVERS.join(','));
// --export: the old single character export (an object with its `name`), or a map { "<player name>": <that player's export> }.
// Levers that need a player's export never block a search: that player is skipped by the lever (result.skippedNoExport).
const exportData = arg('export', null) ? JSON.parse(readFileSync(arg('export'), 'utf8')) : null;
const exportMap = exportData && typeof exportData.name !== 'string' ? exportData : null;
let budget = null, budgetSource;
const budgetList = parseBudgetList(arg('budgets', null) === true ? null : arg('budgets', null));
if (arg('budget', null) !== null) { budget = Number(arg('budget')); budgetSource = 'typed'; }
else if (exportData && !exportMap) { budget = exportData.coin; budgetSource = 'exporter coin'; if (!(budget >= 0)) throw new Error('exporter JSON has no coin'); }
else if (Object.keys(budgetList).length) budgetSource = 'per player';
else throw new Error('--budget, --budgets or --export required');
if (Object.keys(budgetList).length && budget != null) budgetSource = `per player, else ${budgetSource}`;
const budgets = resolveBudgets(players, budgetList, budget ?? NaN);
if (arg('low-priority', false) === true) os.setPriority(os.constants.priority.PRIORITY_LOW);

const [probeK, probeH] = String(arg('probe', '1x50')).split('x').map(Number);
const trigOpts = { owners: list(arg('trigger-owners', null)), fixed: list(arg('trigger-fixed', null)) };
const userTrig = arg('trigger-cands', null) ? JSON.parse(readFileSync(arg('trigger-cands'), 'utf8')) : {};
let probeStore = null; // set by probeBase() before candidates are built
let needStore = null; // set by needBase() before candidates are built: the party's food need per player (foodfill.mjs)
const metric = (cp) => (goal === 'exp' ? cp.party.expPerHour : cp.party.profitAfterTaxPerDay);
const setups0 = readParty(setupsDir);
const pricer = makePricer(loadMarket(pricesFile));
const t0 = Date.now();

// ---- Run cache and pool ----
const CACHE = path.join(OUT, 'runs.jsonl');
const seedIndex = new Map(); // key -> Set of seeds run for that setup
const cache = new Map(); // key#seed -> { wallSeconds, hours, byHours: {h: metricsCheckpoint} }
// --cache-from a.jsonl,b.jsonl: earlier runs.jsonl files read as well (never written), so a new search reuses
// another search's runs of the same setups without copying them.
for (const f of [...(list(arg('cache-from', null)) || []), CACHE]) if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) put(JSON.parse(l));
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
const keyOptions = { ...options, prices: path.relative(root, path.resolve(options.prices)).split(path.sep).join('/') };
// The snapshot's own time (marketplace.json timestamp, seconds) and where it came from, for result.json (not in the key).
// "committed": a file of tools/calibration (the repo's saved snapshot); "snapshot": any other file, such as the one the
// runner saves from the window's request.
const pricesStamp = JSON.parse(readFileSync(pricesFile, 'utf8')).timestamp;
const pricesMeta = { pricesTimestamp: Number.isFinite(pricesStamp) ? pricesStamp : null, pricesSource: keyOptions.prices.startsWith('tools/calibration/') ? 'committed' : 'snapshot' };
const keyOf = (ops) => createHash('sha1').update(JSON.stringify({ s: applyOps(setups0, ops), o: keyOptions })).digest('hex').slice(0, 16);
const allHours = [...new Set(stages.map((s) => s.h))].sort((a, b) => a - b);
let stoppedByTime = false, stopRequested = false;
const wallLog = []; // per run actually made in this invocation
const live = new Set(); // run processes in flight, killed by a stop request
process.on('message', (m) => { if (m === 'stop') { stopRequested = true; for (const c of live) c.kill(); } });

// ---- Progress (delivery design section 3): the stage, candidates left, runs of the current batch, seconds per run
// measured, and the batch's time left from the measured core-seconds per sim hour. The batch is one stage (the
// screen, a halving, a greedy step, the confirmation); later stages are not in etaSeconds (etaScope: 'stage').
const progress = { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0, secondsPerRun: null, etaSeconds: null, etaScope: 'stage', elapsedSeconds: 0 };
let batch = { hoursLeft: 0, wall: 0, done: 0 };
let partsTracker = null; // stacked parts (progress.mjs), created once the candidates are known
function report(patch = {}) {
    Object.assign(progress, patch);
    const wall = wallLog.reduce((a, r) => a + r.wallSeconds, 0), hours = wallLog.reduce((a, r) => a + r.h, 0);
    const left = progress.runsPlanned - progress.runsDone;
    progress.secondsPerRun = batch.done ? batch.wall / batch.done : wallLog.length ? wall / wallLog.length : null;
    progress.etaSeconds = left <= 0 ? 0 : hours ? Math.round((wall / hours) * batch.hoursLeft / Math.min(jobs, left)) : null;
    progress.elapsedSeconds = Math.round((Date.now() - t0) / 1000);
    if (partsTracker) progress.parts = partsTracker.sync(progress);
    writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify(progress));
    if (process.connected) process.send({ type: 'progress', progress });
}

async function ensure(reqs) { // reqs: [{ops, seed, h, tag}]
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
    if (stopRequested) { stoppedByTime = true; return false; }
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${tasks.length} runs, ${tasks.reduce((a, t) => a + t.h, 0)} sim h`);
    let next = 0;
    const self = fileURLToPath(new URL('./batch.mjs', import.meta.url));
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
        const c = fork(self, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        try { os.setPriority(c.pid, os.getPriority()); } catch { /* the child exited already */ }
        live.add(c);
        const feed = () => {
            if (next < tasks.length && !stopRequested && (Date.now() - t0) / 60000 < maxMinutes) c.send(tasks[next++]);
            else { if (next < tasks.length || stopRequested) stoppedByTime = true; c.send('exit'); }
        };
        c.on('message', (res) => {
            const t = tasks.find((x) => x.variant === res.variant && x.seed === res.seed);
            const rec = { key: res.variant, seed: res.seed, hours: t.h, tag: t.tag, wallSeconds: res.wallSeconds, checkpoints: res.checkpoints };
            appendFileSync(CACHE, JSON.stringify(rec) + '\n');
            put(rec);
            wallLog.push({ tag: t.tag, h: t.h, wallSeconds: res.wallSeconds });
            batch.hoursLeft -= t.h; batch.wall += res.wallSeconds; batch.done++;
            report({ runsDone: progress.runsDone + 1 });
            feed();
        });
        c.on('exit', (code) => { live.delete(c); if (code === 0 || stopRequested) resolve(); else reject(new Error('child exited ' + code)); });
        feed();
    })));
    return !stoppedByTime && !stopRequested; // a stop kills runs in flight, so this batch is incomplete
}
const val = (ops, seed, h) => metric(cache.get(keyOf(ops) + '#' + seed).byHours[h]);
// The parts of a checkpoint (no new run, same cache); the readers and the buyer's net are in buyer.mjs.
const cpOf = (ops, seed, h) => cache.get(keyOf(ops) + '#' + seed).byHours[h];
// The change (variant minus base) and its error, by the same rule as the search's gain. `same`: the base's values on the
// variant's own seeds, the gain's base (the error keeps `bs`, all the base's seeds).
const diffStat = (vs, bs, same) => diffStatBy(vs, bs, errorRule, same);
// The buyer's own payback in days: the price over (his share of the loot gain per user minus the change in his own supplies
// spend); null unless that net and the price are above 0.
const paybackOwnOf = (cost, sharedPerUser, supplies) => { const net = sharedPerUser - supplies; return goal === 'profit' && cost > 0 && net > 0 ? cost / net : null; };
const seedsFor = (k, off = 0) => Array.from({ length: k }, (_, i) => off + i + 1);
// Seeds of k samples of a setup at h hours. Paired: the fixed list 1..k (approved 3.3). Unpaired (delta 4, his point
// 23:14 BRT): any k runs of that setup that reach h, the lowest seeds first, and for the rest the next seeds that
// setup never ran (a counter), so no run is duplicated. Search seeds stay below --confirm-seed-offset; the final
// confirmation's "fresh" seeds are above it. Every run's seed is recorded in runs.jsonl.
function pick(ops, h, k, fresh = false) {
    const lo = fresh ? confirmOffset : 0;
    if (errorRule === 'paired') return seedsFor(k, lo);
    const key = keyOf(ops), hi = fresh ? Infinity : confirmOffset;
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

// ---- Candidates ----
const COMBAT_SLOTS = ['head', 'body', 'legs', 'feet', 'hands', 'main_hand', 'two_hand', 'off_hand', 'pouch', 'back', 'neck', 'earrings', 'ring', 'trinket', 'charm'];
const slotItem = (setups, p, slot) => setups.find((s) => s.name === p).player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + slot);
const meetsReq = (setup, item) => (item.equipmentDetail.levelRequirements || []).every((r) => (setup.player[r.skillHrid.split('/').pop() + 'Level'] ?? 0) >= r.level);
// Market swaps no better on any combat stat (dominated.mjs): never offered, listed in result.json `dominated`.
const dominated = [], dominatedKeys = new Set();

// Charms change only EXP, so a profit goal leaves them out (phase 1 measured exactly zero for every charm, docs
// what-if/phase-1.md in the private repo); --charms keeps them. An EXP goal keeps them.
const charmsOn = goal === 'exp' || arg('charms', false) === true;
// Each candidate names the groups it changes (`<player>:<slot>`, `:food<i>`, `:drink<i>`, `:ability<i>`); after a
// greedy step, candidates touching the accepted change's groups are rebuilt from the new setup.
function candidatesFor(setups, p, slots) {
    const s = setups.find((x) => x.name === p), out = [];
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
const market = loadMarket(pricesFile);
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
    const file = path.join(OUT, 'need.json'), key = keyOf([]);
    if (existsSync(file)) { const n = JSON.parse(readFileSync(file, 'utf8')); if (n.key === key && n.hours === NEED_HOURS && JSON.stringify(n.seeds) === JSON.stringify(NEED_SEEDS)) return n; }
    const t1 = Date.now(), m = await measureNeed({ ...options, setups: setups0, seeds: NEED_SEEDS, hours: NEED_HOURS });
    console.log(`need: ${NEED_SEEDS.length} seeds x ${NEED_HOURS} h, ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    const n = { key, ...m };
    writeFileSync(file, JSON.stringify(n));
    return n;
}
// Swaps to an item in the exporter's inventory: no gold cost; selling it instead is its only price (after tax).
function ownedCands(setups, p, slots) {
    const ex = exportFor(p);
    if (!ex) return [];
    const s = setups.find((x) => x.name === p), out = [], seen = new Set();
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
        const sale = pricer.sell(inv.itemHrid, L);
        const note = sale.noBuyer ? 'owned; no buyer' : `owned; selling it instead: ${fmt(sale.value)} ${TAX_LABEL}`;
        const ops = twoHand ? [{ op: 'unequip', player: p, slot: 'main_hand' }, { op: 'unequip', player: p, slot: 'off_hand' }, { op: 'equip', player: p, slot: 'two_hand', item: inv.itemHrid, level: L }]
            : [{ op: 'equip', player: p, slot, item: inv.itemHrid, level: L }];
        const groups = twoHand ? [`${p}:main_hand`, `${p}:off_hand`, `${p}:two_hand`] : [`${p}:${slot}`];
        out.push({ id: `${p}:${slot}=own:${short(inv.itemHrid)}+${L}`, kind: 'owned', groups, player: p, slot, monotone: false, desc: `${p} ${slot} ${it ? short(it.itemHrid) + ' +' + it.enhancementLevel : 'empty'} -> owned ${short(inv.itemHrid)} +${L}`, ops, cost: FREE('owned', note) });
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
    const file = path.join(OUT, 'probe.json'), key = keyOf(baseOps), setupsB = applyOps(setups0, baseOps);
    if (existsSync(file)) { const p = JSON.parse(readFileSync(file, 'utf8')); if (p.key === key && p.k === probeK && p.h === probeH) return p.store; }
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
    writeFileSync(file, JSON.stringify({ key, k: probeK, h: probeH, store }));
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

// ---- Stages ----
// Screen and halvings of one pool of candidates against `base` (ops of the baseline so far): each stage runs the base and the
// pool at that stage's seeds and hours, estimates, sorts accepted rows first and cuts. `label` names the stage for the progress
// (null: screen / halving n). Returns the pool after the last stage, sorted, or null when the time limit stopped it.
async function halve(cands, base, label, byPlayer) {
    let pool = cands;
    // The base runs alongside the screen, so the cores are not idle while it runs.
    const baseReq = stages.flatMap((st) => req(base, st.h, st.k * baseMult, 'base'));
    for (let si = 0; si < stages.length; si++) {
        const st = stages[si];
        report({ stage: label ?? (si === 0 ? 'screen' : `halving ${si}`), candidatesLeft: pool.length });
        if (!await ensure([...(si === 0 ? baseReq : []), ...pool.flatMap((c) => reqPair(base, [...base, ...c.ops], st.h, st.k, 'variant'))])) return null;
        for (const c of pool) { c.est = estimate(base, c, st, st.k * baseMult); (c.history ||= []).push(c.est); }
        pool.sort(rankFirst); // accepted rows first, so the cut to the next stage keeps the ones that can be taken
        if (si < stages.length - 1) pool = cutPool(pool, keep[si] ?? pool.length, byPlayer);
    }
    return pool;
}
// One player's entry of result.best: his items in slot order after the stage (a food with the readable text of its trigger, null
// when it always fires), with the chosen filling's figures at its last stage; no figures and unchanged: true without one.
function bestEntry(kind, setup, chosen) {
    const slots = (setup[kind === 'foods' ? 'food' : 'drinks']?.['/action_types/combat'] || []).map((x) => x?.itemHrid).filter(Boolean);
    const items = slots.map((item) => (kind === 'foods' ? { item, trigger: triggerText(effectiveTriggers(setup, item)) } : { item }));
    if (!chosen) return { items, unchanged: true };
    const e = chosen.est, n = setups0.length;
    return { items, gain: e.gain, se: e.se, gainPerUser: e.gain / n, sePerUser: e.se / n, ...(e.net !== undefined ? { buyerNet: e.net, buyerNetSe: e.netSe } : {}), stage: e.stage };
}

// ---- Search ----
async function main() {
    const result = { args: process.argv.slice(2).join(' '), goal, errorRule, baseMult, z, stages: stages.map((s) => `${s.k}x${s.h}`), keep, budget, budgets, budgetSource, taxLabel: TAX_LABEL, players, partySize: setups0.length, options: { ...keyOptions, ...pricesMeta, levers: [...levers] }, setups: setups0, steps: [], singles: [], apart: [], overBudget: [], dominated, skippedNoExport: [] };
    const fin = stages[stages.length - 1];
    let baseOps = [], spent = zeroSpend(budgets);
    const fillings = levers.has('consumables');
    partsTracker = createParts({ stages, keep, candidates: null, maxSteps, fillings });
    result.best = { foods: {}, drinks: {} };
    result.baselineOps = [];
    if (fillings) {
        report({ stage: 'need' }); needStore = await needBase();
        // STAGE F, then STAGE D: the foods and the drinks are decided first, whole fillings of every open slot, each against the
        // baseline so far; all players' choices together are the baseline the rest of the search is measured on.
        for (const kind of ['foods', 'drinks']) {
            const setupsNow = applyOps(setups0, baseOps);
            const fc = players.flatMap((p) => (kind === 'foods' ? foodStageCands(setupsNow, p) : drinkStageCands(setupsNow, p)));
            const fpool = await halve(fc, baseOps, kind, true);
            if (!fpool) return stop(result);
            const chosen = bestPerPlayer(fpool, players); // fpool is in rankAcceptedFirst order
            for (const p of players) if (chosen[p]) baseOps = [...baseOps, ...chosen[p].ops];
            const after = applyOps(setups0, baseOps);
            for (const p of players) result.best[kind][p] = bestEntry(kind, after.find((s) => s.name === p), chosen[p]);
            const flag = kind === 'foods' ? 'food' : 'drink';
            result.singles.push(...fc.map((c) => ({ ...row(c), stage: flag, hiddenFood: true })));
            console.log(`${kind}: ${players.map((p) => `${p} ${chosen[p] ? chosen[p].desc.slice(p.length + 1) : 'unchanged'}`).join('; ')}`);
        }
        result.baselineOps = baseOps;
        result.drinkPruning = drinkStats;
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
    console.log(`${cands.length} candidates within budget, ${result.overBudget.length} priced over budget and ${result.apart.length} with unknown cost listed apart; ${dominated.length} swaps skipped (no better on any stat)`);

    // The rest of the search runs on the baseline (baseOps: the chosen foods and drinks): screen, then halvings, with the free
    // and the paid candidates kept as two pools at each cut.
    partsTracker.setCandidates(cands.length);
    const pool = await halve(cands, baseOps, null, false);
    if (!pool) return stop(result);
    // The original base (no food or drink change), per user, in the goal's unit: the mean over the base seeds of the last stage.
    // The rows below are measured against the baseline, this figure stays the original base.
    if (!await ensure(req([], fin.h, fin.k * baseMult, 'base'))) return stop(result);
    { const bs = pick([], fin.h, fin.k * baseMult); result.basePerUser = bs.reduce((a, i) => a + val([], i, fin.h), 0) / bs.length / setups0.length; }
    result.singles = [...cands.map((c) => row(c)).sort((a, b) => (a.lastStage === b.lastStage ? (b.score - a.score) : (b.stageIndex - a.stageIndex))), ...result.singles];

    // Greedy stacking on the finalists.
    let finalists = pool.filter((c) => !c.timeOnly); // time-only levers (skill levels) are shown, never bought
    result.timeOnly = cands.filter((c) => c.timeOnly);
    logCandidates(1, finalists);
    // The chain guard (pools.mjs dropChainStates): no candidate may lead back to a state the search has already been in.
    const chain = new Set([keyOf([]), keyOf(baseOps)]);
    const guard = (list) => { const { kept, dropped } = dropChainStates(list, baseOps, keyOf, chain); if (dropped.length) console.log(`  ${dropped.length} candidate(s) lead back to a state already in the chain, dropped: ${dropped.map((c) => c.id).join(', ')}`); return kept; };
    for (let step = 0; step < maxSteps; step++) {
        const ok = finalists.filter((c) => c.est.accepted && affordable(c, budgets, spent)).sort(rank); // paid from its own player's coin left
        if (!ok.length) break;
        const best = ok[0];
        spent = pay(spent, best);
        baseOps = [...baseOps, ...best.ops];
        chain.add(keyOf(baseOps));
        result.steps.push({ ...row(best), kind: best.kind, owner: best.owner, runningCost: Object.values(spent).reduce((a, x) => a + x, 0), runningSpend: { ...spent } });
        console.log(`step ${step + 1}: ${best.desc}, gain ${fmt(best.est.gain)} ± ${fmt(best.est.se)}, cost ${fmt(best.cost.cost)}`);
        // The accepted variant's runs are the new base; seeds it lacks for the base count are run now.
        const newBase = req(baseOps, fin.h, fin.k * baseMult, 'base');
        // Re-screen the survivors on the new base, rebuilt from the new setup (a survivor whose change no longer
        // applies drops out). The accepted change's equipment slots get fresh candidates from the new item, as in
        // phase 1; the other groups it touched keep only their survivors, so a loadout step does not re-add dozens.
        const setupsNow = applyOps(setups0, baseOps), touched = new Set(best.groups);
        const survivors = new Set(finalists.filter((c) => c !== best).map((c) => c.id));
        finalists = players.flatMap((p) => allCandidates(setupsNow, p)).filter((c) => c.cost.known && affordable(c, budgets, spent) && (
            c.groups.some((g) => touched.has(g)) && c.kind === 'equip' && (best.kind === 'equip' || best.kind === 'owned')
                ? (c.monotone || !onlyCands || onlyCands.includes(c.id))
                : c.groups.some((g) => touched.has(g)) && (c.kind === 'trigger' || c.kind === 'food-fill') ? false // stale: built on the owner's old list / old foods
                    : (survivors.has(c.id) && c.id !== best.id)));
        // Coordinate-wise rounds (3.5 item 3): the changed owner's terms get local candidates around the new values.
        if (best.kind === 'trigger') finalists.push(...localCands(setupsNow.find((x) => x.name === best.player), best.player, probeStore, best.owner));
        finalists = guard(finalists);
        report({ stage: `greedy step ${step + 1}`, candidatesLeft: finalists.length });
        if (!await ensure([...newBase, ...finalists.flatMap((c) => reqPair(baseOps, [...baseOps, ...c.ops], fin.h, fin.k, 'variant'))])) return stop(result);
        for (const c of finalists) c.est = estimate(baseOps, c, fin, fin.k * baseMult);
        logCandidates(step + 2, finalists);
    }

    // One trigger, one step: when the greedy rounds moved one owner's trigger more than once (200 -> 4600, later 4600 -> 3000), the
    // chosen changes show one step for it, 200 -> 3000, at the first one's place, measured as that one step (the end state is the
    // same: a trigger op carries the owner's whole list). Its figures are measured here, on the state just before that place.
    {
        const merged = await mergeTriggerSteps(result, fin);
        if (merged === null) return stop(result);
        if (merged) baseOps = [...result.baselineOps, ...result.steps.flatMap((s) => s.ops)];
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
// Merges the steps that moved the same owner's trigger (see main). Returns true when it merged, false when there was nothing to
// merge, null when the time limit stopped the measuring.
async function mergeTriggerSteps(result, fin) {
    const steps = result.steps, drop = new Set();
    for (let i = 0; i < steps.length; i++) {
        if (drop.has(i) || steps[i].kind !== 'trigger') continue;
        const later = steps.map((s, j) => (j > i && s.kind === 'trigger' && s.player === steps[i].player && s.owner === steps[i].owner ? j : -1)).filter((j) => j >= 0);
        if (!later.length) continue;
        const last = steps[later.at(-1)];
        const prefix = [...result.baselineOps, ...steps.slice(0, i).filter((_, j) => !drop.has(j)).flatMap((s) => s.ops)];
        const cand = { id: last.id, kind: 'trigger', owner: last.owner, player: last.player, monotone: false, desc: later.reduce((d, j) => joinTriggerDesc(d, steps[j].desc), steps[i].desc), ops: last.ops, cost: { cost: 0, known: true, path: last.costPath, note: '' } };
        if (!await ensure([...req(prefix, fin.h, fin.k * baseMult, 'base'), ...reqPair(prefix, [...prefix, ...cand.ops], fin.h, fin.k, 'variant')])) return null;
        cand.est = estimate(prefix, cand, fin, fin.k * baseMult);
        steps[i] = { ...row(cand), kind: 'trigger', owner: last.owner, runningCost: steps[i].runningCost, runningSpend: steps[i].runningSpend };
        for (const j of later) drop.add(j);
        console.log(`merged ${later.length + 1} trigger steps of ${last.owner.split('/').pop()} into one: ${cand.desc}, gain ${fmt(cand.est.gain)} ± ${fmt(cand.est.se)}`);
    }
    if (!drop.size) return false;
    result.steps = steps.filter((_, j) => !drop.has(j));
    return true;
}
const fmt = (x) => (x == null ? '-' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.abs(x) >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : x.toFixed(1));
const unit = () => (goal === 'exp' ? 'EXP/h' : 'coin/day ' + TAX_LABEL);

function timing(result) {
    const runs = [...cache.values()];
    result.timing = { wallMinutes: (Date.now() - t0) / 60000, runsThisCall: wallLog.length, coreHoursThisCall: wallLog.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursThisCall: wallLog.reduce((a, r) => a + r.h, 0), coreHoursAllRuns: runs.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursAllRuns: runs.reduce((a, r) => a + r.hours, 0) };
    result.timing.secondsPerSimHour = result.timing.simHoursAllRuns ? result.timing.coreHoursAllRuns * 3600 / result.timing.simHoursAllRuns : null;
}
function stop(result) {
    timing(result); result.incomplete = true; result.stoppedBy = stopRequested ? 'stop request' : '--max-minutes';
    result.skippedNoExport = skippedGroup();
    writeFileSync(path.join(OUT, 'partial.json'), JSON.stringify(result, null, 1));
    report({ stage: 'stopped' });
    console.log(`stopped by ${result.stoppedBy}; rerun the same command to resume`);
    process.exit(3);
}
function done(result) {
    timing(result);
    let skillLines = [];
    if (levers.has('skills')) {
        const fin = stages.at(-1), bk = keyOf([]);
        const baseCps = pick([], fin.h, fin.k * baseMult).map((s) => cache.get(bk + '#' + s)?.byHours[fin.h]).filter(Boolean);
        const sk = skillReport({ singles: result.singles, cands: result.timeOnly, setups: setups0, players, baseCps, names: setups0.map((s) => s.name), left: skillOpts.left, reqList: abilitySlotsLevelRequirementList, items: itemDetailMap, styles: combatStyleDetailMap, goal, fmt });
        result.skills = sk.json;
        skillLines = sk.lines;
    }
    delete result.timeOnly;
    result.skippedNoExport = skippedGroup();
    writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
    const L = [`# What-if result`, '', `Run: \`node tools/whatif/optimize.mjs ${result.args}\``, '', `Goal: ${goal === 'exp' ? 'party EXP per hour' : 'party profit per day, ' + TAX_LABEL}. Budget per player: ${Object.entries(budgets).map(([p, b]) => `${p} ${fmt(b)}`).join(', ')} (${budgetSource}). Error rule: ${errorRule}, gain on the same seeds, accept at ${z} se. Stages ${result.stages.join(', ')}, keep ${keep.join(', ')}. Costs ${TAX_LABEL} on every sale.`, ''];
    // The cost path as the report shows it: the note without the upper-bound caveat (the "≤" on the cost carries that).
    const pathMd = (s) => { const note = (s.note || '').replace('; upper bound (XP inside the level unknown)', ''); return s.costPath + (note ? ' (' + note + ')' : ''); };
    // A gain within one error of zero reads "no change" with the real value in brackets (a file has no hover), its error "-".
    const signed = (v) => (v > 0 ? '+' : '') + fmt(v);
    const gainMd = (v, se) => (Number.isFinite(v) && Number.isFinite(se) && Math.abs(v) < se ? `no change (${signed(v)} ± ${fmt(se)}) | -` : `${fmt(v)} | ${fmt(se)}`);
    const buyerMd = (s) => (Number.isFinite(s.buyerNet) ? gainMd(s.buyerNet, s.buyerNetSe) : '- | -');
    const NO_COST = 'no cost, nothing to pay back'; // a cost of exactly 0 has nothing to pay back (a cost above 0 with no gain keeps "-")
    const paybackMd = (s) => (s.paybackOwn !== undefined ? s.paybackOwn : s.payback)?.toFixed(1) ?? (s.cost === 0 ? NO_COST : '-');
    // Best foods and drinks: one line per player, items in slot order, a food's trigger in brackets; a player left unchanged says so.
    const bestKinds = [['foods', 'Best foods'], ['drinks', 'Best drinks']].filter(([k]) => Object.keys(result.best?.[k] || {}).length);
    if (bestKinds.length) {
        L.push('## Best foods and drinks', '');
        for (const [kind, label] of bestKinds) {
            L.push(`### ${label}`, '');
            for (const [p, e] of Object.entries(result.best[kind])) L.push(`- ${p}: ${e.items.map((x) => x.item.split('/').pop() + (x.trigger ? ` (${x.trigger})` : '')).join(', ') || 'none'}${e.unchanged ? ' (no change)' : ''}`);
            L.push('');
        }
        L.push('Everything below is measured on top of these foods and drinks.', '');
    }
    L.push('## Changes, in order', '', '| # | Change | Party gain per user | ± se | Buyer\'s gain per day | ± se | Cost | Payback days | Running cost | Cost path |', '|---|---|---|---|---|---|---|---|---|---|');
    result.steps.forEach((s, i) => L.push(`| ${i + 1} | ${s.desc} | ${gainMd(s.gainPerUser, s.sePerUser)} | ${buyerMd(s)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${paybackMd(s)} | ${fmt(s.runningCost)} | ${pathMd(s)} |`));
    L.push('', "Party gain: the change in the group's shared loot per player per day, before anyone's food and drink. Buyer's gain: that player's share of it plus the change in what they spend on their own food and drink, so a free change can show no party gain and still pay the player by saving food and drink.");
    if (result.confirmation) {
        const c = result.confirmation;
        L.push('', `Confirmation on fresh seeds (base ${c.seeds.base[0]}..${c.seeds.base.at(-1)}, result ${c.seeds.result[0]}..${c.seeds.result.at(-1)}): party gain (the shared loot, before anyone's food and drink) ${Math.abs(c.gainPerUser) < c.sePerUser ? `no change (${signed(c.gainPerUser)} ± ${fmt(c.sePerUser)})` : `${fmt(c.gainPerUser)} ± ${fmt(c.sePerUser)}`} per user per day (${unit()}), cost ${fmt(c.cost)}${c.buyerByPlayer ? '' : c.payback == null && c.cost === 0 ? `, ${NO_COST}` : `, payback ${c.payback?.toFixed(1) ?? '-'} days`}.`);
        if (c.buyerByPlayer) { L.push(''); for (const [p, b] of Object.entries(c.buyerByPlayer)) L.push(`- ${p}: gain ${Math.abs(b.gain) < b.se ? `no change (${signed(b.gain)} ± ${fmt(b.se)})` : `${fmt(b.gain)} ± ${fmt(b.se)}`} per day (${Number.isFinite(c.sharedGainPerUser) && Number.isFinite(c.ownSuppliesByPlayer?.[p]) ? (c.ownSuppliesByPlayer[p] <= 0 ? `${fmt(c.sharedGainPerUser)} loot share + ${fmt(-c.ownSuppliesByPlayer[p])} food and drink saved` : `${fmt(c.sharedGainPerUser)} loot share - ${fmt(c.ownSuppliesByPlayer[p])} more food and drink bought`) : 'loot share and own food and drink'}), ${b.payback == null && c.runningSpend?.[p] === 0 ? NO_COST : `pays back in ${b.payback?.toFixed(1) ?? '-'} days`}`); }
    }
    L.push('', '## Ranked single changes (vs the original base, at the last stage each reached)', '', '| Change | Party gain per user | ± se | Buyer\'s gain per day | ± se | Cost | Payback days | Cost path |', '|---|---|---|---|---|---|---|---|');
    const rowMd = (s) => `| ${s.desc} | ${gainMd(s.gainPerUser, s.sePerUser)} | ${buyerMd(s)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${paybackMd(s)} | ${pathMd(s)} |`;
    for (const s of result.singles) if (!s.hiddenFood) L.push(rowMd(s));
    L.push(...skillLines);
    if (result.overBudget.length) { L.push('', '## Priced, over budget, not ranked', ''); for (const a of result.overBudget) L.push(`- ${a.player}, ${a.desc}: ${a.costBound === 'upper' ? '≤ ' : ''}${fmt(a.cost)}`); }
    if (result.apart.length) { L.push('', '## Unknown cost, not ranked', ''); for (const a of result.apart) L.push(`- ${a.desc}: ${a.note}`); }
    const t = result.timing;
    L.push('', `Timing: ${t.wallMinutes.toFixed(1)} min wall this call, ${t.coreHoursAllRuns.toFixed(2)} core-hours over all cached runs (${t.simHoursAllRuns} sim h, ${t.secondsPerSimHour?.toFixed(2)} s per sim hour).`);
    writeFileSync(path.join(OUT, 'result.md'), L.join('\n') + '\n');
    report({ stage: 'done', candidatesLeft: 0 });
    console.log(`done: ${result.steps.length} steps; ${path.join(OUT, 'result.md')}`);
}

await main();
if (process.connected) process.disconnect(); // the IPC channel (stop requests) would keep the process alive
