# Game data fields: where the character data lives

The field map for our own read-only exporter (`docs/proposals/what-if.md`, 3.6 track E, 4.2 item 1, 4.4 item 2). It lists, for each data kind the exporter would read, the WebSocket message that carries it, the field path and an example value, and which existing export carries it today.

Read from the two scripts' sources (2026-11-04). No live capture was made: the sources name every field. The example values are shaped from the sources and the sim's setup format, with made-up numbers; none is his. Whether the names still hold on today's game is checked when he tests the exporter on his own export.

## Sources

- Toolasha 2.108.4 by Celasha, CC-BY-NC-SA-4.0: `docs/ground-truth/third-party/toolasha-2.108.4/`. Its sim export is `constructSelfPlayer` (`toolasha-combat.js:10973-11130`).
- MWITools 26.4.23 (Greasy Fork script 494467) by bot7420, shykai and Stella, CC-BY-NC-SA-4.0: `docs/ground-truth/third-party/mwitools-26.4.23.user.js`. Its sim export is `constructSelfPlayerExportObjFromInitCharacterData` (`:44501-44588`); it stores `init_character_data` at `:9916-9930`.

## How the scripts read it

- Both read the game's own WebSocket messages as the page receives them, and send nothing. MWITools wraps the `MessageEvent.prototype.data` getter (`hookWS`, `mwitools-26.4.23.user.js:10247-10271`) and keeps only sockets whose URL matches its game hosts. Toolasha wraps the `WebSocket` constructor (`toolasha-core.js:3700-3720`).
- Every message is JSON with a `type` field. The character data comes whole in one message on login or refresh, `init_character_data`, and changes then come in smaller update messages (last column of the table).
- Static game data (item, ability and buff details) comes in `init_client_data`. The scripts read it to tell a special ability from a normal one (`abilityDetailMap[hrid].isSpecialAbility`) and to map guild shrines to buffs (`guildBuffDetailMap`).

## The map

