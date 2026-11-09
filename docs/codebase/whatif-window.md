# The What-if window

The page's What-if window runs the what-if optimizer (`tools/whatif/optimize.mjs`) through the local what-if runner: a program on the user's own PC that serves this page and runs the search at low priority on every core. The public website has no runner, so it shows no What-if button.

## Files

1. `src/whatif/panel.mjs`: the window's logic, without the DOM, tested in Node: the request body, the progress line, the result tables, which slots an Apply writes, and where the page's setup differs from the search's. It computes no figure: every number shown is a field of the result or of the progress, rendered with `numberHtml` (`src/numberFormat.js`), so the raw value rides along.
2. `src/whatif/applyOps.mjs`: the ops that edit a setup (enhance, equip, food, drink, ability, abilityLevel, abilityOrder, unequip, level, house, trigger). Shared: `tools/whatif/variants.mjs` re-exports it for the Node tools.
3. `src/main.js`, region "What-if window": the DOM side. `initWhatIf` asks `/api/version`; only when it answers is the button shown and the window wired. `whatIfSlots` saves the current tab first (`savePreviousPlayer`), then reads the five slots with their tab names. Apply writes the new slot JSON into `playerDataMap` and reloads the screen (`updateNextPlayer`, `updateState`, `updateUI`), as an import does.
4. `index.html`: the button (hidden by default, beside Import/Export), the `whatIfModal` window and its styles (in Dark Mode the progress bar has a dark track with a border and a blue fill, so an empty bar reads as empty).
5. Strings: `common:whatIf.*` in `locales/en`, `pt` and `zh`.

## The runner's interface (JSON over HTTP, same address as the page)

1. `GET /api/version`: `{ runner, engine }`.
2. `POST /api/search`: `{ setups, options: { zone, tier, marketplace }, goal: "profit" | "exp", budgets: { "<player>": coin }, levers: [...], players }` answers `{ id }`. `marketplace` is the game's `marketplace.json` body, fetched when Start is pressed by `fetchMarketplace` (`src/marketplace.mjs`, shared with the page's Get Prices button; `searchRequest` in `panel.mjs`); when the fetch fails the window says so and starts no search (no older snapshot is used in its place); a second search while one runs is refused with the running `id`, and the window then follows that one.
3. `GET /api/search/<id>`: `{ state: "running" | "stopped" | "done" | "error", progress: { stage, candidatesLeft, runsDone, runsPlanned, secondsPerRun, etaSeconds }, error?, result? }`. The window polls it every second while it runs.
4. `POST /api/search/<id>/stop`: stops a running search; the same request on a stopped one resumes it.
5. `GET /api/results` (newest first, `{ id, finished, goal, players }`) and `GET /api/results/<id>` (one result).

## What the window reads from a result

1. Top: `goal`, `budgets` per player, `setups` (the base the search ran on), `confirmation` (`gainPerUser`, `sePerUser`, `cost`, `payback`), `apart` (unknown cost, listed, never ranked), `overBudget` (priced but above its player's budget: "Priced, over budget", player, change and cost, listed apart in the same style, never ranked), `options.pricesTimestamp` and `options.pricesSource` (one line: the snapshot's time and its age when shown, or that the simulator's own saved snapshot was used).
2. Each row of `steps` and `singles`: `player`, `desc`, `gainPerUser`, `sePerUser`, `cost`, `costBound: "upper"` (printed as "≤" on the cost, the payback, and that player's running spend from that step on), `payback` (none shows "—"), `accepted` (a single that is not is grey, and sits collapsed behind one "Show N more below 2 errors" toggle, N being the count of those rows), `ops`; a single also `lastStage`, `costPath`, `note`; a step also `runningSpend` per player.
3. Apply on step n applies the ops of steps 1 to n together; Apply on a single applies its own. An op naming a player no tab is named after applies nothing and names that player.

## Tests

1. `tools/test/whatif-panel.mjs`: the logic and the strings in en, pt and zh.
2. `tools/test/whatif-window.mjs`: the built page (`dist/`) in our own headless Chrome against a fake runner that implements the interface above; `--shots <dir>` saves dark pictures of the window.
