# Engine

Commit documented: `95db2f6` (upstream `testing`). All references are `path:line` at that commit. Time is in nanoseconds; `ONE_SECOND = 1e9` (src/combatsimulator/combatSimulator.js:25).

## Constants

- Intervals in src/combatsimulator/combatSimulator.js:26-32: HoT tick 5 s, DoT tick 3 s, regen tick 10 s, enemy respawn 3 s, player respawn 150 s, restart (dungeon wipe) 3 s, enrage tick 60 s.
- Curse, fury and weaken buffs last 15 s each (src/combatsimulator/combatSimulator.js:498, 523, 572). Max stacks: fury 5 (src/combatsimulator/combatSimulator.js:524), curse 5 (src/combatsimulator/events/curseExpirationEvent.js:5), weaken 5 (src/combatsimulator/events/weakenExpirationEvent.js:5), enrage 10 (src/combatsimulator/combatSimulator.js:998). Labyrinth encounter timeout 120 s (src/combatsimulator/labyrinth.js:29).

## Event queue and time model

- `EventQueue` is a min-heap (`heap-js`) ordered by `event.time` only (src/combatsimulator/events/eventQueue.js:5). No tie-break: equal-time order is the heap's.
- Every `clear*`, `get*` and `contains*` call copies the heap with `toArray()` and scans it linearly (src/combatsimulator/events/eventQueue.js:16-62).
- All events extend `CombatEvent{type,time}` (src/combatsimulator/events/combatEvent.js:1-6). There is no real-time clock; `simulationTime` is set to each popped event's time (src/combatsimulator/combatSimulator.js:269).

## Main loop (`CombatSimulator.simulate`, src/combatsimulator/combatSimulator.js:173-259)

1. `reset()` zeroes time, clears the queue, builds a fresh `SimResult` (src/combatsimulator/combatSimulator.js:261-266).
2. Pushes `CombatStartEvent(0)` (src/combatsimulator/combatSimulator.js:178).
3. `while (simulationTime < simulationTimeLimit)`: pop the next event, `await processEvent`. The last processed event may be past the limit; `simResult.simulatedTime` is set to the time of the last event processed (src/combatsimulator/combatSimulator.js:232). UNCLEAR: if the queue were ever empty, `getNextEvent()` returns `undefined` and `processEvent` would throw on `event.time`; not determined whether that state can occur.
4. Every 1000 events a `progress` CustomEvent is dispatched (progress = `min(simulationTime/limit,1)`), plus an HP/MP snapshot when enabled (src/combatsimulator/combatSimulator.js:185-203).
5. After the loop: dungeon fields, `setDropRateMultipliers`/`setManaUsed` per player, boss spawn lists, labyrinth attempt count (src/combatsimulator/combatSimulator.js:212-256).

`processEvent` (src/combatsimulator/combatSimulator.js:268-332) switches on `event.type`, then always calls `checkTriggers()` after the event (src/combatsimulator/combatSimulator.js:331).

## Events (`src/combatsimulator/events/`)

