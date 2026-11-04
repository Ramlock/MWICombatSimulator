// Headless calibration harness: runs the engine as src/worker.js does on the party setups in
// docs/ground-truth/setups, then computes the in-game panel's metrics per player.
// Usage: node tools/calibration/run.mjs [--hours 24] [--seed 1] [--tier 4]
//        [--zone /actions/combat/infernal_abyss] [--prices <marketplace.json>] [--guild] [--out <file.json>]
// --guild maps the setups' guildCombatBuffLevels onto the engine's guild buffs (the UI import ignores them).
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
const GUILD = arg('guild', false) === true;
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
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { default: itemDetailMap } = await import(src('combatsimulator/data/itemDetailMap.json'));
const { default: combatMonsterDetailMap } = await import(src('combatsimulator/data/combatMonsterDetailMap.json'));
const { default: openableLootDropMap } = await import(src('combatsimulator/data/openableLootDropMap.json'));
const { default: abilitySlotsLevelRequirementList } = await import(src('combatsimulator/data/abilitySlotsLevelRequirementList.json'));
const { default: combatTriggerConditionDetailMap } = await import(src('combatsimulator/data/combatTriggerConditionDetailMap.json'));
const { default: guildBuffDetailMap } = await import(src('combatsimulator/data/guildBuffDetailMap.json'));

const ONE_HOUR = 3600 * 1e9;

// src/main.js:3983 fixTriggerMap
function fixTriggerMap(triggerMap) {
    for (const key of Object.keys(triggerMap)) {
        if (triggerMap[key] == null) triggerMap[key] = [];
        if (triggerMap[key].some((t) => !combatTriggerConditionDetailMap[t.conditionHrid])) delete triggerMap[key];
    }
}

// src/main.js:745 calcCombatLevel
function calcCombatLevel(sta, int, def, att, mel, ran, mag) {
    return 0.1 * (sta + int + att + def + Math.max(mel, ran, mag)) + 0.5 * Math.max(att, def, mel, ran, mag);
}

// The DTO the UI builds after doSoloImport (src/main.js:4265) + startSimulation (src/main.js:3144-3213).
function buildDto(setup, j) {
    const triggerMap = structuredClone(setup.triggerMap || {});
    fixTriggerMap(triggerMap);
    const p = setup.player;
    const dto = {
        hrid: 'player' + j,
        staminaLevel: p.staminaLevel, intelligenceLevel: p.intelligenceLevel, attackLevel: p.attackLevel,
        meleeLevel: p.meleeLevel ?? p.powerLevel, defenseLevel: p.defenseLevel, rangedLevel: p.rangedLevel, magicLevel: p.magicLevel,
        equipment: {}, food: [], drinks: [], abilities: [],
        houseRooms: setup.houseRooms || {},
        labyrinthUpgrades: {}, // src/main.js:3184-3187
        guildBuffs: {},
        achievements: setup.achievements || {},
    };
    // Equipment selects exist for these locations only (src/main.js:4276-4302); trinket has no UI slot.
    for (const loc of ['head', 'body', 'legs', 'feet', 'hands', 'off_hand', 'pouch', 'neck', 'earrings', 'ring', 'back', 'charm', 'main_hand', 'two_hand']) {
        const it = p.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + loc);
        if (!it) continue;
        const type = itemDetailMap[it.itemHrid].equipmentDetail.type;
        dto.equipment[type] = new Equipment(it.itemHrid, it.enhancementLevel);
    }
    if (GUILD && setup.guildCombatBuffLevels) {
        for (const [k, lvl] of Object.entries(setup.guildCombatBuffLevels)) {
            const hrid = `/guild_buffs/${k}_combat`;
            if (guildBuffDetailMap[hrid] && lvl > 0) dto.guildBuffs[hrid] = lvl;
        }
    }
    // Slot counts come from the pouch (src/main.js:3156-3170 via player.combatDetails).
    const probe = Player.createFromDTO(structuredClone({ ...dto, food: [], drinks: [], abilities: [] }));
    probe.updateCombatDetails();
    const food = (setup.food['/action_types/combat'] || []).map((f) => f?.itemHrid || '');
    const drinks = (setup.drinks['/action_types/combat'] || []).map((d) => (d?.itemHrid || '').replace('power', 'melee'));
    for (let i = 0; i < 3; i++) {
        dto.food[i] = food[i] && i < probe.combatDetails.combatStats.foodSlots ? new Consumable(food[i], triggerMap[food[i]]) : null;
        dto.drinks[i] = drinks[i] && i < probe.combatDetails.combatStats.drinkSlots ? new Consumable(drinks[i], triggerMap[drinks[i]]) : null;
    }
    // Abilities: 5 entries → slots 0..4 (src/main.js:4320-4350); slot gate src/main.js:3173-3181.
    const abil = setup.abilities || [];
    const hasSpecial = abil.length == 5;
    for (let i = 0; i < 5; i++) {
        const a = hasSpecial ? abil[i] : abil[i - 1];
        dto.abilities[i] = a && a.abilityHrid && Number(a.level) > 0 && dto.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]
            ? new Ability(a.abilityHrid, Number(a.level), triggerMap[a.abilityHrid]) : null;
    }
    return structuredClone(dto);
}

const setups = PLAYERS.map((n) => JSON.parse(readFileSync(path.join(root, 'docs', 'ground-truth', 'setups', n + '.json'), 'utf8')));
const dtos = setups.map((s, i) => buildDto(s, i + 1));

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
const summary = { args: { HOURS, SEED, TIER, ZONE, GUILD, COM_DROP, COM_EXP, MOO_PASS, PRICES: path.basename(PRICES) }, wallSeconds, simHours, encounters: r.encounters, killsPerHour: kills, maxEnrageStack: r.maxEnrageStack, players: results };
const json = JSON.stringify(summary, null, 2);
if (OUT) writeFileSync(OUT, json);
console.log(json);
