// The page's run pool: the search core's `pool` seam (tools/whatif/core.mjs: run(task) resolves with the run's result, or null once drop() or kill()
// ended it; drop(); kill()) on Web Workers (searchWorker.mjs), as tools/whatif/node-shell.mjs createNodePool is on forked processes.
// drop() ends every run asked so far (a worker running one is terminated, a run still waiting is not started), at once; later runs start new workers.
// kill() ends the pool: every worker, and every later run() resolves null. Both go through end(), the one way a run is ended.
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
    // Ends these runs at once: each resolves null; a worker running one is terminated (a new one is started for a later run), a waiting one is dropped.
    function end(jobs) {
        for (const job of jobs) {
            const w = job.worker;
            if (w) { w.onmessage = w.onerror = null; all.delete(w); w.terminate(); }
            const i = waiting.indexOf(job);
            if (i >= 0) waiting.splice(i, 1);
            job.resolve(null);
        }
    }
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
        drop() { end([...running]); },
        kill() {
            killed = true;
            end([...running]);
            for (const w of all) { w.onmessage = w.onerror = null; w.terminate(); }
            all.clear(); idle.length = 0;
        },
        size: () => all.size,
    };
}
