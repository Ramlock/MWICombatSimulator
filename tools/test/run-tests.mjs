// The one tracked test loop: runs the named test files (names or paths, with or without extension), or all of them (tools/test/*.mjs and
// userscript/test/*), one after another, one log each under .test-logs/<stamp>/ (gitignored) with a timestamp on every line written, and prints
// one line per file: exit code, ok count, fail count, seconds. Exit code 0 when every file exits 0.
// When it is not already under HeavyRun (MWI_UNDER_HEAVYRUN unset) and D:\Apps\HeavyRun\HeavyRun.exe exists, it starts itself again through
// ONE HeavyRun call for the whole loop, its minutes the sum of the files' own (LONG_MINUTES, else DEFAULT_MINUTES), capped at 60, memory floor 3 GB (one node process and at most one headless Chrome: under 2 GB). Where
// HeavyRun does not exist it runs plainly. BROWSER is a no-op for every file; no core limit is ever passed. Every file it runs gets MWI_UNDER_HEAVYRUN=1,
// on both paths: the what-if files' guard (heavyrun-guard.mjs) ends any what-if file started without it. Arguments after -- go to every file it runs.
// Usage: node tools/test/run-tests.mjs [--strict] [file ...] [-- <file arguments>]        Docs: docs/codebase/test-loop.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HEAVYRUN = 'D:\\Apps\\HeavyRun\\HeavyRun.exe';
export const DEFAULT_MINUTES = 1;
// The long files (minutes each may take): about twice the time measured through this loop on 2026-11-15 (synthetic 409 s, presses 338 s,
// window 95 s, foods-drinks 65 s); whatif-runner-exe.mjs is not measured (needs a built exe). Every other file took under 40 s.
export const LONG_MINUTES = { 'whatif-runner-exe.mjs': 15, 'whatif-synthetic.mjs': 14, 'whatif-presses.mjs': 12, 'whatif-window.mjs': 4, 'whatif-foods-drinks.mjs': 3 };
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// The counts of a log's text: lines starting ok / PASS / pass / ✔, and FAIL / fail / not ok / ✖ (after the line's own timestamp, if any).
export function countLines(text) {
    let ok = 0, fail = 0, skipped = 0;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /, '');
        if (/^(ok|PASS|pass|✔)\b/.test(line) || line.startsWith('✔')) ok++;
        else if (/^(FAIL|fail|not ok|NOT OK)\b/.test(line) || line.startsWith('✖')) fail++;
        else if (/^SKIPPED\b/.test(line)) skipped++;
    }
    return { ok, fail, skipped };
}
// Whether to start again through HeavyRun: not already under it, and it exists here.
// The HeavyRun memory floor: MEMORY_FLOOR_GB, or none when a what-if file is among the files (WHATIF_FLOOR_GB; null would mean unmeasured or 8 GB+: no floor).
export const MEMORY_FLOOR_GB = 3, WHATIF_FLOOR_GB = 6;   // what-if: the highest peak measured 2026-11-15 was +4.3 GB (whatif-presses.mjs), plus about 1 GB
export const memoryArgs = (files) => { const n = files.some((f) => path.basename(f).startsWith('whatif-')) ? WHATIF_FLOOR_GB : MEMORY_FLOOR_GB; return n ? ['--memory-gb', String(n)] : []; };
export const shouldRelaunch = (env, heavyRunExists) => !env.MWI_UNDER_HEAVYRUN && heavyRunExists;
// The minutes these files may take: the sum of each one's, at least 1 (never cut: over 60, the loop says so and stops).
export const minutesFor = (files) => Math.max(1, files.reduce((s, f) => s + (LONG_MINUTES[path.basename(f)] ?? DEFAULT_MINUTES), 0));
// The loop's exit code: 1 when a file failed, or under --strict when a file skipped anything.
export const exitCode = (results, strict) => results.some((r) => r.code !== 0 || (strict && r.skipped > 0)) ? 1 : 0;
// The modules in tools/test that are not test files: the loop itself and the what-if files' guard.
export const NOT_TESTS = ['run-tests.mjs', 'heavyrun-guard.mjs'];
// The loop's own arguments, and the files' (everything after the first --).
export const splitArgs = (argv) => {
    const i = argv.indexOf('--'), own = i < 0 ? argv : argv.slice(0, i);
    return { strict: own.includes('--strict'), names: own.filter((a) => a !== '--strict'), fileArgs: i < 0 ? [] : argv.slice(i + 1) };
};
// The environment of each file the loop runs: BROWSER a no-op, and the marker the what-if files' guard checks.
export const fileEnv = (env) => ({ ...env, BROWSER: 'true', MWI_UNDER_HEAVYRUN: '1' });
// The files to run: the named ones (resolved in tools/test then userscript/test), or all of them.
export function resolveFiles(names, dir = root) {
    const all = [...fs.readdirSync(path.join(dir, 'tools/test')).filter((f) => f.endsWith('.mjs') && !NOT_TESTS.includes(f)).map((f) => 'tools/test/' + f),
        ...fs.readdirSync(path.join(dir, 'userscript/test')).filter((f) => /\.(c|m)?js$/.test(f)).map((f) => 'userscript/test/' + f)];
    if (!names.length) return all;
    return names.map((n) => {
        const b = path.basename(n.replace(/\\/g, '/'));
        const hit = all.find((f) => path.basename(f) === b) ?? all.find((f) => path.basename(f).replace(/\.(test\.)?(c|m)?js$/, '') === b);
        if (!hit) throw new Error('no such test file: ' + n);
        return hit;
    });
}

