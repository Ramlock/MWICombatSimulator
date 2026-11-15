// Runs the short real search (tools/test/runner-search.mjs) from an extracted runner zip, as release.ps1's built-file test of the zip.
// Starts the zip's own node.exe on its tools/whatif/runner/server.mjs, hidden, on a free port (never 8787), without --open, and with
// BROWSER set to a no-op anyway. Usage: node tools/release/zip-search.mjs --dir <the zip's WhatIfRunner folder>. Exit 0 on a finished search, 1 otherwise.
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { runSearch } from '../test/runner-search.mjs';

const i = process.argv.indexOf('--dir');
const dir = i < 0 ? null : path.resolve(process.argv[i + 1]);
if (!dir) { console.error('usage: --dir <WhatIfRunner folder>'); process.exit(2); }
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let port = await freePort(); while (port === 8787) port = await freePort();
const child = spawn(path.join(dir, 'node.exe'), [path.join(dir, 'tools', 'whatif', 'runner', 'server.mjs'), '--port', String(port)],
    { cwd: dir, env: { ...process.env, BROWSER: 'C:\Windows\System32\where.exe' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { out += b; });
let code = 1;
try {
    const t0 = Date.now();
    while (!/What-if runner http:\/\//.test(out) && child.exitCode === null && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    if (!/What-if runner http:\/\//.test(out)) throw new Error('the runner did not start: ' + out);
    const ts = Date.now();
    const r = await runSearch(port);
    const ok = r?.state === 'done' && r.result && Array.isArray(r.result.steps);
    console.log(ok ? 'ok  ' : 'FAIL', `a short real search from the zip (${((Date.now() - ts) / 1000).toFixed(0)} s)`, ok ? '' : JSON.stringify({ state: r?.state, error: r?.error }));
    code = ok ? 0 : 1;
} catch (e) { console.log('FAIL', e.message); }
try { execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
process.exit(code);
