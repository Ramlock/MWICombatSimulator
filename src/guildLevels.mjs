// A setup's guild buff levels, in one place: the simulator's own `guildBuffs` keyed by hrid, or the game-side exporters'
// `guildCombatBuffLevels: {force, tempo, spirit, rarity, scholar}`. Returns one hrid-keyed map; `guildBuffs` wins where both name a
// buff. `known(hrid)`: whether the exporter name maps to a combat guild buff (names that do not are skipped). Pure (no data import), so
// the page, the what-if ops (src/whatif/applyOps.mjs) and the Node tools share it; src/importGuildBuffs.js passes the game's data.
export const exporterBuffHrid = (name) => '/guild_buffs/' + name + '_combat';

export function guildLevels(importSet, known = () => true) {
    const result = {};
    const levels = importSet?.guildCombatBuffLevels;
    if (levels && typeof levels === 'object') {
        for (const [name, level] of Object.entries(levels)) {
            const hrid = exporterBuffHrid(name);
            if (known(hrid)) result[hrid] = parseInt(level) || 0;
        }
    }
    const buffs = importSet?.guildBuffs;
    if (buffs && typeof buffs === 'object') Object.assign(result, buffs);
    return result;
}
