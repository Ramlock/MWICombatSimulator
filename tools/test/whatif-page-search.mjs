// The what-if search in the page (src/whatif/pageSearch.mjs) against the Node search, in headless Chrome. A short search of the party (read at run time from
// docs/ground-truth/setups, gitignored; with no setups the test is skipped) runs once in this process on the Node seams and once in the page through the page
// API (IndexedDB store, Web Workers, the worker's probeRun and measureNeed), and must ask the same runs and reach the same result (timing fields aside).
// Then the same search in a second database is reloaded mid-search: after the reload it reads stopped, and Start resumes it from its stored runs (counted
// before and after) to the same result. Figures (printed, not checked): the page's time against Node's, and the main thread's lag during the page search
// (a 20 ms timer chain: how late its ticks came). The page entry is tools/test/page-search/entry.mjs, bundled with the repo's webpack config into a
// scratch folder (never dist/); the page is served on a free loopback port and opened in headless Chrome only.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); if (!ok) failed++; };

const E = await import(toUrl(path.join(root, 'tools/whatif/engine.mjs'))); // the loader hooks first
const { readParty } = await import(toUrl(path.join(root, 'tools/whatif/variants.mjs')));
const setups = readParty();
if (!setups.length) { console.log('SKIP: no setups in docs/ground-truth/setups (copy them in to run it)'); process.exit(0); }
const S = await import(toUrl(path.join(root, 'tools/whatif/node-shell.mjs')));
const { pageSettings } = await import(toUrl(path.join(root, 'src/whatif/pageSearch.mjs')));
const { main } = await import(toUrl(path.join(root, 'tools/whatif/core.mjs')));

// The short search: the first player's head +1, his food fillings and one food's trigger (so the sim calls run in a worker), 1 sim hour per run.
const p0 = setups[0], food0 = (p0.food?.['/action_types/combat'] || []).find((f) => f && f.itemHrid)?.itemHrid;
const marketplace = JSON.parse(fs.readFileSync(E.DEFAULT_PRICES, 'utf8'));
const body = {
    setups, options: { zone: '/actions/combat/fly', tier: 0, marketplace }, goal: 'profit', budgets: { [p0.name]: 1e9 }, players: [p0.name],
    levers: food0 ? ['equip', 'foods', 'triggers'] : ['equip', 'foods'], slots: 'head', maxUp: 1, swaps: false, unitHours: 1, confirmHours: 1, maxRounds: 3,
    lockRule: 'reading', readingStep: 8, leaders: 4, z: 0, ...(food0 ? { probe: '1x1', triggerOwners: food0.split('/').pop() } : {}),
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-search-'));

// ---- Node: the core on the Node seams, in this process (the optimizer's own seams; the prices file holds the same snapshot, the run keys the page's name for it)
const out = path.join(tmp, 'node');
fs.mkdirSync(out, { recursive: true });
const { settings, data } = pageSettings(body, os.availableParallelism());
settings.pricesFile = path.join(out, 'marketplace.json');
fs.writeFileSync(settings.pricesFile, JSON.stringify(marketplace));
const nodePool = S.createNodePool(), log = console.log;
let tNode = performance.now();
console.log = () => {};
try {
    await main(settings, { data, store: S.createNodeStore(out, null), pool: nodePool, sink: S.createNodeSink(out), stop: { requested: false, done: false }, hash: S.sha1, sim: { probeRun: E.probeRun, measureNeed: E.measureNeed, buildDtos: E.buildDtos } });
} finally { console.log = log; nodePool.kill(); }
tNode = (performance.now() - tNode) / 1000;
const nodeResult = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
// A search's runs as id -> hours (the longest kept, as the core keeps it).
const runIds = (text) => { const m = new Map(); for (const l of text.split('\n')) if (l.trim()) { const r = JSON.parse(l), id = r.key + '#' + r.seed; m.set(id, Math.max(m.get(id) ?? 0, r.hours)); } return m; };
const nodeRuns = runIds(fs.readFileSync(path.join(out, 'runs.jsonl'), 'utf8'));
const sameRuns = (m) => m.size === nodeRuns.size && [...m].every(([id, h]) => nodeRuns.get(id) === h);
// The paths where two results differ, timing fields aside.
const IGNORE = /timing|elapsed|seconds|wall/i;
function diff(a, b, p = '', acc = []) {
    if (acc.length > 10) return acc;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(p || '/'); return acc; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!IGNORE.test(k)) diff(a[k], b[k], p + '.' + k, acc);
    return acc;
}

