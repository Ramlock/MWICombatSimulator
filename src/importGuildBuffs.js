// Imported sets carry guild buffs in one of two shapes: the simulator's own
// `guildBuffs` keyed by hrid, or the game-side exporters'
// `guildCombatBuffLevels: {force, tempo, spirit, rarity, scholar}`.
// Returns one hrid-keyed map; `guildBuffs` wins where both name a buff.
// Exporter names with no matching combat guild buff are skipped.
import guildBuffDetailMap from "./combatsimulator/data/guildBuffDetailMap.json";

export default function getImportedGuildBuffs(importSet) {
    const result = {};
    const levels = importSet?.guildCombatBuffLevels;
    if (levels && typeof levels === "object") {
        for (const [name, level] of Object.entries(levels)) {
            const hrid = "/guild_buffs/" + name + "_combat";
            if (guildBuffDetailMap[hrid]) {
                result[hrid] = parseInt(level) || 0;
            }
        }
    }
    const buffs = importSet?.guildBuffs;
    if (buffs && typeof buffs === "object") {
        Object.assign(result, buffs);
    }
    return result;
}
