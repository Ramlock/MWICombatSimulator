// The page's search Web Worker: runs the what-if search's tasks (tools/whatif/runTask.mjs, the same function the Node run process calls) with the
// pure engine (tools/whatif/engine-pure.mjs). Nothing is read in the worker: the party's setups and the market table arrive in one 'init' message;
// a task message carries only the task (its ops, seed, checkpoints, options).
//   in   { type: 'init', setups, market }    { type: 'task', id, task }
//   out  { id, result }  or  { id, error }   (one per task)
import { runTask } from '../../tools/whatif/runTask.mjs';
import { runParty, buildPrices } from '../../tools/whatif/engine-pure.mjs';

let setups = null, priceTable = null;

self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') { setups = m.setups; priceTable = buildPrices(m.market); return; }
    if (m.type !== 'task') return;
    try {
        if (!setups) throw new Error('task before init');
        // task.options.prices is a file name in Node; here the table is already data.
        const result = await runTask(m.task, { runParty: (opts) => runParty({ ...opts, priceTable }), setups });
        self.postMessage({ id: m.id, result });
    } catch (err) {
        self.postMessage({ id: m.id, error: String(err && err.stack || err) });
    }
};
