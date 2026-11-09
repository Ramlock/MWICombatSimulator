# Results and profit

Commit documented: `95db2f6`. `SimResult` (`src/combatsimulator/simResult.js`) is built in the worker, posted back with `postMessage` (structured clone), and all revenue/cost/profit arithmetic runs afterwards in `src/main.js`, not in the engine.

## What `SimResult` counts during a run

| Field | Written by | Meaning |
|---|---|---|
| `deaths[hrid]` | `addDeath` src/combatsimulator/simResult.js:63-69 (called at every 0-HP event in `combatSimulator.js`) | kills of each monster hrid and deaths of each `playerN` |
| `encounters` | `addEncounterEnd` src/combatsimulator/simResult.js:162 (from `checkEncounterEnd`, src/combatsimulator/combatSimulator.js:706) | encounters fully cleared |
| `experienceGained[player][skill]` | `addExperienceGain` src/combatsimulator/simResult.js:105-160 | per-skill XP, formula in `engine.md` |
| `attacks[source][target][ability][hit]` | `addAttack` src/combatsimulator/simResult.js:166-182 | counts per damage value (or `"miss"`), per ability/`autoAttack`/`parry`/`retaliation`/thorns type/`damageOverTime` |
| `consumablesUsed[player][hrid]` | `addConsumableUse` src/combatsimulator/simResult.js:184-193 | uses per food/drink |
| `hitpointsGained`, `manapointsGained`, `hitpointsSpent` | src/combatsimulator/simResult.js:195-255 | per source name (regen, consumable hrid, lifesteal, ability hrid, ripple, manaLeech) |
| `manaUsed[player][ability]` | `setManaUsed` src/combatsimulator/simResult.js:239-244 from `player.abilityManaCosts` (src/combatsimulator/combatSimulator.js:1190-1196) | total mana spent per ability |
| `timeSpentAlive[]` | `updateTimeSpentAlive` src/combatsimulator/simResult.js:71-86 | per monster hrid (and per dungeon wave `#N`): total time alive and count |
| `playerRanOutOfMana`, `playerRanOutOfManaTime` | `addRanOutOfManaCount` src/combatsimulator/simResult.js:257-275 | out-of-mana flag and time; the flag object is pre-seeded for `player1..player5` only (src/combatsimulator/simResult.js:16-22) |
| `triggerHolds[player][ability][i]`, `manaHolds[player]` | `updateTriggerHolds`, `closeTriggerHolds`, `syncManaHold` in src/combatsimulator/simResult.js, fed by `addNextAttackEvent` (src/combatsimulator/combatSimulator.js) through `Ability.shouldTrigger`'s optional `failed` list | "Held by trigger": per player ability and trigger condition `{held, start, total, count}`. A condition holds the ability when the ability is ready (not stunned or silenced, off cooldown) but the condition fails at a check; every failing condition counts, all conditions being evaluated. A hold ends at the next check where that condition passes, at the player's death, or at the encounter's end (`closeTriggerHolds`). Abilities after a used or mana-short one are not checked, so their holds carry on unchanged. "Held for mana": the union of the out-of-mana state and any open hold by an own-MP condition (`self` + `current_mp` / `missing_mp`, `isOwnMpTrigger` in src/combatsimulator/triggerHolds.js); `count` = entries into that state. The counters only observe (tools/test/held-by-trigger.mjs runs a seed with and without them). Shown under "Ran out of mana" by `triggerHoldRows` (src/main.js) from `summarizeTriggerHolds` (src/combatsimulator/triggerHolds.js): share of sim time (an open hold runs to `simulatedTime`) and holds per hour; conditions with no hold are left out. Both labels carry the definitions above as a tooltip (`heldByTriggerTip`, `heldForManaTip` in `locales/*/common.json`, kept current on a language change by the `data-i18n-title` pass in `updateContent`). |
| `dropRateMultiplier`, `rareFindMultiplier`, `combatDropQuantity`, `debuffOnLevelGap` | `setDropRateMultipliers` src/combatsimulator/simResult.js:217-237, at the end of the run | `1 + combatDropRate`, `1 + combatRareFind`, `combatDropQuantity` (no `1+`), the player's `debuffOnLevelGap` |
| Dungeon fields | src/combatsimulator/combatSimulator.js:212-256; `updateDungenonFinish` src/combatsimulator/simResult.js:88-103 | `dungeonsCompleted/Failed`, `maxWaveReached`, `min/maxDungenonTime`, `lastDungeonFinishTime`, `bossSpawns`, `wipeEvents` (last 200 hits before a wipe, src/combatsimulator/combatSimulator.js:45-59) |
| Other | | `lastEncounterFinishTime`, `maxEnrageStack`, `labyAttemptCount`, `simulatedTime`, `timeSeriesData` (HP/MP every 1000 events when enabled, src/combatsimulator/simResult.js:278-297), `numberOfPlayers` |

**Drops are not rolled in the engine.** `SimResult` has no drop fields other than the multipliers above. The `Drops` class (src/combatsimulator/drops.js:1-10) is a plain record; `Monster` fills `dropTable`/`rareDropTable` with it (src/combatsimulator/monster.js:38-47) but no code reads `monster.dropTable` or `monster.rareDropTable` (only `combatMonsterDetailMap[...].dropTable` is read directly at `src/main.js:1998-2011`). UNCLEAR: whether `Drops` instances are used anywhere not caught by `grep dropTable` over `src/` (none found).

## How drops are computed (`calcDropMaps`, `src/main.js:1982-2070`)

Run per displayed player after the simulation, from `simResult.deaths` (kill counts per monster hrid; names `player1..player5` are filtered out, `src/main.js:1989-1991`).

