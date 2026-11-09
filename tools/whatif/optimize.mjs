// What-if optimizer core, phase 1 (docs/proposals/what-if.md 3.2-3.4, 3.6 item 1): equipment levers, priced from
// per-level market entries and the Mirror path after 4% market tax (prices.mjs), searched by a screen of every
// single change, successive halving and greedy stacking, with one fresh-seed confirmation at the end.
//
// Usage: node tools/whatif/optimize.mjs --out <dir> [options]
//   --players Ramlock            whose equipment is open (comma list); each change is costed to its player
//   --levers equip               comma list of equip (phase 1: +N and market swaps), consumables (any food or drink
//                                with a market ask, drop one, fill an empty slot; one of each food or drink type),
//                                pairs (two slots of a kind changed together, each to another tier of its type),
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
//   --keep 40,10                 candidates kept after each stage but the last
//   --error unpaired|paired      default unpaired (design revision 6). paired: se of per-seed differences, base on the variant's seed count (3.3 up to
//                                revision 5); unpaired: sqrt(sv^2/kv + sb^2/kb), base on --base-mult x seeds, each new
//                                run on the next seed its setup never ran (delta 4, with his point of 23:14 BRT)
//   --base-mult <n>              base seeds per variant seed; default 1 when paired, 4 when unpaired
//   --z 2                        accept a change only at gain >= z se
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
import { DEFAULT_PRICES, buildDtos, root } from './engine.mjs';
import { consumableType, swapCands, tierPairCands } from './consumables.mjs';
import { installProbe, summarize, mergeProbes, triggerCands, localCands } from './triggers.mjs';
import { runParty } from './engine.mjs';
import { skillCands, skillReport, parseSkillLeft } from './levers/skills.mjs';
import { upgradeCands, LEVER_NAMES as UPGRADE_LEVERS } from './levers/houses.mjs'; // houses, abilitylevels, books (phase 3)
import { parseBudgetList, resolveBudgets, zeroSpend, affordable, pay } from './budgets.mjs';
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
const exportData = arg('export', null) ? JSON.parse(readFileSync(arg('export'), 'utf8')) : null;
if ((levers.has('owned') || levers.has('abilities')) && !exportData) throw new Error('--levers owned/abilities need --export (inventory, learned abilities)');
let budget = null, budgetSource;
const budgetList = parseBudgetList(arg('budgets', null) === true ? null : arg('budgets', null));
if (arg('budget', null) !== null) { budget = Number(arg('budget')); budgetSource = 'typed'; }
else if (exportData) { budget = exportData.coin; budgetSource = 'exporter coin'; if (!(budget >= 0)) throw new Error('exporter JSON has no coin'); }
else if (Object.keys(budgetList).length) budgetSource = 'per player';
else throw new Error('--budget, --budgets or --export required');
if (Object.keys(budgetList).length && budget != null) budgetSource = `per player, else ${budgetSource}`;
const budgets = resolveBudgets(players, budgetList, budget ?? NaN);
if (arg('low-priority', false) === true) os.setPriority(os.constants.priority.PRIORITY_LOW);

const [probeK, probeH] = String(arg('probe', '1x50')).split('x').map(Number);
const trigOpts = { owners: list(arg('trigger-owners', null)), fixed: list(arg('trigger-fixed', null)) };
const userTrig = arg('trigger-cands', null) ? JSON.parse(readFileSync(arg('trigger-cands'), 'utf8')) : {};
let probeStore = null; // set by probeBase() before candidates are built
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
function report(patch = {}) {
    Object.assign(progress, patch);
    const wall = wallLog.reduce((a, r) => a + r.wallSeconds, 0), hours = wallLog.reduce((a, r) => a + r.h, 0);
    const left = progress.runsPlanned - progress.runsDone;
    progress.secondsPerRun = batch.done ? batch.wall / batch.done : wallLog.length ? wall / wallLog.length : null;
    progress.etaSeconds = left <= 0 ? 0 : hours ? Math.round((wall / hours) * batch.hoursLeft / Math.min(jobs, left)) : null;
    progress.elapsedSeconds = Math.round((Date.now() - t0) / 1000);
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

// ---- Candidates ----
const COMBAT_SLOTS = ['head', 'body', 'legs', 'feet', 'hands', 'main_hand', 'two_hand', 'off_hand', 'pouch', 'back', 'neck', 'earrings', 'ring', 'trinket', 'charm'];
const slotItem = (setups, p, slot) => setups.find((s) => s.name === p).player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + slot);
const meetsReq = (setup, item) => (item.equipmentDetail.levelRequirements || []).every((r) => (setup.player[r.skillHrid.split('/').pop() + 'Level'] ?? 0) >= r.level);

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
                out.push({ id: `${p}:${slot}=${item.hrid.split('/').pop()}+${L}`, kind: 'equip', groups: [`${p}:${slot}`], player: p, slot, monotone: false, desc: `${p} ${slot} ${name} +${it.enhancementLevel} -> ${item.hrid.split('/').pop()} +${L}`, ops: [{ op: 'equip', player: p, slot, item: item.hrid, level: L }], cost: c });
            }
        }
    }
    return out;
}

