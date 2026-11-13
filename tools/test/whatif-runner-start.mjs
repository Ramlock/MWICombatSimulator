// Test: how the real runner process starts (tools/whatif/runner/server.mjs as the launchers run it, with --open).
// Real child processes and real sockets; the browser is a stub ($BROWSER = node with a preload) that asks the runner's own
// /api/version at the moment it is called and records the time, so the order "listening, then open" is measured, not assumed.
// Cases: a free port; our runner already holds it; a stranger holds it (an HTTP server of another kind, and a socket that never answers);
// another start failure (a bad port); no --open flag (the Linux way: the address is printed, nothing is opened).
// Usage: node tools/test/whatif-runner-start.mjs   Exit code 0 on pass, 1 on fail.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = path.join(root, 'tools', 'whatif', 'runner', 'server.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-start-'));
const openedFile = path.join(tmp, 'opened.jsonl');
const stub = path.join(tmp, 'opener.mjs');
// Runs in every node process that inherits NODE_OPTIONS, but acts only when node was started with an http address as its script (the browser call).
fs.writeFileSync(stub, `import fs from 'node:fs';
// node resolves its script argument to a path, so the address is read back out of it.
const arg = process.argv[1] || '';
const m = /127\\.0\\.0\\.1:(\\d+)/.exec(arg);
if (!arg.endsWith('server.mjs') && m) {
    const url = 'http://127.0.0.1:' + m[1] + '/';
    const t = Date.now(); let answers = 'no';
    try { const r = await fetch(url + 'api/version', { signal: AbortSignal.timeout(3000) }); answers = String(r.status); } catch (e) { answers = 'error ' + e.code; }
    fs.appendFileSync(${JSON.stringify(openedFile)}, JSON.stringify({ t, url, answers }) + '\\n');
    process.exit(0);
}
`);
const env = { ...process.env, BROWSER: process.execPath, NODE_OPTIONS: `--import=${pathToFileURL(stub).href}` };

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = () => (fs.existsSync(openedFile) ? fs.readFileSync(openedFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function start(port, extra = ['--open']) {
    const child = spawn(process.execPath, [server, '--port', String(port), '--results', path.join(tmp, 'results'), ...extra], { env, windowsHide: true });
    const run = { child, out: '', exit: null };
    child.stdout.on('data', (d) => { run.out += d; });
    child.stderr.on('data', (d) => { run.out += d; });
    run.done = new Promise((r) => child.on('exit', (code) => { run.exit = code; r(code); }));
    run.listening = async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (/What-if runner http:/.test(run.out)) return true; await sleep(100); } return false; };
    return run;
}
const lineTime = (out, re) => { const m = out.split('\n').find((l) => re.test(l)); return m ? Date.parse(m.slice(0, 24)) : NaN; };
const noStack = (out) => !/\n\s+at /.test(out) && !out.includes('node:net');

// ---- A free port ----
const port = await freePort();
const a = start(port);
check('free port: the runner starts and says where it listens', await a.listening(), a.out);
await sleep(1500);
let o = opened();
check('free port: the browser is opened once', o.length === 1 && o[0].url === `http://127.0.0.1:${port}/`, JSON.stringify(o));
check('free port: when the browser was opened the runner already answered (listen came first)', o[0]?.answers === '200', JSON.stringify(o));
check('free port: the log order is "listening" then "Opening the page", and the open call came after the listening line', lineTime(a.out, /What-if runner http:/) <= lineTime(a.out, /Opening the page in your browser/) && o[0]?.t >= lineTime(a.out, /What-if runner http:/), a.out + JSON.stringify(o));

// ---- Our runner already holds the port ----
const b = start(port);
const bCode = await b.done;
check('ours holds the port: the second start exits with the "already running" code (3)', bCode === 3, `exit ${bCode}\n${b.out}`);
check('ours holds the port: it says the runner is already running, never "stopped", no EADDRINUSE and no stack trace', /already running/.test(b.out) && !/stopped|EADDRINUSE/i.test(b.out) && noStack(b.out), b.out);
await sleep(1500);
o = opened();
check('ours holds the port: the page is opened on the running one (a second open, same address, it answered)', o.length === 2 && o[1].url === o[0].url && o[1].answers === '200', JSON.stringify(o));
const b2 = start(port, []);
check('ours holds the port, no --open: exit 3 and nothing opened', (await b2.done) === 3 && (await sleep(1000), opened().length === 2));

// ---- A runner of another version holds the port (a real runner process serving a dist with another bundle hash) ----
{
    const otherDist = path.join(tmp, 'other-dist'); fs.mkdirSync(otherDist);
    fs.writeFileSync(path.join(otherDist, 'index.html'), '<script src="bundle.deadbeef.js"></script>');
    const p3 = await freePort();
    const holder = start(p3, ['--dist', otherDist]);
    check('other version: a runner with another engine starts', await holder.listening(), holder.out);
    const before = opened().length;
    const f = start(p3);
    const code = await f.done;
    check('other version: exit 4, the text says another version is running, names both versions, tells to close it, never "stopped"', code === 4 && /another version is already running/.test(f.out) && /engine deadbeef/.test(f.out) && /This one is runner [^,]+, engine (?!deadbeef)\w+/.test(f.out) && /Close that one and start this again/.test(f.out) && !/stopped/i.test(f.out) && noStack(f.out), `exit ${code}\n${f.out}`);
    await sleep(800);
    check('other version: no browser opened', opened().length === before, JSON.stringify(opened()));
    holder.child.kill(); await holder.done;
}

// ---- A stranger holds the port ----
const mkStranger = (handler) => new Promise((res) => {
    const s = (handler ? http.createServer(handler) : net.createServer(() => {}));
    s.sockets = new Set(); s.on('connection', (k) => { s.sockets.add(k); k.on('close', () => s.sockets.delete(k)); });
    s.listen(0, '127.0.0.1', () => res(s));
});
for (const [what, handler] of [['an HTTP server of another kind', (rq, rs) => { rs.writeHead(200, { 'Content-Type': 'text/plain' }); rs.end('hello'); }], ['a JSON server with another shape', (rq, rs) => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{"version":"1"}'); }], ['a socket that never answers', null]]) {
    const s = await mkStranger(handler);
    const before = opened().length;
    const c = start(s.address().port);
    const code = await c.done;
    check(`a stranger (${what}): exit 1 with the port-taken text, no stack trace`, code === 1 && /EADDRINUSE: port \d+ is used by another program/.test(c.out) && noStack(c.out), `exit ${code}\n${c.out}`);
    await sleep(800);
    check(`a stranger (${what}): no browser opened`, opened().length === before, JSON.stringify(opened()));
    for (const k of s.sockets) k.destroy();
    await new Promise((r) => s.close(r));
}

// ---- Another start failure ----
{
    const before = opened().length;
    const d = start(99999);
    const code = await d.done;
    check('another failure (a bad port): exit 1, "could not start", no stack trace, no browser', code === 1 && /could not start/.test(d.out) && noStack(d.out) && (await sleep(800), opened().length === before), `exit ${code}\n${d.out}`);
}

// ---- No --open (the Linux way) ----
{
    const p2 = await freePort();
    const before = opened().length;
    const e = start(p2, []);
    check('no --open: the runner starts and prints its address', await e.listening(), e.out);
    await sleep(1200);
    check('no --open: nothing is opened', opened().length === before && !/Opening the page/.test(e.out), e.out);
    e.child.kill();
    await e.done;
}

a.child.kill();
await a.done;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
