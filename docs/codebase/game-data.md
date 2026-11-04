# Game data

Commit documented: `95db2f6`. Directory `src/combatsimulator/data/`, all imported as JSON by webpack. "Unread fields" were found by searching the field name over every `.js` file under `src/` (excluding `js/i18n.js` and the data directory); a hit elsewhere with the same name can hide a false positive, so a name that matches nothing is certainly unread and a name that matches is only probably read. Sizes are bytes at the commit.

## One row per file

| File (size) | Holds | Read by | Fields never read |
|---|---|---|---|
| src/combatsimulator/data/abilityDetailMap.json (135960) | 57 abilities: cost, cooldown, cast time, `abilityEffects[]` (type, target, style, damage type, damage/accuracy/armor ratios and per-level bonuses, DoT, hp drain, pierce, blind/silence/stun, spend hp, buffs), default triggers | src/combatsimulator/ability.js:2, :111, :126-170; `src/main.js:3` and `:928` (default triggers for the UI) | none found; `name`, `description` only used for display elsewhere |
| src/combatsimulator/data/abilitySlotsLevelRequirementList.json (54) | `[0,1,1,20,50,90]` intelligence needed per ability slot | `src/main.js:16`, `:940-942`, `:3174` | n/a |
| src/combatsimulator/data/achievementDetailMap.json (27555) | 77 achievements with `tierHrid` | src/combatsimulator/achievement.js:3, :12; `src/main.js:23`, `:389` | `steamAchievementId`, `target` |
| src/combatsimulator/data/achievementTierDetailMap.json (5023) | 6 tiers, each with one buff | src/combatsimulator/achievement.js:2, :10-23; `src/main.js:22`, `:362`, `:387` | `usableInActionTypeMap` |
| src/combatsimulator/data/actionDetailMap.json (1390150) | 760 actions of all skills; combat zones and dungeons carry `combatZoneInfo` (spawns, bosses, dungeon waves) and `buffs` | src/combatsimulator/zone.js:1, :9-18; `src/main.js:17`, `:1237-1260`, `:1338-1350`, `:3321-3346` | `levelRequirement`, `baseTimeCost`, `experienceGain`, `dropTable` (zone-level, 0 combat actions have one), `essenceDropTable`, `rareDropTable` on actions, `upgradeItemHrid`, `retainAllEnhancement`, `inputItems`, `outputItems`, `maxPartySize`, `combatZoneInfo.dungeonInfo.keyItemHrid`, `combatZoneInfo.dungeonInfo.rewardDropTable`; all non-combat actions |
| src/combatsimulator/data/combatMonsterDetailMap.json (373983) | 95 monsters: `combatDetails` (levels, combat stats, attack interval), `abilities`, `dropTable`, `rareDropTable`, `enrageTime`, `experience`, `isLabyrinthMonster`, `isGuildMonster` | src/combatsimulator/monster.js:3, :24-47, :50-158; `src/main.js:18`, `:1364`, `:1998-2011`, `:2326`, `:3288` | `isGuildMonster` (8 monsters), `combatDetails.totalCastSpeed`; the pre-computed `combatDetails` ratings/HP/armor fields (`maxHitpoints`, `stabAccuracyRating`, `totalArmor`, …) are only read for the names listed in src/combatsimulator/monster.js:59-65, 72-76 |
| src/combatsimulator/data/combatStyleDetailMap.json (1956) | 6 styles with `skillExpMap` | src/combatsimulator/simResult.js:1, :135-143; `src/main.js:20`, `:606` | none |
| src/combatsimulator/data/combatTriggerComparatorDetailMap.json (815) | 4 comparators, `allowValue` | `src/main.js:15`, `:1161`, `:1211` (UI only) | n/a (engine uses hrid strings in src/combatsimulator/trigger.js:163-176) |
| src/combatsimulator/data/combatTriggerConditionDetailMap.json (21644) | 54 conditions, single/multi target, allowed comparators | `src/main.js:14`, `:1193-1209`, `:3991` (UI only) | n/a (engine switches on hrid strings in src/combatsimulator/trigger.js:85-160) |
| src/combatsimulator/data/combatTriggerDependencyDetailMap.json (960) | 4 dependencies | src/combatsimulator/trigger.js:1, :18 (`isSingleTarget`); `src/main.js:13`, `:1179-1189` | none |
| src/combatsimulator/data/communityBuffTypeDetailMap.json (4282) | 5 community buff types | **no importer** | all (values re-typed in `src/worker.js:23-48`) |
| src/combatsimulator/data/damageTypeDetailMap.json (524) | 4 damage types | `src/main.js:19`, `:609` | n/a |
| src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json (257) | cumulative enhancement multiplier per level (21 entries) | src/combatsimulator/equipment.js:2, :22 | none |
| src/combatsimulator/data/guildBuffDetailMap.json (166039) | 10 guild buffs with `levelCosts` | src/combatsimulator/guildBuff.js:2, :9; `src/main.js:7`, `:247`, `:350` | `levelCosts`, `shrineHrid` read only for i18n key (`src/main.js:259`) |
| src/combatsimulator/data/houseRoomDetailMap.json (177701) | 17 rooms: `actionBuffs`, `globalBuffs`, `upgradeCostsMap` | src/combatsimulator/houseRoom.js:2, :9-26; `src/main.js:5`, `:154`, `:4079`, `:4368`, `:4562` | `upgradeCostsMap`, `usableInActionTypeMap`; buff types `efficiency`, `action_speed`, `enhancing_success` are carried but unused |
| src/combatsimulator/data/itemDetailMap.json (2436743) | 957 items: equipment combat stats and enhancement bonuses, consumable details (restores, cooldowns, buffs, default triggers), `sellPrice`, `categoryHrid`, `sortIndex` | src/combatsimulator/equipment.js:1, :7, :23-43; src/combatsimulator/consumable.js:2, :9-33; `src/main.js:4`, `:135`, `:528`, `:4684` | `isTradable`, `itemLevel`, `alchemyDetail`, `guildCreditConversions`, `enhancementCosts`, `protectionItemHrids`, `equipmentDetail.levelRequirements`, `noncombatStats`, `noncombatEnhancementBonuses`, `baseItemHrids` |
| src/combatsimulator/data/labyrinthCrateDetailMap.json (30482) | 9 crates → arrays of buffs | src/combatsimulator/labyrinth.js:2, :12 | buff types for non-combat skills, `efficiency`, `labyrinth_double_progress`, `success_rate` |
| src/combatsimulator/data/labyrinthUpgradeDetailMap.json (2138) | 5 labyrinth upgrades (each is one buff + `maxLevel`) | src/combatsimulator/labyrinthUpgrade.js:2, :9-14; `src/main.js:6`, `:200` | none |
| src/combatsimulator/data/openableLootDropMap.json (38282) | loot tables of 22 openable items | `src/main.js:21`, `:4695-4725` (small/medium/large treasure chest prices only) | the other 19 openable items |
| src/combatsimulator/data/personalBuffTypeDetailMap.json (9390) | 12 personal buff types | **no importer** | all (values re-typed in `src/worker.js:50-121`) |

