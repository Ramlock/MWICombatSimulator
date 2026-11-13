// Talismans for the combat engine: the modifier table (game client data) and the one function that turns a player's
// talisman lines into engine effects. This is the only file with talisman logic; the setup reads it in one place
// (src/simSetup.js, createSimPlayer). A later swap for another implementation replaces this file and that call.
//
// The table is data: per modifier the six grade values (G1..G6, as in the game's client data, talismanModifierDetailMap)
// and the engine stats it maps to (the names player.js sums from equipment). A talisman line is a plain gear stat: the
// player adds it to that sum (Player.talismanStats, set by simSetup applyTalismans).
// Damage Taken is a gear stat like the others: combatUnit.js adds it to the buffs' damage_taken.
// The five unique modifiers are listed as known and have no effect (not simulated).

// An effect on an engine combat stat: summed like a gear stat.
const stat = (name) => ({ stat: name });

// id -> { name, grades: [G1..G6], effects: [...] } ; `unique: true` entries have no effects.
export const TALISMAN_MODIFIERS = {
    auto_attack_damage: { name: 'Auto Attack Damage', grades: [0.012, 0.018, 0.024, 0.03, 0.036, 0.048], effects: [stat('autoAttackDamage')] },
    ability_damage: { name: 'Ability Damage', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('abilityDamage')] },
    attack_speed: { name: 'Attack Speed', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('attackSpeed')] },
    cast_speed: { name: 'Cast Speed', grades: [0.012, 0.018, 0.024, 0.03, 0.036, 0.048], effects: [stat('castSpeed')] },
    ability_haste: { name: 'Ability Haste', grades: [1, 1.5, 2, 2.5, 3, 4], effects: [stat('abilityHaste')] },
    critical_rate: { name: 'Critical Rate', grades: [0.006, 0.009, 0.012, 0.015, 0.018, 0.024], effects: [stat('criticalRate')] },
    critical_damage: { name: 'Critical Damage', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('criticalDamage')] },
    healing_amplify: { name: 'Healing Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('healingAmplify')] },
    armor_penetration: { name: 'Armor Penetration', grades: [0.02, 0.03, 0.04, 0.05, 0.06, 0.08], effects: [stat('armorPenetration')] },
    melee_accuracy: { name: 'Melee Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('stabAccuracy'), stat('slashAccuracy'), stat('smashAccuracy')] },
    ranged_accuracy: { name: 'Ranged Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('rangedAccuracy')] },
    magic_accuracy: { name: 'Magic Accuracy', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('magicAccuracy')] },
    melee_damage: { name: 'Melee Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('stabDamage'), stat('slashDamage'), stat('smashDamage')] },
    ranged_damage: { name: 'Ranged Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('rangedDamage')] },
    magic_damage: { name: 'Magic Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('magicDamage')] },
    defensive_damage: { name: 'Defensive Damage', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('defensiveDamage')] },
    physical_amplify: { name: 'Physical Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('physicalAmplify')] },
    // Elemental: all three elements (his presumption, 2026-11-12); one list each, change it here.
    elemental_amplify: { name: 'Elemental Amplify', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('waterAmplify'), stat('natureAmplify'), stat('fireAmplify')] },
    elemental_penetration: { name: 'Elemental Penetration', grades: [0.02, 0.03, 0.04, 0.05, 0.06, 0.08], effects: [stat('waterPenetration'), stat('naturePenetration'), stat('firePenetration')] },
    thorns: { name: 'Thorns', grades: [0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02], effects: [stat('physicalThorns'), stat('elementalThorns')] },
    max_hitpoints: { name: 'Max Hitpoints', grades: [20, 30, 40, 50, 60, 80], effects: [stat('maxHitpoints')] },
    max_manapoints: { name: 'Max Manapoints', grades: [20, 30, 40, 50, 60, 80], effects: [stat('maxManapoints')] },
    armor: { name: 'Armor', grades: [2, 3, 4, 5, 6, 8], effects: [stat('armor')] },
    damage_taken: { name: 'Damage Taken', grades: [-0.005, -0.0075, -0.01, -0.0125, -0.015, -0.02], effects: [stat('damageTaken')] },    tenacity: { name: 'Tenacity', grades: [6, 9, 12, 15, 18, 24], effects: [stat('tenacity')] },
    hp_regen: { name: 'HP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [stat('hpRegenPer10')] },
    mp_regen: { name: 'MP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [stat('mpRegenPer10')] },
    melee_evasion: { name: 'Melee Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('stabEvasion'), stat('slashEvasion'), stat('smashEvasion')] },
    ranged_evasion: { name: 'Ranged Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('rangedEvasion')] },
    magic_evasion: { name: 'Magic Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('magicEvasion')] },
    elemental_resistance: { name: 'Elemental Resistance', grades: [2, 3, 4, 5, 6, 8], effects: [stat('waterResistance'), stat('natureResistance'), stat('fireResistance')] },
    threat: { name: 'Increased Threat', grades: [4, 6, 8, 10, 12, 16], effects: [stat('threat')] },
    threat_reduction: { name: 'Reduced Threat', grades: [-4, -6, -8, -10, -12, -16], effects: [stat('threat')] },
    combat_drop_rate: { name: 'Combat Drop Rate', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('combatDropRate')] },
    combat_rare_find: { name: 'Combat Rare Find', grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('combatRareFind')] },
    combat_experience: { name: 'Combat Experience', grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('combatExperience')] },
    stamina_experience: { name: 'Stamina Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('staminaExperience')] },
    intelligence_experience: { name: 'Intelligence Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('intelligenceExperience')] },
    attack_experience: { name: 'Attack Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('attackExperience')] },
    defense_experience: { name: 'Defense Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('defenseExperience')] },
    melee_experience: { name: 'Melee Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('meleeExperience')] },
    ranged_experience: { name: 'Ranged Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('rangedExperience')] },
    magic_experience: { name: 'Magic Experience', grades: [0.015, 0.0225, 0.03, 0.0375, 0.045, 0.06], effects: [stat('magicExperience')] },
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
// modifier: a TALISMAN_MODIFIERS id; grade: 1..6. Returns [{ modifier, stat, value }]; unique modifiers give none.
// An unknown modifier or a grade outside 1..6 throws.
export function talismanEffects(talismans) {
    const power = talismans?.power ?? 0;
    const out = [];
    for (const line of talismans?.lines ?? []) {
        const mod = TALISMAN_MODIFIERS[line.modifier];
        if (!mod) throw new Error(`unknown talisman modifier "${line.modifier}"`);
        if (!Number.isInteger(line.grade) || line.grade < 1 || line.grade > 6) throw new Error(`talisman grade ${line.grade} for "${line.modifier}" is not 1..6`);
        const value = scaleByPower(mod.grades[line.grade - 1], power);
        for (const e of mod.effects) out.push({ modifier: line.modifier, stat: e.stat, value });
    }
    return out;
}

// The effects summed per engine stat name: { stat: value }, what Player.talismanStats takes.
export function talismanStats(talismans) {
    const stats = {};
    for (const e of talismanEffects(talismans)) stats[e.stat] = (stats[e.stat] ?? 0) + e.value;
    return stats;
}
