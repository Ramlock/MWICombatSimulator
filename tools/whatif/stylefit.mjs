// Style fit of an equipment swap: a swap is limited to the player's combat style and, for magic, the element. Gear of another
// style is never a candidate, however good its armour (Owner: "The other stats are too important").
// What binds a piece (anything else is neutral and stays a candidate; the safe side):
//   - a POSITIVE base value of an offensive style stat: stab|slash|smash|melee, ranged or magic + Accuracy|Damage|Experience
//     (stab, slash, smash and melee all count as melee). Negative values (every melee and ranged piece carries a negative
//     magicAccuracy) and Evasion, Resistance, armor and the like say nothing about style.
//   - a POSITIVE base value of fire|water|nature + Amplify|Penetration binds it to that element.
//   - a weapon also binds to its own style (combatStats.combatStyleHrids[0]) and its element (combatStats.damageType).
// The player's style is the one the engine reads from his weapon (drinkfill.mjs combatStyleOf); his element is his weapon's
// damageType when he is a mage (physical or no weapon: none, so any element-bound piece fails). Pure functions.
import { combatStyleOf } from './drinkfill.mjs';

const STYLE_STAT = /^(stab|slash|smash|melee|ranged|magic)(Accuracy|Damage|Experience)$/;
const ELEMENT_STAT = /^(fire|water|nature)(Amplify|Penetration)$/;
const MELEE = new Set(['stab', 'slash', 'smash', 'melee']);
const short = (h) => String(h).split('/').pop();

// { styles: ['melee'|'ranged'|'magic'], elements: ['fire'|'water'|'nature'] } the piece is bound to; empty = neutral.
export function boundsOf(item) {
    const cs = item?.equipmentDetail?.combatStats || {}, styles = new Set(), elements = new Set();
    for (const [k, v] of Object.entries(cs)) {
        if (!(v > 0)) continue;
        let m = STYLE_STAT.exec(k);
        if (m) { styles.add(MELEE.has(m[1]) ? 'melee' : m[1]); continue; }
        m = ELEMENT_STAT.exec(k);
        if (m) elements.add(m[1]);
    }
    const style = cs.combatStyleHrids?.[0];
    if (style) styles.add(MELEE.has(short(style)) ? 'melee' : short(style));
    const dmg = cs.damageType && short(cs.damageType);
    if (dmg && dmg !== 'physical') elements.add(dmg);
    return { styles: [...styles].sort(), elements: [...elements].sort() };
}

// The player's { style, element } from his setup.
export function playerFit(setup, items) {
    const style = combatStyleOf(setup, items);
    let element = null;
    if (style === 'magic') {
        for (const slot of ['main_hand', 'two_hand']) {
            const e = setup.player?.equipment?.find((x) => x.itemLocationHrid === '/item_locations/' + slot);
            const d = e && items[e.itemHrid]?.equipmentDetail?.combatStats?.damageType;
            if (d && short(d) !== 'physical') { element = short(d); break; }
        }
    }
    return { style, element };
}

// null when the item fits (or is neutral); else the bounds that keep it out: { styles, elements }.
export function misfit(item, fit) {
    const b = boundsOf(item);
    const styleOK = !b.styles.length || b.styles.includes(fit.style);
    const elemOK = !b.elements.length || (fit.element != null && b.elements.includes(fit.element));
    return styleOK && elemOK ? null : b;
}
