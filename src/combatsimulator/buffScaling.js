// How a drink's buff and an aura's buff are scaled before they are added to a unit. Shared by the combat
// (CombatSimulator.tryUseConsumable / processAbilityBuffEffect) and the Combat Stats panel (src/simSetup.js),
// so both compute the same value.

// A drink's buff: ratio and flat scaled by drink concentration, duration shortened by it. A food's or any
// other consumable's buff is returned as a plain copy.
export function scaleConsumableBuff(buff, consumable, drinkConcentration) {
    const currentBuff = structuredClone(buff);
    if (drinkConcentration > 0 && consumable.catagoryHrid.includes("drink")) {
        currentBuff.ratioBoost *= (1 + drinkConcentration);
        currentBuff.flatBoost *= (1 + drinkConcentration);
        currentBuff.duration = currentBuff.duration / (1 + drinkConcentration);
    }
    return currentBuff;
}

// A special ability's (aura's) buff: ratio and flat scaled by 1 + the caster's effective level in the aura's skill
// times multiplierPerSkillLevel. Any other ability buff is returned as it is (not copied).
export function scaleAbilityBuff(buff, ability, source) {
    if (ability.isSpecialAbility && buff.multiplierForSkillHrid && buff.multiplierPerSkillLevel > 0) {
        const multiplier = 1.0 + source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level'] * buff.multiplierPerSkillLevel;
        const currentBuff = structuredClone(buff);
        currentBuff.flatBoost *= multiplier;
        currentBuff.ratioBoost *= multiplier;
        return currentBuff;
    }
    return buff;
}
