// Headless calibration harness: runs the engine as src/worker.js does on the party setups in
// docs/ground-truth/setups, then computes the in-game panel's metrics per player.
// Usage: node tools/calibration/run.mjs [--hours 24] [--seed 1] [--tier 4]
//        [--zone /actions/combat/infernal_abyss] [--prices <marketplace.json>] [--legacy-import] [--out <file.json>]
// Guild buffs come from src/importGuildBuffs.js, as the UI import applies them (both guildBuffs and
// the exporters' guildCombatBuffLevels). --legacy-import reads guildBuffs only, as the import did before batch 2.
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return def;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const HOURS = Number(arg('hours', 24));
const SEED = Number(arg('seed', 1));
const TIER = Number(arg('tier', 4));
const ZONE = arg('zone', '/actions/combat/infernal_abyss');
const PRICES = arg('prices', path.join(here, 'marketplace-2026-11-03.json'));
const LEGACY_IMPORT = arg('legacy-import', false) === true;
const OUT = arg('out', null);
// extra buffs as src/worker.js:10-48 builds them (UI toggles): community buff levels and Moo Pass.
const COM_DROP = Number(arg('comdrop', 0));
const COM_EXP = Number(arg('comexp', 0));
const MOO_PASS = arg('moopass', false) === true;
const PLAYERS = ['PlayerA', 'Ramlock', 'PlayerC'];

// Seeded Math.random (sfc32) so runs are reproducible.
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
Math.random = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, SEED >>> 0);
for (let i = 0; i < 20; i++) Math.random();

const src = (p) => new URL('file:///' + path.join(root, 'src', p).replace(/\\/g, '/')).href;
const { buildDto, readSetup, calcCombatLevel } = await import('./setupDto.mjs');
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: itemDetailMap } = await import(src('combatsimulator/data/itemDetailMap.json'));
const { default: combatMonsterDetailMap } = await import(src('combatsimulator/data/combatMonsterDetailMap.json'));
const { default: openableLootDropMap } = await import(src('combatsimulator/data/openableLootDropMap.json'));

const ONE_HOUR = 3600 * 1e9;

const setups = PLAYERS.map(readSetup);
const dtos = setups.map((s, i) => buildDto(s, i + 1, { legacyImport: LEGACY_IMPORT }));

// Level-gap debuff (src/main.js:3195-3213)
let maxCL = 1;
for (const d of dtos) { d.combatLevel = calcCombatLevel(d.staminaLevel, d.intelligenceLevel, d.defenseLevel, d.attackLevel, d.meleeLevel, d.rangedLevel, d.magicLevel); maxCL = Math.max(maxCL, d.combatLevel); }
for (const d of dtos) d.debuffOnLevelGap = maxCL / d.combatLevel > 1.2 ? -Math.min(0.9, 3 * (maxCL / d.combatLevel - 1.2)) : 0;

// What src/worker.js:129-161 does (extra buffs off: Moo Pass, community and personal buffs are unknown).
const zone = new Zone(ZONE, TIER);
const buffBase = { ratioBoost: 0, ratioBoostLevelBonus: 0, flatBoostLevelBonus: 0, startTime: '0001-01-01T00:00:00Z', duration: 0 };
const extraBuffs = [];
if (MOO_PASS) extraBuffs.push({ ...buffBase, uniqueHrid: '/buff_uniques/experience_moo_pass_buff', typeHrid: '/buff_types/wisdom', flatBoost: 0.05 });
if (COM_EXP > 0) extraBuffs.push({ ...buffBase, uniqueHrid: '/buff_uniques/experience_community_buff', typeHrid: '/buff_types/wisdom', flatBoost: 0.005 * (COM_EXP - 1) + 0.2 });
if (COM_DROP > 0) extraBuffs.push({ ...buffBase, uniqueHrid: '/buff_uniques/combat_community_buff', typeHrid: '/buff_types/combat_drop_quantity', flatBoost: 0.005 * (COM_DROP - 1) + 0.2 });
const players = dtos.map((d) => {
    const pl = Player.createFromDTO(structuredClone(d));
    pl.zoneBuffs = zone.buffs || [];
    pl.extraBuffs = extraBuffs;
    return pl;
});
const sim = new CombatSimulator(players, zone, null, {});
const t0 = Date.now();
const r = await sim.simulate(HOURS * ONE_HOUR);
const wallSeconds = (Date.now() - t0) / 1000;

