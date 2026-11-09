# What-if runner

`tools/whatif/runner/server.mjs`: a local web server that serves the built simulator and runs the what-if optimizer (`tools/whatif/optimize.mjs`) for it, at the lowest operating-system priority on every core. Test: `tools/test/whatif-runner.mjs`.

## Starting it

`node tools/whatif/runner/server.mjs [--port 8787] [--results <dir>] [--dist <dir>]`

- Listens on `127.0.0.1` only. `--port 0` picks a free port; the address is printed on start.
- `--results`: where each search keeps its folder; default `<home>/MWI-WhatIf/results`, never inside the repo.
- `--dist`: the built simulator to serve at `/`; default the repo's `dist/`.
- The runner sets its own priority to Node's `PRIORITY_LOW` (Windows: the idle class) at start (`createRunner`), so every process it starts inherits it; it also sets the optimizer process to it explicitly (`forkOptimizer`). The optimizer gives each run process its own priority (`optimize.mjs`, `ensure`; `batch.mjs` does the same), and `--low-priority` sets the optimizer itself low when it runs from the command line.

## Interface

JSON over HTTP, under `/api/`. Everything else is a static file from `dist/` (`/` is `index.html`); nothing outside `dist/` is served.

| Request | Answer |
|---|---|
| `GET /api/version` | `{ runner, engine }`: the runner's version (with the commit when run from a checkout) and the `bundle.<hash>.js` hash named in `dist/index.html` |
| `POST /api/search` (body JSON, `Content-Type: application/json`, up to 50 MB; a full `marketplace.json` is about 250 KB) | `{ id }`; `409 { error, id, running }` (both the running search's id) while another search runs; `400 { error }` for a malformed request |
| `GET /api/search/<id>` | `{ state, progress, error?, result? }`, `state` one of `running`, `stopped`, `done`, `error`; `result` is the search's `result.json` |
| `POST /api/search/<id>/stop` | `{ id, stopping: true }`; on a stopped search it resumes it from its `request.json`: `{ id, resumed: true }` (the window's Resume); `409` otherwise |
| `GET /api/results` | finished searches, newest first: `[{ id, finished, goal, players }]` |
| `GET /api/results/<id>` | one `result.json` |

The search body: `setups` (the page's setups, each with its `name`), `options` (`zone`, `tier`, `comdrop`, `comexp`; and the prices: `marketplace`, the game's `marketplace.json` body `{ marketData, timestamp }` as the window fetched it when the search started, or `prices`, a snapshot file name in `tools/calibration/`, never both; neither means the optimizer's committed default), `goal`, `budgets` (`{ "<player>": <coin> }`), `levers`, `players` (default: every setup), `stages`, `keep`, `export` (the exporter JSON, for the owned and abilities levers), `triggerCands`, and the optimizer's other flags by their command-line name without the dashes (`max-minutes` or `maxMinutes`; lists as arrays; `false` becomes `--no-<flag>`). `buildArgs` turns it into the optimizer's arguments and refuses anything else (`out`, `setups`, `cache-from` are the runner's own or not offered).

The id is a hash of the request (key order ignored), so a new snapshot is a new search, and the search's folder is `<results>/<id>/`: `request.json`, `setups/` (one file per player and `party.txt`), `marketplace.json` (the request's `options.marketplace`, written once and passed as `--prices`; a resume finds it and keeps it, because the run cache's key holds the price file), `runs.jsonl` (the run store), `progress.json`, `log.txt` (the optimizer's output, each line timestamped), then `partial.json` or `result.json`. The same request again runs in the same folder, so a stopped search resumes from its run store; a finished one is not run again.

Same origin only: a request whose `Host` is not this loopback address and port (DNS rebinding) or whose `Origin` is another site's is refused with `403`. A page of another origin can neither read the interface (no CORS headers) nor start a search (a cross-origin form post cannot send `application/json`, and its `Origin` is refused).

## The optimizer's side

- **Budget per player:** `--budgets A=1.5M,B=200K` (`tools/whatif/budgets.mjs`). `--budget` alone, or the exporter's coin, is every player's budget, and the budget of anyone `--budgets` leaves out; a player with no budget is an error. Each candidate is paid by its own `player`: the screen keeps a candidate whose cost fits its player's budget, and the greedy step and the rebuild after it keep one whose cost fits what its player has left (`affordable`). A change that costs nothing or frees gold is always affordable; a sale never refunds a budget (`pay`).
- **Progress:** `report()` writes `<out>/progress.json` and, when the optimizer has an IPC channel, sends `{ type: 'progress', progress }`. Fields: `stage` (`probe`, `screen`, `halving <n>`, `greedy step <n>`, `confirmation`, `done`, `stopped`), `candidatesLeft`, `runsDone` and `runsPlanned` of the current batch (one stage; cached runs are not counted), `secondsPerRun` (mean core-seconds per run in this batch, else in this call), `etaSeconds` (the batch's sim hours left times the measured core-seconds per sim hour, over the processes in use; `etaScope: 'stage'`: later stages are not in it), `elapsedSeconds`.
- **Stop:** the IPC message `'stop'` stops issuing runs and kills the runs in flight. Every finished run is already a whole line of `runs.jsonl` (the parent appends it), so nothing half-written is left; the optimizer writes `partial.json` with `stoppedBy: 'stop request'` and exits with code 3, as `--max-minutes` does.
- **`result.json`** additions: at the top `budgets`, `partySize`, `options` (zone, tier, comdrop, comexp, `prices` the price file relative to the checkout, `pricesTimestamp` the snapshot's own `timestamp` in seconds, `pricesSource` `committed` for a file of `tools/calibration/` or `snapshot` for any other such as the request's, levers; the last three are not in the run cache's key) and the base `setups`; `overBudget`, the priced candidates whose cost is above their own player's budget (`id`, `player` the payer, `desc`, `cost`, `costBound`, `costPath`, `note`), listed and never ranked, beside `apart` (unknown cost); on every row of `steps` and `singles` its `player`, `ops`, `gainPerUser` and `sePerUser` (the party figure divided by the party size, equal split), with `accepted` and `costBound` as before; each step's `runningSpend` per player (cumulative after it; `runningCost` stays as the sum); `confirmation` carries `gainPerUser`, `sePerUser`, `accepted` and `runningSpend`.