// ---- Phase 2 levers (design 1.1-1.3, 3.6 item 2): loadout tweaks, no gold cost ----
const short = (h) => h.split('/').pop();
const FREE = (path, note = '') => ({ cost: 0, known: true, path, mirrors: 0, note });
const exportFor = (p) => (exportData && exportData.name === p ? exportData : null);
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
// One food and one drink of each type at a time (consumables.mjs); --levers pairs adds both slots of a kind
// changed together, each to another tier of its own type.
const typeOf = (h) => consumableType(itemDetailMap[h]);
function consumableCands(setups, p, withSingles, withPairs) {
    const s = setups.find((x) => x.name === p), n = consumableSlots(setups, p), out = [];
    for (const [kind, key, pool] of [['food', 'food', FOODS], ['drink', 'drinks', DRINKS]]) {
        const list = Array.from({ length: n[kind] }, (_, i) => s[key]['/action_types/combat']?.[i]?.itemHrid || null);
        if (withSingles) out.push(...swapCands(p, kind, list, n[kind], pool, typeOf));
        if (withPairs) out.push(...tierPairCands(p, kind, list, n[kind], pool, typeOf));
    }
    return out;
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
    return [
        ...(levers.has('equip') ? candidatesFor(setups, p, openSlots) : []),
        ...(levers.has('consumables') || levers.has('pairs') ? consumableCands(setups, p, levers.has('consumables'), levers.has('pairs')) : []),
        ...(levers.has('owned') ? ownedCands(setups, p, openSlots) : []),
        ...abilityCands(setups, p, levers.has('abilities'), levers.has('order')),
        ...upgradeCands(setups.find((x) => x.name === p), p, levers, { arg, pricer, ex: exportFor(p) }),
        ...(levers.has('triggers') ? triggerCands(setups.find((x) => x.name === p), p, probeStore, { ...trigOpts, user: userTrig[p] }) : []),
        ...(levers.has('skills') ? skillCands(setups, p, skillOpts) : []),
    ];
}