| Event (type string) | Created where | Effect when processed |
|---|---|---|
| `CombatStartEvent` ("combatStart") | loop start; dungeon wipe restart (+3 s, src/combatsimulator/combatSimulator.js:750); labyrinth encounter end (src/combatsimulator/combatSimulator.js:767) | `processCombatStartEvent` src/combatsimulator/combatSimulator.js:334: at time 0 calls `generatePermanentBuffs()` per player; `player.reset()` (labyrinth) or `player.reset(simulationTime)`; queues first `RegenTickEvent` (+10 s); `startNewEncounter()` |
| `PlayerRespawnEvent` ("playerRespawn") | player dies in a non-dungeon zone (+150 s, src/combatsimulator/combatSimulator.js:717) | full HP/MP, `clearBuffs()`, `clearCCs()`; if all players were dead → `startAttacks()`, else `addNextAttackEvent` (src/combatsimulator/combatSimulator.js:352-365) |
| `EnemyRespawnEvent` ("enemyRespawn") | all enemies dead (+3 s, src/combatsimulator/combatSimulator.js:684) | `startNewEncounter()` |
| `AutoAttackEvent` ("autoAttack") | `addNextAttackEvent` at `now + attackInterval` | `processAutoAttackEvent` src/combatsimulator/combatSimulator.js:452-662 (below) |
| `AbilityCastEndEvent` ("abilityCastEndEvent") | `addNextAttackEvent` at `now + castDuration/(1+castSpeed)` (src/combatsimulator/combatSimulator.js:804-806) | `tryUseAbility` (src/combatsimulator/combatSimulator.js:1181) |
| `AwaitCooldownEvent` ("awaitCooldownEvent") | when a unit flagged `isOutOfMana` gains mana (regen or consumable) | `addNextAttackEvent(source)` (src/combatsimulator/combatSimulator.js:322-325) |
| `CooldownReadyEvent` ("cooldownReady") | `tryUseConsumable`, at `now + consumable cooldown` | no handler body; exists so `checkTriggers()` runs then (src/combatsimulator/combatSimulator.js:326-328) |
| `ConsumableTickEvent` ("consumableTick") | consumable with `recoveryDuration > 0` | heal/mana tick, reschedules +5 s until `currentTick == totalTicks` (src/combatsimulator/combatSimulator.js:844-886) |
| `DamageOverTimeEvent` ("damageOverTime") | ability with `damageOverTimeRatio > 0` and `damageDone > 0` | one DoT tick, reschedules +3 s (src/combatsimulator/combatSimulator.js:888-925); field `sourceRef` (not `source`) so it survives the source dying (src/combatsimulator/events/damageOverTimeEvent.js:9) |
| `CheckBuffExpirationEvent` ("checkBuffExpiration") | every buff added via ability/consumable at `now + buff.duration` | `source.removeExpiredBuffs(now)` (src/combatsimulator/combatSimulator.js:964-966) |
| `RegenTickEvent` ("regenTick") | start, then self-reschedules every 10 s | players only (enemy regen deliberately skipped, src/combatsimulator/combatSimulator.js:930-933): `floor(maxHp*hpRegenPer10)` and `floor(maxMp*mpRegenPer10)` (src/combatsimulator/combatSimulator.js:940-945) |
| `StunExpirationEvent` ("stunExpiration") | stun applied by an ability | `isStunned=false`, `addNextAttackEvent` (src/combatsimulator/combatSimulator.js:968-972) |
| `BlindExpirationEvent` ("blindExpiration") | blind applied | `isBlinded=false`, `addNextAttackEvent` (src/combatsimulator/combatSimulator.js:974-977) |
| `SilenceExpirationEvent` ("silenceExpiration") | silence applied | `isSilenced=false` only (src/combatsimulator/combatSimulator.js:979-981) |
| `CurseExpirationEvent` ("curseExpiration") | auto/ability hit by a source with `curse > 0` | `removeExpiredBuffs`; constructor holds `curseAmount = min(prev+1, 5)` (src/combatsimulator/events/curseExpirationEvent.js:9) |
| `WeakenExpirationEvent` ("weakenExpiration") | hit against a target with `weaken > 0` | `removeExpiredBuffs`; `weakenAmount = min(prev+1, 5)` (src/combatsimulator/events/weakenExpirationEvent.js:9-12) |
| `FuryExpirationEvent` ("furyExpiration") | attacker with `fury > 0`, `furyAmount > 0` | `removeExpiredBuffs` and `console.log("Fury Timeout")` (src/combatsimulator/combatSimulator.js:991-994) |
| `EnrageTickEvent` ("enrageTick") | every new encounter, +60 s, self-reschedules | see Enrage |

## Encounters

