# Build and entry points

Commit documented: `95db2f6`.

## Build

- `package.json`: name `mwicombatsimulator` 1.0.1; scripts `build` = `webpack`, `watch`, `start` = `webpack serve --mode development --open`; `test` is a placeholder. Dependencies: `heap-js` (event queue), a self reference `"mwicombatsimulator": "file:"`; dev: `webpack`, `webpack-cli`, `webpack-dev-server`, `copy-webpack-plugin` (`package.json:23-32`). `repository`/`bugs` point at `AmVoidGuy/MWICombatSimulator`.
- `webpack.config.js`: entry `./src/main.js`; output `dist/bundle.js`, `clean: true`; `mode: 'development'`, `devtool: 'source-map'` (`webpack.config.js:5-11`); dev server on port 9000; `CopyWebpackPlugin` copies `patchNote.json`, `index.html`, `js/`, `locales/` into `dist/` (`webpack.config.js:21-30`). Workers are created with `new Worker(new URL('worker.js', import.meta.url))`, which webpack splits into numbered bundles (`dist/0.bundle.js` … in the commit).
- `dist/` is the committed webpack build the site serves. `js/i18n.js` is the translation/i18next setup (not documented further).
- `index.html` is the single page (loads the bundle, Bootstrap and the DOM ids that `src/main.js` looks up). UNCLEAR: `index.html` was not read in detail.

## `src/main.js`

Single module (5031 lines) that owns all UI state, builds the simulation message, and renders results. Sections are `// #region` blocks: Worker, Equipment, food/drinks/abilities, triggers, zones/dungeons/labyrinth, Simulation Result, charts, import/export, prices, extra buffs. See `inputs.md` and `results-and-profit.md`.

## Starting a simulation

1. Click handler `buttonStartSimulation` (`src/main.js:3094-3119`): rejects if any `:invalid` element, `savePreviousPlayer(currentPlayerTabId)`, collects checked `.player-checkbox` (players 1-5), calls `startSimulation(selectedPlayers)`.
2. `startSimulation` (`src/main.js:3144-3368`) builds `playersToSim`, level-gap debuffs, `extra`, then one of three messages.

### Single run → `worker.js`

`worker.postMessage` (`src/main.js:3272-3286`), listener `onWorkerMessage` (`src/main.js:65-90`):

```
{ type: "start_simulation", workerId, players: [DTO...], zone: {zoneHrid, difficultyTier} | null,
  labyrinth: {labyrinthHrid, roomLevel, crates[]} | null, simulationTimeLimit (ns),
  extra: {mooPass, comExp, comDrop, enableHpMpVisualization, personalBuffs[]} }
```

`src/worker.js:6-168`: builds `extraBuffs` from `extra` (hard-coded buff objects), `new Zone(zoneHrid, difficultyTier)` or `new Labyrinth(hrid, roomLevel, crates)`, `Player.createFromDTO(structuredClone(dto))` per player with `zoneBuffs = zone?.buffs || labyrinth?.buffs || []` and `extraBuffs` (`src/worker.js:139-144`), `new CombatSimulator(players, zone, labyrinth, {enableHpMpVisualization})` and `await simulate(limit)`.

### All zones / all labyrinths → `multiWorker.js`

`start_simulation_all_zones` carries `zones: [{zoneHrid, difficultyTier}...]`; `start_simulation_all_labyrinths` carries `labyrinths: [{labyrinthHrid, roomLevel, crates}...]`; both carry `players`, `extra`, `simulationTimeLimit` (`src/main.js:3303-3366`). `src/multiWorker.js:4-67, 68-131`: a pool of `min(navigator.hardwareConcurrency, tasks)` async loops; each task spawns a fresh `worker.js` Worker with a `start_simulation` message for one zone/labyrinth, awaits `simulation_result`, terminates it, stores the result at its index. Progress is the average of per-task progress.

## Messages back

| Message | From | Fields | Handler |
|---|---|---|---|
| `simulation_progress` | `worker.js` every 1000 events (`src/worker.js:148-158`) | `progress` (0-1), `zone`, `difficultyTier`, `labyrinth`, `roomLevel`, `timeSeriesData` | progress bar; HP/MP chart if enabled (`src/main.js:77-85`) |
| `simulation_result` | `worker.js` (`src/worker.js:162`) | `simResult` | `showSimulationResult` (`src/main.js:1505`) |
| `simulation_error` | `worker.js` catch (`src/worker.js:163-166`) | `error` | `showErrorModal` |
| `simulation_progress` | `multiWorker.js` (`src/multiWorker.js:42`) | averaged `progress` | progress bar (`src/main.js:104-108`) |
| `simulation_result_allZones` / `simulation_result_allLabyrinths` | `multiWorker.js` (`src/multiWorker.js:62, 126`) | `simResults[]` in task order | `showAllSimulationResults` (`src/main.js:1545`) |

Results are structured-cloned `SimResult` objects (class instances arrive as plain objects). Stop button terminates and recreates the workers (`src/main.js:3122-3141`).