// The trigger counter (design 3.5 item 2): base runs with the probe, cut to percentiles, kept in <out>/probe.json
// for this base. Each probe run must equal the plain run of the same seed (the probe only observes): it is checked
// against the cached plain run when there is one (tools/test/whatif-triggers.mjs checks it on a generic party).
async function probeBase() {
    const file = path.join(OUT, 'probe.json'), key = keyOf([]);
    if (existsSync(file)) { const p = JSON.parse(readFileSync(file, 'utf8')); if (p.key === key && p.k === probeK && p.h === probeH) return p.store; }
    const stores = [];
    for (const seed of seedsFor(probeK)) {
        let st;
        const t1 = Date.now();
        const res = await runParty({ ...options, setups: setups0, seed, checkpoints: [probeH], onPlayers: (pls, names) => { st = installProbe(pls, names, players, Trigger); } });
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
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    let gain, se;
    if (errorRule === 'paired') { const d = vs.map((v, i) => v - bs[i]); gain = mean(d); se = sd(d) / Math.sqrt(d.length); }
    else { gain = mean(vs) - mean(bs); se = Math.sqrt(sd(vs) ** 2 / vs.length + sd(bs) ** 2 / bs.length); }
    const cost = c.cost.cost;
    const g = c.monotone ? Math.max(gain, 0) : gain; // a monotone lever can only help (3.2 item 1): rank by its size
    const score = cost <= 0 ? (g > 0 ? Infinity : g) : g / cost;
    const payback = goal === 'profit' && gain > 0 && cost > 0 ? cost / gain : null;
    return { stage: `${st.k}x${st.h}`, seeds: vSeeds, baseSeeds: bSeeds, gain, se, base: mean(bs), score, payback, accepted: gain > 0 && gain >= z * se }; // a zero gain (an EXP-only charm on a profit goal) is never accepted
}
const rank = (a, b) => (b.est.score - a.est.score) || (b.est.gain - a.est.gain);

// ---- Search ----
async function main() {
    const result = { args: process.argv.slice(2).join(' '), goal, errorRule, baseMult, z, stages: stages.map((s) => `${s.k}x${s.h}`), keep, budget, budgets, budgetSource, taxLabel: TAX_LABEL, players, partySize: setups0.length, options: { ...keyOptions, ...pricesMeta, levers: [...levers] }, setups: setups0, steps: [], singles: [], apart: [], overBudget: [] };
    const fin = stages[stages.length - 1];
    let baseOps = [], spent = zeroSpend(budgets);
    if (levers.has('triggers')) { report({ stage: 'probe' }); probeStore = await probeBase(); }
    let cands = players.flatMap((p) => allCandidates(setups0, p));
    if (onlyCands) cands = cands.filter((c) => onlyCands.includes(c.id));
    result.apart = cands.filter((c) => !c.cost.known).map((c) => ({ id: c.id, desc: c.desc, note: c.cost.note }));
    // Priced but over its own player's budget: listed in their own group, never ranked (so a result with no steps says why).
    result.overBudget = cands.filter((c) => c.cost.known && !affordable(c, budgets, null)).map((c) => ({ id: c.id, player: c.player, desc: c.desc, cost: c.cost.cost, ...(c.cost.costBound ? { costBound: c.cost.costBound } : {}), costPath: c.cost.path, note: c.cost.note || '' }));
    cands = cands.filter((c) => c.cost.known && affordable(c, budgets, null)); // each within its own player's budget
    // Monotone levers first (3.2 item 1), then the rest; screen then halving.
    cands.sort((a, b) => (b.monotone - a.monotone));
    result.candidates = cands.length;
    result.candidateList = cands.map((c) => ({ id: c.id, desc: c.desc, cost: c.cost.cost, path: c.cost.path, note: c.cost.note || "" }));
    console.log(`${cands.length} candidates within budget, ${result.overBudget.length} priced over budget and ${result.apart.length} with unknown cost listed apart`);

    // Base: each seed run once, at the longest stage it is needed for.
    const baseReq = [];
    stages.forEach((st) => baseReq.push(...req([], st.h, st.k * baseMult, 'base')));

    let pool = cands;
    for (let si = 0; si < stages.length; si++) {
        const st = stages[si];
        report({ stage: si === 0 ? 'screen' : `halving ${si}`, candidatesLeft: pool.length });
        // The base runs alongside the screen, so the cores are not idle while it runs.
        if (!await ensure([...(si === 0 ? baseReq : []), ...pool.flatMap((c) => req(c.ops, st.h, st.k, 'variant'))])) return stop(result);
        for (const c of pool) { c.est = estimate([], c, st, st.k * baseMult); (c.history ||= []).push(c.est); }
        pool.sort(rank);
        if (si < stages.length - 1) pool = pool.slice(0, keep[si] ?? pool.length);
    }
    // The base the search compared against, per user, in the goal's unit: the mean over the base seeds of the last stage.
    { const bs = pick([], fin.h, fin.k * baseMult); result.basePerUser = bs.reduce((a, i) => a + val([], i, fin.h), 0) / bs.length / setups0.length; }
    result.singles = cands.map((c) => row(c)).sort((a, b) => (a.lastStage === b.lastStage ? (b.score - a.score) : (b.stageIndex - a.stageIndex)));

    // Greedy stacking on the finalists.
    let finalists = pool.filter((c) => !c.timeOnly); // time-only levers (skill levels) are shown, never bought
    result.timeOnly = cands.filter((c) => c.timeOnly);
    for (let step = 0; step < maxSteps; step++) {
        const ok = finalists.filter((c) => c.est.accepted && affordable(c, budgets, spent)).sort(rank); // paid from its own player's coin left
        if (!ok.length) break;
        const best = ok[0];
        spent = pay(spent, best);
        baseOps = [...baseOps, ...best.ops];
        result.steps.push({ ...row(best), runningCost: Object.values(spent).reduce((a, x) => a + x, 0), runningSpend: { ...spent } });
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
                : c.groups.some((g) => touched.has(g)) && c.kind === 'trigger' ? false // stale: built on the owner's old list
                    : (survivors.has(c.id) && c.id !== best.id)));
        // Coordinate-wise rounds (3.5 item 3): the changed owner's terms get local candidates around the new values.
        if (best.kind === 'trigger') finalists.push(...localCands(setupsNow.find((x) => x.name === best.player), best.player, probeStore, best.owner));
        report({ stage: `greedy step ${step + 1}`, candidatesLeft: finalists.length });
        if (!await ensure([...newBase, ...finalists.flatMap((c) => req([...baseOps, ...c.ops], fin.h, fin.k, 'variant'))])) return stop(result);
        for (const c of finalists) c.est = estimate(baseOps, c, fin, fin.k * baseMult);
    }

    // One confirmation on fresh seeds (3.3): base and result.
    if (result.steps.length) {
        report({ stage: 'confirmation', candidatesLeft: 0 });
        const fs = pick([], fin.h, fin.k * baseMult, true), vs = pick(baseOps, fin.h, fin.k, true);
        if (!await ensure([...fs.map((i) => ({ ops: [], seed: i, h: fin.h, tag: 'confirm' })), ...vs.map((i) => ({ ops: baseOps, seed: i, h: fin.h, tag: 'confirm' }))])) return stop(result);
        const v = vs.map((i) => val(baseOps, i, fin.h)), b = fs.map((i) => val([], i, fin.h));
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
        let gain, se;
        if (errorRule === 'paired') { const d = v.map((x, i) => x - b[i]); gain = mean(d); se = sd(d) / Math.sqrt(d.length); }
        else { gain = mean(v) - mean(b); se = Math.sqrt(sd(v) ** 2 / v.length + sd(b) ** 2 / b.length); }
        const total = Object.values(spent).reduce((a, x) => a + x, 0);
        result.confirmation = { seeds: { base: fs, result: vs }, gain, se, ...perUser(gain, se), accepted: gain > 0 && gain >= z * se, cost: total, runningSpend: { ...spent }, payback: goal === 'profit' && gain > 0 ? total / gain : null, ops: baseOps };
    }
    return done(result);
}