## Whole files or field groups loaded but unused by the engine

| Item | Status |
|---|---|
| `communityBuffTypeDetailMap.json`, `personalBuffTypeDetailMap.json` | bundled in the repo, imported nowhere; the engine uses hard-coded copies in `src/worker.js` |
| `actionDetailMap.json` non-combat actions (all skills except combat zones/dungeons) | present, never filtered in by the code |
| `actionDetailMap.json` `combatZoneInfo.dungeonInfo.rewardDropTable` (2 entries on each of 4 dungeons) | never read: dungeon revenue is 0 (`src/main.js:2332`) |
| `itemDetailMap.json` `alchemyDetail`, `enhancementCosts`, `noncombatStats`, `guildCreditConversions`, `levelRequirements` | never read |
| `houseRoomDetailMap.json` `upgradeCostsMap`; `guildBuffDetailMap.json` `levelCosts` | never read |
| `combatMonsterDetailMap.json` pre-computed rating fields (`stab/…AccuracyRating`, `…MaxDamage`, `…EvasionRating`, `maxHitpoints`, `totalArmor`, …) | the engine recomputes these from levels (src/combatsimulator/monster.js:59-65 and src/combatsimulator/combatUnit.js); the data copies are not used |
| `combatTriggerConditionDetailMap.json`, `combatTriggerComparatorDetailMap.json` | UI option lists only; the engine does not consult them |
| Buff types in data that no stat code reads | listed per source in `buffs-and-modifiers.md` |
