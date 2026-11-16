# Talismans in the engine

One module, one setup step, two call sites. A later swap for another implementation (upstream's, when it has one) replaces `src/combatsimulator/talismans.js` and the body of `applyTalismans`.

## The field

A player DTO (and a what-if setup) may carry `talismans: { power, lines: [{ modifier, grade }] }`:

- `power`: the belt's Talisman Power as a fraction (0.2 = +20 %); absent = 0.
- `modifier`: an id of `TALISMAN_MODIFIERS` (the game's `/talisman_modifiers/<id>` without the prefix); `grade`: 1 to 6. An unknown id or a grade outside 1..6 throws.
- Absent field (or `null`): the player is left exactly as before. An empty `lines` gives no stat either.

The Tracker's character export and the self slot of its party export write this field (`talismansForSim` in `userscript/mwics-exporter.user.js`); the page keeps it in the slot's JSON and shows it read-only (`src/talismanView.mjs`).

The names shown: a modifier the game's bundle in `js/i18n.js` has (`TALISMAN_NAME_KEYS`) uses its key there; every other one (melee and elemental lines, Thorns, Reduced Threat, the five unique ones), the label and Talisman Power use `common:talismans.*` in `locales/{en,pt,zh}/common.json`, the game's own words taken 2026-11-15 from the game's test client (not yet in the live one): `test.milkywayidle.com/static/js/main.60d0d5b1.chunk.js` (en), `7.4277e30d.chunk.js` (pt), `10.14d8a4bb.chunk.js` (zh), keys `talismanModifierNames./talisman_modifiers/*`, `combatStats.talismanPower|smite|overkill|echo|shatter|fortify`, `characterManagement.talismans`, `talismansPanel.reducedThreat`.

## The table (`src/combatsimulator/talismans.js`)

- `TALISMAN_MODIFIERS`: per modifier its name, its six grade values (the game's `talismanModifierDetailMap`) and the engine stats it adds to (the names `Player.updateCombatDetails` sums from equipment; melee lines go to stab, slash and smash, elemental lines to water, nature and fire).
- The unique modifiers: Smite, Shatter, Fortify and Overkill each have one effect under their own id (below, "The unique modifiers"); Echo has none (not simulated).
- `scaleByPower`: grade value x (1 + power), the one line with the formula; checked against the game's own combat stats at two talisman powers.
- `talismanEffects(talismans)` -> `[{ modifier, stat, value }]`; `talismanStats(talismans)` -> `{ stat: summed value }`.

## The one setup step

`applyTalismans(simPlayer, talismans)` in `src/simSetup.js` sets `Player.talismanStats` from `talismanStats`. `Player.updateCombatDetails` adds each to the equipment sum of that stat (the unique ids `smite`, `shatter`, `fortify`, `overkill` are no gear stat, so it leaves them alone and the engine reads them from `talismanStats`); `damageTaken` is kept as `CombatUnit.gearDamageTaken` and added to the buffs' damage taken in `CombatUnit.updateCombatDetails`.

Call sites (nothing else computes a talisman stat):

1. `src/simSetup.js` `createSimPlayer`: the page's worker (`src/worker.js`) and every caller of `createSimPlayer`.
2. `tools/whatif/engine.mjs` `runParty`: the what-if search and batch runs; `buildDtos` copies `setup.talismans` onto the DTO.

The calibration and attribution tools build players from setups that carry no talisman field, so they do not call it.

## The unique modifiers

**All four come from the in-game text and are not checked against fights.** The text is the whole source (the game's client data holds the grade values only):

- Smite: "Deals 3% more damage to bosses." (G1)
- Shatter: "Critical hits gain 4% armor and resistance penetration." (G1)
- Fortify: "When hit, gain 2.5% armor and resistances for 5s, stacking up to 4 times." (G4)
- Overkill: "On a killing blow, stores 22.5% of the excess damage and adds it as true damage to the first target of your next successful direct attack." (G2)

A line's value is its grade value x (1 + Talisman Power), as for every other modifier. The engine reads it with `uniqueValue(unit, id)` (0 for a monster). The helpers live in `src/combatsimulator/talismans.js`; the engine calls them from one place each, so the page's simulation and the what-if search (`tools/whatif/engine.mjs`, which runs the same `CombatSimulator`) get them by the same path.

- **Smite:** `CombatUtilities.processAttack` multiplies the damage roll by `smiteMultiplier(source, target)` (1 + value against a boss), next to the task damage and damage-taken factors. A boss is what `isBoss` says: a monster the zone spawned as its boss encounter (`spawnedAsBoss`, set in `Zone.getRandomEncounter`) or a monster of a dungeon's fixed wave (`spawnedInFixedWave`, set in `Zone.getNextWave`; the waves the engine already reports as boss waves). The monster data has no boss flag; a labyrinth room's monster and a promoted chess piece are never a boss. Damage over time is a share of the hit's damage, so it carries Smite with no extra code.
- **Shatter:** in `processAttack`, after the crit roll, `shatterPenetration` adds the value to that hit's penetration of its damage type (armor penetration for physical, that element's penetration otherwise), for that hit only.
- **Fortify:** `CombatSimulator.applyFortify(target, attackResult)`, called after each `processAttack` (auto attack, ability, parry), gives a unit that was hit one stack: four engine buffs (`/buff_types/armor` and the three resistances) of ratio boost stacks x value, i.e. a share of the base armor and resistances as every % armor buff in the engine, from `fortifyBuffs`. It schedules a `CheckBuffExpirationEvent` 5 s later, and the buffs run out through `removeExpiredBuffs` like any other. At most 4 stacks (`FORTIFY_MAX_STACKS`).
- **Overkill:** in `processAttack`, the unit's store (`unit.overkillStore = { amount, attack }`) is spent by `overkillSpend` on the first landed hit of a later attack: the whole amount, floored to whole HP, added to that hit's damage with no armor, resistance, crit or multiplier, capped at the target's HP; the store empties. A killing blow fills it with `overkillStore`: value x (damage beyond the target's HP). The callers pass one `attack` object per attack (an auto attack event with all the targets its pierce reaches, an ability's damage effect with all its targets), so the same attack's later targets do not spend the store it just filled. `attackResult.hitDamageDone` is the hit without the true damage: life steal, HP drain, mana leech and an ability's damage over time take that.

### The open questions: one setting each

`UNIQUE_SETTINGS` at the top of `src/combatsimulator/talismans.js`. Each default is the plainest reading of the text; flip it there once a recording answers it.

| Setting | Default | Reading |
| --- | --- | --- |
| `SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES` | true | a dungeon's fixed-wave monsters are bosses (the engine already calls them boss waves); off = only zone bosses |
| `SMITE_ON_REFLECT` | true | Smite also raises the thorns and retaliation the player deals to a boss ("deals more damage" names no kind) |
| `SHATTER_ADDS_TO_PENETRATION` | true | the value is added to the hit's penetration, as a penetration line is; off = (1 + penetration) x (1 + value) - 1 |
| `SHATTER_ON_ABILITIES` | true | an ability's crit counts ("critical hits" names no kind) |
| `FORTIFY_NEW_STACK_RESTARTS_ALL` | true | a new stack restarts the 5 s of all stacks, as the engine's Fury does; off = each stack runs its own 5 s and a hit at 4 stacks renews the oldest |
| `FORTIFY_ON_MISS` | false | only a landed attack is "hit"; a dodged one gives nothing |
| `OVERKILL_CARRIES_ACROSS_FIGHTS` | true | the store keeps across encounters, waves and deaths (the text names no expiry); off = it empties at each encounter's end |
| `OVERKILL_KILLS_ADD_UP` | true | two kills before the store is spent add up; off = the later overwrites |
| `OVERKILL_AREA_KILLS` | true | every kill of an area ability is a killing blow |
| `OVERKILL_DOT_KILLS` | false | a damage-over-time tick is not a blow |
| `OVERKILL_REFLECT_KILLS` | false | a kill by the player's thorns or retaliation is not a blow |
| `OVERKILL_EXCESS_AFTER_MITIGATION` | true | the excess is the damage after armor or resistance; off = the raw roll |
| `OVERKILL_PARRY_IS_DIRECT` | true | a parry's counterattack is a direct attack |

Readings with no setting: Fortify's share is of the base armor and resistances (the engine's ratio buffs all are); "direct attack" is every `processAttack` call (auto attacks, ability damage, parries), never a damage-over-time tick, thorns or retaliation; "the first target" is the first target the attack lands on; a Fortify stack is gained only while the unit is alive.

## Packing

`tools/whatif/engine.mjs` loads `src/simSetup.js`, so `tools/runner-zip/build-zip.ps1` archives it; `tools/test/runner-zip-files.mjs` follows the engine's `src('...')` loads and fails when one is missing.

## Tests

`tools/test/talismans.mjs`: the table, the effects, the scaling, the player's sums, the absent field changing nothing, and a what-if run with and without the field; for the unique modifiers, direct `processAttack` calls with `Math.random` fixed (Smite on a boss and not on another monster, Shatter on a crit and not on a plain hit, Overkill's store, spend and settings), Fortify's stacks and run-out through `applyFortify`, the zone's boss marks, every setting's default, and a page run and a what-if run that the four change.
