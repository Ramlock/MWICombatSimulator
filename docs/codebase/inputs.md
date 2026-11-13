# Inputs

Commit documented: `95db2f6`. Every input the UI collects, where `src/main.js` reads it, and what the engine receives. `src/main.js` is a single 5031-line module that runs at load: it grabs DOM elements, builds state in the module-level `player` (a `Player` instance, `src/main.js:40`), `food`, `drinks`, `abilities`, `triggerMap` (`src/main.js:42-46`), and calls the `init*` functions at the bottom (`src/main.js:5008-5031`).

## What the engine receives

`startSimulation` (`src/main.js:3144-3368`) builds one message (details in `build-and-entry.md`): `players` (array of `structuredClone(player)` objects), `zone` or `labyrinth`, `simulationTimeLimit` (ns), `extra`. `worker.js` turns each player DTO into a `Player` via `Player.createFromDTO` (src/combatsimulator/player.js:31-74).

Player DTO fields the engine reads: `staminaLevel`, `intelligenceLevel`, `attackLevel`, `meleeLevel`, `defenseLevel`, `rangedLevel`, `magicLevel`, `hrid`, `equipment{ "/equipment_types/<slot>": {hrid, enhancementLevel} }`, `food[3]`, `drinks[3]` (`{hrid, triggers[]}`), `abilities[]` (`{hrid, level, triggers[]}`), `houseRooms{hrid: level}`, `labyrinthUpgrades{uniqueHrid: level}`, `guildBuffs{hrid: level}`, `achievements{hrid: bool}`, `debuffOnLevelGap`. Everything else on the cloned `Player` (e.g. `combatDetails`) is ignored.

## Input table

