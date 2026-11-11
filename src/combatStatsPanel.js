// What the Combat Stats panel (index.html, ids combatStat_*) shows for a combat unit's combatDetails.
// Shared by src/main.js (rendering) and tools/calibration/panel-check.mjs (the check against the engine).

import { numberHtml, percentHtml } from "./numberFormat.js";

// Effective skill levels: the raw level plus every level buff (house rooms, ...).
export const levelStats = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].map((skill) => skill + "Level");

// combatDetails values shown rounded down.
export const flooredStats = [
    "maxHitpoints",
    "maxManapoints",
    "stabAccuracyRating",
    "stabMaxDamage",
    "slashAccuracyRating",
    "slashMaxDamage",
    "smashAccuracyRating",
    "smashMaxDamage",
    "rangedAccuracyRating",
    "rangedMaxDamage",
    "magicAccuracyRating",
    "magicMaxDamage",
    "defensiveMaxDamage",
    "stabEvasionRating",
    "slashEvasionRating",
    "smashEvasionRating",
    "rangedEvasionRating",
    "magicEvasionRating",
    "totalArmor",
    "totalWaterResistance",
    "totalNatureResistance",
    "totalFireResistance",
    "totalThreat"
];

// combatDetails.combatStats values shown rounded down.
export const flooredCombatStats = [
    "abilityHaste",
    "tenacity"
];

// combatDetails.combatStats values shown as percentages.
export const percentCombatStats = [
    "physicalAmplify",
    "waterAmplify",
    "natureAmplify",
    "fireAmplify",
    "healingAmplify",
    "lifeSteal",
    "hpRegenPer10",
    "mpRegenPer10",
    "physicalThorns",
    "elementalThorns",
    "criticalRate",
    "criticalDamage",
    "combatExperience",
    "combatRareFind",
    "taskDamage",
    "armorPenetration",
    "waterPenetration",
    "naturePenetration",
    "firePenetration",
    "manaLeech",
    "castSpeed",
    "parry",
    "mayhem",
    "pierce",
    "curse",
    "fury",
    "weaken",
    "ripple",
    "bloom",
    "blaze",
    "attackSpeed",
    "autoAttackDamage",
    "abilityDamage",
    "drinkConcentration",
    "foodHaste",
    "staminaExperience",
    "intelligenceExperience",
    "attackExperience",
    "defenseExperience",
    "meleeExperience",
    "rangedExperience",
    "magicExperience"
];

// The HTML of every numeric panel row, keyed by the element id's suffix (combatStat_<key>). Display text follows
// src/numberFormat.js; each value carries its exact figure (hover title), so equal panels mean equal stats.
export function getCombatStatsPanelValues(combatDetails) {
    const values = {};
    values.attackInterval = numberHtml(combatDetails.combatStats.attackInterval / 1e9, "s", { minDecimals: 2 });
    levelStats.forEach((stat) => {
        values[stat] = numberHtml(combatDetails[stat]);
    });
    flooredStats.forEach((stat) => {
        values[stat] = numberHtml(Math.floor(combatDetails[stat]));
    });
    flooredCombatStats.forEach((stat) => {
        values[stat] = numberHtml(Math.floor(combatDetails.combatStats[stat]));
    });
    percentCombatStats.forEach((stat) => {
        values[stat] = percentHtml(100 * combatDetails.combatStats[stat]);
    });
    return values;
}
