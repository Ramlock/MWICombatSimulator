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
//   GET  /api/results              earlier searches, finished and stopped, newest first: [{ id, finished, goal, players, stopped? }]
//   GET  /api/results/<id>         one result.json, or a stopped search's partial.json
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
import { searchIdWith, checkRequest, budgetArgs, flagArgs } from '../../../src/whatif/request.mjs';
import { loadScenario, applyScenarioToRequest } from '../synthetic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');
const OPTIMIZER = path.join(ROOT, 'tools', 'whatif', 'optimize.mjs');
const PRICES_DIR = path.join(ROOT, 'tools', 'calibration');
export const RUNNER_VERSION = '0.1.0';
export const MARKETPLACE_FILE = 'marketplace.json';
export const DEFAULT_RESULTS = path.join(os.homedir(), 'MWI-WhatIf', 'results');

// The request read as flags, its checks and its id: src/whatif/request.mjs (the page's own search reads it the same way).
export const searchId = (body) => searchIdWith((t) => createHash('sha1').update(t).digest('hex'), body);

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
    checkRequest(body);
    const setups = body.setups;
    const setupsDir = path.join(outDir, 'setups');
    mkdirSync(setupsDir, { recursive: true });
    for (const s of setups) writeFileSync(path.join(setupsDir, s.name + '.json'), JSON.stringify(s));
    writeFileSync(path.join(setupsDir, 'party.txt'), setups.map((s) => s.name).join('\n') + '\n');
    const args = ['--out', outDir, '--setups', setupsDir, '--low-priority'];
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
    args.push(...budgetArgs(body));
    // export: written as it comes.
    if (body.export != null) { const f = path.join(outDir, 'export.json'); writeFileSync(f, JSON.stringify(body.export)); args.push('--export', f); }
    const tc = body.triggerCands ?? body['trigger-cands'];
    if (tc != null) { const f = path.join(outDir, 'trigger-cands.json'); writeFileSync(f, JSON.stringify(tc)); args.push('--trigger-cands', f); }
    args.push(...flagArgs(body));
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
    // The list of earlier searches: finished ones (result.json) and stopped ones (partial.json, what the search got to; entry `stopped: true`),
    // one path for both (savedReport). The search running now is left out (a resumed one still holds its old partial.json). A report is read (in
    // full: it is one JSON) only when it is new or changed since the last list (its size and time), so opening the window does not parse every saved
    // result each time.
    const listed = new Map(); // id -> { file, mtimeMs, size, entry }
    // The report a search folder holds: its result.json when it finished, else its partial.json when it was stopped; null for neither.
    const savedReport = (dir) => {
        for (const [name, stopped] of [['result.json', false], ['partial.json', true]]) {
            const file = path.join(dir, name);
            try { return { file, stopped, st: statSync(file) }; } catch { /* not this one */ }
        }
        return null;
    };
    function results() {
        if (!existsSync(resultsDir)) return [];
        return readdirSync(resultsDir).filter((d) => /^[0-9a-f]{12}$/.test(d) && d !== running).map((d) => {
            const saved = savedReport(path.join(resultsDir, d));
            if (!saved) { listed.delete(d); return null; }
            const { file, stopped, st } = saved, seen = listed.get(d);
            if (seen && seen.file === file && seen.mtimeMs === st.mtimeMs && seen.size === st.size) return seen.entry;
            const r = readJson(file), entry = { id: d, finished: st.mtime.toISOString(), goal: r.goal, players: r.players, ...(stopped ? { stopped: true } : {}) };
            listed.set(d, { file, mtimeMs: st.mtimeMs, size: st.size, entry });
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
                const saved = savedReport(dirOf(m[1]));
                return saved ? send(res, 200, readJson(saved.file)) : send(res, 404, { error: 'no such result' });
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
// Returns that version, or null for a stranger. A runner of ours busy with a search can take seconds to answer (its event loop is
// shared with the search's messages, on a full CPU), so the probe waits up to HOLDER_WAIT_MS for an answer. The wait is only that long
// for a holder that takes the connection and stays silent: a stranger that answers anything (another web server) or refuses the
// connection is decided as soon as it does, and nothing that answers is ever waited on past its answer.
export const HOLDER_WAIT_MS = 10000;
export async function holderVersion(port, wait = HOLDER_WAIT_MS) {
    try {
        const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(wait) });
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