- `startNewEncounter` (src/combatsimulator/combatSimulator.js:371-420): if `allPlayersDead` → clear flag and `zone.failWave()` (zones only). Zone, non-dungeon → `zone.getRandomEncounter()`; dungeon → `zone.getNextWave()` and, when `dungeonsCompleted` rose, players are restored to full HP/MP (src/combatsimulator/combatSimulator.js:387-394); labyrinth → `labyrinth.getMonster()` and records encounter start. Each enemy `reset(simulationTime)`. Enrage events are cleared and re-queued, pending `AbilityCastEndEvent`s are cleared, `checkTriggers()` runs once (food/drink first), then `startAttacks()` (an attack event per living unit, src/combatsimulator/combatSimulator.js:422-438).
- `checkEncounterEnd` (src/combatsimulator/combatSimulator.js:664-772), called after attacks, ability casts and DoT ticks:
  - dead enemies with `experienceRate == 0` get `experienceRate = 1 + min(now - enrageBeginTime, enrageTime)/enrageTime` (src/combatsimulator/combatSimulator.js:666-676);
  - all enemies dead → clear autoattacks, queue `EnemyRespawnEvent`, `totalExp = Σ enemy.experience*experienceRate`, `addExperienceGain(player, totalExp/numberOfPlayers)` for every player (alive or not), `encounters++`, `lastEncounterFinishTime = now` (src/combatsimulator/combatSimulator.js:681-712);
  - a dead player with no pending respawn gets `PlayerRespawnEvent(+150 s)` in a non-dungeon zone; nothing is queued for dungeons (src/combatsimulator/combatSimulator.js:714-723);
  - all players dead: non-dungeon zones clear attack/cast events only; dungeons log a wipe (`saveWipeLogsToSimResult`), clear most event types and queue `CombatStartEvent(+3 s)` (src/combatsimulator/combatSimulator.js:725-761);
  - labyrinth: on timeout (`now - encounterStart > 120 s`) or `encounterEnded`: `enemies=null`, queue fully cleared, new `CombatStartEvent(now)` (src/combatsimulator/combatSimulator.js:763-769).
- Zone encounters (src/combatsimulator/zone.js:21-54): every `battlesPerBoss` (hard-set to 10, src/combatsimulator/zone.js:13) the boss list spawns, else up to `randomSpawnInfo.maxSpawnCount` draws weighted by `rate`; each draw adds `strength` to a running total and stops at `maxTotalStrength` (the overflowing draw is discarded). Monster difficulty = `spawn.difficultyTier + zone.difficultyTier`. `encountersKilled` is only incremented on the random-draw path; it is reset to 1 on boss spawn.
- Dungeon waves (src/combatsimulator/zone.js:61-111): `encountersKilled > maxWaves` → `dungeonsCompleted++`, counter back to 1. Fixed spawns come from `fixedSpawnsMap[wave]`; otherwise the `randomSpawnInfoMap` entry for the wave bucket is drawn the same way as zone spawns. `failWave()` (src/combatsimulator/zone.js:56) counts a failed run and resets to wave 1.
- Labyrinth (src/combatsimulator/labyrinth.js): one monster (`new Monster(hrid, 0, roomLevel)`) per attempt; `attemptCount` counts attempts; crates' buff arrays are concatenated into `labyrinth.buffs` (src/combatsimulator/labyrinth.js:11-13). In `worker.js` those become `player.zoneBuffs` (src/worker.js:141).

## Unit stats (`CombatUnit.updateCombatDetails`, src/combatsimulator/combatUnit.js:162-377)

`combatDetails.combatStats` holds the "sum of sources" stats; the derived ratings are computed here from levels plus buffs. `getBuffBoost(type)` sums `ratioBoost`/`flatBoost` over all current buffs of that `typeHrid` (src/combatsimulator/combatUnit.js:523-537); `combatBuffs` is keyed by `uniqueHrid` (so a re-added buff replaces itself) except permanent buffs which are keyed by `typeHrid` (below).

