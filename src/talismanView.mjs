// The player's talismans, shown read-only with the equipment: each line's modifier name and grade, and the talisman power. Display only: the
// names come from the module's table (src/combatsimulator/talismans.js), the stats from nothing here (the engine applies them, src/simSetup.js).
// No input and no edit control. A player with no `talismans` field, or no line, shows nothing.
import { TALISMAN_MODIFIERS } from './combatsimulator/talismans.js';

// A modifier whose name is one of the game's own translated strings (the game's bundle in js/i18n.js): its key there, so the page's
// translation (data-i18n, updateContent) shows the game's word in each language. A modifier not listed (melee and elemental lines, Thorns,
// Threat Reduction, the five unique ones) has no string in that bundle: its name is `common:talismans.names.<id>` in locales/*/common.json, the
// game's own words (en, pt, zh) from the game's current client (talismanModifierNames, combatStats, talismansPanel.reducedThreat).
export const TALISMAN_NAME_KEYS = {
    auto_attack_damage: 'combatStats.autoAttackDamage', ability_damage: 'combatStats.abilityDamage', attack_speed: 'combatStats.attackSpeed',
    cast_speed: 'combatStats.castSpeed', ability_haste: 'combatStats.abilityHaste', critical_rate: 'combatStats.criticalRate',
    critical_damage: 'combatStats.criticalDamage', healing_amplify: 'combatStats.healingAmplify', armor_penetration: 'combatStats.armorPenetration',
    ranged_accuracy: 'combatStats.rangedAccuracy', magic_accuracy: 'combatStats.magicAccuracy', ranged_damage: 'combatStats.rangedDamage',
    magic_damage: 'combatStats.magicDamage', defensive_damage: 'combatStats.defensiveDamage', physical_amplify: 'combatStats.physicalAmplify',
    max_hitpoints: 'buffTypeNames./buff_types/max_hitpoints', max_manapoints: 'buffTypeNames./buff_types/max_manapoints', armor: 'combatStats.armor',
    damage_taken: 'combatStats.damageTaken', tenacity: 'combatStats.tenacity', hp_regen: 'combatStats.hpRegenPer10', mp_regen: 'combatStats.mpRegenPer10',
    ranged_evasion: 'combatStats.rangedEvasion', magic_evasion: 'combatStats.magicEvasion', threat: 'combatStats.threat',
    combat_drop_rate: 'combatStats.combatDropRate', combat_rare_find: 'combatStats.combatRareFind', combat_experience: 'combatStats.combatExperience',
    stamina_experience: 'combatStats.staminaExperience', intelligence_experience: 'combatStats.intelligenceExperience',
    attack_experience: 'combatStats.attackExperience', defense_experience: 'combatStats.defenseExperience', melee_experience: 'combatStats.meleeExperience',
    ranged_experience: 'combatStats.rangedExperience', magic_experience: 'combatStats.magicExperience',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The power as the game shows it: a fraction, 0.224 reads "+22.4%".
export const powerText = (power) => '+' + String(Math.round((Number(power) || 0) * 1000) / 10) + '%';

// The block's HTML for a player's talismans ({ power, lines: [{ modifier, grade }] }), or '' when there is nothing to show. `t(key)`: the page's
// translation, used for the first draw; every translated text also carries its data-i18n key, so a language change redraws it with the page.
export function talismanViewHtml(talismans, t) {
    const lines = Array.isArray(talismans?.lines) ? talismans.lines : [];
    if (!lines.length) return '';
    const tr = (key, fallback) => { const v = t ? t(key) : null; return typeof v === 'string' && v && v !== key && !v.endsWith('.' + key) ? v : fallback; };
    const items = lines.map((l) => {
        const name = TALISMAN_MODIFIERS[l.modifier]?.name ?? String(l.modifier);
        const key = TALISMAN_NAME_KEYS[l.modifier] ?? (TALISMAN_MODIFIERS[l.modifier] ? `common:talismans.names.${l.modifier}` : null);
        const label = key ? `<span data-i18n="${esc(key)}">${esc(tr(key, name))}</span>` : `<span>${esc(name)}</span>`;
        return `<li class="talisman-line">${label} <span class="talisman-grade">G${esc(l.grade)}</span></li>`;
    }).join('');
    return `<div class="col-md-2 col-form-label" data-i18n="common:talismans.title">${esc(tr('common:talismans.title', 'Talismans'))}</div>`
        + `<div class="col-md-10"><ul class="talisman-lines">${items}</ul>`
        + `<div class="talisman-power"><span data-i18n="common:talismans.power">${esc(tr('common:talismans.power', 'Talisman Power'))}</span> ${esc(powerText(talismans.power))}</div></div>`;
}
