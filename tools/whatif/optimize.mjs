// What-if optimizer, command line (the Node shell of the search in core.mjs; see the end of this comment), phase 1 (docs/proposals/what-if.md 3.2-3.4, 3.6 item 1): equipment levers, priced from
// per-level market entries and the Mirror path after 4% market tax (prices.mjs), searched by a screen of every
// single change, successive halving and greedy stacking, with one fresh-seed confirmation at the end.
//
// Usage: node tools/whatif/optimize.mjs --out <dir> [options]
//   --players Ramlock            whose equipment is open (comma list); each change is costed to its player
//   --levers equip               comma list of equip (phase 1: +N and market swaps), foods and drinks (decided FIRST,
//                                each as whole fillings of every open slot: foods = Stage F picks each player's best food
//                                filling, drinks = Stage D his best drink filling (drinkfill.mjs, pruned by his rules); the
//                                ticked ones, foods then drinks, become the baseline every other change is measured on;
//                                result.best says what they are; an unticked one has no stage and the setup's own foods or
//                                drinks stay as they are; `consumables`, the old single name, reads as foods and drinks),
//                                (pairs is accepted and ignored, for old command lines: drinks are fillings),
//                                triggers (each numeric term over its grid, structure changes; design 3.5),
//                                owned (items in the exporter's
//                                inventory), abilities (learned, at their learned level), order (ability order),
//                                skills (each trained combat skill +1..+skill-up; days to reach, never stacked),
//                                houses, abilitylevels, books (phase 3, tools/whatif/levers/houses.mjs; its flags
//                                --house-rooms, --house-up, --ability-steps, --book-levels; a cost that is only an
//                                upper bound carries costBound: 'upper' in its row and prints as "≤"),
//                                shrines (each combat guild shrine buff raised by --shrine-steps, default 1,2,3,cap, up to
//                                --shrine-cap, the guild's shrine level, empty = the game's maximum; per player also all
//                                five +1 and all five up to the cap; cost in Coin from the price snapshot, the split in
//                                shrineSplit; tools/whatif/levers/shrines.mjs); all
//   --skill-up 2  --skill-left P1:stamina=300.5K,magic=1.2M;P2:...   experience left to the next level (levers/skills.mjs)
//   --charms                     keep charm candidates on a profit goal (left out by default: they change only EXP)
//   --goal profit|exp            party profit per day after tax, or party EXP per hour (1.8)
//   --budget <coin> | --export <exporter JSON>   budget: typed, else `coin` of the exporter JSON (3.1); every
//                                player's budget unless --budgets names that player
//   --max-payback <days>         default 365, 0 = no limit (profit goal): a change whose buyer's payback (cost over the buyer's gain per day) is over this
//                                is not chosen: not eligible at its step (result.overPayback), and a pick whose fresh reading is over it fails the
//                                pick check (result.notConfirmed). A free change always passes.
//   --budgets A=1.5M,B=200K      a budget per player (budgets.mjs): each change is paid from its own player's coin,
//                                each step records every player's running spend (result.json steps[].runningSpend)
//   --low-priority               run this process and every run process at the lowest priority (Windows: idle class)
//   --stages 4x50,4x150,8x300    seeds x sim hours per stage: screen, halvings; the last is the finalist stage
//   --keep 40,10                 candidates kept after each stage but the last. In the rest of the search the cut keeps this many free
//                                (cost 0) AND this many paid candidates and the pool is their union (390 free tweaks would
//                                otherwise take every place); in Stage F and Stage D it is kept per player
//   --error unpaired|paired      default unpaired (design revision 6). paired: se of per-seed differences, base on the variant's seed count (3.3 up to
//                                revision 5); unpaired: sqrt(sv^2/kv + sb^2/kb) with the base on --base-mult x seeds, each new
//                                run on the next seed its setup never ran (delta 4, with his point of 23:14 BRT); the unpaired
//                                GAIN is the variant against the base on the variant's own seeds (his pick "Compare on the same seeds")
//   --base-mult <n>              base seeds per variant seed (they feed the error); default 1 when paired, 4 when unpaired
//   --z 2                        profit goal: the party's shared loot gain or the buyer's net is above 0 by z errors, and the other is not below -(z/2) errors (acceptBoth)
//   --max-up 3                   enhance levers +1..+max-up per slot
//   --swaps / --no-swaps         market swaps of each slot's item (same equipment type, level requirement met)
//   --swap-levels 0,same         levels a swapped-in item is bought at ("same" = the current item's level)
//   --sell-down                  also keep swaps that free gold (dropped by default, design 4.3 item 2)
//   --slots ring,neck            restrict the open slots
//   --only-candidates a,b        restrict to these candidate ids (a pilot)
//   --max-steps 20  --jobs <n>  --max-minutes <n> (stop issuing runs after n minutes; rerun resumes)
//   --confirm-seed-offset 10000  --setups <dir>  --prices <marketplace.json>
//   --synthetic <scenario.json>  test tooling: runs come from the scenario (tools/whatif/synthetic.mjs), not the engine; give it the scenario's setups and prices
//   --cache-from <runs.jsonl,...> earlier searches' run caches, read only (runs are keyed by setup, so any match counts)
//   Triggers (design 3.5): --probe 1x50 (base seeds x sim hours the counter records; kept in <out>/probe.json)
//   --trigger-owners toxic_pollen,star_fruit_gummy   search only these owners' triggers (hrid or its last part;
//                                the last part avoids Git Bash rewriting a leading /)   --trigger-fixed <owners>  skip these
//   --trigger-cands <json>       the user's own candidates, { "<player>": { "<owner hrid>": [[terms], ...] } };
//                                they replace the generated ones for that owner
//   --comdrop 20 --comexp 20 --tier 4 --zone /actions/combat/infernal_abyss
// Pick check (tools/whatif/sure.mjs): each greedy pick, and each player's chosen food and drink filling, is re-measured on fresh seeds
// (20001.., 16 per arm, up to 64) against the chain (the baseline so far) before it joins; one that is not confirmed is left out
// (result.notConfirmed) and the next best is tried. A trigger pick is refined first (tools/whatif/refine.mjs), so its row is final.
// Live report: with an IPC channel the optimizer sends { type: 'partial', result } at five points (after the foods, after the drinks,
// after the candidates are priced, after the last halving, and after each confirmed step and each failed pick): snapshot().
// Every run is cached in <out>/runs.jsonl by (resulting setups, options, seed); a rerun with the same args
// resumes. Results: <out>/result.json and <out>/result.md. Exit code 3 = stopped (by --max-minutes or a stop
// request), rerun. Progress goes to <out>/progress.json and, when started with an IPC channel (the runner,
// tools/whatif/runner/), as { type: 'progress', progress } messages; the message 'stop' ends the search cleanly: no
// new runs, the runs in flight are dropped, runs.jsonl keeps every finished run, and the same command resumes.
// Every run process takes this process's priority.

