// Test of the what-if files' guard (tools/test/heavyrun-guard.mjs): without the marker a file that loads it ends at once, exit 3, with the one
// line naming the test loop, and runs nothing after it; with the marker it runs. A scan checks that every tools/test/whatif-*.mjs loads the guard
// as its first statement, before any other import. No private data. Usage: node tools/test/run-tests.mjs heavyrun-guard-self
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MARKER, GUARD_EXIT, guardLine } from './heavyrun-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

// A file shaped like a what-if test: the guard first, then a line that shows it ran.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
const probe = path.join(tmp, 'whatif-probe.mjs');
fs.writeFileSync(probe, `import ${JSON.stringify(pathToFileURL(path.join(here, 'heavyrun-guard.mjs')).href)};\nconsole.log('RAN');\n`);
const run = (env) => spawnSync(process.execPath, [probe], { env, encoding: 'utf8', windowsHide: true });
const bare = { ...process.env }; delete bare[MARKER];
const a = run(bare);
check('marker unset: exits with the guard code', a.status === GUARD_EXIT, `status=${a.status}`);
check('marker unset: one line naming the loop', a.stderr.trim() === guardLine('whatif-probe.mjs') && a.stderr.trim().includes('node tools/test/run-tests.mjs whatif-probe.mjs'), JSON.stringify(a.stderr));
check('marker unset: nothing after the guard ran', !a.stdout.includes('RAN'), JSON.stringify(a.stdout));
const b = run({ ...bare, [MARKER]: '1' });
check('marker set: the file runs', b.status === 0 && b.stdout.includes('RAN') && !b.stderr.trim(), `status=${b.status} ${JSON.stringify(b.stderr)}`);
fs.rmSync(tmp, { recursive: true, force: true });

// The scan: the first statement of every what-if test file (after its leading comments) is the guard's import.
const files = fs.readdirSync(here).filter((f) => /^whatif-.*\.mjs$/.test(f));
check('the scan found the what-if files', files.length > 0, String(files.length));
const late = files.filter((f) => {
    const first = fs.readFileSync(path.join(here, f), 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('//'));
    return !/^import\s+['"]\.\/heavyrun-guard\.mjs['"];/.test(first || '');
});
check('every whatif-*.mjs loads the guard first', late.length === 0, late.join(', '));
process.exit(failed ? 1 : 0);
