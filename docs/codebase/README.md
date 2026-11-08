# MWI Combat Simulator — codebase documentation

Documents upstream `testing` at commit `95db2f6` of `https://github.com/shykai/MWICombatSimulatorTest.git`, the code the live site `https://shykai.github.io/MWICombatSimulatorTest/dist/` is built from. Describes what the code does today, without fixes or judgments. All `path:line` references are relative to the repo root at that commit. `UNCLEAR:` marks what could not be determined.

## Files

- `build-and-entry.md`: `package.json`, webpack, `index.html`, `src/main.js` role, the two workers, message formats.
- `inputs.md`: every UI input, where it is read, how it reaches the engine.
- `engine.md`: event queue, main loop, events, unit stat formulas, damage resolution, abilities, triggers, consumables, enrage, zones, labyrinth.
- `buffs-and-modifiers.md`: every modifier source, its data file, reader and affected stats; the full house-room trace.
- `results-and-profit.md`: what `SimResult` counts; drop, revenue, expense and profit arithmetic and its assumptions.
- `game-data.md`: one row per file in `src/combatsimulator/data/`, with unused fields.
- `observed-gaps.md`: unused data, dead code, TODOs, hard-coded constants, ignored inputs.
- `game-data-fields.md`: where the game sends each kind of character data (message, field path), for our read-only exporter; why the HTML is not a source.
- `combat-tracker.md`: how the game draws damage numbers (notes kept from the per-player colouring, removed in userscript 0.6.0).

`js/i18n.js` is the i18next translation setup (about 1.3 MB of strings). `dist/` is the committed webpack build the site serves.

## Overview

```
index.html + src/main.js (UI, state, rendering)
   │ postMessage {type:"start_simulation", players[], zone|labyrinth, simulationTimeLimit, extra}
   ▼
src/worker.js ──(all zones / labyrinths)── src/multiWorker.js → one src/worker.js per task, pooled
   │ builds Zone/Labyrinth, Player.createFromDTO, extra buffs
   ▼
CombatSimulator.simulate (discrete-event loop over a min-heap of events, ns time)
   │ events → CombatUtilities.processAttack / abilities / consumables / regen
   ▼
SimResult (counts only: kills, deaths, damage, XP, consumables, mana, time alive)
   │ postMessage {type:"simulation_result", simResult} (+ progress every 1000 events)
   ▼
src/main.js: kills/h, XP/h, drops (calcDropMaps from kill counts), prices → revenue, expenses, profit
```

The engine never rolls item drops or prices anything; drops and profit are computed in `src/main.js` from kill counts and consumable counts after the run.
