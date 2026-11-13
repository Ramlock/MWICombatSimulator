// The one function that runs a search task (a variant on a seed): apply the task's ops to the party's setups, run the engine, answer with the
// run's result. Called by the Node run process (batch.mjs --child) and by the page's Web Worker (src/whatif/searchWorker.mjs).
// Pure: no node: module, no file read, no import.meta, no computed import(); a bundler loads it as it is.
// task    { variant, ops, seed, checkpoints, options, ... } as the core's ensure() builds it (core.mjs); extra fields (setupsDir, tag, h) are not read here.
// ctx     { runParty, setups }: runParty(opts) is the engine's run (engine.mjs in Node, engine-pure.mjs with the price table in the page);
//         setups is the party's base setup JSON, which the ops are applied to a clone of (the base is never changed).
// Resolves with { variant, seed, wallSeconds, checkpoints }.
import { applyOps } from '../../src/whatif/applyOps.mjs';

export async function runTask(task, { runParty, setups }) {
    const res = await runParty({ ...task.options, setups: applyOps(setups, task.ops), seed: task.seed, checkpoints: task.checkpoints });
    return { variant: task.variant, seed: task.seed, ...res };
}
