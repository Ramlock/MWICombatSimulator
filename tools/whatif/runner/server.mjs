// What-if runner (delivery design sections 3 and 10): a local web server on the loopback address that serves the built
// simulator (dist/) at / and the search interface under /api/, and runs the optimizer (tools/whatif/optimize.mjs) at
// the lowest priority on every core (the server itself runs below normal, one step above). Code doc: docs/codebase/whatif-runner.md.
//
// Usage: node tools/whatif/runner/server.mjs [--port 8787] [--results <dir>] [--dist <dir>] [--demo-runs <runs.jsonl>] [--demo-prices <marketplace.json>] [--synthetic <scenario.json>]
//   --port 0 picks a free port. --results defaults to <home>/MWI-WhatIf/results (never inside the repo).
//   --demo-runs: that run file is read into every search's run store (the optimizer's --cache-from); --demo-prices: that price snapshot
//   replaces the request's own. Both are off by default and meant for showing a search from saved runs.
//
// Interface (JSON over HTTP):
//   GET  /api/version              { runner, engine }
//   POST /api/search               body { setups, options: { zone, tier, comdrop, comexp, prices | marketplace }, goal, budgets,
//                                  levers, players, stages, keep, export?, ...the optimizer's own flags without the
//                                  dashes }; answer { id }. One search at a time: 409 { error, running } otherwise.
//                                  The id is a hash of the request, so the same request again resumes its run store.
//   GET  /api/search/<id>[?since=<n>]  { state: running|stopped|done|error, progress, error?, result?, partial?, partialVersion?, round?, roundVersion? }; a running
//                                  search carries its report so far (partial) and its version only when newer than `since`, and the latest
//                                  search round (round, roundVersion) the same way (one counter, one `since`)
//   POST /api/search/<id>/stop     stops it (exit code 3, run store kept); on a stopped search, resumes it
//   GET  /api/results              finished searches, newest first: [{ id, finished, goal, players }]
//   GET  /api/results/<id>         one result.json
// Requests come only from the runner's own page: a Host that is not the loopback address and port, or an Origin
// that is not the runner's own, is refused with 403.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, createWriteStream, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMarketplace } from '../../../src/marketplace.mjs';
import { loadScenario, applyScenarioToRequest } from '../synthetic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');
const OPTIMIZER = path.join(ROOT, 'tools', 'whatif', 'optimize.mjs');
const PRICES_DIR = path.join(ROOT, 'tools', 'calibration');
export const RUNNER_VERSION = '0.1.0';
export const MARKETPLACE_FILE = 'marketplace.json';
export const DEFAULT_RESULTS = path.join(os.homedir(), 'MWI-WhatIf', 'results');

