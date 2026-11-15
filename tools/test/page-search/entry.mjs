// The page entry of tools/test/whatif-page-search.mjs (in a folder of its own so the test runner does not take it for a test; bundled by webpack into a
// scratch folder, never into dist/): puts the page search (src/whatif/pageSearch.mjs) on window so the test can drive it from headless Chrome.
import { createPageSearch } from '../../../src/whatif/pageSearch.mjs';
import { createIdbStore } from '../../../src/whatif/idbStore.mjs';

const body = () => fetch('/body.json').then((r) => r.json());

// Starts the search of /body.json in the database `dbName` through the page API and follows it with its own status loop; window.run holds where it is.
window.go = async (dbName) => {
    const ps = createPageSearch({ dbName }), t0 = performance.now();
    const r = await ps.start(await body());
    window.run = { id: r.id, error: r.error, state: 'running', seconds: null, polls: 0 };
    const poll = async () => {
        const s = await ps.status(r.id);
        window.run.polls++;
        window.run.state = s?.state ?? null;
        window.run.runsDone = s?.progress?.runsDone ?? null;
        if (s?.state === 'running') return setTimeout(poll, 250);
        window.run.seconds = (performance.now() - t0) / 1000;
        window.run.result = s?.result ?? null;
        window.run.error = s?.error ?? null;
    };
    if (!r.error) poll();
    return r;
};

// The state of a search after a reload (no search object of this page has seen it), and its stored runs.
window.stateOf = async (dbName, id) => (await createPageSearch({ dbName }).status(id))?.state ?? null;
window.countRuns = async (dbName, id) => { const st = await createIdbStore(id, { dbName }); const n = await st.count(); st.close(); return n; };
window.runsOf = (dbName, id) => createPageSearch({ dbName }).exportRuns(id);

// Main-thread lag: a 20 ms timer chain; each sample is how late a tick came. stop() gives the spread in ms.
window.lag = {
    start() {
        this.samples = []; this.on = true;
        let last = performance.now();
        const tick = () => { if (!this.on) return; const now = performance.now(); this.samples.push(now - last - 20); last = now; setTimeout(tick, 20); };
        setTimeout(tick, 20);
    },
    stop() {
        this.on = false;
        const s = this.samples.slice().sort((a, b) => a - b), at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
        return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] };
    },
};