// Prices: window.prices as src/main.js:4638-4733 builds it.
const market = JSON.parse(readFileSync(PRICES, 'utf8')).marketData;
const prices = {};
for (const item of Object.values(itemDetailMap)) {
    if (item.hrid in market) {
        prices[item.hrid] = { ask: -1, bid: -1, vendor: item.sellPrice };
        if (market[item.hrid]['0']) { prices[item.hrid].ask = market[item.hrid]['0'].a; prices[item.hrid].bid = market[item.hrid]['0'].b; }
    }
}
prices['/items/coin'] = { ask: 1, bid: 1, vendor: 1 };
for (const chest of ['/items/small_treasure_chest', '/items/medium_treasure_chest', '/items/large_treasure_chest']) {
    const sum = (side) => openableLootDropMap[chest].map((it) => (it.itemHrid in prices ? prices[it.itemHrid][side] * it.dropRate * (it.maxCount + it.minCount) / 2 : 0)).reduce((a, b) => a + b, 0);
    prices[chest] = { ask: sum('ask'), bid: sum('bid'), vendor: 0 };
}
// src/main.js:2347-2369 price choice
function uiPrice(hrid, setting) {
    const item = prices[hrid];
    if (!item) return -1;
    let p = -1;
    if (setting == 'bid') p = item.bid !== -1 ? item.bid : item.ask !== -1 ? item.ask : -1;
    else p = item.ask !== -1 ? item.ask : item.bid !== -1 ? item.bid : -1;
    return p == -1 ? item.vendor : p;
}
// Toolasha 3.28.10 panel valuation, default "hybrid" mode: drops at ask, coins at face value, openables at
// the expected value of their contents with 4% tax on taxable contents; consumables at ask.
const MARKET_TAX = 0.04;
function panelDropValue(hrid) {
    if (hrid === '/items/coin') return 1;
    if (openableLootDropMap[hrid]) {
        let ev = 0;
        for (const d of openableLootDropMap[hrid]) {
            if (!(d.dropRate > 0)) continue;
            const v = d.itemHrid === '/items/coin' ? 1 : (prices[d.itemHrid]?.ask ?? -1);
            if (!(v > 0)) continue;
            const amt = (d.minCount + d.maxCount) / 2 * d.dropRate * v;
            ev += d.itemHrid === '/items/coin' ? amt : amt * (1 - MARKET_TAX);
        }
        return ev;
    }
    const a = prices[hrid]?.ask;
    return a > 0 ? a : 0;
}

// src/main.js:1982-2070 calcDropMaps, expected ("No RNG") part only.
function noRngDrops(playerHrid) {
    const dropRateMultiplier = r.dropRateMultiplier[playerHrid];
    const rareFindMultiplier = r.rareFindMultiplier[playerHrid];
    const cdq = r.combatDropQuantity[playerHrid];
    const gap = r.debuffOnLevelGap[playerHrid];
    const n = r.numberOfPlayers;
    const out = new Map();
    const add = (k, v) => out.set(k, (out.get(k) || 0) + v);
    for (const m of Object.keys(r.deaths).filter((e) => !/^player\d$/.test(e))) {
        const md = combatMonsterDetailMap[m];
        if (!md.dropTable) continue;
        for (const d of md.dropTable) {
            if (d.minDifficultyTier > r.difficultyTier) continue;
            let rate = Math.min(1, (1 + 0.1 * r.difficultyTier) * (d.dropRate + (d.dropRatePerDifficultyTier ?? 0) * r.difficultyTier));
            if (rate <= 0) continue;
            rate = Math.min(1, rate * dropRateMultiplier);
            add(d.itemHrid, r.deaths[m] * rate * (d.maxCount + d.minCount) / 2 * (1 + gap) * (1 + cdq) / n);
        }
        for (const d of md.rareDropTable || []) {
            if (d.minDifficultyTier > r.difficultyTier) continue;
            add(d.itemHrid, r.deaths[m] * d.dropRate * rareFindMultiplier * (d.maxCount + d.minCount) / 2 * (1 + gap) * (1 + cdq) / n);
        }
    }
    return out;
}

