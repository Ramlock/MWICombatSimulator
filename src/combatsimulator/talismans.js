// Talismans for the combat engine: the modifier table (game client data) and the one function that turns a player's
// talisman lines into engine effects. This is the only file with talisman logic; the setup reads it in one place
// (src/simSetup.js, createSimPlayer). A later swap for another implementation replaces this file and that call.
//
// The table is data: per modifier the six grade values (G1..G6, as in the game's client data, talismanModifierDetailMap)
// and the engine effects it maps to. An effect is { stat, buff }: `stat` is the engine's combat stat name
// (player.js combatStats), `buff` is the permanent buff that gives the same bonus ({ type, field }, a /buff_types/ name
// and the buff's flatBoost or ratioBoost) or null where the engine has no buff type for the stat.
// The five unique modifiers are listed as known and have no effect (not simulated).

const FLAT = 'flatBoost';
const RATIO = 'ratioBoost';
// An effect on a stat that a buff of the same name carries (same bonus as the stat).
const viaBuff = (stat, type, field = FLAT) => ({ stat, buff: { type, field } });
// An effect on a stat the engine takes only from equipment (no buff type carries it).
const statOnly = (stat) => ({ stat, buff: null });

// id -> { name, grades: [G1..G6], effects: [...] } ; `unique: true` entries have no effects.
export const TALISMAN_MODIFIERS = {
    auto_attack_damage: { name: 'Auto Attack Damage', grades: [0.012, 0.018, 0.024, 0.03, 0.036, 0.048], effects: [statOnly('autoAttackDamage')] },
    ability_damage: { name: 'Ability Damage', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [statOnly('abilityDamage')] },
    attack_speed: { name: 'Attack Speed', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('attackSpeed', 'attack_speed', RATIO)] }, // buff ratio: same for one source, multiplies (not adds) with other speed stats
    cast_speed: { name: 'Cast Speed', grades: [0.012, 0.018, 0.024, 0.03, 0.036, 0.048], effects: [viaBuff('castSpeed', 'cast_speed')] },
    ability_haste: { name: 'Ability Haste', grades: [1, 1.5, 2, 2.5, 3, 4], effects: [statOnly('abilityHaste')] },
    critical_rate: { name: 'Critical Rate', grades: [0.006, 0.009, 0.012, 0.015, 0.018, 0.024], effects: [viaBuff('criticalRate', 'critical_rate')] },
    critical_damage: { name: 'Critical Damage', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [viaBuff('criticalDamage', 'critical_damage')] },
    healing_amplify: { name: 'Healing Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('healingAmplify', 'healing_amplify')] },
    armor_penetration: { name: 'Armor Penetration', grades: [0.02, 0.03, 0.04, 0.05, 0.06, 0.08], effects: [statOnly('armorPenetration')] },
    melee_accuracy: { name: 'Melee Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('stabAccuracy'), statOnly('slashAccuracy'), statOnly('smashAccuracy')] },
    ranged_accuracy: { name: 'Ranged Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('rangedAccuracy')] },
    magic_accuracy: { name: 'Magic Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('magicAccuracy')] },
    melee_damage: { name: 'Melee Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [statOnly('stabDamage'), statOnly('slashDamage'), statOnly('smashDamage')] },
    ranged_damage: { name: 'Ranged Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [statOnly('rangedDamage')] },
    magic_damage: { name: 'Magic Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [statOnly('magicDamage')] },
    defensive_damage: { name: 'Defensive Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [statOnly('defensiveDamage')] },
    physical_amplify: { name: 'Physical Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('physicalAmplify', 'physical_amplify')] },
    // Elemental: all three elements (his presumption, 2026-11-12); one list each, change it here.
    elemental_amplify: { name: 'Elemental Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('waterAmplify', 'water_amplify'), viaBuff('natureAmplify', 'nature_amplify'), viaBuff('fireAmplify', 'fire_amplify')] },
    elemental_penetration: { name: 'Elemental Penetration', grades: [0.02, 0.03, 0.04, 0.05, 0.06, 0.08], effects: [statOnly('waterPenetration'), statOnly('naturePenetration'), statOnly('firePenetration')] },
    thorns: { name: 'Thorns', grades: [0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02], effects: [viaBuff('physicalThorns', 'physical_thorns'), viaBuff('elementalThorns', 'elemental_thorns')] },
    max_hitpoints: { name: 'Max Hitpoints', grades: [20, 30, 40, 50, 60, 80], effects: [statOnly('maxHitpoints')] }, // the max_hitpoints buff is ratio only
    max_manapoints: { name: 'Max Manapoints', grades: [20, 30, 40, 50, 60, 80], effects: [statOnly('maxManapoints')] },
    armor: { name: 'Armor', grades: [2, 3, 4, 5, 6, 8], effects: [viaBuff('armor', 'armor')] },
    damage_taken: { name: 'Damage Taken', grades: [-0.005, -0.0075, -0.01, -0.0125, -0.015, -0.02], effects: [viaBuff('damageTaken', 'damage_taken')] }, // the engine reads this stat only from buffs
    tenacity: { name: 'Tenacity', grades: [6, 9, 12, 15, 18, 24], effects: [viaBuff('tenacity', 'tenacity')] },
    hp_regen: { name: 'HP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [viaBuff('hpRegenPer10', 'hp_regen')] },
    mp_regen: { name: 'MP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [viaBuff('mpRegenPer10', 'mp_regen')] },
    melee_evasion: { name: 'Melee Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('stabEvasion'), statOnly('slashEvasion'), statOnly('smashEvasion')] },
    ranged_evasion: { name: 'Ranged Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('rangedEvasion')] },
    magic_evasion: { name: 'Magic Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [statOnly('magicEvasion')] },
    elemental_resistance: { name: 'Elemental Resistance', grades: [2, 3, 4, 5, 6, 8], effects: [viaBuff('waterResistance', 'water_resistance'), viaBuff('natureResistance', 'nature_resistance'), viaBuff('fireResistance', 'fire_resistance')] },
    threat: { name: 'Increased Threat', grades: [4, 6, 8, 10, 12, 16], effects: [viaBuff('threat', 'threat')] },
    threat_reduction: { name: 'Reduced Threat', grades: [-4, -6, -8, -10, -12, -16], effects: [viaBuff('threat', 'threat')] },
    combat_drop_rate: { name: 'Combat Drop Rate', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('combatDropRate', 'combat_drop_rate')] },
    combat_rare_find: { name: 'Combat Rare Find', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [viaBuff('combatRareFind', 'rare_find')] },
    combat_experience: { name: 'Combat Experience', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [viaBuff('combatExperience', 'wisdom')] },
    stamina_experience: { name: 'Stamina Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('staminaExperience')] },
    intelligence_experience: { name: 'Intelligence Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('intelligenceExperience')] },
    attack_experience: { name: 'Attack Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('attackExperience')] },
    defense_experience: { name: 'Defense Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('defenseExperience')] },
    melee_experience: { name: 'Melee Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('meleeExperience')] },
    ranged_experience: { name: 'Ranged Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('rangedExperience')] },
    magic_experience: { name: 'Magic Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [statOnly('magicExperience')] },
    // Unique modifiers: known, no effect here (the engine has no code for them).
    smite: { name: 'Smite', unique: true, grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [] },
    overkill: { name: 'Overkill', unique: true, grades: [0.15, 0.225, 0.3, 0.375, 0.45, 0.6], effects: [] },
    echo: { name: 'Echo', unique: true, grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [] },
    shatter: { name: 'Shatter', unique: true, grades: [0.04, 0.06, 0.08, 0.1, 0.12, 0.16], effects: [] },
    fortify: { name: 'Fortify', unique: true, grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [] },
};

// How talisman power scales a grade value. ONE line, the only place the formula lives.
const scaleByPower = (value, power) => value * (1 + power); // unverified: formula not known (power 0 = the raw grade value)

// A player's talismans -> the engine effects of every line, in line order.
// talismans: { power, lines: [{ modifier, grade }] }   power: the belt's Talisman Power as a fraction (0.2 = +20 %), default 0;
// modifier: a TALISMAN_MODIFIERS id; grade: 1..6. Returns [{ modifier, stat, value, buff }] (buff: { type, field } or null);
// unique modifiers give none. An unknown modifier or a grade outside 1..6 throws.
export function talismanEffects(talismans) {
    const power = talismans?.power ?? 0;
    const out = [];
    for (const line of talismans?.lines ?? []) {
        const mod = TALISMAN_MODIFIERS[line.modifier];
        if (!mod) throw new Error(`unknown talisman modifier "${line.modifier}"`);
        if (!Number.isInteger(line.grade) || line.grade < 1 || line.grade > 6) throw new Error(`talisman grade ${line.grade} for "${line.modifier}" is not 1..6`);
        const value = scaleByPower(mod.grades[line.grade - 1], power);
        for (const e of mod.effects) out.push({ modifier: line.modifier, stat: e.stat, value, buff: e.buff });
    }
    return out;
}

// The one step that splits the effects by how the engine takes them: `buffs` are permanent buffs in the shape the engine's
// extraBuffs take, `stats` the effects no buff type carries, summed per engine stat name ({ stat: value }).
export function splitEffects(effects) {
    const buffs = [], stats = {};
    for (const e of effects) {
        if (e.buff) {
            buffs.push({
                uniqueHrid: '/buff_uniques/talisman_' + e.modifier,
                typeHrid: '/buff_types/' + e.buff.type,
                flatBoost: e.buff.field === 'flatBoost' ? e.value : 0,
                ratioBoost: e.buff.field === 'ratioBoost' ? e.value : 0,
                flatBoostLevelBonus: 0,
                ratioBoostLevelBonus: 0,
                startTime: '0001-01-01T00:00:00Z',
                duration: 0,
            });
        } else {
            stats[e.stat] = (stats[e.stat] ?? 0) + e.value;
        }
    }
    return { buffs, stats };
}
