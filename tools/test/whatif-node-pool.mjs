// Test: the search's run-process pool (tools/whatif/node-shell.mjs createNodePool). A run ended by drop() or kill() resolves null at once, before
// its killed process has exited (on a full CPU a killed process takes seconds to be reaped; the window's Skip, Accept and Stop must not wait for
// it); a run that answers resolves with its answer and its process is reused; a run process that exits by itself rejects.
// Usage: node tools/test/whatif-node-pool.mjs        Exit code 0 on pass, 1 on fail.
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createNodePool } = await import(pathToFileURL(path.join(root, 'tools/whatif/node-shell.mjs')).href);
let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok || !detail ? '' : ' -- ' + detail}`); if (!ok) failed++; };
const tmp = mkdtempSync(path.join(os.tmpdir(), 'whatif-pool-'));
// A run process: 'echo' answers at once, 'hang' never answers, 'die' exits by itself.
const child = path.join(tmp, 'child.mjs');
writeFileSync(child, "process.on('message', (t) => { if (t.mode === 'echo') process.send({ variant: t.v, pid: process.pid }); else if (t.mode === 'die') process.exit(7); });\n");
const pool = createNodePool(child);
try {
    const a = await pool.run({ mode: 'echo', v: 'a' }), b = await pool.run({ mode: 'echo', v: 'b' });
    check(a?.variant === 'a' && b?.variant === 'b' && a.pid === b.pid, 'a run that answers resolves with its answer; its process is reused for the next run');
    let err = null;
    try { await pool.run({ mode: 'die' }); } catch (e) { err = e; }
    check(/child exited 7/.test(String(err)), 'a run process that exits by itself rejects', String(err));
    // drop(): the runs in flight resolve null at once, before their processes' exit events.
    const runs = [0, 1, 2].map(() => pool.run({ mode: 'hang' }));
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now();
    pool.drop();
    const results = await Promise.all(runs.map((p) => p.then((v) => [v, performance.now() - t0])));
    check(results.every(([v, ms]) => v === null && ms < 50), 'drop(): the runs in flight resolve null at once (not when their processes exit)', JSON.stringify(results));
    const c = await pool.run({ mode: 'echo', v: 'c' });
    check(c?.variant === 'c', 'after drop(), a later run gets a process and answers');
    const hung = pool.run({ mode: 'hang' });
    await new Promise((r) => setTimeout(r, 200));
    const t1 = performance.now();
    pool.kill();
    const v = await hung, ms = performance.now() - t1;
    check(v === null && ms < 50, `kill(): the run in flight resolves null at once (${Math.round(ms)} ms)`);
    check((await pool.run({ mode: 'echo', v: 'd' })) === null, 'after kill(), every later run resolves null');
} finally {
    pool.kill();
    await new Promise((r) => setTimeout(r, 500));
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a process still holds the folder */ }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
