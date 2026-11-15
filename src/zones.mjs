// A planet: an area's own group fight, a combat action that is not a dungeon and spawns more than one monster at a time.
// The game has 11 (six named "Planet", plus five players count as planets). Every place that needs the test calls this.
export function isPlanetZone(action) {
    return action.type == "/action_types/combat"
        && action.category != "/action_categories/combat/dungeons"
        && action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount > 1;
}
