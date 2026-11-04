# Observed gaps

Commit documented: `95db2f6`. Facts only, each with `path:line`. No opinion on whether any item is a bug.

## Data loaded but never used

- src/combatsimulator/data/communityBuffTypeDetailMap.json and src/combatsimulator/data/personalBuffTypeDetailMap.json: imported by no file; the same values are typed inline in `src/worker.js:23-48` and `src/worker.js:50-121`.
- Dungeon `rewardDropTable` and `keyItemHrid` in src/combatsimulator/data/actionDetailMap.json: never read; `showKills` replaces dungeon drop maps with empty ones (`src/main.js:2332`).
- House-room buffs `efficiency`, `action_speed`, `enhancing_success` are built into `Buff` objects (src/combatsimulator/houseRoom.js:15-26) and stored in `permanentBuffs` (src/combatsimulator/combatUnit.js:435-448) but no stat code reads those types. Same for achievement tiers `beginner`/`adept`/`champion`, guild `efficiency`/`action_speed`/`essence_find`, consumable non-combat buffs, labyrinth-crate non-combat buffs (`buffs-and-modifiers.md`).
- `usableInActionTypeMap` on house rooms/achievement tiers is never read; every room's `actionBuffs` are applied (src/combatsimulator/houseRoom.js:15-26).
- Pre-computed rating fields inside src/combatsimulator/data/combatMonsterDetailMap.json `combatDetails` (e.g. `stabAccuracyRating`, `totalArmor`, `maxHitpoints`) and `isGuildMonster`, `totalCastSpeed` are not read (src/combatsimulator/monster.js:59-76).
- `monster.dropTable`/`rareDropTable` (`Drops` instances) are built (src/combatsimulator/monster.js:38-47) and never read; drop calculation reads the raw data in `src/main.js:1998-2016`.
- `itemDetailMap` `noncombatStats`, `levelRequirements`, `alchemyDetail`, `enhancementCosts` (src/combatsimulator/data/itemDetailMap.json) unread (src/combatsimulator/equipment.js).
- Stats declared but with no consumer found: `armorDamageRatio`, `hpDrainRatio` in `combatStats` (src/combatsimulator/combatUnit.js:139-140); `combatDetails.abilityHaste`, `combatDetails.tenacity` (src/combatsimulator/combatUnit.js:69-70) while the code reads `combatStats.abilityHaste`/`tenacity` (src/combatsimulator/combatSimulator.js:1202, 1444).
- `SimResult.playerRanOutOfMana` is pre-seeded for `player1..player5` only (src/combatsimulator/simResult.js:16-22).

## Dead code and code paths that cannot run

- `source.isWeakened` / `source.weakenPercentage`: read at src/combatsimulator/combatUtilities.js:148-150; no assignment anywhere in `src/` (grep).
- `source.weakenExpireTime` assigned (src/combatsimulator/combatSimulator.js:1552) and never read.
- `CombatSimulator.logAndResetWipeLogs` (src/combatsimulator/combatSimulator.js:61-85) has no call site; its log lines are commented out.
- `EventQueue.containsEventOfType` (src/combatsimulator/events/eventQueue.js:16) has no call site; `CombatUnit.removeBuff` (src/combatsimulator/combatUnit.js:426) is only referenced in comments (src/combatsimulator/combatSimulator.js:566-567, 1545-1546).
- `CooldownReadyEvent` has an empty handler by design (src/combatsimulator/combatSimulator.js:326-328).
- `AwaitCooldownEvent`/`CooldownReadyEvent` rely on `checkTriggers` after every event (src/combatsimulator/combatSimulator.js:331).

## TODO / FIXME / commented-out code

- `src/main.js:1240`: comment `// TOOD dungeon wave spawns` above `initZones`.
- Large commented-out blocks: src/combatsimulator/combatSimulator.js:206-210 (alive-time update), 808-815 and 835-837 (debug), 1208-1212; src/combatsimulator/combatUnit.js:199-201, 257-259, 542-546; many `// console.log` lines throughout `combatSimulator.js`.
- Live `console.log` calls inside event handlers: src/combatsimulator/combatSimulator.js:214, 689, 730, 993, 1006.

## Hard-coded constants standing in for game values

