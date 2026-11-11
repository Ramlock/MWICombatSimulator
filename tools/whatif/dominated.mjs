// Dominated market swaps: a swap from the worn item W (at its level) to X (at the level the swap gives it) that
// cannot help on any combat stat. The optimizer skips them and lists them in result.json `dominated`.
// A swap is dominated only when all hold (anything else is offered, the safe side):
//   1. neither item has any noncombat stat (the engine never reads them, so they are not judged at all);
//   2. no combat stat of either item is negative (each at its own level, through the engine's own
//      Equipment.getCombatStat, so the enhancement bonus is the engine's);
//   3. every combat stat key of X is a key of W, and X's value <= W's value for each;
//   4. every non-stat field is equal on both: in combatStats, the fields below (not stats), and every
//      equipmentDetail field other than the stat and bonus maps, `type` (equal by construction) and
//      `levelRequirements` (already filtered by the optimizer's requirement check).
// The engine's Equipment class is a static import of src/. In Node the loader hooks (engine.mjs) must be registered before this file is
// loaded: the Node shell and the tests import engine.mjs first. A bundler needs nothing.
import Equipment from '../../src/combatsimulator/equipment.js';

export const NON_STAT_COMBAT_FIELDS = ['combatStyleHrids', 'damageType', 'attackInterval', 'primaryTraining', 'focusTraining'];
const SKIPPED_DETAIL_FIELDS = new Set(['type', 'levelRequirements', 'combatStats', 'noncombatStats', 'combatEnhancementBonuses', 'noncombatEnhancementBonuses']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nonEmpty = (o) => !!o && Object.keys(o).length > 0;

// The item's combat stats at a level, as the engine reads them (non-stat fields left out).
export function combatStatsAt(item, level) {
    const eq = new Equipment(item.hrid, level), out = {};
    for (const k of Object.keys(item.equipmentDetail.combatStats || {})) if (!NON_STAT_COMBAT_FIELDS.includes(k)) out[k] = eq.getCombatStat(k);
    return out;
}

// Returns true when the swap W(wLevel) -> X(xLevel) is dominated (see the rules above).
export function isDominatedSwap(w, wLevel, x, xLevel) {
    const wd = w?.equipmentDetail, xd = x?.equipmentDetail;
    if (!wd || !xd) return false;
    if (nonEmpty(wd.noncombatStats) || nonEmpty(xd.noncombatStats)) return false;
    for (const k of NON_STAT_COMBAT_FIELDS) if (!same(wd.combatStats?.[k], xd.combatStats?.[k])) return false;
    for (const k of new Set([...Object.keys(wd), ...Object.keys(xd)])) if (!SKIPPED_DETAIL_FIELDS.has(k) && !same(wd[k], xd[k])) return false;
    const ws = combatStatsAt(w, wLevel), xs = combatStatsAt(x, xLevel);
    if ([...Object.values(ws), ...Object.values(xs)].some((v) => v < 0)) return false;
    return Object.entries(xs).every(([k, v]) => k in ws && v <= ws[k]);
}
