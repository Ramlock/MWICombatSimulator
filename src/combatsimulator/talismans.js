// Talismans for the combat engine: the modifier table (game client data) and the one function that turns a player's
// talisman lines into engine effects. This is the only file with talisman logic; the setup reads it in one place
// (src/simSetup.js, createSimPlayer). A later swap for another implementation replaces this file and that call.
//
// The table is data: per modifier the six grade values (G1..G6, as in the game's client data, talismanModifierDetailMap)
// and the engine stats it maps to (the names player.js sums from equipment). A talisman line is a plain gear stat: the
// player adds it to that sum (Player.talismanStats, set by simSetup applyTalismans).
// Damage Taken is a gear stat like the others: combatUnit.js adds it to the buffs' damage_taken.
// Four of the five unique modifiers (Smite, Shatter, Fortify, Overkill) are built from their in-game text, NOT checked against
// fights: their line value lands in Player.talismanStats under the modifier's id (no gear stat of that name exists, so
// Player.updateCombatDetails leaves it alone) and the engine reads it through the helpers at the bottom of this file
// (combatUtilities.js processAttack, combatSimulator.js). Echo has no effect (not simulated).

// ---- Unique modifiers: the open questions the in-game text leaves, one named setting each ----
// Each default is the plainest reading of the text; flip it here once a recording answers it. docs/codebase/talismans.md lists them.
export const UNIQUE_SETTINGS = {
    // Smite ("Deals X% more damage to bosses."). A boss is a monster the zone spawned as its boss (the boss encounter every
    // battlesPerBoss); with this on, also every monster of a dungeon's fixed waves (the waves the engine reports as boss waves).
    SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES: true,
    // Smite on the thorns and retaliation the player deals to a boss (damage over time needs no setting: it is a share of the
    // hit's damage, which already carries Smite).
    SMITE_ON_REFLECT: true,
    // Shatter ("Critical hits gain X% armor and resistance penetration."): true = added to the hit's penetration;
    // false = multiplied in, (1 + penetration) x (1 + X) - 1.
    SHATTER_ADDS_TO_PENETRATION: true,
    // Shatter on an ability's crit as well as an auto attack's.
    SHATTER_ON_ABILITIES: true,
    // Fortify ("When hit, gain X% armor and resistances for 5s, stacking up to 4 times."): true = a new stack restarts the
    // timer of all stacks (as the engine's Fury does); false = each stack runs its own 5 s (a fifth hit renews the oldest).
    FORTIFY_NEW_STACK_RESTARTS_ALL: true,
    // Fortify on an attack that missed the player (dodged): false = only a landed attack is "hit".
    FORTIFY_ON_MISS: false,
    // Overkill ("On a killing blow, stores X% of the excess damage and adds it as true damage to the first target of your next
    // successful direct attack."): the store carries across encounters, waves and deaths (the text names no expiry);
    // false = it empties at each encounter's end.
    OVERKILL_CARRIES_ACROSS_FIGHTS: true,
    // Two kills before the next landed attack: true = their stores add up; false = the later one overwrites.
    OVERKILL_KILLS_ADD_UP: true,
    // A kill by an area ability (every target) counts as a killing blow.
    OVERKILL_AREA_KILLS: true,
    // A kill by a damage-over-time tick counts as a killing blow.
    OVERKILL_DOT_KILLS: false,
    // A kill by the player's thorns or retaliation counts as a killing blow.
    OVERKILL_REFLECT_KILLS: false,
    // Excess damage is the hit's damage after armor or resistance, beyond the target's HP; false = the raw roll before it.
    OVERKILL_EXCESS_AFTER_MITIGATION: true,
    // A parry's counterattack is a direct attack (it may spend the store and its kill may fill it).
    OVERKILL_PARRY_IS_DIRECT: true,
};
// Fixed by the text itself.
export const FORTIFY_MAX_STACKS = 4;
export const FORTIFY_DURATION = 5e9; // 5 s in the engine's nanoseconds

// An effect on an engine combat stat: summed like a gear stat.
const stat = (name) => ({ stat: name });

