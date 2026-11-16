# The payback as a break-even day

Every payback figure in the fork comes from one function, `payback` in `src/whatif/payback.mjs`. The window (`src/whatif/panel.mjs`) and the search (`tools/whatif/core.mjs`, `optimize.mjs`, `sure.mjs`, `rounds.mjs`) read it through `paybackDays` and `overPaybackLimit`, which are its no-lead case. The same file holds the level clock, the evenness check and the stopping level. Its tests: `tools/test/whatif-payback.mjs` (and the payback lines of `tools/test/whatif-sure.mjs`).

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

- `change = { cost, gain, leads: [{ gainPerLevel, with: clock, without: clock }] }`. `gain` is the day-one gain per day (0 for books alone; negative for a switch that loses at first). Each lead is one ability or skill: its lead on a day is `levelOn(with) − levelOn(without)`, read at the middle of the day (day `n`, counted from 0, is read at `n + 0.5`, as the books report does), so half a level ahead gives nothing.
- `maxDays`: the most days looked at (default: no end). The 5-year horizon and the Payback limit are the caller's.
- Returns the payback in days, or `null`: no cost (0 or not a number), a gain or gain per level that is not a number, or a summed difference that never covers the cost within `maxDays`.
- The figure is the exact crossing point, each day's difference accruing evenly through that day. For a change with no lead it is `cost / gain` exactly, today's figure; with a lead, its ceiling is the first whole day on which the summed difference covers the cost: the books report's break-even day (the test holds the report's `breakEven` and compares, on 48 made-up inputs). **The design's "payback day" is the ceiling of what `payback` returns**; the limit is checked on the figure itself, as before.
- How it walks: the daily difference changes only on a day one of the clocks changes level, so it walks from level change to level change (at most 199 per clock), adding the difference over each stretch, and finds the crossing inside the stretch where it falls. When no clock moves again (no XP coming in, or level 200 reached) the last stretch has no end: a difference above 0 still crosses, one at or below 0 never does. A no-lead change is one stretch from day 0.
- `paybackDays(cost, buyerNet)` is `payback({ cost, gain: buyerNet })`. `overPaybackLimit(cost, buyerNet, limit)`: true when a change with a cost pays back after the limit or never; a free change, or no limit (0, null, undefined), passes.

## The evenness check

`evenness(steps, { margin = 2 })`

- `steps`: the measured steps of one ability or skill, ascending: `[{ levels, gain, se }]` (+10, +20, +40 ...; the gain per day against today and its standard error).
- Each step is checked against the one before: the earlier gain against the later gain scaled to the earlier step's levels (the +10 gain against half the +20 gain, then each doubling against the last), even when the difference is within `margin` (twice) its standard error, `sqrt(se₁² + (se₂ · L₁/L₂)²)` (the two errors taken as independent). **When the two steps share seeds, this check is more lenient than a paired one** (the true error of the difference is smaller); the caller that wires the steps (part 2) reads this first. The first step that fails ends the check; nothing past it is read.
- Returns `{ perLevel, lastEven, flagged, pairs }`: the gain per level is the last even step's gain over its levels (the largest even step, the least noisy); `flagged` is true when a step failed ("for us to rethink our strategy"); `pairs` lists each check (`from`, `to`, `diff`, `seDiff`, `even`). One step gives its gain over its levels with no check made; no step gives `perLevel: null`.

## The stopping level

`stoppingLevel({ from, changeAt, limit, measuredTo, table, top = 200 })`

- Levels one at a time while the next level alone still pays back within `limit` (the Payback limit, or the horizon when there is none); the top level is the only other end.
- `changeAt(level)` gives the change of having `level` instead of today (as `payback` takes it; its leads in the same order at every level, with the same `without` clocks). The next level alone is the change from `n` to `n + 1`: the difference in cost and day-one gain, and each lead's `with` at `n + 1` against its `with` at `n`, judged by `payback` with `maxDays = limit`.
- Returns `{ level, levels, cost, payback, pastMeasured }`: where the recommendation stops (`from` when not one level pays back), how many levels, the whole change's cost and payback, and whether the level lies past `measuredTo` (today's level plus the largest measured step), so the search knows to measure further. Which further states to run is the search's (part 2).

## The use counter

- `tryUseAbility` (`src/combatsimulator/combatSimulator.js`) counts each cast in `source.abilityUses` (a `Map` on the unit, `combatUnit.js`) inside the same block that adds the mana cost to `abilityManaCosts`, so casts × mana cost equals the mana recorded. It changes no simulated outcome.
- `SimResult.setManaUsed(unit)` (`simResult.js`) carries both out: `manaUsed[player][ability]` and `abilityUses[player][ability]` (casts).
- The what-if engine's snapshot (`tools/whatif/engine.mjs` `snapshot`) reads `abilityUses`, and each player of a run record (`metrics`) carries `abilityUsesPerDay`: ability hrid → casts per day, the clock's uses per day.
