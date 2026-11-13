// Test: the page's run pool (src/whatif/pagePool.mjs) in our own headless Chrome gives the same results as the Node pool (node-shell.mjs createNodePool, forked
// batch.mjs --child) on the same task list, through the core's `pool` seam (run(task) -> result, kill()). Part 1 checks the pool's own logic with fake workers
// (queueing, kill, a failing worker). Part 2 bundles the page entry with the repo's webpack config into a scratch folder (never dist/), serves it on loopback and
// runs the same tasks in real Web Workers. The party is read at run time from docs/ground-truth/setups (gitignored; the harness copies it in): with no setups
// the test prints SKIP and exits 0 after part 1. The page's sha1 is also compared with node:crypto in the page.
// Usage: node tools/test/whatif-page-pool.mjs        Exit code 0 on pass, 1 on fail.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import { createPagePool } from '../../src/whatif/pagePool.mjs';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

// ---- Part 1: the pool's logic with fake workers
{
    let live = 0, peak = 0, made = 0;
    const makeWorker = () => {
        made++;
        const w = {
            msgs: [], terminated: false,
            postMessage(m) {
                this.msgs.push(m);
                if (m.type !== 'task') return;
                live++; peak = Math.max(peak, live);
                setTimeout(() => { if (this.terminated) return; live--; if (m.task.fail) this.onmessage?.({ data: { id: m.id, error: 'boom' } }); else this.onmessage?.({ data: { id: m.id, result: { echo: m.task.n } } }); }, 20);
            },
            terminate() { this.terminated = true; },
        };
        return w;
    };
    const init = { setups: [{ name: 'x' }], market: {} };
    const pool = createPagePool(init, { size: 3, makeWorker });
    const out = await Promise.all(Array.from({ length: 8 }, (_, n) => pool.run({ n })));
    check('fake: 8 tasks on 3 workers, results in order', out.map((r) => r.echo).join() === '0,1,2,3,4,5,6,7');
    check('fake: at most 3 run at once, 3 workers made', peak === 3 && made === 3, `peak ${peak} made ${made}`);
    const failing = await pool.run({ n: 99, fail: true }).then(() => 'resolved', (e) => e.message);
    check('fake: a failing worker rejects its run', failing === 'boom');
    const again = await pool.run({ n: 100 });
    check('fake: the pool still runs after a failed run', again.echo === 100);
    const slow = pool.run({ n: 1 });
    pool.kill();
    check('fake: kill resolves the run in flight with null', (await slow) === null);
    check('fake: a run after kill resolves null', (await pool.run({ n: 2 })) === null);
}

// ---- Part 2: real Web Workers in headless Chrome against the Node pool
const variantsMod = await import(path.join(root, 'tools/whatif/variants.mjs').replace(/^([A-Za-z]):/, 'file:///$1:').replace(/\\/g, '/'));
const setups = variantsMod.readParty();
if (!setups.length) {
    console.log('SKIP the Chrome part: no setups in docs/ground-truth/setups (copy them in to run it)');
    process.exit(failed ? 1 : 0);
}
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { DEFAULT_PRICES } = await import(toUrl(path.join(root, 'tools/whatif/engine.mjs')));
const { createNodePool, loadMarket } = await import(toUrl(path.join(root, 'tools/whatif/node-shell.mjs')));
const market = loadMarket(DEFAULT_PRICES);

const player = setups[0].name;
const options = { comdrop: 20, comexp: 20, tier: 4, zone: '/actions/combat/infernal_abyss', prices: DEFAULT_PRICES };
const plus = [{ op: 'level', player, skill: 'attack', delta: 1 }];
const tasks = [];
for (const [variant, ops] of [['base', []], ['plus', plus]]) for (const seed of [1, 2]) tasks.push({ variant, ops, seed, checkpoints: [3, 6], options, setupsDir: undefined, tag: 'test', h: 6 });
const strip = (r) => JSON.stringify({ variant: r.variant, seed: r.seed, checkpoints: r.checkpoints });

const nodePool = createNodePool();
const nodeRes = await Promise.all(tasks.map((t) => nodePool.run(t)));
nodePool.kill();

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'page-pool-'));
const outDir = path.join(prof, 'bundle');
const base = createRequire(import.meta.url)('../../webpack.config.js');
const compiler = webpack({ ...base, entry: path.join(root, 'tools/test/page-pool/entry.mjs'), output: { ...base.output, path: outDir, clean: true }, plugins: [], devtool: false });
const stats = await new Promise((res, rej) => compiler.run((e, s) => { compiler.close(() => {}); if (e) rej(e); else if (s.hasErrors()) rej(new Error(s.toString({ all: false, errors: true }))); else res(s); }));
const mainFile = stats.toJson({ all: false, assets: true, chunks: true }).assetsByChunkName.main.find((f) => f.endsWith('.js'));
check('the repo webpack config bundles the page entry and its worker', fs.readdirSync(outDir).some((f) => /searchWorker/.test(f)));

const html = `<!doctype html><meta charset=utf-8><title>pool</title><script src="/${mainFile}"></script>`;
const data = JSON.stringify({ setups, market });
const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
    if (p === '/data.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(data); }
    const f = path.join(outDir, p.slice(1));
    if (!f.startsWith(outDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), commandTimeoutMs: 600000 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    await page.send('Page.navigate', { url });
    for (let i = 0; i < 50 && !(await js('typeof window.runPool')).startsWith('function'); i++) await new Promise((r) => setTimeout(r, 200));

    const got = await js(`fetch('/data.json').then(r => r.json()).then(init => runPool(init, ${JSON.stringify(tasks)}))`);
    check('page pool: one result per task', got.results.length === tasks.length && got.results.every((r) => r && r.checkpoints));
    check('page pool: same results as the Node pool on the same task list', got.results.every((r, i) => strip(r) === strip(nodeRes[i])), got.results.map((r, i) => strip(r) === strip(nodeRes[i])).join());
    check('page pool: one worker per task up to navigator.hardwareConcurrency, no core limit', got.workers === Math.min(got.hardwareConcurrency, tasks.length), `${got.workers} workers, ${got.hardwareConcurrency} cores`);
    check('page pool: the two variants differ (the ops reached the worker)', strip(got.results[0]) !== strip(got.results[2]));

    const long = { ...tasks[0], checkpoints: [300], h: 300 };
    const k = await js(`fetch('/data.json').then(r => r.json()).then(init => killTest(init, ${JSON.stringify(long)}))`);
    check('page pool: stop terminates the workers; the run in flight and a run after it resolve null', k.killed === null && k.after === null && k.workers === 0, JSON.stringify(k));

    const texts = ['', 'abc', 'x'.repeat(1000), JSON.stringify({ s: setups[0], o: options }), '中文 😀'];
    const hex = await js(`sha1Of(${JSON.stringify(texts)})`);
    check('page sha1 equals node:crypto in the page', hex.every((h, i) => h === createHash('sha1').update(texts[i]).digest('hex')));
} finally {
    await chrome.close();
    server.close();
}
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