- Regen (players only): `hpRegenPer10 = 0.01 + equipmentSum` (same for mp) (src/combatsimulator/combatUnit.js:163-174), then `+= stat*ratioBoost + flatBoost` from `hp_regen`/`mp_regen` buffs (src/combatsimulator/combatUnit.js:333-339). Monsters take the data value unchanged.
- Level buffs: for each of stamina, intelligence, attack, melee, defense, ranged, magic: `level_eff = level + level*Σratio + Σflat` over `/buff_types/<skill>_level` (src/combatsimulator/combatUnit.js:176-183).
- `maxHitpoints = floor((10*(10+staminaEff) + stat.maxHitpoints) * (1 + stat.maxHitpointsRatio + Σmax_hitpoints.ratio))`; mana likewise with intelligence (src/combatsimulator/combatUnit.js:185-195). `stat.maxHitpointsRatio`/`maxManapointsRatio` are never assigned for players (default 0).
- Accuracy rating (stab/slash/smash/ranged/magic) `= (10+attackEff) * (1+stat.<style>Accuracy) * (1+Σaccuracy.ratio) * (1+Σfury_accuracy.ratio)` (src/combatsimulator/combatUnit.js:206-211, 237-241, 261-265). All styles use the attack level for accuracy.
- Max damage per style `= (10+levelEff) * (1+stat.<style>Damage) * (1+Σdamage.ratio) * (1+Σfury_damage.ratio)` with level = melee for stab/slash/smash, ranged, magic respectively (src/combatsimulator/combatUnit.js:212-216, 242-246, 266-270). `Σdamage.flat` is not read.
- `defensiveMaxDamage = (10+defenseEff) * (1+stat.defensiveDamage) * (1+Σdamage.ratio) * (1+Σfury_damage.ratio)` (src/combatsimulator/combatUnit.js:226-230). If the equipped two-hand item's hrid contains `"bulwark"`, `smashMaxDamage += defensiveMaxDamage` (src/combatsimulator/combatUnit.js:233-235).
- Evasion rating per style `= base + Σ(flat + base*ratio)` over `evasion` buffs where `base = (10+defenseEff)*(1+stat.<style>Evasion)` (src/combatsimulator/combatUnit.js:217-223, 248-254, 272-277).
- `stat.damageTaken = Σ damage_taken.flatBoost` (assigned, not added) (src/combatsimulator/combatUnit.js:256).
- Amplifies: `physical/water/nature/fire/healingAmplify += Σflat` of the matching buff type (src/combatsimulator/combatUnit.js:279-283).
- Attack interval: `interval = weaponInterval / (1 + attackEff/2000) / (1 + stat.attackSpeed) / (1 + Σattack_speed.ratio)` (src/combatsimulator/combatUnit.js:285-293). Weapon interval is read in src/combatsimulator/player.js:81-90 (main-hand first, else two-hand, else 3 s smash/physical).
- Armor `= (0.2*defenseEff + stat.armor)` then `+ Σ(flat + base*ratio)` from `armor` buffs; water/nature/fire resistance use the same pattern with their own buff types (src/combatsimulator/combatUnit.js:295-331). Defense level therefore contributes 0.2 per level to each of the four resistances.
- Drops/XP/rare find: `combatDropRate`, `combatRareFind`, `combatDropQuantity` `+= (1+stat)*Σratio`, then `+= Σflat` (src/combatsimulator/combatUnit.js:355-363); `combatExperience += Σ wisdom.flat` (src/combatsimulator/combatUnit.js:348). Buff types used: `combat_drop_rate`, `rare_find`, `combat_drop_quantity`, `wisdom`.
- `lifeSteal`, `physicalThorns`, `elementalThorns`, `criticalRate`, `criticalDamage`, `castSpeed` `+= Σflat` of their types (src/combatsimulator/combatUnit.js:341-352); `castSpeed += attackEff/2000` (src/combatsimulator/combatUnit.js:353).
- Threat: `base = 100 + stat.threat`; `totalThreat = base`; if `Σthreat.ratio != 0` then `stat.threat += base*Σratio` (the 100 is not added in that branch), else `stat.threat = base`; then `+= Σthreat.flat` (src/combatsimulator/combatUnit.js:365-373). UNCLEAR: whether the two branches are meant to differ; documented as written.
- `retaliation += Σflat`, `tenacity += Σflat` (src/combatsimulator/combatUnit.js:375-376).
- Because these `+=` lines run on every call, the base values must be reset first: `Player.updateCombatDetails` re-sums the equipment value for every stat in its list before calling `super` (src/combatsimulator/player.js:106-194); `Monster.updateCombatDetails` re-copies the data record (src/combatsimulator/monster.js:72-76) and zeroes the listed stats absent from the record (src/combatsimulator/monster.js:83-151).
- Stats the code never reads from `combatStats`/buffs for combat: `armorDamageRatio`, `hpDrainRatio` (declared at src/combatsimulator/combatUnit.js:139-140, no consumer found), `combatDetails.abilityHaste`/`tenacity` (the code reads `combatStats.abilityHaste`/`combatStats.tenacity` instead, src/combatsimulator/combatSimulator.js:1202, 1444).

## Players (`player.js`)

