// What-if optimizer core, phase 1 (docs/proposals/what-if.md 3.2-3.4, 3.6 item 1): equipment levers, priced from
// per-level market entries and the Mirror path after 4% market tax (prices.mjs), searched by a screen of every
// single change, successive halving and greedy stacking, with one fresh-seed confirmation at the end.
//
// Usage: node tools/whatif/optimize.mjs --out <dir> [options]
//   --players Ramlock            whose equipment is open (comma list); each change is costed to its player
//   --goal profit|exp            party profit per day after tax, or party EXP per hour (1.8)
//   --budget <coin> | --export <exporter JSON>   budget: typed, else `coin` of the exporter JSON (3.1)
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
//   --comdrop 20 --comexp 20 --tier 4 --zone /actions/combat/infernal_abyss
// Every run is cached in <out>/runs.jsonl by (resulting setups, options, seed); a rerun with the same args
// resumes. Results: <out>/result.json and <out>/result.md. Exit code 3 = stopped by --max-minutes, rerun.
import { fork } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { readParty, applyOps } from './variants.mjs';
import { loadMarket, makePricer, TAX_LABEL } from './prices.mjs';
import { DEFAULT_PRICES } from './engine.mjs';

const { default: itemDetailMap } = await import(new URL('../../src/combatsimulator/data/itemDetailMap.json', import.meta.url), { with: { type: 'json' } });

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
let budget, budgetSource;
if (arg('budget', null) !== null) { budget = Number(arg('budget')); budgetSource = 'typed'; }
else if (arg('export', null)) { budget = JSON.parse(readFileSync(arg('export'), 'utf8')).coin; budgetSource = 'exporter coin'; if (!(budget >= 0)) throw new Error('exporter JSON has no coin'); }
else throw new Error('--budget or --export required');

const metric = (cp) => (goal === 'exp' ? cp.party.expPerHour : cp.party.profitAfterTaxPerDay);
const setups0 = readParty(setupsDir);
const pricer = makePricer(loadMarket(pricesFile));
const t0 = Date.now();