// The optimizer's flags a request may set (camelCase or dashed). --out, --setups, --export and --prices are set by
// the runner itself; --cache-from is not offered (it reads arbitrary files).
// The rounds options (unit-hours ... confirm-seeds, confirm-hours) are the search's named options; `stages` and `keep` are still accepted and ignored by the search.
const PASS = ['unit-hours', 'first-seeds', 'round-seeds', 'leaders', 'pause-mult', 'coverage', 'reading-step', 'reading-min', 'lock-rule', 'max-rounds', 'confirm-seeds', 'confirm-hours', 'players', 'levers', 'goal', 'stages', 'keep', 'error', 'base-mult', 'z', 'max-up', 'swaps', 'swap-levels', 'sell-down', 'slots', 'only-candidates', 'max-steps', 'max-payback', 'jobs', 'max-minutes', 'confirm-seed-offset', 'skill-up', 'skill-left', 'charms', 'house-rooms', 'house-up', 'ability-steps', 'book-levels', 'probe', 'trigger-owners', 'trigger-fixed', 'budget', 'comdrop', 'comexp', 'tier', 'zone'];
const dashed = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const RESERVED = new Set(['synthetic', 'setups', 'options', 'budgets', 'export', 'prices', 'marketplace', 'triggerCands', 'trigger-cands']);
const SAFE_NAME = /^[^\\/:*?"<>|\r\n]+$/;

const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
// A search's folder (its runs and result) is named by this id. The foods and drinks levers used to be one lever, `consumables`: a request that
// ticks both hashes in that old form, so a rerun with both ticked finds the old search's folder, runs and result. Foods alone or drinks alone is its own search.
const oldLevers = (levers) => { const i = levers.indexOf('foods'); return i < 0 || !levers.includes('drinks') ? levers : levers.flatMap((l, j) => (j === i ? ['consumables'] : l === 'drinks' ? [] : [l])); };
export const searchId = (body) => createHash('sha1').update(JSON.stringify(canonical(Array.isArray(body?.levers) ? { ...body, levers: oldLevers(body.levers) } : body))).digest('hex').slice(0, 12);

// A price snapshot by file name, from tools/calibration only (default: the optimizer's own default).
export function pricesPath(name) {
    if (name == null) return null;
    const base = path.basename(String(name));
    const f = path.join(PRICES_DIR, base);
    if (base !== String(name) || !/^marketplace-[\w-]+\.json$/.test(base) || !existsSync(f)) throw new Error(`unknown price snapshot ${name}`);
    return f;
}

// The request as optimizer arguments; writes the setups (and the exporter JSON, the user's trigger candidates) into
// the search's own folder. Throws on a malformed request.
// `demo` (the runner's --demo-runs / --demo-prices, both off by default): { runs: <runs.jsonl path>, prices: <marketplace.json path> }.
// demo.runs is passed as --cache-from (the optimizer reads it into its run store, never writes it); demo.prices replaces the request's
// price snapshot and is used in place (the run keys hold the price file's path relative to the checkout, so saved runs hit only
// when that path is the one they were made with).
export function buildArgs(body, outDir, demo = {}) {
    if (!body || typeof body !== 'object') throw new Error('body must be a JSON object');
    const setups = body.setups;
    if (!Array.isArray(setups) || !setups.length || setups.some((s) => !s || typeof s.name !== 'string' || !SAFE_NAME.test(s.name) || !s.player)) throw new Error('setups: a list of setups, each with a name and a player');
    const setupsDir = path.join(outDir, 'setups');
    mkdirSync(setupsDir, { recursive: true });
    for (const s of setups) writeFileSync(path.join(setupsDir, s.name + '.json'), JSON.stringify(s));
    writeFileSync(path.join(setupsDir, 'party.txt'), setups.map((s) => s.name).join('\n') + '\n');
    const args = ['--out', outDir, '--setups', setupsDir, '--low-priority'];
    const flags = { ...(body.options || {}), ...body };
    const market = body.options?.marketplace;
    if (demo.runs) args.push('--cache-from', demo.runs);
    if (demo.prices) args.push('--prices', demo.prices);
    else if (market != null) {
        // The window's market snapshot (delivery design section 3): saved once in the search's folder and used from
        // there; a resume finds it and keeps it (the run cache's key holds the price file, so it must not change).
        if (body.options.prices != null) throw new Error('options: prices or marketplace, not both');
        if (!isMarketplace(market)) throw new Error('options.marketplace: the marketplace.json body, { marketData, timestamp }');
        const f = path.join(outDir, MARKETPLACE_FILE);
        if (!existsSync(f)) writeFileSync(f, JSON.stringify(market));
        args.push('--prices', f);
    } else if (body.options?.prices != null) args.push('--prices', pricesPath(body.options.prices));
    if (body.budgets != null) {
        if (typeof body.budgets !== 'object') throw new Error('budgets: { "<player>": <coin> }');
        const list = Object.entries(body.budgets).map(([p, v]) => { if (!SAFE_NAME.test(p) || p.includes(',') || p.includes('=') || !(Number(v) >= 0)) throw new Error(`budgets: bad entry ${p}`); return `${p}=${Number(v)}`; });
        if (list.length) args.push('--budgets', list.join(','));
    }
    // export: the old single character export (an object with its `name`) or a map { "<player name>": that player's export }; written as it comes.
    if (body.export != null && (typeof body.export !== 'object' || Array.isArray(body.export))) throw new Error('export: a character export object, or { "<player name>": <export> }');
    if (body.export != null) { const f = path.join(outDir, 'export.json'); writeFileSync(f, JSON.stringify(body.export)); args.push('--export', f); }
    const tc = body.triggerCands ?? body['trigger-cands'];
    if (tc != null) { const f = path.join(outDir, 'trigger-cands.json'); writeFileSync(f, JSON.stringify(tc)); args.push('--trigger-cands', f); }
    if (body.players == null) args.push('--players', setups.map((s) => s.name).join(','));
    for (const [k, v] of Object.entries(flags)) {
        if (RESERVED.has(k) || v == null) continue;
        const name = dashed(k);
        if (!PASS.includes(name)) throw new Error(`unknown option ${k}`);
        if (v === false) { args.push('--no-' + name); continue; }
        if (v === true) { args.push('--' + name); continue; }
        const text = Array.isArray(v) ? v.join(',') : String(v);
        if (text.startsWith('--') || /[\r\n]/.test(text)) throw new Error(`option ${k}: bad value`);
        args.push('--' + name, text);
    }
    return args;
}

// Starts the optimizer for one search at the lowest priority: set right after the fork (the runner's own server is one step above, below
// normal), and by the optimizer's own --low-priority. Every log line is timestamped into <out>/log.txt.
export function forkOptimizer(args, outDir) {
    const log = createWriteStream(path.join(outDir, 'log.txt'), { flags: 'a' });
    const stamp = (src) => (buf) => { for (const l of String(buf).split(/\r?\n/).filter(Boolean)) log.write(`${new Date().toISOString()} ${src} ${l}\n`); };
    const c = fork(OPTIMIZER, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    try { os.setPriority(c.pid, os.constants.priority.PRIORITY_LOW); } catch { /* it exited already */ }
    let tail = '';
    c.stdout.on('data', stamp('out'));
    c.stderr.on('data', (b) => { tail = (tail + b).slice(-4000); stamp('err')(b); });
    const handle = {
        pid: c.pid,
        onProgress: null, onPartial: null, onRound: null, onExit: null,
        stop: () => { if (c.connected) c.send('stop'); },
        done: (mode) => { if (c.connected) c.send({ done: mode }); }, // the race stage running now ends after its round: 'accept' or 'skip'
    };
    c.on('message', (m) => { if (m?.type === 'progress') handle.onProgress?.(m.progress); else if (m?.type === 'partial') handle.onPartial?.(m.result); else if (m?.type === 'round') handle.onRound?.(m.round); });
    c.on('exit', (code) => { log.end(); handle.onExit?.(code, tail); });
    return handle;
}

function engineVersion(dist) {
    try { return /bundle\.([0-9a-f]+)\.js/.exec(readFileSync(path.join(dist, 'index.html'), 'utf8'))?.[1] ?? 'unknown'; } catch { return 'unknown'; }
}
function gitVersion() {
    try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.gif': 'image/gif' };

// opts: { resultsDir, distDir, launch(args, outDir) -> handle (default forkOptimizer), lowPriority (default true) }.
// Returns { server, listen(port, host) -> Promise<url> }.
export function createRunner(opts = {}) {
    const resultsDir = path.resolve(opts.resultsDir || DEFAULT_RESULTS);
    const distDir = path.resolve(opts.distDir || path.join(ROOT, 'dist'));
    const launch = opts.launch || forkOptimizer;
    const synthFile = opts.synthetic ? path.resolve(opts.synthetic) : null, scenario = synthFile ? loadScenario(synthFile) : null; // the runner's --synthetic <scenario.json>
    mkdirSync(resultsDir, { recursive: true });
    // The web server itself runs one step above the searches (below normal), so the window's requests are answered while every core is busy; the
    // optimizer it forks is set to the lowest at once (forkOptimizer), and its run processes take the optimizer's.
    if (opts.lowPriority !== false) os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
    const version = { runner: RUNNER_VERSION + (gitVersion() ? '+' + gitVersion() : ''), engine: engineVersion(distDir) };
    const searches = new Map(); // id -> { state, progress, error, handle }
    let running = null;
    let port = null;
    let partialSeq = 0; // the version of the live report: one counter for the runner, up with every snapshot, so a new search is always newer than what a window saw

    const dirOf = (id) => { if (!/^[0-9a-f]{12}$/.test(id)) throw Object.assign(new Error('bad id'), { status: 404 }); return path.join(resultsDir, id); };
    const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
    // `since`: the live report's version the caller has; the running status carries the latest snapshot (`partial`, `partialVersion`) only
    // when it is newer (the report is big once the each-change-alone table is in it).
    function status(id, since = 0) {
        const dir = dirOf(id), s = searches.get(id);
        const progress = s?.progress ?? (existsSync(path.join(dir, 'progress.json')) ? readJson(path.join(dir, 'progress.json')) : null);
        // The search rounds (`round`, the latest round record, `roundVersion`) are served the same way, on the same counter and the same `since`.
        if (s?.state === 'running') return { state: 'running', progress, ...(s.partial && s.partialVersion > since ? { partial: s.partial, partialVersion: s.partialVersion } : {}), ...(s.round && s.roundVersion > since ? { round: s.round, roundVersion: s.roundVersion } : {}) };
        if (existsSync(path.join(dir, 'result.json'))) return { state: 'done', progress, result: readJson(path.join(dir, 'result.json')) };
        if (s?.state === 'error') return { state: 'error', progress, error: s.error };
        if (existsSync(path.join(dir, 'request.json'))) return { state: 'stopped', progress };
        return null;
    }
    function start(body0) {
        // --synthetic (test tooling): the scenario's party and prices replace the window's request, the optimizer is told to answer its runs from the scenario.
        const body = scenario ? applyScenarioToRequest(body0, scenario) : body0;
        if (running) return { status: 409, body: { error: 'a search is running', id: running, running } }; // the window reads id
        const id = searchId(body), dir = dirOf(id);
        if (existsSync(path.join(dir, 'result.json'))) return { status: 200, body: { id } }; // finished already
        mkdirSync(dir, { recursive: true });
        const args = buildArgs(body, dir, { runs: opts.demoRuns, prices: opts.demoPrices });
        writeFileSync(path.join(dir, 'request.json'), JSON.stringify(body));
        const s = { state: 'running', progress: { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0, secondsPerRun: null, etaSeconds: null }, error: null };
        searches.set(id, s);
        running = id;
        if (scenario) args.push('--synthetic', synthFile);
        s.handle = launch(args, dir);
        s.handle.onProgress = (p) => { s.progress = p; };
        s.handle.onPartial = (r) => { s.partial = r; s.partialVersion = ++partialSeq; };
        s.handle.onRound = (r) => { s.round = r; s.roundVersion = ++partialSeq; };
        s.handle.onExit = (code, tail) => {
            running = null;
            if (code === 0 && existsSync(path.join(dir, 'result.json'))) s.state = 'done';
            else if (code === 3) s.state = 'stopped';
            else { s.state = 'error'; s.error = `optimizer exited ${code}: ${String(tail || '').split(/\r?\n/).filter((l) => l.trim() && !/^\s+at |^Node\.js v/.test(l)).slice(-4).join(' | ')}`; }
        };
        return { status: 200, body: { id } };
    }
    // The list of finished searches. A result.json is read (in full: it is one JSON) only when it is new or changed since the last list
    // (its size and time), so opening the window does not parse every saved result each time.
    const listed = new Map(); // id -> { mtimeMs, size, entry }
    function results() {
        if (!existsSync(resultsDir)) return [];
        return readdirSync(resultsDir).filter((d) => /^[0-9a-f]{12}$/.test(d)).map((d) => {
            const f = path.join(resultsDir, d, 'result.json');
            let st;
            try { st = statSync(f); } catch { listed.delete(d); return null; }
            const seen = listed.get(d);
            if (seen && seen.mtimeMs === st.mtimeMs && seen.size === st.size) return seen.entry;
            const r = readJson(f), entry = { id: d, finished: st.mtime.toISOString(), goal: r.goal, players: r.players };
            listed.set(d, { mtimeMs: st.mtimeMs, size: st.size, entry });
            return entry;
        }).filter(Boolean).sort((a, b) => (a.finished < b.finished ? 1 : -1));
    }

    // Same origin only: the Host must be this loopback address and port (no DNS rebinding), and an Origin, when the
    // browser sends one, must be this runner's own.
    const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    function sameOrigin(req) {
        if (!allowedHosts().includes(String(req.headers.host || '').toLowerCase())) return false;
        const o = req.headers.origin;
        return o == null || allowedHosts().map((h) => 'http://' + h).includes(String(o).toLowerCase());
    }
    const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(b); };
    const readBody = (req) => new Promise((resolve, reject) => {
        let n = 0; const parts = [];
        req.on('data', (b) => { n += b.length; if (n > 50e6) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else parts.push(b); });
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || 'null')); } catch { reject(Object.assign(new Error('body is not JSON'), { status: 400 })); } });
        req.on('error', reject);
    });
    function serveStatic(req, res, url) {
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const f = path.resolve(distDir, '.' + rel);
        if (!f.startsWith(distDir + path.sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') res.end(); else createReadStream(f).pipe(res);
    }

    const server = http.createServer(async (req, res) => {
        try {
            if (!sameOrigin(req)) return send(res, 403, { error: 'requests only from the runner\'s own page' });
            const url = new URL(req.url, 'http://' + req.headers.host);
            const p = url.pathname;
            if (!p.startsWith('/api/')) return req.method === 'GET' || req.method === 'HEAD' ? serveStatic(req, res, url) : send(res, 405, { error: 'method not allowed' });
            let m;
            if (req.method === 'GET' && p === '/api/version') return send(res, 200, version);
            if (req.method === 'POST' && p === '/api/search') {
                if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Content-Type must be application/json' });
                const r = start(await readBody(req));
                return send(res, r.status, r.body);
            }
            if (req.method === 'GET' && (m = /^\/api\/search\/([^/]+)$/.exec(p))) { const s = status(m[1], Number(url.searchParams.get('since')) || 0); return s ? send(res, 200, s) : send(res, 404, { error: 'no such search' }); }
            if (req.method === 'POST' && (m = /^\/api\/search\/([^/]+)\/stop$/.exec(p))) {
                const s = searches.get(m[1]);
                // Stop on a stopped search resumes it from its own request (the window's Resume button); the same
                // request posted to /api/search again does the same.
                if ((!s || s.state !== 'running') && status(m[1])?.state === 'stopped') {
                    const r = start(readJson(path.join(dirOf(m[1]), 'request.json')));
                    return send(res, r.status, r.status === 200 ? { id: m[1], resumed: true } : r.body);
                }
                if (!s || s.state !== 'running') return send(res, 409, { error: 'not running', state: status(m[1])?.state ?? null });
                s.handle.stop();
                return send(res, 200, { id: m[1], stopping: true });
            }
            if (req.method === 'POST' && (m = /^\/api\/search\/([^/]+)\/done$/.exec(p))) {
                const s = searches.get(m[1]);
                if (!s || s.state !== 'running') return send(res, 409, { error: 'not running', state: status(m[1])?.state ?? null });
                const mode = (await readBody(req))?.mode;
                if (mode !== 'accept' && mode !== 'skip') return send(res, 400, { error: 'mode must be accept or skip' });
                s.handle.done(mode);
                return send(res, 200, { id: m[1], done: mode });
            }
            if (req.method === 'GET' && p === '/api/results') return send(res, 200, results());
            if (req.method === 'GET' && (m = /^\/api\/results\/([^/]+)$/.exec(p))) {
                const f = path.join(dirOf(m[1]), 'result.json');
                return existsSync(f) ? send(res, 200, readJson(f)) : send(res, 404, { error: 'no such result' });
            }
            return send(res, 404, { error: 'no such endpoint' });
        } catch (e) {
            return send(res, e.status || 400, { error: e.message });
        }
    });
    return {
        server,
        get running() { return running; },
        get version() { return version; },
        listen: (p = 8787, host = '127.0.0.1') => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(p, host, () => { port = server.address().port; resolve(`http://${host}:${port}/`); });
        }),
        close: () => new Promise((r) => { for (const s of searches.values()) if (s.state === 'running') s.handle.stop(); server.close(() => r()); server.closeAllConnections?.(); }),
    };
}