- `createFromDTO` (src/combatsimulator/player.js:31-74): copies the seven levels, `hrid`, each equipment slot via `Equipment.createFromDTO`, food/drink via `Consumable.createFromDTO`, abilities via `Ability.createFromDTO`; `houseRooms`, `labyrinthUpgrades`, `guildBuffs` are `{hrid: level}` maps and only entries with level > 0 become objects; `new Achievement(dto.achievements)`; `debuffOnLevelGap`.
- Equipment stat: `getCombatStat(s) = base[s] + enhancementTable[level] * enhancementBonus[s]` only when `base[s]` is truthy (a stat whose base is 0/absent returns 0 even if an enhancement bonus exists) (src/combatsimulator/equipment.js:21-29). `enhancementTable` is src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json.
- Combat style, damage type and primary training come from the main-hand item, else the two-hand item (src/combatsimulator/player.js:77-98); focus training from `/equipment_types/charm` (src/combatsimulator/player.js:100-104). Food/drink slots `= 1 + pouch.foodSlots/drinkSlots` (src/combatsimulator/player.js:184-192).

## Monsters (`monster.js`)

- Level scaling by difficulty tier `t` (src/combatsimulator/monster.js:53-65): `levelMultiplier = 1+0.25t`, `defMultiplier = 1+0.15t`, `bonus = 20t`; `level = mult * (dataLevel + bonus) * labyrinthScale` (defense uses `defMultiplier`). `labyrinthScale = roomLevel / 100` (roomLevel 0 → 100) (src/combatsimulator/monster.js:10, 20-22, 31, 57).
- `experience = (1+0.5t) * (data.experience + 5t)` (src/combatsimulator/monster.js:67-70).
- Combat style = first of `combatStyleHrids` (src/combatsimulator/monster.js:72). Armor and the three resistances are multiplied by `labyrinthScale` (src/combatsimulator/monster.js:78-81). Other combat stats are copied unscaled.
- Abilities: `abilities[i]` created for each data ability whose `minDifficultyTier <= t`, level `floor(level*labyrinthScale)` (src/combatsimulator/monster.js:32-37). Slot indices follow the data array (so a skipped ability leaves a `null` hole; `addNextAttackEvent` filters nulls, src/combatsimulator/combatSimulator.js:796).
- Initial cooldown for non-players: `lastUsed = now - floor(cd*0.5) + floor(random*cd*0.5)` (src/combatsimulator/combatUnit.js:570-574).
- `enrageTime` from data (src/combatsimulator/monster.js:29).

## Auto attack (`processAutoAttackEvent`, src/combatsimulator/combatSimulator.js:452-662)

- Targets: player source → `this.enemies`; enemy source → `this.players`. A loop runs over the living targets (`for i`).
- If the source is an enemy and more than one player is alive, the target is drawn by `stat.threat` weights (src/combatsimulator/combatSimulator.js:466-480). A player source hits the first living enemy; the loop continues to the next only if the hit landed, no parry happened and `random < source.pierce` is true (the `break` condition at src/combatsimulator/combatSimulator.js:653).
- Parry (`checkParry`, src/combatsimulator/combatSimulator.js:440-450): one random living defender with `parry > 0` is picked; it parries if `parry > random`. On parry, source and target swap (the defender attacks the original source).
- Mayhem: `mayhem = source.mayhem > random`; a miss with mayhem continues to the next target; stats are only recorded on a hit, or on the last target (src/combatsimulator/combatSimulator.js:495, 593, 649-651).
- Hit → `CombatUtilities.processAttack` (below); then curse (hit and `source.curse > 0`: target gets a `damage_taken` buff with `flatBoost = curse * stacks`, stacks ≤ 5, 15 s), fury (source `fury > 0`: stacks +1 on hit capped at 5, halved on miss, buffs `fury_accuracy` and `fury_damage` with `ratioBoost = stacks*fury`, removed at 0), weaken (target `weaken > 0`: the attacker gets a `damage` buff `ratioBoost = -weaken*stacks`) (src/combatsimulator/combatSimulator.js:497-591). These buffs are also applied in ability damage effects (src/combatsimulator/combatSimulator.js:1476-1571).
- Results are recorded through `SimResult.addAttack/addHitpointsGained/addManapointsGained`, thorns and retaliation recorded as separate attack types; deaths clear the unit's events (`clearEventsForUnit`) and call `addDeath` (src/combatsimulator/combatSimulator.js:604-647).
- The next attack is queued unless `checkEncounterEnd()` returned true (src/combatsimulator/combatSimulator.js:658-661).

## Damage resolution (`CombatUtilities.processAttack`, src/combatsimulator/combatUtilities.js:49-286)

