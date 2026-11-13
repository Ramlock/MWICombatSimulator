# Combat tracker: how the game draws damage numbers

The userscript `userscript/mwics-exporter.user.js` (named MWI Combat Tracker since 0.5.0) drew the damage numbers on enemies and the teammates' names in each teammate's colour in 0.5.0 and 0.5.1. That per-player colouring was removed in 0.6.0 at the user's request: the script no longer touches the combat screen. Its stored colours (script storage key `mwicsTrackerColors`) are left in place, unused. `userscript/test/tracker.test.cjs` checks that the colouring stays removed.

The notes below on how the game draws damage numbers are kept for any later display work.

## How the game draws damage numbers

Read from a saved copy of the game page (bundle and stylesheet, 2026-11-07). Class names carry a build hash suffix, so match them by prefix (`[class*="CombatUnit_splat"]`).

- The battle panel has a players area (`BattlePanel_playersArea`) followed by a monsters area (`BattlePanel_monstersArea`); each holds one `CombatUnit_combatUnit` element per unit, with a name (`CombatUnit_name`) and a splats grid (`CombatUnit_splatsContainer`).
- The grid has 9 slot divs, keyed by slot index. A live splat is a div with `CombatUnit_splat` plus one of `damage`, `criticalDamage`, `miss`, `heal`, `mana`; its text is the bare number; an empty slot is a bare `<div>`. React reuses the same node for later splats in that slot.
- The colour is the pill's `background-color` (damage and crit: the game's scarlet, crit with an orange glow; miss `#777`).
- A splat is made in the `CombatUnit` component's `componentDidUpdate`, once per `battle_updated` that changes the unit: a heal splat if HP rose, else a damage splat if `dmgCounter` changed, worth the HP drop in that update (0 = miss, crit when the new `dmgCounter` equals the new `critCounter`). Splats expire after about 2 s; when all 9 slots are busy the oldest is reused.
- The component's props carry `combatUnit.isPlayer` and `index` (the unit's index in `pMap`/`mMap`), readable from the element's `__reactFiber$` key.

## Echo check

`tools/echo-analysis.mjs <test-server file> [--window-ms 2000] [--casts] [--json]` reads the test-server records (one JSON per line: records `{ key, type, data }`, bare encounter rows, or a saved recording) and uses the encounters that carry a `trace` (see `toolasha-loot-tracker.md`, "Test server beside the live one, talismans and the trace"). A cast is a player row with an attack-attempt change; an event is a monster row with HP lost (damage) or a player row with HP gained (heal). The events of a cast are those from its own update on, up to the window or the same player's next cast. Per ability it prints counts only: casts with no event, with the first event only, with one more, with two or more; extra events in the same update or a later one; damage or heal; update rows with two or more damage splats; and the number of extra events by ratio to the first event (0.1-wide bins up to 2). `--casts` lists every cast with its events. It decides nothing: whether an extra event is an Echo proc is for whoever reads the counts. Damage is not told apart by dealer, so a fight with several casting players mixes their events; the header gives the number of players that cast.
