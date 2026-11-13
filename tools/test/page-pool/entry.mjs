// The page entry of tools/test/whatif-page-pool.mjs (in a folder of its own so the test runner does not take it for a test) (bundled by webpack into a scratch folder, never into dist/): puts the page pool and the page's
// sha1 on window so the test can drive them from headless Chrome.
import { createPagePool } from '../../../src/whatif/pagePool.mjs';
import { sha1 } from '../../../src/whatif/sha1.mjs';

// Every task at once through the pool seam (default size: navigator.hardwareConcurrency); resolves with the results in the tasks' order.
window.runPool = async (init, tasks) => {
    const pool = createPagePool(init);
    const results = await Promise.all(tasks.map((t) => pool.run(t)));
    const workers = pool.size();
    pool.kill();
    return { results, workers, hardwareConcurrency: navigator.hardwareConcurrency };
};

// One long task, killed while it runs: it resolves null; a run asked after the kill resolves null too.
window.killTest = async (init, task) => {
    const pool = createPagePool(init, { size: 1 });
    const running = pool.run(task);
    await new Promise((r) => setTimeout(r, 500));
    pool.kill();
    const killed = await running;
    const after = await pool.run(task);
    return { killed, after, workers: pool.size() };
};

window.sha1Of = (texts) => texts.map(sha1);