1. Style and damage type come from the source's stats (auto attack) or from the ability effect (src/combatsimulator/combatUtilities.js:50-53). Style selects the source's accuracy rating and max damage and the target's evasion rating (src/combatsimulator/combatUtilities.js:59-87). Damage type selects amplify, resistance, penetration and thorns type (src/combatsimulator/combatUtilities.js:97-136); thorns type: physical → `physicalThorns`, others → `elementalThorns`.
2. `hitChance = a^1.4 / (a^1.4 + e^1.4)`, with `a` = accuracy (times `1+bonusAccuracyRatio` for abilities) and `e` = evasion (src/combatsimulator/combatUtilities.js:144-154). The `isWeakened`/`weakenPercentage` branch (src/combatsimulator/combatUtilities.js:148-150) reads fields no code ever sets.
3. `critChance = (ranged style ? 0.3*hitChance : 0) + stat.criticalRate` (src/combatsimulator/combatUtilities.js:156-160).
4. `minDamage = amplify * (1 + flat + armorDamageRatio*armor)`; `maxDamage = amplify * (ratio*styleMaxDamage + flat + armorDamageRatio*armor)`, where flat/ratio/armorDamageRatio come from the ability effect (flat 0, ratio 1, armor ratio 0 for an auto attack) (src/combatsimulator/combatUtilities.js:162-168). On a crit `max *= (1+criticalDamage)` and `min = max` (src/combatsimulator/combatUtilities.js:170-174).
5. `roll = randomInt(min, max)` — an integer draw that corrects for fractional ends (src/combatsimulator/combatUtilities.js:11-47); then `*= (1+taskDamage)`, `*= (1+target.damageTaken)`, and for an auto attack `+= roll*autoAttackDamage`, for an ability `*= (1+abilityDamage)` (src/combatsimulator/combatUtilities.js:176-183).
6. The hit roll is independent of the crit roll: `random < hitChance` (src/combatsimulator/combatUtilities.js:189). On a hit: effective resistance `= targetRes / (1+sourcePenetration)` if both positive; `takenRatio = 100/(100+res)` (for negative res `(100-res)/100`); `damage = min(ceil(takenRatio*roll), targetHp)` (src/combatsimulator/combatUtilities.js:191-204).
7. Thorns (src/combatsimulator/combatUtilities.js:207-233): when the target's thorn stat > 0 and its resistance of that type > -99, the source takes `randomInt(1, mult * target.defensiveMaxDamage * (1+targetRes/100) * thornPower)` mitigated by the source's resistance (penetrated by the target's penetration). This runs regardless of whether the original attack hit.
8. Retaliation (src/combatsimulator/combatUtilities.js:235-267): if `target.retaliation > 0` and `retaliationHitChance = smashAcc(target)^1.4 / (… + smashEva(source)^1.4)` beats a roll, the source takes `randomInt(mult*ret*pre, mult*ret*(defMax+pre))` with `pre = min(roll, 5*target.defensiveMaxDamage)`, mitigated by the source's armor (penetrated by the target's armor penetration). Also runs regardless of the original hit.
9. Lifesteal (auto attacks only): `floor(lifeSteal*damage)` HP; ability `hpDrainRatio`: `floor(ratio*damage*(1+healingAmplify))`; mana leech (auto attacks only): `floor(manaLeech*damage)` (src/combatsimulator/combatUtilities.js:269-283).

## Abilities

