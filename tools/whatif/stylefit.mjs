// Style fit of the what-if search: one place decides whether a piece of gear fits the player (`misfit`) and one whether an
// ability does (`abilityMisfit`); every candidate builder asks them, and what they drop is listed as left out. Gear or
// abilities of another style are never candidates, however good their other stats (Owner: "The other stats are too
// important"; "the what-if shouldn't even be TRYING to equip gear, abilities, coffees, etc., that don't match the player's
// combat style and element"). Everything is read from the game's own data; no item or ability is named here.
//
// Gear. What binds a piece (anything else is neutral and stays a candidate, unless a penalty rule below drops it):
//   - a POSITIVE base value of an offensive style stat: stab|slash|smash|melee, ranged or magic + Accuracy|Damage|Experience
//     (stab, slash, smash and melee all count as melee). Negative values (every melee and ranged piece carries a negative
//     magicAccuracy) and Evasion, Resistance, armor and the like say nothing about style.
//   - a POSITIVE base value of fire|water|nature + Amplify|Penetration binds it to that element.
//   - a weapon also binds to its own style (combatStats.combatStyleHrids[0]) and its element (combatStats.damageType).
// A piece fails the player when it is bound to styles that do not include his, or to elements that do not include his
// (only a mage has an element; a player with no element is never failed by an element binding, so a ranged piece with
// water amplify stays for a ranged player, and a style-free piece with an element amplify stays for melee and ranged),
// or by one of the two penalty rules:
//   P. a NEGATIVE value of his own style's Accuracy or Damage (melee: stab, slash, smash or melee), or, for a mage, of his
//      element's Amplify or Penetration (plate and bucklers for a mage: their magicAccuracy penalty);
//   F. for a ranged player, a piece whose level requirements name only Defense, with a negative magicAccuracy and no
//      positive stat of his style (the melee plate family, which carries no ranged penalty).
//
// Abilities. An ability fails the player by one of:
//   D. a damage effect whose combat style is not his (stab, slash, smash are melee); for a mage also one whose damage type is
//      not his element; for a melee player also one of another melee kind than his weapon's (a sword user is never offered
//      a stab or smash ability). An ability with no damage effect (heals, auras, buffs) is never failed by D.
//   B. a self buff with no damage effect, every boost of which helps only damage the player never deals. What a boost type
//      helps: `physical_amplify` physical damage, `<element>_amplify` that element's damage, `attack_speed` auto attacks
//      (a mage never auto attacks: the owner's 2026-11-10 ruling, the same one drinkfill.mjs rule b reads); any other boost
//      helps everyone. What the player deals: his weapon's damage type, the damage type of every ability D keeps for him,
//      and auto attacks unless he is a mage. So a mage drops a physical amplify or attack speed buff, a melee player an
//      elemental amplify buff, and a ranged player keeps it (his style's abilities deal elemental damage).
//
// The player's style is the one the engine reads from his weapon (drinkfill.mjs combatStyleOf), `kind` its raw style
// (stab|slash|smash|ranged|magic); his element is his weapon's damageType when he is a mage, else null. Pure functions.
import abilityDetailMap from '../../src/combatsimulator/data/abilityDetailMap.json' with { type: 'json' };
import { weaponStyleOf } from './drinkfill.mjs';

const STYLE_STAT = /^(stab|slash|smash|melee|ranged|magic)(Accuracy|Damage|Experience)$/;
const ELEMENT_STAT = /^(fire|water|nature)(Amplify|Penetration)$/;
const MELEE = new Set(['stab', 'slash', 'smash', 'melee']);
const short = (h) => String(h).split('/').pop();
const group = (s) => (MELEE.has(s) ? 'melee' : s);

// { styles: ['melee'|'ranged'|'magic'], elements: ['fire'|'water'|'nature'] } the piece is bound to; empty = neutral.
export function boundsOf(item) {
    const cs = item?.equipmentDetail?.combatStats || {}, styles = new Set(), elements = new Set();
    for (const [k, v] of Object.entries(cs)) {
        if (!(v > 0)) continue;
        let m = STYLE_STAT.exec(k);
        if (m) { styles.add(group(m[1])); continue; }
        m = ELEMENT_STAT.exec(k);
        if (m) elements.add(m[1]);
    }
    const style = cs.combatStyleHrids?.[0];
    if (style) styles.add(group(short(style)));
    const dmg = cs.damageType && short(cs.damageType);
    if (dmg && dmg !== 'physical') elements.add(dmg);
    return { styles: [...styles].sort(), elements: [...elements].sort() };
}

// The player's { style, element, kind } from his setup.
export function playerFit(setup, items) {
    const kind = weaponStyleOf(setup, items), style = group(kind);
    let element = null;
    if (style === 'magic') {
        for (const slot of ['main_hand', 'two_hand']) {
            const e = setup.player?.equipment?.find((x) => x.itemLocationHrid === '/item_locations/' + slot);
            const d = e && items[e.itemHrid]?.equipmentDetail?.combatStats?.damageType;
            if (d && short(d) !== 'physical') { element = short(d); break; }
        }
    }
    return { style, element, kind };
}