All paths are in `init_character_data`. "Toolasha" and "MWITools" mean each script's sim export; "setup JSON" is the sim's own import format (the party's setups in `docs/ground-truth/setups/`), which is the same shape Toolasha exports.

| Data kind | Field path | Example value | Carried today by | Updated by |
| --- | --- | --- | --- | --- |
| Equipped gear and enhancement | `characterItems[]` where `itemLocationHrid` is not `/item_locations/inventory`: `itemLocationHrid`, `itemHrid`, `enhancementLevel` | `{itemLocationHrid: "/item_locations/head", itemHrid: "/items/acrobatic_hood", enhancementLevel: 10}` | Toolasha, MWITools, setup JSON (`player.equipment`) | `items_updated` (`endCharacterItems`) |
| Equipped abilities | `combatUnit.combatAbilities[]`: `abilityHrid`, `level` | `{abilityHrid: "/abilities/...", level: 50}` | Toolasha, MWITools, setup JSON (`abilities`) | `abilities_updated` |
| Ability triggers | `abilityCombatTriggersMap[abilityHrid]` = array of triggers | trigger objects as in the setup JSON's `triggerMap` | Toolasha, MWITools, setup JSON (`triggerMap`) | no update message handled by either script; read again from the next `init_character_data` |
| Food and drinks | `actionTypeFoodSlotsMap["/action_types/combat"][]`, `actionTypeDrinkSlotsMap["/action_types/combat"][]`: `itemHrid` (a slot may be `null`) | `{itemHrid: "/items/..."}` | Toolasha, MWITools, setup JSON (`food`, `drinks`) | `action_type_consumable_slots_updated` |
| Food and drink triggers | `consumableCombatTriggersMap[itemHrid]` = array of triggers | as above | Toolasha, MWITools, setup JSON (`triggerMap`, merged with the ability triggers) | no update message handled by either script; read again from the next `init_character_data` |
| House rooms | `characterHouseRoomMap` (object): values `{houseRoomHrid, level}` | `{houseRoomHrid: "/house_rooms/...", level: 6}` | Toolasha, MWITools, setup JSON (`houseRooms`) | `house_rooms_updated` |
| Achievements | `characterAchievements[]`: `achievementHrid`, `isCompleted` | `{achievementHrid: "/achievements/...", isCompleted: true}` | Toolasha (completed only), MWITools (all, with the flag), setup JSON (`achievements`) | `achievement_buffs_updated` (buffs only) |
| Guild buffs | `characterGuildBuffMap[buffHrid].level` (purchased), capped by `guildBuildingLevelMap[shrineHrid]` (unlocked); shrine-to-buff mapping from `init_client_data.guildBuffDetailMap` | `{force: 3, tempo: 2, ...}` after mapping | Toolasha only (`guildCombatBuffLevels`); not MWITools | `guild_buffs_updated`, `guild_updated` |
| Skill levels | `characterSkills[]`: `skillHrid`, `level`, `experience` | `{skillHrid: "/skills/attack", level: 100, experience: ...}` | Toolasha, MWITools, setup JSON (`player.*Level`, the seven combat skills only) | `skills_updated`, `action_completed` (`endCharacterSkills`) |
| Learned abilities with level and XP | `characterAbilities[]`: `abilityHrid`, `level`, `experience` | `{abilityHrid: "/abilities/...", level: 50, experience: ...}` | none (both exports keep only the equipped ones) | `abilities_updated`, `action_completed` (`endCharacterAbilities`) |
| Inventory | `characterItems[]` where `itemLocationHrid` is `/item_locations/inventory`: `itemHrid`, `enhancementLevel`, `count`, `hash` | `{itemHrid: "/items/...", itemLocationHrid: "/item_locations/inventory", enhancementLevel: 0, count: 12}` | none | `items_updated`, `action_completed` (`endCharacterItems`) |
| Liquid Coin | the inventory entry with `itemHrid` `/items/coin`: `count` (Toolasha's `getCoinBalance`, `toolasha-market.js:11748-11751`) | `{itemHrid: "/items/coin", count: ...}` | none | as inventory |

## Data kinds with no field

None: all ten kinds have a field in `init_character_data`. Two are not in any export today: learned abilities with their XP, and inventory with liquid Coin.

## Why not read the page's HTML

The page renders only the panel that is open, in the player's UI language, and rounds large counts. A saved page of the live game (2026-11-04, Portuguese UI, with Toolasha running) carries:

| Data kind | In the HTML | Markup |
| --- | --- | --- |
| Equipped abilities | yes, level but no XP | `AbilitySlot_abilitySlot__*`, icon `<use href="...items_sprite...#<ability>">`, `Ability_level__*` text "Nv.16" |
| Food and drinks | yes | `ConsumableSlot_*`, icon `#<item>` |
| Skill levels | yes, localized labels | `NavigationBar_level__*`, e.g. "Ataque 150" |
| Inventory | rounded counts | `Inventory_itemGrid__*`, icon `#<item>`, `Item_enhancementLevel__*` "+10", `Item_count__*` "1963K" |
| Liquid Coin | rounded | the inventory's `#coin`, `Item_count__*` "13T" |
| Equipped gear | only when that panel is open | none in the saved page |
| Triggers | no | only a settings icon, `CombatTriggersSetting_*` |
| House rooms, achievements, guild buffs, learned abilities, any XP | no | none |

Getting the rest from the HTML would mean opening panels, which is pressing buttons. Both plugins read the message, not the HTML; they only write their display into the page.

## The export

`userscript/mwics-exporter.user.js` builds one JSON from `init_character_data`, copied to the clipboard from the userscript manager's menu ("Copy export"); "Settings" holds one toggle per data kind, all on by default, kept across reloads. A kind switched off is left out of the JSON (unknown, never empty).

- **Setup keys**, the same as the sim's setup JSON, read by today's import (`doSoloImport`, `src/main.js:4223`): `player` (the seven `*Level` keys from skill levels, `equipment` from gear), `food`, `drinks`, `abilities`, `triggerMap` (ability triggers with equipped abilities, consumable triggers with food and drinks), `houseRooms`, `achievements` (every achievement, `true` or `false`), `guildCombatBuffLevels`, and `name` (the character's name, always).
- **New keys**, not read by today's import:
  - `learnedAbilities`: `[{abilityHrid, level, experience}]`, every learned ability, from `characterAbilities`.
  - `inventory`: `[{itemHrid, enhancementLevel, count}]`, every inventory entry except Coin.
  - `coin`: a number, the inventory's `/items/coin` `count`.
- The data is as of the page's last load: the script reads only `init_character_data`, so a change made since (an item bought, gear swapped) shows after a reload.
- Today's import needs `player.equipment`, `food`, `drinks` and `abilities` (`src/main.js:4237`, `:4261-4262`, `:4297`): with gear, food and drinks, or equipped abilities switched off, the export does not import into the sim; with skill levels off, the level boxes get no value.
- Test: `node userscript/test/exporter.test.cjs` (made-up fixture).
