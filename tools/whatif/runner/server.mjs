// What-if runner (delivery design sections 3 and 10): a local web server on the loopback address that serves the built
// simulator (dist/) at / and the search interface under /api/, and runs the optimizer (tools/whatif/optimize.mjs) at
// the lowest priority on every core. Code doc: docs/codebase/whatif-runner.md.
//
// Usage: node tools/whatif/runner/server.mjs [--port 8787] [--results <dir>] [--dist <dir>]
//   --port 0 picks a free port. --results defaults to <home>/MWI-WhatIf/results (never inside the repo).
//
// Interface (JSON over HTTP):
//   GET  /api/version              { runner, engine }
//   POST /api/search               body { setups, options: { zone, tier, comdrop, comexp, prices | marketplace }, goal, budgets,
//                                  levers, players, stages, keep, export?, ...the optimizer's own flags without the
//                                  dashes }; answer { id }. One search at a time: 409 { error, running } otherwise.
//                                  The id is a hash of the request, so the same request again resumes its run store.
//   GET  /api/search/<id>[?since=<n>]  { state: running|stopped|done|error, progress, error?, result?, partial?, partialVersion? }; a running
//                                  search carries its report so far (partial) and its version only when newer than `since`
//   POST /api/search/<id>/stop     stops it (exit code 3, run store kept); on a stopped search, resumes it
//   GET  /api/results              finished searches, newest first: [{ id, finished, goal, players }]
//   GET  /api/results/<id>         one result.json
// Requests come only from the runner's own page: a Host that is not the loopback address and port, or an Origin
// that is not the runner's own, is refused with 403.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, createWriteStream, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMarketplace } from '../../../src/marketplace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');
const OPTIMIZER = path.join(ROOT, 'tools', 'whatif', 'optimize.mjs');
const PRICES_DIR = path.join(ROOT, 'tools', 'calibration');
export const RUNNER_VERSION = '0.1.0';
export const MARKETPLACE_FILE = 'marketplace.json';
export const DEFAULT_RESULTS = path.join(os.homedir(), 'MWI-WhatIf', 'results');

// The optimizer's flags a request may set (camelCase or dashed). --out, --setups, --export and --prices are set by
// the runner itself; --cache-from is not offered (it reads arbitrary files).
const PASS = ['players', 'levers', 'goal', 'stages', 'keep', 'error', 'base-mult', 'z', 'max-up', 'swaps', 'swap-levels', 'sell-down', 'slots', 'only-candidates', 'max-steps', 'jobs', 'max-minutes', 'confirm-seed-offset', 'skill-up', 'skill-left', 'charms', 'house-rooms', 'house-up', 'ability-steps', 'book-levels', 'probe', 'trigger-owners', 'trigger-fixed', 'budget', 'comdrop', 'comexp', 'tier', 'zone'];
const dashed = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const RESERVED = new Set(['setups', 'options', 'budgets', 'export', 'prices', 'marketplace', 'triggerCands', 'trigger-cands']);
const SAFE_NAME = /^[^\\/:*?"<>|\r\n]+$/;

const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
export const searchId = (body) => createHash('sha1').update(JSON.stringify(canonical(body))).digest('hex').slice(0, 12);

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
export function buildArgs(body, outDir) {
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
    if (market != null) {
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

// Starts the optimizer for one search at the lowest priority; it inherits the runner's (low) class and is set to it
// explicitly as well. Every log line is timestamped into <out>/log.txt.
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
        onProgress: null, onPartial: null, onExit: null,
        stop: () => { if (c.connected) c.send('stop'); },
    };
    c.on('message', (m) => { if (m?.type === 'progress') handle.onProgress?.(m.progress); else if (m?.type === 'partial') handle.onPartial?.(m.result); });
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
    mkdirSync(resultsDir, { recursive: true });
    if (opts.lowPriority !== false) os.setPriority(os.constants.priority.PRIORITY_LOW);
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
        if (s?.state === 'running') return { state: 'running', progress, ...(s.partial && s.partialVersion > since ? { partial: s.partial, partialVersion: s.partialVersion } : {}) };
        if (existsSync(path.join(dir, 'result.json'))) return { state: 'done', progress, result: readJson(path.join(dir, 'result.json')) };
        if (s?.state === 'error') return { state: 'error', progress, error: s.error };
        if (existsSync(path.join(dir, 'request.json'))) return { state: 'stopped', progress };
        return null;
    }
    function start(body) {
        if (running) return { status: 409, body: { error: 'a search is running', id: running, running } }; // the window reads id
        const id = searchId(body), dir = dirOf(id);
        if (existsSync(path.join(dir, 'result.json'))) return { status: 200, body: { id } }; // finished already
        mkdirSync(dir, { recursive: true });
        const args = buildArgs(body, dir);
        writeFileSync(path.join(dir, 'request.json'), JSON.stringify(body));
        const s = { state: 'running', progress: { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0, secondsPerRun: null, etaSeconds: null }, error: null };
        searches.set(id, s);
        running = id;
        s.handle = launch(args, dir);
        s.handle.onProgress = (p) => { s.progress = p; };
        s.handle.onPartial = (r) => { s.partial = r; s.partialVersion = ++partialSeq; };
        s.handle.onExit = (code, tail) => {
            running = null;
            if (code === 0 && existsSync(path.join(dir, 'result.json'))) s.state = 'done';
            else if (code === 3) s.state = 'stopped';
            else { s.state = 'error'; s.error = `optimizer exited ${code}: ${String(tail || '').split(/\r?\n/).filter((l) => l.trim() && !/^\s+at |^Node\.js v/.test(l)).slice(-4).join(' | ')}`; }
        };
        return { status: 200, body: { id } };
    }
    function results() {
        if (!existsSync(resultsDir)) return [];
        return readdirSync(resultsDir).filter((d) => /^[0-9a-f]{12}$/.test(d) && existsSync(path.join(resultsDir, d, 'result.json'))).map((d) => {
            const f = path.join(resultsDir, d, 'result.json'), r = readJson(f);
            return { id: d, finished: statSync(f).mtime.toISOString(), goal: r.goal, players: r.players };
        }).sort((a, b) => (a.finished < b.finished ? 1 : -1));
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
        listen: (p = 8787, host = '127.0.0.1') => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(p, host, () => { port = server.address().port; resolve(`http://${host}:${port}/`); });
        }),
        close: () => new Promise((r) => { for (const s of searches.values()) if (s.state === 'running') s.handle.stop(); server.close(() => r()); server.closeAllConnections?.(); }),
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
    const r = createRunner({ resultsDir: arg('results', DEFAULT_RESULTS), distDir: arg('dist', undefined) });
    const url = await r.listen(Number(arg('port', 8787)));
    console.log(`${new Date().toISOString()} What-if runner ${url} (results: ${path.resolve(arg('results', DEFAULT_RESULTS))}, lowest priority)`);
}