- Selection (`addNextAttackEvent`, src/combatsimulator/combatSimulator.js:774-842): if the unit already has a pending attack or cast event, nothing is done. Otherwise abilities are tested in slot order; the first whose `shouldTrigger` is true and which the unit can afford is queued as `AbilityCastEndEvent(now + castDuration/(1+castSpeed))`. If the first triggered ability is unaffordable, `skipNextAbility` blocks all later abilities (src/combatsimulator/combatSimulator.js:795-819). If none was queued, an auto attack is queued unless the unit is blinded (blinded → `isOutOfMana = true`, src/combatsimulator/combatSimulator.js:839-841).
- `Ability.shouldTrigger` (src/combatsimulator/ability.js:183-214): false when stunned or silenced, or `lastUsed + cooldown > now` where `cooldown = cooldownDuration*100/(100+abilityHaste)`; then all triggers must be active (AND).
- `tryUseAbility` (src/combatsimulator/combatSimulator.js:1181-1280): re-checks mana; adds mana cost to `abilityManaCosts` (players); sets `lastUsed`; adds extra `blaze` (fire 30% AoE, src/combatsimulator/ability.js:6-57) / `bloom` (heal, src/combatsimulator/ability.js:58-103) casts with probability `stat.blaze`/`stat.bloom`; runs each ability effect by `effectType`: `buff`, `damage`, `heal`, `spend_hp`, `revive`, `promote`; then `ripple` (probability: +10 mana and shaves 2 s off active cooldowns, src/combatsimulator/combatSimulator.js:1253-1264); then `addNextAttackEvent`, death check, `checkEncounterEnd`.
- Ability effect values scale with ability level L: `damageFlat = base + (L-1)*flatBonus`, `damageRatio`, `bonusAccuracyRatio`, `armorDamageRatio` likewise; buffs are `new Buff(buff, L)` (src/combatsimulator/ability.js:126-155). `damageOverTimeRatio/Duration`, `hpDrainRatio`, pierce/blind/silence/stun chance and duration, and `spendHpRatio` are copied unscaled.
- Damage effect (src/combatsimulator/combatSimulator.js:1315-1620): targets `enemy` (one) or `allEnemies`. Parry is checked only for the first target. For an enemy casting a single-target ability the victim is chosen by threat and added to `avoidTarget` (src/combatsimulator/combatSimulator.js:1389-1405). On a hit: effect buffs are applied to the target, DoT is queued (`damageDone*ratio` total over `duration/3 s` ticks), stun/blind/silence roll `chance*100/(100+target.tenacity)` (src/combatsimulator/combatSimulator.js:1444-1474), then curse/fury/weaken as for auto attacks. Pierce: continues to the next target with `pierceChance` (`allEnemies` only effectively).
- Heal effect (src/combatsimulator/combatSimulator.js:1622-1665; `processHeal` src/combatsimulator/combatUtilities.js:288-306): `heal = randomInt(amp*(1+flat), amp*(ratio*magicMaxDamage + flat))`, `amp = 1+healingAmplify`. Targets: `allAllies`, `lowestHpAlly` (lowest HP percentage), `self`. Revive (src/combatsimulator/combatSimulator.js:1667-1693): the first dead ally is healed like a heal, mana refilled, CCs cleared, respawn event cancelled, attack queued. Spend HP: `floor(currentHp*spendHpRatio)` lost (src/combatsimulator/combatUtilities.js:332-341). Promote: the unit's events are cleared and it is replaced by a new random `enchanted_rook/knight/bishop` of the same difficulty tier (src/combatsimulator/combatSimulator.js:1695-1699, 1242-1246). UNCLEAR: the `promote` branch reassigns the local `source` only; whether the replaced monster is placed in `this.enemies` was not determined.
- Buff effect (src/combatsimulator/combatSimulator.js:1282-1313): `allAllies` or `self`. For special abilities a buff with `multiplierForSkillHrid` is scaled by `1 + <skill>Level * multiplierPerSkillLevel` (applies to both flat and ratio) (src/combatsimulator/combatSimulator.js:1287-1292). Each application queues a `CheckBuffExpirationEvent`.

## Triggers (`trigger.js`)

- Dependencies (src/combatsimulator/trigger.js:17-83): `self`, `targeted_enemy` (single target; `targeted_enemy` is the first living enemy, `CombatUtilities.getTarget`, src/combatsimulator/combatUtilities.js:2-9), `all_allies`, `all_enemies` (multi-target; for enemies `all_enemies` with no enemies → false).
- Multi-target conditions: `number_of_active_units`, `number_of_dead_units`, `lowest_hp_percentage`; other conditions are summed over living units (src/combatsimulator/trigger.js:60-80).
- Single-target values (src/combatsimulator/trigger.js:85-161): buff-presence conditions (by `/buff_uniques/<name>` key or prefix), `current_hp/mp`, `missing_hp/mp`, `stun/blind/silence_status` (true while active or if it expired at exactly `now`). Unknown condition/dependency/comparator → throws.
- Comparators: `>=`, `<=`, `is_active`, `is_inactive` (src/combatsimulator/trigger.js:163-176). `value` is compared as given (no unit conversion).
- `Consumable.shouldTrigger` is the same shape (src/combatsimulator/consumable.js:53-84): false if stunned; cooldown `cooldownDuration/(1+foodHaste or drinkConcentration)`; all triggers AND-ed; empty list → true.