async function runOne(file, logDir, fileArgs) {
    const log = fs.createWriteStream(path.join(logDir, path.basename(file) + '.log'));
    const t0 = Date.now(); let text = '', rest = '';
    const write = (chunk) => { rest += chunk; const lines = rest.split(/\r?\n/); rest = lines.pop(); for (const l of lines) { const s = `${stamp()} ${l}\n`; text += s; log.write(s); } };
    const code = await new Promise((resolve) => {
        const p = spawn(process.execPath, [file, ...fileArgs], { cwd: root, env: fileEnv(process.env), windowsHide: true });
        p.stdout.on('data', write); p.stderr.on('data', write);
        p.on('close', (c) => resolve(c ?? 1)); p.on('error', () => resolve(1));
    });
    if (rest) write('\n');
    log.end();
    const { ok, fail, skipped } = countLines(text);
    return { code, ok, fail, skipped, secs: Math.round((Date.now() - t0) / 1000) };
}

async function main() {
    const { strict, names, fileArgs } = splitArgs(process.argv.slice(2));
    const files = resolveFiles(names);
    const minutes = minutesFor(files);
    if (minutes > 60) {
        console.log(`${stamp()} these files may take ${minutes} min, over HeavyRun's 60: run them in parts, e.g. the what-if files (whatif-*.mjs) apart from the rest`);
        process.exit(2);
    }
    if (shouldRelaunch(process.env, fs.existsSync(HEAVYRUN))) {
        const r = spawnSync(HEAVYRUN, ['--label', `test loop, ${files.length} file(s), one node process at a time; headless Chrome for page tests`, '--minutes', String(minutes), ...memoryArgs(files), '--wait', '--',
            process.execPath, fileURLToPath(import.meta.url), ...(strict ? ['--strict'] : []), ...files, ...(fileArgs.length ? ['--', ...fileArgs] : [])], { stdio: 'inherit', env: { ...process.env, MWI_UNDER_HEAVYRUN: '1', BROWSER: 'true' }, windowsHide: true });
        process.exit(r.status ?? 1);
    }
    const logDir = path.join(root, '.test-logs', stamp().replace(/[: ]/g, '-'));
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`${stamp()} logs: ${logDir}`);
    const results = [];
    for (const f of files) {
        const used0 = os.totalmem() - os.freemem(); let peak = 0;
        const timer = setInterval(() => { peak = Math.max(peak, os.totalmem() - os.freemem() - used0); }, 500);
        const r = await runOne(f, logDir, fileArgs);
        clearInterval(timer); results.push(r);
        console.log(`${stamp()} ${f} exit=${r.code} ok=${r.ok} fail=${r.fail} skipped=${r.skipped} ${r.secs}s peak=+${(peak / 2 ** 30).toFixed(1)}GB`);
    }
    const passed = results.filter((r) => r.code === 0).length, skipped = results.reduce((s, r) => s + r.skipped, 0);
    console.log(`${stamp()} ${passed}/${files.length} files passed skipped=${skipped}${strict ? ' (strict: a skip fails the loop)' : ''}`);
    process.exit(exitCode(results, strict));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
