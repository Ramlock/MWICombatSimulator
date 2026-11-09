// One seeded engine run of the party, with metrics read at several sim-hour checkpoints of the same run.
// The run is the one tools/calibration/run.mjs makes (same DTOs, buffs, seeding and prices); a checkpoint at
// h hours holds exactly the state a run of --hours h ends in, since simulate() stops at the first event at or
// past its limit and so does the checkpoint.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

register('../calibration/hooks.mjs', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
const src = (p) => new URL('file:///' + path.join(root, 'src', p).replace(/\\/g, '/')).href;

const { buildDto, calcCombatLevel } = await import('../calibration/setupDto.mjs');
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: CombatStartEvent } = await import(src('combatsimulator/events/combatStartEvent.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: itemDetailMap } = await import(src('combatsimulator/data/itemDetailMap.json'));
const { default: combatMonsterDetailMap } = await import(src('combatsimulator/data/combatMonsterDetailMap.json'));
const { default: openableLootDropMap } = await import(src('combatsimulator/data/openableLootDropMap.json'));

export const ONE_HOUR = 3600 * 1e9;
export const MARKET_TAX = 0.04;
export const DEFAULT_PRICES = path.join(root, 'tools', 'calibration', 'marketplace-2026-11-03.json');

// Seeded Math.random, as tools/calibration/run.mjs:37-51.
export function seedRandom(seed) {
    let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
    Math.random = function () {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 20; i++) Math.random();
}

// Separate RNG streams (design 2.1, 4.2 item 3), a harness-only prototype: src/ is not changed.
// Every encounter gets fresh streams, seeded from (seed, encounter number, key): one for the spawn, one per acting
// unit (players by hrid, monsters by their slot in the encounter) and one "world" stream for events with no source.
// Inside an event, Math.random is the acting unit's stream. So base and variant draw the same monsters for encounter n,
// and each unit's rolls in encounter n start from the same state, however the earlier encounters went.
function sfc32(a, b, c, d) {
    return function () {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}
function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
function installStreams(sim, zone, seed) {
    let encounter = 0;
    let streams = new Map();
    const stream = (key) => {
        let g = streams.get(key);
        if (!g) { g = sfc32(...cyrb128(`${seed}|${encounter}|${key}`)); for (let i = 0; i < 12; i++) g(); streams.set(key, g); }
        return g;
    };
    for (const name of ['getRandomEncounter', 'getNextWave']) {
        const orig = zone[name];
        if (typeof orig !== 'function') continue;
        zone[name] = function (...args) {
            encounter++;
            streams = new Map();
            // The rest of the spawning event (encounter setup) draws from the new encounter's world stream.
            Math.random = stream('spawn');
            try { return orig.apply(this, args); } finally { Math.random = stream('world'); }
        };
    }
    const keyOf = (u) => {
        if (!u) return 'world';
        if (/^playerd$/.test(u.hrid)) return u.hrid;
        const i = sim.enemies ? sim.enemies.indexOf(u) : -1;
        return i >= 0 ? 'enemy' + i : 'world';
    };
    const orig = sim.processEvent.bind(sim);
    sim.processEvent = function (event) {
        Math.random = stream(keyOf(event.source ?? event.sourceRef));
        return orig(event);
    };
}

// Prices as tools/calibration/run.mjs:94-109 (window.prices, src/main.js:4638-4733).
const priceCache = new Map();
export function loadPrices(file = DEFAULT_PRICES) {
    if (priceCache.has(file)) return priceCache.get(file);
    const market = JSON.parse(readFileSync(file, 'utf8')).marketData;
    const prices = {};
    for (const item of Object.values(itemDetailMap)) {
        if (item.hrid in market) {
            prices[item.hrid] = { ask: -1, bid: -1, vendor: item.sellPrice };
            if (market[item.hrid]['0']) { prices[item.hrid].ask = market[item.hrid]['0'].a; prices[item.hrid].bid = market[item.hrid]['0'].b; }
        }
    }
    prices['/items/coin'] = { ask: 1, bid: 1, vendor: 1 };
    for (const chest of ['/items/small_treasure_chest', '/items/medium_treasure_chest', '/items/large_treasure_chest']) {
        const sum = (side) => openableLootDropMap[chest].map((it) => (it.itemHrid in prices ? prices[it.itemHrid][side] * it.dropRate * (it.maxCount + it.minCount) / 2 : 0)).reduce((x, y) => x + y, 0);
        prices[chest] = { ask: sum('ask'), bid: sum('bid'), vendor: 0 };
    }
    priceCache.set(file, prices);
    return prices;
}

// Value of one dropped unit. Pre-tax: Toolasha's panel "hybrid" valuation (tools/calibration/run.mjs:120-136),
// whose openables already carry 4% tax on their taxable contents. After tax: the same, with 4% off every other
// market sale; coin is not taxed (design 2.3, 4.1 answer 3).
function dropValue(prices, hrid) {
    if (hrid === '/items/coin') return { pre: 1, post: 1 };
    if (openableLootDropMap[hrid]) {
        let ev = 0;
        for (const d of openableLootDropMap[hrid]) {
            if (!(d.dropRate > 0)) continue;
            const v = d.itemHrid === '/items/coin' ? 1 : (prices[d.itemHrid]?.ask ?? -1);
            if (!(v > 0)) continue;
            const amt = (d.minCount + d.maxCount) / 2 * d.dropRate * v;
            ev += d.itemHrid === '/items/coin' ? amt : amt * (1 - MARKET_TAX);
        }
        return { pre: ev, post: ev };
    }
    const a = prices[hrid]?.ask;
    const v = a > 0 ? a : 0;
    return { pre: v, post: v * (1 - MARKET_TAX) };
}

// Expected ("No RNG") drops, src/main.js:1982-2070 (tools/calibration/run.mjs:139-166).
function noRngDrops(snap, playerHrid) {
    const dropRateMultiplier = snap.dropRateMultiplier[playerHrid];
    const rareFindMultiplier = snap.rareFindMultiplier[playerHrid];
    const cdq = snap.combatDropQuantity[playerHrid];
    const gap = snap.debuffOnLevelGap[playerHrid];
    const n = snap.numberOfPlayers;
    const out = new Map();
    const add = (k, v) => out.set(k, (out.get(k) || 0) + v);
    for (const m of Object.keys(snap.deaths).filter((e) => !/^player\d$/.test(e))) {
        const md = combatMonsterDetailMap[m];
        if (!md.dropTable) continue;
        for (const d of md.dropTable) {
            if (d.minDifficultyTier > snap.difficultyTier) continue;
            let rate = Math.min(1, (1 + 0.1 * snap.difficultyTier) * (d.dropRate + (d.dropRatePerDifficultyTier ?? 0) * snap.difficultyTier));
            if (rate <= 0) continue;
            rate = Math.min(1, rate * dropRateMultiplier);
            add(d.itemHrid, snap.deaths[m] * rate * (d.maxCount + d.minCount) / 2 * (1 + gap) * (1 + cdq) / n);
        }
        for (const d of md.rareDropTable || []) {
            if (d.minDifficultyTier > snap.difficultyTier) continue;
            add(d.itemHrid, snap.deaths[m] * d.dropRate * rareFindMultiplier * (d.maxCount + d.minCount) / 2 * (1 + gap) * (1 + cdq) / n);
        }
    }
    return out;
}

// Per-player and party metrics from one snapshot. Consumables at ask (500 when no ask), as the panel.
export function metrics(snap, names, prices) {
    const simHours = snap.simulatedTime / ONE_HOUR;
    const hoursForRates = (snap.lastEncounterFinishTime > 0 ? snap.lastEncounterFinishTime : snap.simulatedTime) / ONE_HOUR;
    const perDay = (v) => v / simHours * 24;
    const players = {};
    const party = { incomePerDay: 0, consumablesPerDay: 0, profitPerDay: 0, profitAfterTaxPerDay: 0, expPerHour: 0, deathsPerHour: 0 };
    names.forEach((name, i) => {
        const ph = 'player' + (i + 1);
        let pre = 0, post = 0, cons = 0;
        for (const [hrid, amt] of noRngDrops(snap, ph)) { const v = dropValue(prices, hrid); pre += v.pre * amt; post += v.post * amt; }
        for (const [hrid, n] of Object.entries(snap.consumablesUsed[ph] || {})) cons += (prices[hrid]?.ask > 0 ? prices[hrid].ask : 500) * n;
        const xp = Object.values(snap.experienceGained[ph] || {}).reduce((a, b) => a + b, 0);
        const p = {
            incomePerDay: perDay(pre),
            consumablesPerDay: perDay(cons),
            profitPerDay: perDay(pre - cons),
            profitAfterTaxPerDay: perDay(post - cons),
            expPerHour: xp / simHours,
            expPerHourBySkill: Object.fromEntries(Object.entries(snap.experienceGained[ph] || {}).map(([k, v]) => [k, v / simHours])),
            deathsPerHour: (snap.deaths[ph] || 0) / simHours,
        };
        players[name] = p;
        for (const k of Object.keys(party)) party[k] += p[k]; // expPerHourBySkill stays per player
    });
    return { simHours, encounters: snap.encounters, encountersPerHour: snap.encounters / hoursForRates, players, party };
}

// The DTOs the UI builds from the setups, with the level-gap debuff (tools/calibration/run.mjs:62-68).
export function buildDtos(setups, { legacyImport = false } = {}) {
    const dtos = setups.map((s, i) => buildDto(s, i + 1, { legacyImport }));
    let maxCL = 1;
    for (const d of dtos) { d.combatLevel = calcCombatLevel(d.staminaLevel, d.intelligenceLevel, d.defenseLevel, d.attackLevel, d.meleeLevel, d.rangedLevel, d.magicLevel); maxCL = Math.max(maxCL, d.combatLevel); }
    for (const d of dtos) d.debuffOnLevelGap = maxCL / d.combatLevel > 1.2 ? -Math.min(0.9, 3 * (maxCL / d.combatLevel - 1.2)) : 0;
    return dtos;
}

function extraBuffsFor({ comdrop = 0, comexp = 0, moopass = false }) {
    const buffBase = { ratioBoost: 0, ratioBoostLevelBonus: 0, flatBoostLevelBonus: 0, startTime: '0001-01-01T00:00:00Z', duration: 0 };
    const out = [];
    if (moopass) out.push({ ...buffBase, uniqueHrid: '/buff_uniques/experience_moo_pass_buff', typeHrid: '/buff_types/wisdom', flatBoost: 0.05 });
    if (comexp > 0) out.push({ ...buffBase, uniqueHrid: '/buff_uniques/experience_community_buff', typeHrid: '/buff_types/wisdom', flatBoost: 0.005 * (comexp - 1) + 0.2 });
    if (comdrop > 0) out.push({ ...buffBase, uniqueHrid: '/buff_uniques/combat_community_buff', typeHrid: '/buff_types/combat_drop_quantity', flatBoost: 0.005 * (comdrop - 1) + 0.2 });
    return out;
}

function snapshot(sim) {
    const r = sim.simResult;
    for (const p of sim.players) r.setDropRateMultipliers(p);
    return structuredClone({
        simulatedTime: sim.simulationTime,
        lastEncounterFinishTime: r.lastEncounterFinishTime,
        encounters: r.encounters,
        deaths: r.deaths,
        experienceGained: r.experienceGained,
        consumablesUsed: r.consumablesUsed,
        dropRateMultiplier: r.dropRateMultiplier,
        rareFindMultiplier: r.rareFindMultiplier,
        combatDropQuantity: r.combatDropQuantity,
        debuffOnLevelGap: r.debuffOnLevelGap,
        numberOfPlayers: r.numberOfPlayers,
        difficultyTier: r.difficultyTier,
    });
}

// opts: { setups: [setup JSON], names, seed, streams (bool, the RNG-stream prototype above), checkpoints: [hours ascending], tier, zone, comdrop, comexp, moopass, prices, legacyImport, onPlayers(players, names, sim) }
// Returns { wallSeconds, checkpoints: [metrics at each checkpoint] }.
export async function runParty(opts) {
    const { setups, seed, checkpoints, tier = 4, zone: zoneHrid = '/actions/combat/infernal_abyss' } = opts;
    const names = opts.names || setups.map((s) => s.name);
    const prices = loadPrices(opts.prices || DEFAULT_PRICES);
    seedRandom(seed);
    const dtos = buildDtos(setups, opts);
    const zone = new Zone(zoneHrid, tier);
    const extraBuffs = extraBuffsFor(opts);
    const players = dtos.map((d) => {
        const pl = Player.createFromDTO(structuredClone(d));
        pl.zoneBuffs = zone.buffs || [];
        pl.extraBuffs = extraBuffs;
        return pl;
    });
    const sim = new CombatSimulator(players, zone, null, {});
    if (opts.streams) installStreams(sim, zone, seed);
    if (opts.onPlayers) opts.onPlayers(players, names, sim); // an observer (the trigger counter, triggers.mjs); it must not change the run
    const t0 = Date.now();
    // simulate()'s loop (src/combatsimulator/combatSimulator.js:173-203) without the progress events.
    sim.reset();
    sim.eventQueue.addEvent(new CombatStartEvent(0));
    const out = [];
    for (const h of checkpoints) {
        const limit = h * ONE_HOUR;
        while (sim.simulationTime < limit) await sim.processEvent(sim.eventQueue.getNextEvent());
        out.push(metrics(snapshot(sim), names, prices));
    }
    return { wallSeconds: (Date.now() - t0) / 1000, checkpoints: out };
}

// The HP and MP per sim hour each player really gets from combat foods in the base party: the mean over `seeds` of runs of
// `hours` sim hours, read from the run's own hitpointsGained / manapointsGained (source -> amount) after the run through the
// onPlayers hook, counting only the sources that are foods. It changes no cached run and no checkpoint.
// opts: runParty's options (setups, names, tier, zone, comdrop, comexp, moopass, prices ...) plus { seeds, hours }.
// Returns { hours, seeds, perSeed: [{ <name>: { hp, mp } }], mean: { <name>: { hp, mp } }, sources: { hp: [...], mp: [...] } }
// (sources: every source key seen, foods or not, so a log can show what was left out).
export async function measureNeed(opts) {
    const { seeds, hours = 20 } = opts;
    const names = opts.names || opts.setups.map((s) => s.name);
    const isFood = (k) => itemDetailMap[k]?.categoryHrid === '/item_categories/food';
    const perSeed = [], seen = { hp: new Set(), mp: new Set() };
    for (const seed of seeds) {
        let sim;
        await runParty({ ...opts, seed, checkpoints: [hours], onPlayers: (pls, nm, s) => { sim = s; } });
        const r = sim.simResult, hrs = sim.simulationTime / ONE_HOUR, row = {};
        names.forEach((name, i) => {
            const ph = 'player' + (i + 1), one = (gained, set) => Object.entries(gained[ph] || {}).reduce((a, [k, v]) => { set.add(k); return a + (isFood(k) ? v : 0); }, 0) / hrs;
            row[name] = { hp: one(r.hitpointsGained, seen.hp), mp: one(r.manapointsGained, seen.mp) };
        });
        perSeed.push(row);
    }
    const mean = Object.fromEntries(names.map((n) => [n, { hp: perSeed.reduce((a, r) => a + r[n].hp, 0) / perSeed.length, mp: perSeed.reduce((a, r) => a + r[n].mp, 0) / perSeed.length }]));
    return { hours, seeds, perSeed, mean, sources: { hp: [...seen.hp], mp: [...seen.mp] } };
}