| Input | Where read / stored in `src/main.js` | Reaches the engine as |
|---|---|---|
| Levels (7 skills) | `inputLevel_<skill>`, `updateLevels` `src/main.js:737-743`, stored in `player.<skill>Level`; combat level display `src/main.js:745-763` | `<skill>Level` on the DTO |
| Equipment (14 types: head, body, legs, feet, hands, main_hand, two_hand, off_hand, pouch, neck, earrings, ring, back, charm) and enhancement level | `selectEquipment_*` / `inputEquipmentEnhancementLevel_*`, `initEquipmentSection` `src/main.js:119-149`, `updateEquipmentState` `src/main.js:512-539`; weapon select shared by main_hand and two_hand | `equipment[type] = Equipment(hrid, enhancementLevel)`; stats via src/combatsimulator/equipment.js:21-29 |
| Equipment sets | saved in `localStorage` (`src/main.js:3917-3925`), `getEquipmentSetFromUI` `src/main.js:3925`, `loadEquipmentSetIntoUI` `src/main.js:4005` | not sent; loading rewrites the inputs above |
| Imported group (all five player slots: name and each setup field a tab holds) | `localStorage` key `importedGroup`, `{ v: 1, slots }` (`src/savedGroup.mjs`); kept by `saveImportedGroup` after every Import, replacing the group kept before; restored on page load by `restoreImportedGroup` through `importGroupSlots`, the one function Import's group paths use; a value that is not usable is ignored; zone, duration and the group's tick boxes are page-wide, not per player, and are not restored; tests `tools/test/saved-group.mjs`, `saved-group-page.mjs` | not sent; restore rewrites the inputs above and the player tab names |
| Food (3 slots) and drink (3 slots) | `selectFood_i`, `selectDrink_i`, `updateFoodState` `src/main.js:792-801`, `updateDrinksState` `src/main.js:841-851`; triggers in `triggerMap[hrid]` (defaults copied from `itemDetailMap[..].consumableDetail.defaultCombatTriggers`) | at start: `new Consumable(hrid, triggerMap[hrid])` for slot `i` only if `i < combatStats.foodSlots/drinkSlots` (`src/main.js:3156-3170`); skipped entirely in labyrinth sims |
| Abilities (5 slots), level | `selectAbility_i`, `inputAbilityLevel_i`, `updateAbilityState` `src/main.js:923-932`; triggers in `triggerMap[hrid]` (defaults from `abilityDetailMap[..].defaultCombatTriggers`) | `new Ability(hrid, Number(level), triggerMap[hrid])` only if `player.intelligenceLevel >= abilitySlotsLevelRequirementList[i+1]` (`src/main.js:3173-3181`) |
| Triggers (per food/drink/ability) | modal `initTriggerModal` `src/main.js:976-1235`; stored per item hrid in `triggerMap` (shared by every slot with that item) | `{dependencyHrid, conditionHrid, comparatorHrid, value}` array, evaluated in src/combatsimulator/trigger.js |
| House rooms (17) | `initHouseRoomsModal` `src/main.js:151-182`, inputs 0-8 | `houseRooms{hrid: level}` — traced in `buffs-and-modifiers.md` |
| Achievements | `initAchievementsModal` `src/main.js:382-463`, checkboxes into `player.achievements[hrid]` | `achievements{hrid: bool}`; a tier buff applies only if all of its achievements are true (src/combatsimulator/achievement.js:10-23) |
| Guild buffs | `initGuildBuffsModal` `src/main.js:244-293`, levels 0-20 (`src/main.js:301`), all 10 guild buffs listed (the `isCombat` filter is commented out at `src/main.js:248`, but applied on import at `src/main.js:351`) | `guildBuffs{hrid: level}` |
| Labyrinth upgrades | `initLabyrinthUpgradesModal` `src/main.js:197-229`, `max = upgrade.maxLevel` | `labyrinthUpgrades{uniqueHrid: level}`, emptied to `{}` unless a labyrinth sim (`src/main.js:3184-3187`) |
| Moo Pass toggle | `mooPassToggle`, persisted in `localStorage` (`src/main.js:4846-4853`), read `src/main.js:3216` | `extra.mooPass` |
| Community buffs (experience, combat drop) toggle + level | `comExpToggle/comExpInput`, `comDropToggle/comDropInput` (`src/main.js:4855-4907`, read `src/main.js:3217-3224`) | `extra.comExp`, `extra.comDrop` (0 when unchecked) |
| Personal buffs (7 seals) | `personalBuffsToggle` and checkboxes (`src/main.js:4909-4942`, read `src/main.js:3226-3234`) | `extra.personalBuffs`: array of item hrids |
| HP/MP visualization toggle | `hpMpVisualizationToggle` (`src/main.js:3225`) | `extra.enableHpMpVisualization` |
| Zone, difficulty tier | `selectZone`, `selectDifficulty` (`src/main.js:3264-3265`); zones listed from `actionDetailMap` combat actions that are not dungeons (`initZones` `src/main.js:1237`) | `zone = {zoneHrid, difficultyTier}` |
| Dungeon | `simDungeonToggle`, `selectDungeon` (`src/main.js:3266-3268`, `initDungeons` `src/main.js:1338-1350`) | `zone.zoneHrid` is replaced by the dungeon hrid |
| Labyrinth monster, room level, supply crates | `simLabyrinthToggle`, `selectLabyrinth`, `inputRoomLevel`, three crate selects (`src/main.js:3248-3262`, `initLabyrinth` `src/main.js:1361-1406`, crate lists `src/main.js:1352-1357`) | `labyrinth = {labyrinthHrid, roomLevel, crates[]}` |
| Simulate all zones / all solo zones / all labyrinths | toggles and per-zone checkboxes (`src/main.js:3287-3367`); labyrinth room levels fixed at 40..220 step 20 (`src/main.js:3296`) | `start_simulation_all_zones` / `_all_labyrinths` messages to `multiWorker` |
| Simulation time | `inputSimulationTime` (hours, default 24, `src/main.js:3092`) × `ONE_HOUR` (`src/main.js:3245`) | `simulationTimeLimit` (ns) |
| Party members | five player tabs; `savePreviousPlayer` `src/main.js:4411`, `updateNextPlayer` `src/main.js:4468`, data kept in `playerDataMap` (default strings `src/main.js:50-56`); checkboxes `.player-checkbox` choose who is simulated (`src/main.js:3103-3110`) | one DTO per selected player, `hrid = "player" + j` (`src/main.js:3154`) |
| Level-gap debuff | computed, not entered (`src/main.js:3195-3213`) | `debuffOnLevelGap` on each DTO |
| Prices and price mode | "Get prices" button, `selectPrices_drops`, `selectPrices_consumables`, editable price cells (`src/main.js:4638-4819`) | never sent to the engine; used only for revenue/expense display |
| Import / export (group, solo, JSON file) | `initImportExportModal` `src/main.js:4133`, `doGroupExport` `src/main.js:4169`, `doSoloExport` `src/main.js:4177-4232`, `doGroupImport` `src/main.js` (takes optional `selected` and `fight` next to the slots: ticks, zone, tier; `src/groupSelection.mjs`), `doSoloImport` `src/main.js:4265`, `parsePlayerJson` `src/main.js:3370-3416`, upload-and-simulate handler `src/main.js:3418` | solo export fields: levels, equipment array, food, drinks, abilities, `triggerMap`, `zone`, `simulationTime`, `houseRooms`, `labyrinth`, `guildBuffs`, `achievements` |
| Language, dark mode, patch notes, charts | `i18next`, `darkModeToggle` (`src/main.js:4964-4983`), `initPatchNotes` `src/main.js:4823` | not sent |

## Behaviours worth knowing

- `selectPlayers`: `startSimulation` calls `updateNextPlayer(j)`, `updateState()`, `updateUI()` for every selected player in turn (`src/main.js:3149-3153`) so the shared module-level `player` is refilled from each tab, then `structuredClone`d.
- Food/drink arrays on the DTO hold `Consumable` objects whose `triggers` came from `triggerMap`; because `Consumable.createFromDTO` rebuilds them from `dto.triggers` (src/combatsimulator/consumable.js:46-51), plain-object clones work.
- Houses/achievements/guild levels are per player tab (saved with the tab) while the extra buffs (Moo Pass, community, personal) are global to the run (`extra`).
- UNCLEAR: the upload-and-simulate handler (`src/main.js:3418-3556`) was only partly read: it builds `extra` like `startSimulation` and calls `parsePlayerJson`; how it chooses zone/time and whether it applies the level-gap debuff was not determined.
- UNCLEAR: `index.html` element ids were not enumerated; the ids above come from the `getElementById` calls in `src/main.js`.
