// Headless one-player run of the simulator engine from a ground-truth setup JSON (the "solo export" shape).
// Builds the player the way src/main.js does (new Player + Equipment/Consumable/Ability objects, structuredClone,
// Player.createFromDTO in the worker) and drives CombatSimulator exactly as src/worker.js does.
//
//   node tools/headless-sim.mjs --setup docs/ground-truth/setups/Ramlock.json --houses asis|zero [--hours 1] [--seed 1] [--out file.json]
//
// --houses zero sets every house room to 0 before the run; asis keeps the file's levels.
import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "..");
register(pathToFileURL(resolvePath(here, "loader.mjs")).href);

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
}, []));
const setupPath = resolvePath(root, args.setup ?? "docs/ground-truth/setups/Ramlock.json");
const houses = args.houses ?? "asis";
const hours = Number(args.hours ?? 1);
const seed = Number(args.seed ?? 1);
const difficulty = Number(args.difficulty ?? 0);

// Seeded replacement for Math.random (the engine uses Math.random for parry, threat targeting, mayhem, pierce, blaze, bloom, ripple, stun).
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
Math.random = mulberry32(seed);

const src = (p) => import(pathToFileURL(resolvePath(root, "src/combatsimulator", p)).href);
const [{ default: Player }, { default: Equipment }, { default: Consumable }, { default: Ability }, { default: Zone },
    { default: CombatSimulator }, { default: itemDetailMap }, { default: houseRoomDetailMap }, { default: slotReq }] = await Promise.all([
    src("player.js"), src("equipment.js"), src("consumable.js"), src("ability.js"), src("zone.js"),
    src("combatSimulator.js"), src("data/itemDetailMap.json"), src("data/houseRoomDetailMap.json"), src("data/abilitySlotsLevelRequirementList.json"),
]);

const setup = JSON.parse(readFileSync(setupPath, "utf8"));

// ---- Build the UI-side player (same field names/types as src/main.js's module-level `player`) ----
const player = new Player();
for (const skill of ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"]) {
    player[skill + "Level"] = setup.player[skill + "Level"];
}
// UI equipment list (src/main.js:4479, 4493-4506): trinket is not an input in the UI, so it is ignored here too.
for (const type of ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm", "main_hand", "two_hand"]) {
    const e = setup.player.equipment.find((x) => x.itemLocationHrid === "/item_locations/" + type);
    if (e) player.equipment["/equipment_types/" + type] = new Equipment(e.itemHrid, e.enhancementLevel);
}
player.updateCombatDetails(); // gives food/drink slot counts, as updateUI does before startSimulation reads them
const triggerMap = setup.triggerMap ?? {};
const foodSlots = player.combatDetails.combatStats.foodSlots;
const drinkSlots = player.combatDetails.combatStats.drinkSlots;
const foodHrids = setup.food["/action_types/combat"].map((f) => f.itemHrid).filter(Boolean);
const drinkHrids = setup.drinks["/action_types/combat"].map((f) => f.itemHrid).filter(Boolean);
for (let i = 0; i < 3; i++) {
    player.food[i] = foodHrids[i] && i < foodSlots ? new Consumable(foodHrids[i], triggerMap[foodHrids[i]]) : null;
    player.drinks[i] = drinkHrids[i] && i < drinkSlots ? new Consumable(drinkHrids[i], triggerMap[drinkHrids[i]]) : null;
}
for (let i = 0; i < 5; i++) {
    const a = setup.abilities[i];
    player.abilities[i] = a && a.abilityHrid && player.intelligenceLevel >= slotReq[i + 1]
        ? new Ability(a.abilityHrid, Number(a.level), triggerMap[a.abilityHrid]) : null;
}
// houseRooms as a { hrid: level } dict (src/main.js:155-158, 4569-4579)
player.houseRooms = {};
for (const room of Object.values(houseRoomDetailMap)) player.houseRooms[room.hrid] = 0;
if (houses === "asis") Object.assign(player.houseRooms, setup.houseRooms);
player.achievements = setup.achievements ?? {};
player.guildBuffs = {}; // the file carries guildCombatBuffLevels, which the UI import (src/main.js:4377) does not read
player.labyrinthUpgrades = {};
player.hrid = "player1";
player.debuffOnLevelGap = 0;