## Consumables

- `checkTriggers` (src/combatsimulator/combatSimulator.js:1039-1092): loops until nothing fires; for each living player then each living enemy, every food then every drink slot is tested.
- `tryUseConsumable` (src/combatsimulator/combatSimulator.js:1094-1159): sets `lastUsed`; queues a `CooldownReadyEvent` at the hasted cooldown; records use; instant (`recoveryDuration == 0`) restore of HP/MP, or `ConsumableTickEvent`s with `ticks = recoveryDuration/5 s`, first tick +5 s, per-tick value `floor(i*total/ticks) - floor((i-1)*total/ticks)` (src/combatsimulator/combatUtilities.js:343-348); each consumable buff is cloned and, for drinks with `drinkConcentration > 0`, `ratioBoost`, `flatBoost` multiplied by `(1+dc)` and duration divided by `(1+dc)` (src/combatsimulator/combatSimulator.js:1145-1156). The hasted-cooldown formula for food uses `foodHaste`, for drinks `drinkConcentration`.
- Consumables are only used by units that appear in `checkTriggersForUnit`; enemies have empty slot arrays.

## Enrage

`EnrageTickEvent` every 60 s of an encounter (src/combatsimulator/combatSimulator.js:996-1037): each living enemy gets `stack = min(10, floor(encounterTime/enemy.enrageTime))`; if > 0, it receives `enrage_damage` (type `damage`) and `enrage_accuracy` (type `accuracy`) buffs with `ratioBoost = 0.1*stack`. The two buffs are added with `addBuffs(buffs)` and **no `currentTime`**, so `startTime` stays `undefined` and `removeExpiredBuffs` (`startTime + duration <= now` → NaN comparison) never removes them (src/combatsimulator/combatSimulator.js:1028, src/combatsimulator/combatUnit.js:379-381, 486-488). `simResult.maxEnrageStack` is updated. Enrage also raises kill XP via `experienceRate` (above).

## Death and respawn

- A unit at 0 HP after an attack/ability/DoT gets `clearEventsForUnit`, `addDeath`, and (enemies) `updateTimeSpentAlive(false)` (src/combatsimulator/combatSimulator.js:628-635, 916-922, 1269-1275).
- Players: 150 s respawn in zones (full HP/MP, buffs reset to permanent, CCs cleared; cooldowns not reset by `PlayerRespawnEvent`). In dungeons a wipe restarts via `CombatStartEvent` after 3 s; `reset(now>0)` for a player only removes expired buffs and keeps cooldowns (src/combatsimulator/combatUnit.js:539-556). Labyrinth uses `player.reset()` (full reset) each attempt (src/combatsimulator/combatSimulator.js:340-342).

## Buff lifecycle (`CombatUnit`)

- `addBuff/addBuffs` store by `uniqueHrid`, stamp `startTime`, and call `updateCombatDetails` only when ratio/flat changed (src/combatsimulator/combatUnit.js:379-408). `removeExpiredBuffs(now)` deletes buffs with `startTime + duration <= now` and recomputes (src/combatsimulator/combatUnit.js:486-495). `clearBuffs` resets `combatBuffs` to a clone of `permanentBuffs` (src/combatsimulator/combatUnit.js:497-500).
- Permanent buffs: `generatePermanentBuffs()` (called once at time 0, src/combatsimulator/combatSimulator.js:337-339) adds every house-room buff, labyrinth-upgrade buff, guild buff, achievement-tier buff, zone buff and extra buff via `addPermanentBuff`, which **merges by `typeHrid`** (sums `flatBoost` and `ratioBoost`) (src/combatsimulator/combatUnit.js:435-484). See `buffs-and-modifiers.md`.
- `Buff` (src/combatsimulator/buff.js:4-12): `ratioBoost = base + (level-1)*ratioBoostLevelBonus`, same for flat; `level` defaults to 1.

## Experience

`SimResult.addExperienceGain` (src/combatsimulator/simResult.js:105-160): per skill `rate` = 0.3 for the primary training skill plus 0.7 for the focus training skill (if set and in the style's `skillExpMap`) or 0.7 split equally across the style's `skillExpMap` skills; gained `= xp * (1+combatExperience) * rate*(1+<skill>Experience) * (1+debuffOnLevelGap)`.
