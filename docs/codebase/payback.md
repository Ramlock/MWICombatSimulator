# The payback as a break-even day

Every payback figure in the fork comes from one function, `payback` in `src/whatif/payback.mjs`. The window (`src/whatif/panel.mjs`) and the search (`tools/whatif/core.mjs`, `optimize.mjs`, `sure.mjs`, `rounds.mjs`) read it through `paybackDays` and `overPaybackLimit`, which are its no-lead case. The same file holds the level clock, the evenness check and the stopping level. The search's books stage (below) measures with `tools/whatif/ladder.mjs` and builds its rows in `tools/whatif/books.mjs`. Tests: `tools/test/whatif-payback.mjs` (and the payback lines of `tools/test/whatif-sure.mjs`), `tools/test/whatif-ladder.mjs`, `tools/test/whatif-books.mjs`.

The rule it implements:

- Today is the base: levels, uses per day and XP per hour are what the base run measures today; nothing else is bought; prices stay today's.
- An ability's level moves by its uses per day (0.1 XP per use) against the game's experience table; a combat skill's by its XP per hour. Whole levels only, up to the game's top level, 200.
- A change is a cost, a gain on day one (per day, may be negative) and, for each ability or skill it touches, a lead: how many whole levels ahead (or behind) the party is on each later day, against not making the change, worth a gain per whole level per day.
- The payback day is the first day on which the summed difference (day-one gain plus gain per level times the lead, day by day, losing days counted) covers the cost. A lead that shrinks toward nothing can leave a change that never pays back.

## The level clock

The game's experience table is `tools/whatif/levelExperienceTable.json` (`table[i - 1]` is the total XP to reach level `i`; 200 entries, so the top level is 200). Abilities and combat skills share this one table: the client holds one experience table, and ability totals read from the game at levels 38 to 77 matched it exactly (total plus XP to the next level equals the table's next entry). The clock takes the table as an argument (`table`), so `payback.mjs` imports no JSON and stays plain for the page's bundle; the search's tools pass `XP` from `tools/whatif/charm-lib.mjs` or the JSON itself.

| Function | Takes | Returns |
| --- | --- | --- |
| `levelAt(xp, table)` | a total XP | the whole level it reaches: 1 at XP 0, never past 200 |
| `abilityClock(xp, usesPerDay)` | XP now, casts per day | a clock `{ xp, perDay }`, `perDay = usesPerDay × 0.1` (`ABILITY_XP_PER_USE`) |
| `skillClock(xp, xpPerHour)` | XP now, XP per hour | a clock, `perDay = xpPerHour × 24` |
| `levelOn(clock, day, table)` | a clock, a day (may be fractional) | the whole level that day |
| `abilityLevelOn(xp, usesPerDay, day, table)`, `skillLevelOn(xp, xpPerHour, day, table)` | the same, unwrapped | the whole level that day |

## The one function

`payback(change, { table, maxDays })`

- `change = { cost, gain, leads: [{ gainPerLevel, knee?, with: clock, without: clock }] }`. `gain` is the day-one gain per day (0 for books alone; negative for a switch that loses at first). Each lead is one ability or skill: its lead on a day is `levelOn(with) − levelOn(without)`, read at the middle of the day (day `n`, counted from 0, is read at `n + 0.5`, as the books report does), so half a level ahead gives nothing. A lead's `knee` (a level, optional) is where the gain stops: a level past it counts as the knee itself, on both sides.
- `maxDays`: the most days looked at (default: no end). The Payback limit is the caller's; with none, the search stops at the horizon, `HORIZON_DAYS` (5 years).
- Returns the payback in days, or `null`: no cost (0 or not a number), a gain or gain per level that is not a number, or a summed difference that never covers the cost within `maxDays`.
- The figure is the exact crossing point, each day's difference accruing evenly through that day. For a change with no lead it is `cost / gain` exactly, today's figure; with a lead, its ceiling is the first whole day on which the summed difference covers the cost: the books report's break-even day (the test holds the report's `breakEven` and compares, on 48 made-up inputs). **The design's "payback day" is the ceiling of what `payback` returns**; the limit is checked on the figure itself, as before.
- How it walks: the daily difference changes only on a day one of the clocks changes level, so it walks from level change to level change (at most 199 per clock), adding the difference over each stretch, and finds the crossing inside the stretch where it falls. When no clock moves again (no XP coming in, or level 200 reached) the last stretch has no end: a difference above 0 still crosses, one at or below 0 never does. A no-lead change is one stretch from day 0.
- `paybackDays(cost, buyerNet)` is `payback({ cost, gain: buyerNet })`. `overPaybackLimit(cost, buyerNet, limit)`: true when a change with a cost pays back after the limit or never; a free change, or no limit (0, null, undefined), passes.

## The evenness check

`evenness(steps, { margin = 2 })`

- `steps`: the measured steps of one ability or skill, ascending: `[{ levels, gain, se, samples? }]` (+10, +20, +40 ...; the gain per day against the start, its standard error, and optionally the per-seed gains).
- Each step is checked against the one before: the earlier gain against the later gain scaled to the earlier step's levels (`a − k·b`, `k` = the earlier levels over the later), even when within `margin` (2) errors of their difference. When both steps carry samples on two or more common seeds (the books stage runs every state of one ability on the same seeds), the difference is paired: per seed `a − k·b`, its mean and `sd / √n`. Otherwise the two errors are taken as independent. The first step that fails ends the check.
- A pair that could not have failed is `assumed`, not even: both flat shapes (all of the later gain inside the earlier step, and none of it) would also have passed.
- Returns `{ perLevel, perLevelSe, lastEven, flagged, pairs, mark, knee }`: the gain per level and its error from the last even step; `mark` is `notEven` (a step failed), `even` (some pair passed that could have failed) or `assumed`; `knee` is `{ from, to }` when flagged: the last even step and the failed one, the gain stops between them.