// Per user: the party figure split equally over the party (the contract's gainPerUser / sePerUser).
const perUser = (gain, se) => ({ gainPerUser: gain / setups0.length, sePerUser: se / setups0.length });
function row(c) {
    return { id: c.id, player: c.player, ops: c.ops, desc: c.desc, ...perUser(c.est.gain, c.est.se), cost: c.cost.cost, ...(c.cost.costBound ? { costBound: c.cost.costBound } : {}), costPath: c.cost.path, note: c.cost.note || '', gain: c.est.gain, se: c.est.se, payback: c.est.payback, score: c.est.score, accepted: c.est.accepted, lastStage: c.est.stage, stageIndex: c.history?.length ?? 0, history: c.history?.map((h) => ({ stage: h.stage, gain: h.gain, se: h.se, seeds: h.seeds, baseSeeds: h.baseSeeds })) };
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
    writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
    const L = [`# What-if result`, '', `Run: \`node tools/whatif/optimize.mjs ${result.args}\``, '', `Goal: ${goal === 'exp' ? 'party EXP per hour' : 'party profit per day, ' + TAX_LABEL}. Budget per player: ${Object.entries(budgets).map(([p, b]) => `${p} ${fmt(b)}`).join(', ')} (${budgetSource}). Error rule: ${errorRule}, base on ${baseMult}x seeds, accept at ${z} se. Stages ${result.stages.join(', ')}, keep ${keep.join(', ')}. Costs ${TAX_LABEL} on every sale.`, ''];
    L.push('## Changes, in order', '', '| # | Change | Gain | ± se | Cost | Payback days | Running cost | Cost path |', '|---|---|---|---|---|---|---|---|');
    result.steps.forEach((s, i) => L.push(`| ${i + 1} | ${s.desc} | ${fmt(s.gain)} | ${fmt(s.se)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${s.payback?.toFixed(1) ?? '-'} | ${fmt(s.runningCost)} | ${s.costPath}${s.note ? ' (' + s.note + ')' : ''} |`));
    if (result.confirmation) { const c = result.confirmation; L.push('', `Confirmation on fresh seeds (base ${c.seeds.base[0]}..${c.seeds.base.at(-1)}, result ${c.seeds.result[0]}..${c.seeds.result.at(-1)}): gain ${fmt(c.gain)} ± ${fmt(c.se)} ${unit()}, cost ${fmt(c.cost)}, payback ${c.payback?.toFixed(1) ?? '-'} days.`); }
    L.push('', '## Ranked single changes (vs the original base, at the last stage each reached)', '', '| Change | Stage | Gain | ± se | Cost | Payback days | Cost path |', '|---|---|---|---|---|---|---|');
    for (const s of result.singles) L.push(`| ${s.desc} | ${s.lastStage} | ${fmt(s.gain)} | ${fmt(s.se)} | ${s.costBound === 'upper' ? '≤ ' : ''}${fmt(s.cost)} | ${s.payback?.toFixed(1) ?? '-'} | ${s.costPath}${s.note ? ' (' + s.note + ')' : ''} |`);
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