const zoneHrid = args.zone ?? setup.zone;
const simPlayer = structuredClone(player);

// ---- Same steps as src/worker.js:139-144 ----
const zone = new Zone(zoneHrid, difficulty);
const enginePlayer = Player.createFromDTO(structuredClone(simPlayer));
enginePlayer.zoneBuffs = zone?.buffs || [];
enginePlayer.extraBuffs = [];

// Start-of-combat stats, three views of the same player:
//  panel  = what the stats panel in the UI computes (Player.updateCombatDetails, no permanent buffs: src/main.js:600-601)
//  engine = what the engine uses at time 0 (generatePermanentBuffs + reset(0): combatSimulator.js:338-343)
function snapshot(p) {
    const d = p.combatDetails, c = d.combatStats;
    const r = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
    return {
        stamina: r(d.staminaLevel), intelligence: r(d.intelligenceLevel), attack: r(d.attackLevel), melee: r(d.meleeLevel),
        defense: r(d.defenseLevel), ranged: r(d.rangedLevel), magic: r(d.magicLevel),
        maxHitpoints: d.maxHitpoints, maxManapoints: d.maxManapoints,
        attackIntervalSec: r(c.attackInterval / 1e9, 5), attackSpeedStat: r(c.attackSpeed), castSpeed: r(c.castSpeed, 5),
        hpRegenPer10: r(c.hpRegenPer10, 5), mpRegenPer10: r(c.mpRegenPer10, 5),
        wisdom_combatExperience: r(c.combatExperience, 5), rareFind: r(c.combatRareFind, 5), dropRate: r(c.combatDropRate, 5), dropQuantity: r(c.combatDropQuantity, 5),
        magicAccuracyRating: r(d.magicAccuracyRating, 2), magicMaxDamage: r(d.magicMaxDamage, 2), totalArmor: r(d.totalArmor, 2),
        permanentBuffTypes: Object.keys(p.permanentBuffs).length,
    };
}
const panelPlayer = Player.createFromDTO(structuredClone(simPlayer));
panelPlayer.updateCombatDetails();
const enginePlayerAtStart = Player.createFromDTO(structuredClone(simPlayer));
enginePlayerAtStart.zoneBuffs = enginePlayer.zoneBuffs;
enginePlayerAtStart.extraBuffs = [];
enginePlayerAtStart.generatePermanentBuffs();
enginePlayerAtStart.reset(0);
const startStats = { panel: snapshot(panelPlayer), engine: snapshot(enginePlayerAtStart) };

// ---- Run ----
const t0 = Date.now();
const sim = new CombatSimulator([enginePlayer], zone, null, {});
const log = console.log; console.log = () => { };
const res = await sim.simulate(hours * 3600 * 1e9);
console.log = log;
const wall = (Date.now() - t0) / 1000;

const h = res.simulatedTime / 3.6e12;
const totalXp = Object.values(res.experienceGained.player1 ?? {}).reduce((a, b) => a + b, 0);
const monsterKills = Object.entries(res.deaths).filter(([k]) => !k.startsWith("player"));
const out = {
    setup: setupPath.replace(root, "").replaceAll("\\", "/"), houses, seed, zone: zoneHrid, difficulty,
    houseRooms: player.houseRooms,
    wallSeconds: wall, simulatedHours: h,
    startStats,
    result: {
        encountersPerHour: res.encounters / h,
        killsPerHour: monsterKills.reduce((a, [, n]) => a + n, 0) / h,
        killsPerHourByMonster: Object.fromEntries(monsterKills.map(([k, n]) => [k, n / h])),
        playerDeathsPerHour: (res.deaths.player1 ?? 0) / h,
        totalXpPerHour: totalXp / h,
        xpPerHourBySkill: Object.fromEntries(Object.entries(res.experienceGained.player1 ?? {}).map(([k, v]) => [k, v / h])),
        rareFindMultiplier: res.rareFindMultiplier.player1,
        dropRateMultiplier: res.dropRateMultiplier.player1,
        combatDropQuantity: res.combatDropQuantity.player1,
    },
};
const json = JSON.stringify(out, null, 2);
if (args.out) writeFileSync(resolvePath(root, args.out), json);
console.log(json);