// The search itself is core.mjs (a function that imports no fs, process, os or child_process). This file is the Node shell: it turns the command
// line into flags (options.mjs), loads the data, and hands the core the Node implementations of its seams (node-shell.mjs): files for the run
// store and the reports, forked run processes for the pool, the runner's IPC channel for progress and the 'stop' message.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readParty } from './variants.mjs';
import { DEFAULT_PRICES, root, measureNeed, runParty, buildDtos } from './engine.mjs'; // registers the loader hooks: the core is imported after it
import { parseFlags, makeArg } from './options.mjs';
import { loadNodeData, createNodeStore, createNodePool, createCountingPool, createNodeSink, sha1 } from './node-shell.mjs';
const { default: Trigger } = await import(new URL('../../src/combatsimulator/trigger.js', import.meta.url));
const { main } = await import('./core.mjs');
import { loadScenario, createSyntheticPool, syntheticSim } from './synthetic.mjs';

const argv = process.argv.slice(2);
const flags = parseFlags(argv), arg = makeArg(flags);
const OUT = arg('out');
if (!OUT) throw new Error('--out required');
mkdirSync(OUT, { recursive: true });
if (arg('low-priority', false) === true) os.setPriority(os.constants.priority.PRIORITY_LOW);
const pricesFile = arg('prices', DEFAULT_PRICES), setupsDir = arg('setups', undefined);

const stop = { requested: false, done: false };
// --synthetic <scenario.json> (test tooling, tools/whatif/synthetic.mjs): the run pool and measureNeed are answered from the scenario, the rest is real.
const scenario = arg('synthetic', null) ? loadScenario(arg('synthetic')) : null;
// The counting wrapper (node-shell.mjs) counts the runs that reach the pool: the store's misses, i.e. the real simulations; the search's other runs were replayed.
const pool = createCountingPool(scenario ? createSyntheticPool(scenario, { confirmOffset: Number(arg('confirm-seed-offset', 10000)) }) : createNodePool());
// 'stop' ends the search; { done: 'accept' | 'skip' } (the window's two stage buttons) only asks the race stage running now to end (Accept after its round in flight, its pick taken as it is; Skip at once, the runs already going finishing).
process.on('message', (m) => { if (m === 'stop') { stop.requested = true; pool.kill(); } else if (m?.done === 'accept' || m?.done === 'skip') stop.done = m.done; });
const settings = {
    flags, argsText: argv.join(' '), jobs: Number(arg('jobs', os.availableParallelism())), setupsDir, pricesFile,
    // The key holds the prices file relative to the checkout, so runs cached in one worktree match in another.
    pricesKey: path.relative(root, path.resolve(pricesFile)).split(path.sep).join('/'),
};
const seams = {
    data: loadNodeData(arg, { setupsDir, pricesFile, readParty }),
    store: createNodeStore(OUT, arg('cache-from', null)),
    pool, stop, hash: sha1,
    sink: createNodeSink(OUT),
    sim: scenario ? syntheticSim({ runParty, measureNeed, buildDtos, Trigger }, scenario) : { runParty, measureNeed, buildDtos, Trigger },
};
const outcome = await main(settings, seams);
console.log(pool.summary());
pool.kill();
if (outcome.stopped) process.exit(3);
if (process.connected) process.disconnect(); // the IPC channel (stop requests) would keep the process alive