1. For each monster, each entry of `combatMonsterDetailMap[monster].dropTable`: skipped if `drop.minDifficultyTier > simResult.difficultyTier` (`src/main.js:2000`). Effective rate `r = min(1, (1 + 0.1*tier) * (dropRate + (dropRatePerDifficultyTier ?? 0) * tier))` (`src/main.js:2004-2005`), skipped if `r <= 0`, then `min(1, r * dropRateMultiplier)` (`src/main.js:2008`). `dropRateMultiplier = 1 + combatDropRate` (equipment + `combat_drop_rate` buffs).
2. Rare drops (`rareDropTable`): skipped if `minDifficultyTier > tier`; rate `= dropRate * rareFindMultiplier` with **no** cap and no tier scaling (`src/main.js:2010-2016`).
3. **Expected ("No RNG") amount** per item: `kills * rate * (min+max)/2 * (1 + debuffOnLevelGap) * (1 + combatDropQuantity) / numberOfPlayers` (`src/main.js:2019, 2023`).
4. **Sampled amount** per item: for each kill, `if (random <= rate/numberOfPlayers)` add `floor(random*(max-min+1)+min) * (1+debuffOnLevelGap) * (1+combatDropQuantity)`, with fractional amounts rounded stochastically by `fidDropAmount` (`src/main.js:1974-1980, 2026-2041`).
5. Amounts of the same item across monsters are summed (`src/main.js:2042-2065`).
6. For dungeons `showKills` substitutes empty maps, so drops and revenue are zero (`src/main.js:2332`). The dungeon `rewardDropTable` in src/combatsimulator/data/actionDetailMap.json is not read anywhere.
7. The rate is divided by `numberOfPlayers` regardless of which players are alive or which one is displayed.

## Revenue, expenses, profit

- Prices: `window.prices[hrid] = {ask, bid, vendor}` built by `fetchPrices` (`src/main.js:4638-4733`) from `https://www.milkywayidle.com/game_data/marketplace.json` (fallback `https://www.milkywayidlecn.com/game_data/marketplace.json`). Only enhancement level `'0'` entries are used (`src/main.js:4685-4688`); `vendor = itemDetailMap[item].sellPrice`. `/items/coin` is fixed at 1; the small/medium/large treasure chests are priced from src/combatsimulator/data/openableLootDropMap.json as `Σ price * dropRate * (max+min)/2` (`src/main.js:4692-4728`). Prices are fetched only when the user clicks "Get prices" (`src/main.js:4735-4737`); before that `window.prices` is undefined and every price is `-1`.
- Price choice per item (`src/main.js:2347-2369`): setting `bid` → bid, else ask if bid is -1; setting `ask` → ask, else bid; if still -1 → vendor; an item missing from `window.prices` stays at `-1`. Separate settings `selectPrices_drops` (revenue) and `selectPrices_consumables` (expenses).
- Revenue (sampled) `= Σ price*dropAmount` over `totalDropMap`; "No RNG" revenue `= Σ price*noRngAmount` (`src/main.js:2336-2431`). The same sum also recomputed in `getDropProfit` for the all-zones table (`src/main.js:2072-2142`).
- Expenses `= Σ price * consumablesUsed[item]` for the displayed player (`src/main.js:2519-2565`). Only food and drink use is counted.
- Profit `= window.revenue - window.expenses`; no-RNG profit `= window.noRngRevenue - window.expenses` (`src/main.js:1532-1537`).
- **Time basis:** revenue, expenses and profit are totals over the whole simulated time (`simulationTimeLimit`, default 24 h from `inputSimulationTime`, `src/main.js:3092, 3245`), not per-hour values. Only the displayed rates (kills, consumables, encounters, XP) are divided by hours. There is no code that converts profit to a per-day figure; with the default 24 h the total is a per-day figure by construction. The all-zones table passes the same totals (`src/main.js:1954-1966`).
- Hours used for rates (`src/main.js:2252-2257`): `simulatedTime`, replaced by `lastDungeonFinishTime` for dungeons or `lastEncounterFinishTime` when > 0. `showConsumablesUsed`, `showDeaths`, `showExperienceGained` divide by plain `simulatedTime` (`src/main.js:2444, 2457, 2507`). `simulatedTime` is the time of the last processed event (src/combatsimulator/combatSimulator.js:232).
- Rounding: displayed values use `toLocaleString`/`toFixed`; `noRngRevenue`, `expenses` and `noRngProfit` in the all-zones rows are formatted strings with 2 decimals (`src/main.js:2139-2141`). Prices edited in the tables update totals through `updateTable` (`src/main.js:4739-4819`).

## Assumptions baked into the numbers

- Drop rate for the displayed player equals `rate / numberOfPlayers` for every player (group drops are divided evenly; the displayed player's own multipliers apply).
- No tax or marketplace fee is applied; no coin conversion beyond `/items/coin = 1`.
- Only `dropTable` and `rareDropTable` of killed monsters count. Not counted: dungeon rewards, essences (`essenceDropTable` in zones is not read), task rewards, ability-book or key costs, equipment wear, enhancement costs, house/guild upkeep.
- Drops use difficulty-tier multiplier `1 + 0.1*tier`, applied in the UI code rather than in data.
- Expenses cover only consumables that the simulation used.
- `debuffOnLevelGap` multiplies drops and XP; it is computed in `startSimulation` (`src/main.js:3195-3213`) as `-min(0.9, 3*(maxCombatLevel/ownCombatLevel - 1.2))` when the ratio exceeds 1.2, else 0; combat level `= 0.1*(stamina+intelligence+attack+defense+max(melee,ranged,magic)) + 0.5*max(attack,defense,melee,ranged,magic)` (`src/main.js:745-749`).