// Rule P: the negative stats of the player's own style (and, for a mage, of his element) the piece carries.
function penaltiesOf(cs, fit) {
    const own = (k) => { const m = /^(stab|slash|smash|melee|ranged|magic)(Accuracy|Damage)$/.exec(k); return m && group(m[1]) === fit.style; };
    const elem = (k) => { const m = ELEMENT_STAT.exec(k); return m && fit.style === 'magic' && m[1] === fit.element; };
    return Object.entries(cs).filter(([k, v]) => v < 0 && (own(k) || elem(k))).map(([k]) => k).sort();
}
// Rule F: a Defense-only piece with a magic penalty and nothing for a ranged player.
function defenseOnlyFor(item, fit) {
    if (fit.style !== 'ranged') return false;
    const req = item?.equipmentDetail?.levelRequirements || [], cs = item?.equipmentDetail?.combatStats || {};
    return req.length > 0 && req.every((r) => short(r.skillHrid) === 'defense') && cs.magicAccuracy < 0 && !Object.entries(cs).some(([k, v]) => v > 0 && /^ranged(Accuracy|Damage|Experience)$/.test(k));
}

// null when the piece fits (or is neutral); else why it is kept out: its bounds { styles, elements }, plus `penalty` (rule P:
// the stats) or `defenseOnly: true` (rule F) when that is what drops it.
export function misfit(item, fit) {
    const b = boundsOf(item);
    const styleOK = !b.styles.length || b.styles.includes(fit.style);
    const elemOK = !b.elements.length || fit.element == null || b.elements.includes(fit.element);
    if (!styleOK || !elemOK) return b;
    const penalty = penaltiesOf(item?.equipmentDetail?.combatStats || {}, fit);
    if (penalty.length) return { ...b, penalty };
    if (defenseOnlyFor(item, fit)) return { ...b, defenseOnly: true };
    return null;
}

// ---- Abilities ----
const damageEffects = (det) => (det?.abilityEffects || []).filter((e) => short(e.effectType) === 'damage');
// Rule D on one ability: null, or { styles, elements } of the damage effects that do not fit.
function damageMisfit(det, fit) {
    const bad = damageEffects(det).filter((e) => {
        const kind = short(e.combatStyleHrid), dmg = short(e.damageType);
        if (group(kind) !== fit.style) return true;
        if (fit.style === 'magic' && fit.element != null && dmg !== fit.element) return true;
        return fit.style === 'melee' && MELEE.has(fit.kind) && fit.kind !== 'melee' && kind !== fit.kind;
    });
    if (!bad.length) return null;
    return { styles: [...new Set(bad.map((e) => short(e.combatStyleHrid)))].sort(), elements: [...new Set(bad.map((e) => short(e.damageType)).filter((d) => d && d !== 'physical'))].sort() };
}
// What a boost type helps: a damage kind ('physical', an element, 'auto' for auto attacks), or null for everyone.
function helps(typeHrid) {
    const t = short(typeHrid);
    if (t === 'physical_amplify') return 'physical';
    if (t === 'attack_speed') return 'auto';
    const m = /^(fire|water|nature)_amplify$/.exec(t);
    return m ? m[1] : null;
}
// The damage kinds the player deals (see the header, rule B). Cached per fit.
const dealsCache = new Map();
export function dealsOf(fit) {
    const key = `${fit.style}|${fit.element}|${fit.kind}`;
    let d = dealsCache.get(key);
    if (!d) {
        d = new Set(fit.style === 'magic' ? [] : ['auto', 'physical']);
        if (fit.style === 'magic' && fit.element) d.add(fit.element);
        for (const det of Object.values(abilityDetailMap)) if (!damageMisfit(det, fit)) for (const e of damageEffects(det)) d.add(short(e.damageType));
        dealsCache.set(key, d);
    }
    return d;
}
// Rule B on one ability: null, or { buffs: [boost types] } when it is a self buff that helps nothing the player deals.
function buffMisfit(det, fit) {
    const effects = det?.abilityEffects || [];
    if (!effects.length || damageEffects(det).length || !effects.every((e) => e.targetType === 'self' && short(e.effectType) === 'buff')) return null;
    const boosts = effects.flatMap((e) => e.buffs || []);
    if (!boosts.length) return null;
    const deals = dealsOf(fit);
    if (!boosts.every((b) => { const h = helps(b.typeHrid); return h != null && !deals.has(h); })) return null;
    return { styles: [], elements: [], buffs: [...new Set(boosts.map((b) => short(b.typeHrid)))].sort() };
}

// null when the ability fits the player; else why it is kept out: { styles, elements } of its damage (rule D), or
// { styles: [], elements: [], buffs } (rule B). `ability` is an ability hrid or its detail.
export function abilityMisfit(ability, fit) {
    const det = typeof ability === 'string' ? abilityDetailMap[ability] : ability;
    if (!det) return null;
    return damageMisfit(det, fit) || buffMisfit(det, fit);
}
