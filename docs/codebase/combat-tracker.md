# Combat tracker: teammate colours on damage numbers

The userscript `userscript/mwics-exporter.user.js` (named MWI Combat Tracker since 0.5.0) draws the damage numbers on enemies in the colour of the teammate who dealt the hit, and colours each teammate's name in the combat window the same way. Display only: it sets inline styles on the page, nothing reaches the game. Tests: `node userscript/test/tracker.test.cjs`.

## How the game draws damage numbers

Read from a saved copy of the game page (bundle and stylesheet, 2026-11-07). Class names carry a build hash suffix, so the script matches them by prefix (`[class*="CombatUnit_splat"]`).

- The battle panel has a players area (`BattlePanel_playersArea`) followed by a monsters area (`BattlePanel_monstersArea`); each holds one `CombatUnit_combatUnit` element per unit, with a name (`CombatUnit_name`) and a splats grid (`CombatUnit_splatsContainer`).
- The grid has 9 slot divs, keyed by slot index. A live splat is a div with `CombatUnit_splat` plus one of `damage`, `criticalDamage`, `miss`, `heal`, `mana`; its text is the bare number; an empty slot is a bare `<div>`. React reuses the same node for later splats in that slot.
- The colour is the pill's `background-color` (damage and crit: the game's scarlet, crit with an orange glow; miss `#777`).
- A splat is made in the `CombatUnit` component's `componentDidUpdate`, once per `battle_updated` that changes the unit: a heal splat if HP rose, else a damage splat if `dmgCounter` changed, worth the HP drop in that update (0 = miss, crit when the new `dmgCounter` equals the new `critCounter`). Splats expire after about 2 s; when all 9 slots are busy the oldest is reused.
- The component's props carry `combatUnit.isPlayer` and `index` (the unit's index in `pMap`/`mMap`).

## How a number is matched to its dealer

1. The recorder (`createRecorder`) attributes each monster's damage event from the attack-counter deltas of the same update (`damageEvent`); its `onHit` option receives `{ battleId, idx, value, crit, dealer }`, dealer being the party slot or `null` when ambiguous (several events merged, no actor, more than one actor).
2. The socket hook reads the message before the page renders it, so `createTint().noteHit` queues the hit per monster index first.
3. A `MutationObserver` on each monster's splats grid sees a slot turn into a damage splat; `tintSlot` takes the first queued hit with the splat's value (`splatColor`) and sets the slot's background. If two updates were drawn in one render, the splat shows their sum: it takes their dealer when they share one. No match, or an ambiguous hit: the fallback colour (default: none, the game's red stays). A miss keeps the game's grey fill and gets a 2 px inner ring (`box-shadow: inset`, no layout change) in the dealer's colour, only when the dealer is known (never the fallback); heal and mana splats are left alone. Misses on the players' side are untouched (no teammate dealt them).
4. A unit's side and index come from its React props (`unitInfo`, read only); if those cannot be read, from its order inside the players or monsters area.

## Settings and storage

Script storage key `mwicsTrackerColors`: `{ on, byId: { characterId: '#rrggbb' }, fallback: '#rrggbb' | null }`. Colours follow the character id, so a player keeps their colour in any slot. Until one is picked a slot takes `TINT.PALETTE[slot]` (slot 1 to 5: magenta `#c026d3`, gold `#ca8a04`, lime `#4d7c0f`, indigo `#3730a3`, brown `#78350f`; best first, none red). The Settings dialog has a "Teammate colours" section: an on/off box, one colour per member of the current party with a Default button, and the colour of unattributed hits with a Game red button.

With the recorder switched off, a second recorder instance feeds the colours and keeps nothing.

## Not done

- Thorns and reflect damage on a monster take the fallback (no attacker counter moves); inferable later.
- A colour swatch on the combat screen itself (a later addition).
- Checked against the saved page only: the reading of React props and the monster order come from the bundle and the saved DOM, not yet from a live session.