// id -> { name, grades: [G1..G6], effects: [...] } ; a `unique: true` entry's effect is its own id, read by the engine (Echo: none).
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
    max_hitpoints: { name: 'Max HP', grades: [20, 30, 40, 50, 60, 80], effects: [stat('maxHitpoints')] },
    max_manapoints: { name: 'Max MP', grades: [20, 30, 40, 50, 60, 80], effects: [stat('maxManapoints')] },
    armor: { name: 'Armor', grades: [2, 3, 4, 5, 6, 8], effects: [stat('armor')] },
    damage_taken: { name: 'Damage Taken', grades: [-0.005, -0.0075, -0.01, -0.0125, -0.015, -0.02], effects: [stat('damageTaken')] },
    tenacity: { name: 'Tenacity', grades: [6, 9, 12, 15, 18, 24], effects: [stat('tenacity')] },
    hp_regen: { name: 'HP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [stat('hpRegenPer10')] },
    mp_regen: { name: 'MP Regen', grades: [0.0003, 0.00045, 0.0006, 0.00075, 0.0009, 0.0012], effects: [stat('mpRegenPer10')] },
    melee_evasion: { name: 'Melee Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('stabEvasion'), stat('slashEvasion'), stat('smashEvasion')] },
    ranged_evasion: { name: 'Ranged Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('rangedEvasion')] },
    magic_evasion: { name: 'Magic Evasion', grades: [0.08, 0.12, 0.16, 0.2, 0.24, 0.32], effects: [stat('magicEvasion')] },
    elemental_resistance: { name: 'Elemental Resistance', grades: [2, 3, 4, 5, 6, 8], effects: [stat('waterResistance'), stat('natureResistance'), stat('fireResistance')] },
    threat: { name: 'Threat', grades: [4, 6, 8, 10, 12, 16], effects: [stat('threat')] },
    threat_reduction: { name: 'Threat Reduction', grades: [-4, -6, -8, -10, -12, -16], effects: [stat('threat')] },
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
    // Unique modifiers: from the in-game text, not checked against fights; the engine reads each by its id (helpers below).
    // Echo: no effect (not simulated).
    smite: { name: 'Smite', unique: true, grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [stat('smite')] },
    overkill: { name: 'Overkill', unique: true, grades: [0.15, 0.225, 0.3, 0.375, 0.45, 0.6], effects: [stat('overkill')] },
    echo: { name: 'Echo', unique: true, grades: [0.03, 0.045, 0.06, 0.075, 0.09, 0.12], effects: [] },
    shatter: { name: 'Shatter', unique: true, grades: [0.04, 0.06, 0.08, 0.1, 0.12, 0.16], effects: [stat('shatter')] },
    fortify: { name: 'Fortify', unique: true, grades: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], effects: [stat('fortify')] },
};

// How talisman power scales a grade value. ONE line, the only place the formula lives.
const scaleByPower = (value, power) => value * (1 + power); // checked against the game's own combat stats at two talisman powers (power 0 = the raw grade value)

// A player's talismans -> the engine effects of every line, in line order.
// talismans: { power, lines: [{ modifier, grade }] }   power: the belt's Talisman Power as a fraction (0.2 = +20 %), default 0;
// modifier: a TALISMAN_MODIFIERS id; grade: 1..6. Returns [{ modifier, stat, value }]; Echo gives none. Talisman power scales
// every line the same way, the unique ones included.
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

// ---- The unique modifiers in the engine (from the in-game text, not checked against fights) ----
// A unit's value of a unique modifier: its summed line value (Player.talismanStats), 0 for a monster or a player without it.
export const uniqueValue = (unit, id) => unit?.talismanStats?.[id] ?? 0;

// Smite: is this unit a boss. Zone sets spawnedAsBoss / spawnedInFixedWave (zone.js) when it spawns a monster.
export const isBoss = (unit) => !!unit && !unit.isPlayer && (unit.spawnedAsBoss === true || (UNIQUE_SETTINGS.SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES && unit.spawnedInFixedWave === true));

// Smite: the damage multiplier of source on target (1 when it does not apply).
export function smiteMultiplier(source, target) {
    const v = uniqueValue(source, 'smite');
    return v && isBoss(target) ? 1 + v : 1;
}

// Shatter: a critical hit's penetration (one damage type's, armor or that element's), for that hit only.
export function shatterPenetration(source, penetration, isCrit, isAbility) {
    const v = uniqueValue(source, 'shatter');
    if (!v || !isCrit || (isAbility && !UNIQUE_SETTINGS.SHATTER_ON_ABILITIES)) return penetration;
    return UNIQUE_SETTINGS.SHATTER_ADDS_TO_PENETRATION ? penetration + v : (1 + penetration) * (1 + v) - 1;
}

// Fortify: the buffs the unit gains when hit at time `now` (to pass to addBuffs at `now`), [] when it has no Fortify. One buff per
// armor and resistance type (a ratio boost: a share of the base value, as every % armor buff in the engine); `stacks` on the buff.
const FORTIFY_TYPES = ['armor', 'water_resistance', 'nature_resistance', 'fire_resistance'];
const fortifyHrid = (type, slot) => `/buff_uniques/talisman_fortify_${type}` + (slot === undefined ? '' : `_${slot}`);
const live = (buff, now) => !!buff && buff.startTime + buff.duration > now;
export function fortifyBuffs(unit, now) {
    const v = uniqueValue(unit, 'fortify');
    if (!v) return [];
    const buffs = unit.combatBuffs ?? {};
    const make = (type, slot, stacks) => ({ uniqueHrid: fortifyHrid(type, slot), typeHrid: `/buff_types/${type}`, ratioBoost: stacks * v, flatBoost: 0, duration: FORTIFY_DURATION, stacks });
    if (UNIQUE_SETTINGS.FORTIFY_NEW_STACK_RESTARTS_ALL) {
        const cur = buffs[fortifyHrid('armor')];
        const stacks = live(cur, now) ? Math.min((cur.stacks ?? 1) + 1, FORTIFY_MAX_STACKS) : 1;
        return FORTIFY_TYPES.map((t) => make(t, undefined, stacks));
    }
    // Each stack its own buff and timer: a free (absent or run-out) slot, else the oldest.
    let slot = -1, oldest = Infinity;
    for (let i = 0; i < FORTIFY_MAX_STACKS; i++) {
        const b = buffs[fortifyHrid('armor', i)];
        if (!live(b, now)) { slot = i; break; }
        if (b.startTime < oldest) { oldest = b.startTime; slot = i; }
    }
    return FORTIFY_TYPES.map((t) => make(t, slot, 1));
}
// Fortify: the unit's live stacks at `now` (for tests and display).
export function fortifyStacks(unit, now) {
    const buffs = unit?.combatBuffs ?? {};
    if (UNIQUE_SETTINGS.FORTIFY_NEW_STACK_RESTARTS_ALL) { const b = buffs[fortifyHrid('armor')]; return live(b, now) ? b.stacks : 0; }
    let n = 0;
    for (let i = 0; i < FORTIFY_MAX_STACKS; i++) if (live(buffs[fortifyHrid('armor', i)], now)) n++;
    return n;
}

// Overkill: the store lives on the unit ({ amount, attack }: `attack` is the attack that filled it, so the same attack's later
// targets do not spend it). An attack is any object shared by the targets of one attack; null = a call of its own.
// The true damage the unit's landed hit of `attack` adds (its whole store, floored to whole HP), and the store empties; 0 when none.
export function overkillSpend(unit, attack) {
    const s = unit?.overkillStore;
    if (!s || !(s.amount > 0) || (attack && s.attack === attack)) return 0;
    unit.overkillStore = null;
    return Math.floor(s.amount);
}
// Overkill: a killing blow of `unit` in `attack` with `excess` damage beyond the target's HP fills the store.
export function overkillStore(unit, excess, attack) {
    const v = uniqueValue(unit, 'overkill');
    if (!v || !(excess > 0)) return;
    const prev = unit.overkillStore;
    const amount = v * excess + (UNIQUE_SETTINGS.OVERKILL_KILLS_ADD_UP && prev ? prev.amount : 0);
    unit.overkillStore = { amount, attack: attack ?? null };
}