## The stopping level

`stoppingLevel({ from, changeAt, limit, measuredTo, table, top = 200 })`

- Levels one at a time while the next level alone still pays back within `limit` (the Payback limit, or the horizon when there is none); the top level is the only other end.
- `changeAt(level)` gives the change of having `level` instead of today (as `payback` takes it; its leads in the same order at every level, with the same `without` clocks). The next level alone is the change from `n` to `n + 1`: the difference in cost and day-one gain, and each lead's `with` at `n + 1` against its `with` at `n`, judged by `payback` with `maxDays = limit`.
- Returns `{ level, levels, cost, payback, pastMeasured }`: where the recommendation stops (`from` when not one level pays back), how many levels, the whole change's cost and payback, and whether the level lies past `measuredTo` (today's level plus the largest measured step), so the search knows to measure further. The next level alone keeps the leads' knees.

## The measuring loop (`tools/whatif/ladder.mjs`)

One loop for books, switches and later skills; it knows nothing of what a level costs. The caller gives `measure(levels, k, h)` (a state on `k` seeds of `h` hours) and `stopAt(perLevel, knee, end)` (the levels the recommendation reaches at that gain per level, through `stopOf`, which is `stoppingLevel`).

- **Precisions** (`precisions({ firstHours, fullHours })`): the first block is 16 seeds (`SURE_BLOCK`) of `firstHours`, the hours doubled up to `fullHours` (the pick check's, `--confirm-hours`), then 16 seeds more at a time up to 64 (`SURE_MAX`). A row moves to the next precision only while it has unsettled levels and no bigger step is left.
- **States**: +10 and +20 first (`firstSteps`, fewer near the top); then double the largest step while not flagged and the centre's stop lies past it or some level is unsettled.
- **Settled levels**: `stopAt` runs at the range's low end, centre and high end (`perLevel ± 2·perLevelSe`). Levels up to the low end's stop are settled in (the recommendation, `levels`), past the high end's stop settled out, between them unsettled (`upTo`). No unsettled level: no more runs, however noisy the gain.
- **Knee**: a failed pair is a knee only once confirmed: both its states are measured again at the next precision and the pair fails there too; with no precision left a failure counts at once. On even gains a pair fails on noise alone in about one row in five; the second look cuts the rows marked `notEven` on noise to about one in thirteen (simulated on the loop). A failure that could not change the recommendation (the same stops at both ends of the range with the knee, at the last even step's gain per level, and without it, at the failed step's) is not measured again: the walk stops below it, the row has no knee and is not marked, its pair kept with `confirmed: false`.
- **Halving**: a confirmed knee sets a fence at its failed step; the fence never rises, so a later noisy pass cannot carry the walk past a knee once found. The loop halves between the last even step and the fence while the knee's place matters (the stops differ with the knee at either end of its bracket, at either end of the range) and the gap is wider than the noise can tell (`max(2, 2·se / perLevel)` levels). A knee changes a stop below it too: it caps the levels that casting brings later, so a switch's payback depends on it even when the levels bought lie below it. The recommendation never passes the last even step.
- **The limit of the knee**: the last even step can lie a few levels past the true knee, because the bracket is only as narrow as the noise allows. On a made-up gain that stops at +25, with the books report's noise, the settled-in levels pass the knee in about 31% of draws, by at most 3 levels, and fall short of it in about 33% (simulated on the loop, 2000 draws).
- `MAX_STATES` (24) is a guard only.
- The changes: `booksChangeAt` (books on a held ability: one lead, today's casts bringing the ability up either way) and `switchChangeAt` (a new ability: the day-one gain, the new ability's lead from level 1, and the old ability's levels given up as a lead below 0).

## The books stage (`tools/whatif/books.mjs`, `core.mjs`)

- Runs under `--levers abilitylevels` (books on held abilities) and `--levers books` (switches too; `all` includes both), profit goal only, after foods and drinks and before the triggers probe. Each row is judged alone against that start by the loop; there is no pick check and no "too small" rule. The rows go to `result.books` (and `result.booksApart`, not judged, with the reason) and a `result.md` section "Ability books and switches"; they join neither the race, the chain nor the budget.
- `--books-first-hours` (default `BOOKS_FIRST_HOURS`, 75): the first block's hours. A shorter first block costs more states per row but far fewer core-hours, since most rows settle on it.
- Held abilities first: their gain per level is what a switch gives up. A switch is one row per not-learned ability of the player's style that meets its requirements, per open slot of its kind; its day-one state (the new ability at level 1) is the ladder's start, and the day-one gain's range enters the ends, so a switch whose favourable end does not pay back is settled out after its first block (`to: 0`, no payback).
- A row's payback is `payback()` of its change at the recommended level, at the centre gain per level; the rows carry no figure of their own.
- Casts a day missing from the runs (a record from before they were counted) are never read as zero: the rows are listed apart with "casts a day unknown", and none of their states is run.


## The use counter

- `tryUseAbility` (`src/combatsimulator/combatSimulator.js`) counts each cast in `source.abilityUses` (a `Map` on the unit, `combatUnit.js`) inside the same block that adds the mana cost to `abilityManaCosts`, so casts × mana cost equals the mana recorded. It changes no simulated outcome.
- `SimResult.setManaUsed(unit)` (`simResult.js`) carries both out: `manaUsed[player][ability]` and `abilityUses[player][ability]` (casts).
- The what-if engine's snapshot (`tools/whatif/engine.mjs` `snapshot`) reads `abilityUses`, and each player of a run record (`metrics`) carries `abilityUsesPerDay`: ability hrid → casts per day, the clock's uses per day.