// Is the holder of this loopback port one of our runners? Its /api/version answers { runner, engine }; a stranger's server does not.
// Returns that version, or null for a stranger.
export async function holderVersion(port) {
    try {
        const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(2000) });
        const j = await r.json();
        return r.ok && typeof j?.runner === 'string' && typeof j?.engine === 'string' ? { runner: j.runner, engine: j.engine } : null;
    } catch { return null; }
}

// Opens the page in the default browser (or in $BROWSER, the usual override: a program that takes the address). Only ever
// called once a runner answers on that address.
export function openBrowser(url) {
    const [cmd, args] = process.env.BROWSER ? [process.env.BROWSER, [url]]
        : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
            : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* no browser to open: the address is printed anyway */ }
}

// Exit codes of a start: 1 = could not start (the port is used by something that is not our runner, or any other failure),
// 3 = a runner of the same version already answers on the port (the page is opened on it with --open, nothing is started),
// 4 = a runner of another version holds the port (nothing is started, nothing is opened).
export const EXIT_ALREADY_RUNNING = 3;
export const EXIT_OTHER_VERSION = 4;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
    const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
    const open = process.argv.includes('--open');
    const port = Number(arg('port', 8787));
    const r = createRunner({ resultsDir: arg('results', DEFAULT_RESULTS), distDir: arg('dist', undefined), demoRuns: arg('demo-runs', undefined), demoPrices: arg('demo-prices', undefined), synthetic: arg('synthetic', undefined) });
    let url;
    try { url = await r.listen(port); } catch (e) {
        const held = e.code === 'EADDRINUSE' ? await holderVersion(port) : null;
        if (held) {
            const there = `http://127.0.0.1:${port}/`;
            const fmt = (v) => `runner ${v.runner}, engine ${v.engine}`;
            if (held.runner === r.version.runner && held.engine === r.version.engine) {
                log(`The What-if runner is already running on ${there} (${fmt(held)}).`);
                if (open) { log('Opening the page on it in your browser.'); openBrowser(there); }
                process.exit(EXIT_ALREADY_RUNNING);
            }
            log(`A What-if runner of another version is already running on ${there}: ${fmt(held)}. This one is ${fmt(r.version)}. Close that one and start this again. The page is not opened.`);
            process.exit(EXIT_OTHER_VERSION);
        }
        log(e.code === 'EADDRINUSE' ? `EADDRINUSE: port ${port} is used by another program (not the What-if runner).` : `The runner could not start: ${e.message}`);
        process.exit(1);
    }
    log(`What-if runner ${url} (results: ${path.resolve(arg('results', DEFAULT_RESULTS))}, searches at the lowest priority)`);
    if (open) { log('Opening the page in your browser.'); openBrowser(url); }
}