| Value | Location |
|---|---|
| Event intervals (5/3/10/3/150/3/60 s) | src/combatsimulator/combatSimulator.js:26-32 |
| Curse/fury/weaken duration 15 s, max stacks 5; enrage max 10 stacks, +10% damage/accuracy per stack | src/combatsimulator/combatSimulator.js:498, 523-524, 572, 998, 1011, 1021 |
| `battlesPerBoss = 10` (overwrites the data object) | src/combatsimulator/zone.js:13 |
| Labyrinth timeout 120 s; base room level 100; room levels 40-220 step 20 | src/combatsimulator/labyrinth.js:29; src/combatsimulator/monster.js:10; `src/main.js:3296` |
| Monster scaling: level `×(1+0.25t)`, defense `×(1+0.15t)`, `+20t`; XP `×(1+0.5t)`, `+5t` | src/combatsimulator/monster.js:53-55, 67-68 |
| Hit chance exponent 1.4; ranged crit `0.3 × hitChance`; thorns/retaliation caps (-99, `5 × defensiveMaxDamage`) | src/combatsimulator/combatUtilities.js:152-158, 207, 257 |
| Attack/cast speed per attack level `1/2000`; armor/resistance `0.2 × defense`; base regen 0.01 per 10 s; base HP/MP `10×(10+level)`; rating `(10+level)` | src/combatsimulator/combatUnit.js:285, 353, 295-331, 164-173, 188-195, 207-217 |
| Default weapon-less attack: smash/physical, 3 s | src/combatsimulator/player.js:93-98 |
| Ripple: +10 mana, −2 s cooldowns; blaze 0.3 fire AoE, bloom 10 + 0.15 heal | src/combatsimulator/combatSimulator.js:1254-1260; src/combatsimulator/ability.js:6-103 |
| Promote targets `/monsters/enchanted_rook|knight|bishop` | src/combatsimulator/combatSimulator.js:1696 |
| XP split 0.3 primary / 0.7 focus-or-style | src/combatsimulator/simResult.js:133-143 |
| Drop-rate tier multiplier `1 + 0.1 × tier`; rare-find rate uncapped | `src/main.js:2004, 2015` |
| Level-gap debuff: ratio > 1.2, `3 × (ratio − 1.2)`, cap 0.9 | `src/main.js:3201-3206` |
| Moo Pass wisdom 0.05; community buff `0.2 + 0.005 × (L−1)`; seal values | `src/worker.js:10-121` |
| Default simulation time 24 h; default empty player tabs | `src/main.js:3092, 50-56` |
| Marketplace URLs | `src/main.js:4641, 4655` |

## Inputs the UI collects that the engine ignores

- Prices, price modes, price edits (display only, `src/main.js:4638-4819`).
- Achievement tiers `beginner`, `adept`, `champion` can be checked but their buff types are unread (`buffs-and-modifiers.md`).
- House room levels for rooms whose only combat-relevant output is `wisdom`/`rare_find` still count; rooms' `efficiency`/`action_speed`/`enhancing_success` are carried but unread.
- Guild buffs of the skilling shrines can be entered; `efficiency`, `action_speed`, `essence_find` are unread, `rare_find`/`wisdom` from `rarity_skilling`/`scholar_skilling` are applied (src/combatsimulator/guildBuff.js:15-17).
- Equipment `levelRequirements` and skill-level checks are not enforced by the engine.
- Ability level is not bounded by the engine (`Number(abilityLevelInput.value)`, `src/main.js:3176`).

## Behaviours worth noting for the fix work (facts)

- Enrage buffs are added without a start time and never expire (src/combatsimulator/combatSimulator.js:1028, src/combatsimulator/combatUnit.js:379-381, 486-489).
- Thorns and retaliation are resolved even when the attack missed (src/combatsimulator/combatUtilities.js:207-267).
- A stat whose base value is 0 returns 0 from `Equipment.getCombatStat` even if an enhancement bonus exists (src/combatsimulator/equipment.js:23).
- `combatDetails` ratings recompute on every buff change; `Player` resets stats from equipment each time, monsters re-copy from data (src/combatsimulator/player.js:106-182, src/combatsimulator/monster.js:72-151).
- Revenue, expenses and profit are totals over the whole simulated time, not per hour or day (`src/main.js:1532-1537`, `results-and-profit.md`).
- Dungeon runs report zero revenue (`src/main.js:2332`).
- Drop amounts and rates are divided by the number of selected players for every player (`src/main.js:2019, 2029`).