const hoursForRates = (r.lastEncounterFinishTime > 0 ? r.lastEncounterFinishTime : r.simulatedTime) / ONE_HOUR; // src/main.js:2252-2257
const simHours = r.simulatedTime / ONE_HOUR;
const results = {};
dtos.forEach((d, i) => {
    const ph = d.hrid;
    const drops = noRngDrops(ph);
    let uiRevenue = 0, panelIncome = 0;
    const dropRows = [];
    for (const [hrid, amt] of drops) {
        const u = uiPrice(hrid, 'bid') * amt, pv = panelDropValue(hrid) * amt;
        uiRevenue += u; panelIncome += pv;
        dropRows.push({ item: hrid.replace('/items/', ''), perDay: amt / simHours * 24, panelValuePerDay: pv / simHours * 24 });
    }
    dropRows.sort((a, b) => b.panelValuePerDay - a.panelValuePerDay);
    let uiExpenses = 0, panelCons = 0;
    const consRows = [];
    for (const [hrid, n] of Object.entries(r.consumablesUsed[ph] || {})) {
        uiExpenses += uiPrice(hrid, 'ask') * n;
        panelCons += (prices[hrid]?.ask > 0 ? prices[hrid].ask : 500) * n;
        consRows.push({ item: hrid.replace('/items/', ''), perDay: n / simHours * 24, askPrice: prices[hrid]?.ask });
    }
    const xp = Object.values(r.experienceGained[ph] || {}).reduce((a, b) => a + b, 0);
    const deaths = r.deaths[ph] || 0;
    const perDay = (v) => v / simHours * 24;
    results[setups[i].name] = {
        encountersPerHour: r.encounters / hoursForRates,
        panel: { dailyIncome: perDay(panelIncome), dailyConsumables: perDay(panelCons), dailyProfit: perDay(panelIncome - panelCons) },
        uiDefault: { dailyRevenueBid: perDay(uiRevenue), dailyExpensesAsk: perDay(uiExpenses), dailyProfit: perDay(uiRevenue - uiExpenses) },
        expPerHour: xp / simHours,
        expBySkill: Object.fromEntries(Object.entries(r.experienceGained[ph] || {}).map(([k, v]) => [k, v / simHours])),
        deathsPerHour: deaths / simHours,
        deaths,
        multipliers: { dropRate: r.dropRateMultiplier[ph], rareFind: r.rareFindMultiplier[ph], dropQuantity: r.combatDropQuantity[ph], levelGap: r.debuffOnLevelGap[ph] },
        consumables: consRows,
        topDrops: dropRows.slice(0, 15),
        ranOutOfMana: r.playerRanOutOfMana?.[ph] || false,
    };
});
const kills = Object.fromEntries(Object.entries(r.deaths).filter(([k]) => !/^player\d$/.test(k)).map(([k, v]) => [k, v / simHours]));
const summary = { args: { HOURS, SEED, TIER, ZONE, LEGACY_IMPORT, COM_DROP, COM_EXP, MOO_PASS, PRICES: path.basename(PRICES) }, wallSeconds, simHours, encounters: r.encounters, killsPerHour: kills, maxEnrageStack: r.maxEnrageStack, players: results };
const json = JSON.stringify(summary, null, 2);
if (OUT) writeFileSync(OUT, json);
console.log(json);
