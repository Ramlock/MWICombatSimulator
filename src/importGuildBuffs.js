// Imported sets carry guild buffs in one of two shapes: the simulator's own
// `guildBuffs` keyed by hrid, or the game-side exporters'
// `guildCombatBuffLevels: {force, tempo, spirit, rarity, scholar}`.
// Returns one hrid-keyed map; `guildBuffs` wins where both name a buff.
// Exporter names with no matching combat guild buff are skipped. The reading is guildLevels (src/guildLevels.mjs).
import guildBuffDetailMap from "./combatsimulator/data/guildBuffDetailMap.json";
import { guildLevels } from "./guildLevels.mjs";

export default function getImportedGuildBuffs(importSet) {
    return guildLevels(importSet, (hrid) => !!guildBuffDetailMap[hrid]);
}
