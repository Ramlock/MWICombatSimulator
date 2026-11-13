// The page's run pool: the search core's `pool` seam (tools/whatif/core.mjs: run(task) resolves with the run's result, or null once kill() ended it;
// kill()) on Web Workers (searchWorker.mjs), as tools/whatif/node-shell.mjs createNodePool is on forked processes.
// One worker per core (navigator.hardwareConcurrency), no core limit, started on demand. The party's setups and the market table go to each worker once,
// in an init message; a task carries only its ops, seed, checkpoints and options. A run asked while every worker is busy waits for one.
// A worker that errors rejects the run it was doing (the Node pool does the same when a run process exits by itself).
//   init  { setups, market }
//   opts  { size (default hardwareConcurrency), makeWorker (default: the real worker; a test passes a fake) }
export function createPagePool(init, { size = (globalThis.navigator && navigator.hardwareConcurrency) || 4, makeWorker = () => new Worker(new URL('./searchWorker.mjs', import.meta.url)) } = {}) {
    const idle = [], all = new Set(), waiting = [];
    let killed = false, nextId = 1;
    function start() {
        const w = makeWorker();
        w.postMessage({ type: 'init', setups: init.setups, market: init.market });
        all.add(w);
        return w;
    }
    function dispatch(w, job) {
        const id = nextId++;
        w.onmessage = (e) => {
            if (e.data.id !== id) return;
            w.onmessage = w.onerror = null;
            if (e.data.error !== undefined) { all.delete(w); w.terminate(); job.reject(new Error(e.data.error)); } else { idle.push(w); job.resolve(e.data.result); }
            next();
        };
        w.onerror = (e) => { w.onmessage = w.onerror = null; all.delete(w); w.terminate(); if (killed) job.resolve(null); else job.reject(new Error('worker error: ' + (e && e.message))); next(); };
        job.worker = w;
        w.postMessage({ type: 'task', id, task: job.task });
    }
    function next() {
        while (!killed && waiting.length) {
            const w = idle.pop() || (all.size < size ? start() : null);
            if (!w) return;
            dispatch(w, waiting.shift());
        }
    }
    const running = new Set();
    return {
        run(task) {
            if (killed) return Promise.resolve(null);
            return new Promise((resolve, reject) => {
                const job = { task, resolve: (r) => { running.delete(job); resolve(r); }, reject: (e) => { running.delete(job); reject(e); } };
                running.add(job);
                waiting.push(job);
                next();
            });
        },
        kill() {
            killed = true;
            for (const w of all) { w.onmessage = w.onerror = null; w.terminate(); }
            all.clear(); idle.length = 0; waiting.length = 0;
            for (const job of [...running]) job.resolve(null);
        },
        size: () => all.size,
    };
}