// ---- The page
const bundleDir = path.join(tmp, 'bundle');
const base = createRequire(import.meta.url)('../../webpack.config.js');
const compiler = webpack({ ...base, entry: path.join(root, 'tools/test/page-search/entry.mjs'), output: { ...base.output, path: bundleDir, clean: true }, plugins: [], devtool: false });
const stats = await new Promise((res, rej) => compiler.run((e, s) => { compiler.close(() => {}); if (e) rej(e); else if (s.hasErrors()) rej(new Error(s.toString({ all: false, errors: true }))); else res(s); }));
const mainFile = stats.toJson({ all: false, assets: true, chunks: true }).assetsByChunkName.main.find((f) => f.endsWith('.js'));
const html = `<!doctype html><meta charset=utf-8><title>search</title><script src="/${mainFile}"></script>`, bodyText = JSON.stringify(body);
const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
    if (p === '/body.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(bodyText); }
    const f = path.join(bundleDir, p.slice(1));
    if (!f.startsWith(bundleDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.json') ? 'application/json' : 'text/javascript' });
    fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = await launchChrome({ userDataDir: path.join(tmp, 'profile'), commandTimeoutMs: 600000 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const ready = async () => { for (let i = 0; i < 100 && (await js('typeof window.go').catch(() => '')) !== 'function'; i++) await sleep(200); };
    const until = async (cond, ms = 3600000) => { const t = Date.now(); for (;;) { const v = await js('window.run && { state: run.state, runsDone: run.runsDone, error: run.error }'); if (cond(v)) return v; if (Date.now() - t > ms) throw new Error('timed out: ' + JSON.stringify(v)); await sleep(100); } };
    await page.send('Page.navigate', { url });
    await ready();

    // 1. The whole search through the page API, the main thread's lag watched meanwhile.
    await js('lag.start()');
    const started = await js(`go('a')`);
    check('page API: start answers { id }, the runner\'s id for this request', /^[0-9a-f]{12}$/.test(started.id || ''), JSON.stringify(started));
    const endA = await until((v) => v && v.state !== 'running');
    const lag = await js('lag.stop()');
    check('page search ends done', endA.state === 'done', JSON.stringify(endA));
    const runA = await js('({ seconds: run.seconds, polls: run.polls, result: run.result })');
    const pageRuns = runIds(await js(`runsOf('a', ${JSON.stringify(started.id)})`));
    check('page search asks the same runs as Node (ids and hours)', sameRuns(pageRuns), `${pageRuns.size} page, ${nodeRuns.size} Node`);
    const dA = runA.result ? diff(nodeResult, runA.result) : ['no result'];
    check('page search result equals Node\'s (timing fields aside)', dA.length === 0, dA.join(', '));
    console.log(`figure: speed: page ${runA.seconds.toFixed(1)} s, Node ${tNode.toFixed(1)} s (page / Node = ${(runA.seconds / tNode).toFixed(2)}), ${nodeRuns.size} runs`);
    console.log(`figure: main-thread lag during the page search (ms late on a 20 ms timer, ${lag.n} ticks): p50 ${lag.p50.toFixed(1)}, p95 ${lag.p95.toFixed(1)}, p99 ${lag.p99.toFixed(1)}, max ${lag.max.toFixed(1)}`);

    // 2. A reload mid-search, then Start: the search resumes from IndexedDB.
    await js(`go('b')`);
    const stopAt = Math.max(1, Math.floor(nodeRuns.size * 0.4));
    let mid = 0;
    for (const t = Date.now(); Date.now() - t < 3600000; await sleep(100)) { mid = await js(`countRuns('b', ${JSON.stringify(started.id)})`); if (mid >= stopAt || (await js('run.state')) !== 'running') break; }
    await page.send('Page.reload');
    await sleep(500);
    await ready();
    const before = await js(`countRuns('b', ${JSON.stringify(started.id)})`);
    const state = await js(`stateOf('b', ${JSON.stringify(started.id)})`);
    check('after the reload the search reads stopped, with runs stored', state === 'stopped' && before > 0 && before < nodeRuns.size, `state ${state}, ${before} of ${nodeRuns.size} runs stored`);
    await js(`go('b')`);
    const endB = await until((v) => v && v.state !== 'running');
    const after = await js(`countRuns('b', ${JSON.stringify(started.id)})`);
    const runB = await js('({ result: run.result })');
    check('Start resumes it from the store: it ends done with every run stored once', endB.state === 'done' && after === nodeRuns.size, `before ${before}, after ${after}, Node ${nodeRuns.size}`);
    const dB = runB.result ? diff(nodeResult, runB.result) : ['no result'];
    check('the resumed search\'s result equals Node\'s', dB.length === 0, dB.join(', '));
    console.log(`figure: reload: ${before} runs stored before the reload, ${after} after the resumed search (${after - before} made after it)`);
} finally {
    await chrome.close();
    server.close();
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