// ---- Run cache and pool ----
const CACHE = path.join(OUT, 'runs.jsonl');
const seedIndex = new Map(); // key -> Set of seeds run for that setup
const cache = new Map(); // key#seed -> { wallSeconds, hours, byHours: {h: metricsCheckpoint} }
if (existsSync(CACHE)) for (const l of readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); put(r); }
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
const keyOf = (ops) => createHash('sha1').update(JSON.stringify({ s: applyOps(setups0, ops), o: options })).digest('hex').slice(0, 16);
const allHours = [...new Set(stages.map((s) => s.h))].sort((a, b) => a - b);
let stoppedByTime = false;
const wallLog = []; // per run actually made in this invocation

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
    if (!tasks.length) return true;
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${tasks.length} runs, ${tasks.reduce((a, t) => a + t.h, 0)} sim h`);
    let next = 0;
    const self = fileURLToPath(new URL('./batch.mjs', import.meta.url));
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
        const c = fork(self, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        const feed = () => {
            if (next < tasks.length && (Date.now() - t0) / 60000 < maxMinutes) c.send(tasks[next++]);
            else { if (next < tasks.length) stoppedByTime = true; c.send('exit'); }
        };
        c.on('message', (res) => {
            const t = tasks.find((x) => x.variant === res.variant && x.seed === res.seed);
            const rec = { key: res.variant, seed: res.seed, hours: t.h, tag: t.tag, wallSeconds: res.wallSeconds, checkpoints: res.checkpoints };
            appendFileSync(CACHE, JSON.stringify(rec) + '\n');
            put(rec);
            wallLog.push({ tag: t.tag, h: t.h, wallSeconds: res.wallSeconds });
            feed();
        });
        c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('child exited ' + code))));
        feed();
    })));
    return !stoppedByTime;
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

function candidatesFor(setups, p, slots) {
    const s = setups.find((x) => x.name === p), out = [];
    for (const slot of slots) {
        const it = slotItem(setups, p, slot);
        if (!it) continue;
        const name = it.itemHrid.split('/').pop();
        for (let d = 1; d <= maxUp; d++) {
            const c = pricer.upgrade(it.itemHrid, it.enhancementLevel, it.enhancementLevel + d);
            out.push({ id: `${p}:${slot}+${d}`, player: p, slot, monotone: true, desc: `${p} ${slot} ${name} +${it.enhancementLevel} -> +${it.enhancementLevel + d}`, ops: [{ op: 'enhance', player: p, slot, delta: d }], cost: c });
        }
        if (!swapsOn) continue;
        const type = itemDetailMap[it.itemHrid]?.equipmentDetail?.type;
        for (const item of Object.values(itemDetailMap)) {
            if (item.hrid === it.itemHrid || item.equipmentDetail?.type !== type || !meetsReq(s, item)) continue;
            for (const L of [...new Set(swapLevels.map((x) => (x === 'same' ? it.enhancementLevel : Number(x))))]) {
                const c = pricer.swap(it.itemHrid, it.enhancementLevel, item.hrid, L);
                if (!c.known) continue; // no seller at this level: not a market swap
                if (c.cost <= 0 && !sellDown) continue; // frees gold: a sell-down, dropped (design 4.3 item 2)
                out.push({ id: `${p}:${slot}=${item.hrid.split('/').pop()}+${L}`, player: p, slot, monotone: false, desc: `${p} ${slot} ${name} +${it.enhancementLevel} -> ${item.hrid.split('/').pop()} +${L}`, ops: [{ op: 'equip', player: p, slot, item: item.hrid, level: L }], cost: c });
            }
        }
    }
    return out;
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
    const result = { args: process.argv.slice(2).join(' '), goal, errorRule, baseMult, z, stages: stages.map((s) => `${s.k}x${s.h}`), keep, budget, budgetSource, taxLabel: TAX_LABEL, players, steps: [], singles: [], apart: [] };
    const fin = stages[stages.length - 1];
    let baseOps = [], spent = 0;
    let cands = players.flatMap((p) => candidatesFor(setups0, p, openSlots));
    if (onlyCands) cands = cands.filter((c) => onlyCands.includes(c.id));
    result.apart = cands.filter((c) => !c.cost.known).map((c) => ({ id: c.id, desc: c.desc, note: c.cost.note }));
    cands = cands.filter((c) => c.cost.known && c.cost.cost <= budget);
    // Monotone levers first (3.2 item 1), then the rest; screen then halving.
    cands.sort((a, b) => (b.monotone - a.monotone));
    result.candidates = cands.length;
    result.candidateList = cands.map((c) => ({ id: c.id, desc: c.desc, cost: c.cost.cost, path: c.cost.path, note: c.cost.note || "" }));
    console.log(`${cands.length} candidates within budget, ${result.apart.length} with unknown cost listed apart`);

    // Base: each seed run once, at the longest stage it is needed for.
    const baseReq = [];
    stages.forEach((st) => baseReq.push(...req([], st.h, st.k * baseMult, 'base')));

    let pool = cands;
    for (let si = 0; si < stages.length; si++) {
        const st = stages[si];
        // The base runs alongside the screen, so the cores are not idle while it runs.
        if (!await ensure([...(si === 0 ? baseReq : []), ...pool.flatMap((c) => req(c.ops, st.h, st.k, 'variant'))])) return stop(result);
        for (const c of pool) { c.est = estimate([], c, st, st.k * baseMult); (c.history ||= []).push(c.est); }
        pool.sort(rank);
        if (si < stages.length - 1) pool = pool.slice(0, keep[si] ?? pool.length);
    }
    result.singles = cands.map((c) => row(c)).sort((a, b) => (a.lastStage === b.lastStage ? (b.score - a.score) : (b.stageIndex - a.stageIndex)));

    // Greedy stacking on the finalists.
    let finalists = pool;
    for (let step = 0; step < maxSteps; step++) {
        const ok = finalists.filter((c) => c.est.accepted && c.cost.cost <= budget - spent).sort(rank);
        if (!ok.length) break;
        const best = ok[0];
        spent += Math.max(best.cost.cost, 0);
        baseOps = [...baseOps, ...best.ops];
        result.steps.push({ ...row(best), runningCost: spent });
        console.log(`step ${step + 1}: ${best.desc}, gain ${fmt(best.est.gain)} ± ${fmt(best.est.se)}, cost ${fmt(best.cost.cost)}`);
        // The accepted variant's runs are the new base; seeds it lacks for the base count are run now.
        const newBase = req(baseOps, fin.h, fin.k * baseMult, 'base');
        // Re-screen the survivors on the new base; the accepted slot gets fresh candidates from its new item.
        const setupsNow = applyOps(setups0, baseOps);
        const fresh = candidatesFor(setupsNow, best.player, [best.slot]).filter((c) => c.cost.known && (c.monotone || !onlyCands));
        finalists = [...finalists.filter((c) => c !== best && !(c.player === best.player && c.slot === best.slot)), ...fresh]
            .filter((c) => c.cost.cost <= budget - spent);
        if (!await ensure([...newBase, ...finalists.flatMap((c) => req([...baseOps, ...c.ops], fin.h, fin.k, 'variant'))])) return stop(result);
        for (const c of finalists) c.est = estimate(baseOps, c, fin, fin.k * baseMult);
    }

    // One confirmation on fresh seeds (3.3): base and result.
    if (result.steps.length) {
        const fs = pick([], fin.h, fin.k * baseMult, true), vs = pick(baseOps, fin.h, fin.k, true);
        if (!await ensure([...fs.map((i) => ({ ops: [], seed: i, h: fin.h, tag: 'confirm' })), ...vs.map((i) => ({ ops: baseOps, seed: i, h: fin.h, tag: 'confirm' }))])) return stop(result);
        const v = vs.map((i) => val(baseOps, i, fin.h)), b = fs.map((i) => val([], i, fin.h));
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
        let gain, se;
        if (errorRule === 'paired') { const d = v.map((x, i) => x - b[i]); gain = mean(d); se = sd(d) / Math.sqrt(d.length); }
        else { gain = mean(v) - mean(b); se = Math.sqrt(sd(v) ** 2 / v.length + sd(b) ** 2 / b.length); }
        result.confirmation = { seeds: { base: fs, result: vs }, gain, se, cost: spent, payback: goal === 'profit' && gain > 0 ? spent / gain : null, ops: baseOps };
    }
    return done(result);
}

function row(c) {
    return { id: c.id, desc: c.desc, cost: c.cost.cost, costPath: c.cost.path, note: c.cost.note || '', gain: c.est.gain, se: c.est.se, payback: c.est.payback, score: c.est.score, accepted: c.est.accepted, lastStage: c.est.stage, stageIndex: c.history?.length ?? 0, history: c.history?.map((h) => ({ stage: h.stage, gain: h.gain, se: h.se, seeds: h.seeds, baseSeeds: h.baseSeeds })) };
}
const fmt = (x) => (x == null ? '-' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.abs(x) >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : x.toFixed(1));
const unit = () => (goal === 'exp' ? 'EXP/h' : 'coin/day ' + TAX_LABEL);

function timing(result) {
    const runs = [...cache.values()];
    result.timing = { wallMinutes: (Date.now() - t0) / 60000, runsThisCall: wallLog.length, coreHoursThisCall: wallLog.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursThisCall: wallLog.reduce((a, r) => a + r.h, 0), coreHoursAllRuns: runs.reduce((a, r) => a + r.wallSeconds, 0) / 3600, simHoursAllRuns: runs.reduce((a, r) => a + r.hours, 0) };
    result.timing.secondsPerSimHour = result.timing.simHoursAllRuns ? result.timing.coreHoursAllRuns * 3600 / result.timing.simHoursAllRuns : null;
}
function stop(result) { timing(result); result.incomplete = true; writeFileSync(path.join(OUT, 'partial.json'), JSON.stringify(result, null, 1)); console.log('stopped by --max-minutes; rerun the same command to resume'); process.exit(3); }
function done(result) {
    timing(result);
    writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
    const L = [`# What-if result`, '', `Run: \`node tools/whatif/optimize.mjs ${result.args}\``, '', `Goal: ${goal === 'exp' ? 'party EXP per hour' : 'party profit per day, ' + TAX_LABEL}. Budget ${fmt(budget)} (${budgetSource}). Error rule: ${errorRule}, base on ${baseMult}x seeds, accept at ${z} se. Stages ${result.stages.join(', ')}, keep ${keep.join(', ')}. Costs ${TAX_LABEL} on every sale.`, ''];
    L.push('## Changes, in order', '', '| # | Change | Gain | ± se | Cost | Payback days | Running cost | Cost path |', '|---|---|---|---|---|---|---|---|');
    result.steps.forEach((s, i) => L.push(`| ${i + 1} | ${s.desc} | ${fmt(s.gain)} | ${fmt(s.se)} | ${fmt(s.cost)} | ${s.payback?.toFixed(1) ?? '-'} | ${fmt(s.runningCost)} | ${s.costPath}${s.note ? ' (' + s.note + ')' : ''} |`));
    if (result.confirmation) { const c = result.confirmation; L.push('', `Confirmation on fresh seeds (base ${c.seeds.base[0]}..${c.seeds.base.at(-1)}, result ${c.seeds.result[0]}..${c.seeds.result.at(-1)}): gain ${fmt(c.gain)} ± ${fmt(c.se)} ${unit()}, cost ${fmt(c.cost)}, payback ${c.payback?.toFixed(1) ?? '-'} days.`); }
    L.push('', '## Ranked single changes (vs the original base, at the last stage each reached)', '', '| Change | Stage | Gain | ± se | Cost | Payback days | Cost path |', '|---|---|---|---|---|---|---|');
    for (const s of result.singles) L.push(`| ${s.desc} | ${s.lastStage} | ${fmt(s.gain)} | ${fmt(s.se)} | ${fmt(s.cost)} | ${s.payback?.toFixed(1) ?? '-'} | ${s.costPath}${s.note ? ' (' + s.note + ')' : ''} |`);
    if (result.apart.length) { L.push('', '## Unknown cost, not ranked', ''); for (const a of result.apart) L.push(`- ${a.desc}: ${a.note}`); }
    const t = result.timing;
    L.push('', `Timing: ${t.wallMinutes.toFixed(1)} min wall this call, ${t.coreHoursAllRuns.toFixed(2)} core-hours over all cached runs (${t.simHoursAllRuns} sim h, ${t.secondsPerSimHour?.toFixed(2)} s per sim hour).`);
    writeFileSync(path.join(OUT, 'result.md'), L.join('\n') + '\n');
    console.log(`done: ${result.steps.length} steps; ${path.join(OUT, 'result.md')}`);
}

await main();
