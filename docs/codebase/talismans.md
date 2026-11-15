# Talismans in the engine

One module, one setup step, two call sites. A later swap for another implementation (upstream's, when it has one) replaces `src/combatsimulator/talismans.js` and the body of `applyTalismans`.

## The field

A player DTO (and a what-if setup) may carry `talismans: { power, lines: [{ modifier, grade }] }`:

- `power`: the belt's Talisman Power as a fraction (0.2 = +20 %); absent = 0.
- `modifier`: an id of `TALISMAN_MODIFIERS` (the game's `/talisman_modifiers/<id>` without the prefix); `grade`: 1 to 6. An unknown id or a grade outside 1..6 throws.
- Absent field (or `null`): the player is left exactly as before. An empty `lines` gives no stat either.

The Tracker's character export and the self slot of its party export write this field (`talismansForSim` in `userscript/mwics-exporter.user.js`); the page keeps it in the slot's JSON and shows it read-only (`src/talismanView.mjs`).

## The table (`src/combatsimulator/talismans.js`)

- `TALISMAN_MODIFIERS`: per modifier its name, its six grade values (the game's `talismanModifierDetailMap`) and the engine stats it adds to (the names `Player.updateCombatDetails` sums from equipment; melee lines go to stab, slash and smash, elemental lines to water, nature and fire).
- The five unique modifiers (Smite, Overkill, Echo, Shatter, Fortify) are listed with no effect: the engine has no code for them.
- `scaleByPower`: grade value x (1 + power), the one line with the formula; checked against the game's own combat stats at two talisman powers.
- `talismanEffects(talismans)` -> `[{ modifier, stat, value }]`; `talismanStats(talismans)` -> `{ stat: summed value }`.

## The one setup step

`applyTalismans(simPlayer, talismans)` in `src/simSetup.js` sets `Player.talismanStats` from `talismanStats`. `Player.updateCombatDetails` adds each to the equipment sum of that stat; `damageTaken` is kept as `CombatUnit.gearDamageTaken` and added to the buffs' damage taken in `CombatUnit.updateCombatDetails`.

Call sites (nothing else computes a talisman stat):

1. `src/simSetup.js` `createSimPlayer`: the page's worker (`src/worker.js`) and every caller of `createSimPlayer`.
2. `tools/whatif/engine-pure.mjs` `runParty` (called through `tools/whatif/engine.mjs` in Node): the what-if search and batch runs; `buildDtos` copies `setup.talismans` onto the DTO.

The calibration and attribution tools build players from setups that carry no talisman field, so they do not call it.

## Packing

`tools/whatif/engine-pure.mjs` imports `src/simSetup.js`, so `tools/runner-zip/build-zip.ps1` archives it; `tools/test/runner-zip-files.mjs` follows the runner's imports and fails when one is missing.

## Tests

`tools/test/talismans.mjs`: the table, the effects, the scaling, the player's sums, the absent field changing nothing, and a what-if run with and without the field.
