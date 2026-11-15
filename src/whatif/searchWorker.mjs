// The page's search Web Worker: runs the what-if search's tasks (tools/whatif/runTask.mjs, the same function the Node run process calls) with the
// pure engine (tools/whatif/engine-pure.mjs). Nothing is read in the worker: the party's setups and the market table arrive in one 'init' message;
// a task message carries only the task (its ops, seed, checkpoints, options).
// A call message runs one of the sim seam's engine calls (the core's sim.probeRun, sim.measureNeed) with its own options, which carry their setups.
//   in   { type: 'init', setups, market }    { type: 'task', id, task }    { type: 'call', id, fn: 'probeRun' | 'measureNeed', opts }
//   out  { id, result }  or  { id, error }   (one per task or call)
import { runTask } from '../../tools/whatif/runTask.mjs';
import { runParty, measureNeed, buildPrices } from '../../tools/whatif/engine-pure.mjs';
import { probeRun } from '../../tools/whatif/probe.mjs';

let setups = null, priceTable = null;

self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') { setups = m.setups; priceTable = buildPrices(m.market); return; }
    if (m.type !== 'task' && m.type !== 'call') return;
    try {
        if (!priceTable) throw new Error(m.type + ' before init');
        // options.prices is a file name in Node; here the table is already data.
        const run = (opts) => runParty({ ...opts, priceTable });
        const result = m.type === 'task' ? await runTask(m.task, { runParty: run, setups })
            : m.fn === 'probeRun' ? await probeRun(run, m.opts)
            : m.fn === 'measureNeed' ? await measureNeed({ ...m.opts, priceTable })
            : (() => { throw new Error('unknown call ' + m.fn); })();
        self.postMessage({ id: m.id, result });
    } catch (err) {
        self.postMessage({ id: m.id, error: String(err && err.stack || err) });
    }
};
