// The one tracked test loop: runs the named test files (names or paths, with or without extension), or all of them (tools/test/*.mjs and
// userscript/test/*), one after another, one log each under .test-logs/<stamp>/ (gitignored) with a timestamp on every line written, and prints
// one line per file: exit code, ok count, fail count, seconds. Exit code 0 when every file exits 0.
// When it is not already under HeavyRun (MWI_UNDER_HEAVYRUN unset) and D:\Apps\HeavyRun\HeavyRun.exe exists, it starts itself again through
// ONE HeavyRun call for the whole loop, its minutes the sum of the files' own (LONG_MINUTES, else DEFAULT_MINUTES), capped at 60, memory floor 3 GB (one node process and at most one headless Chrome: under 2 GB). Where
// HeavyRun does not exist it runs plainly. BROWSER is a no-op for every file; no core limit is ever passed.
// Usage: node tools/test/run-tests.mjs [file ...]        Docs: docs/codebase/test-loop.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HEAVYRUN = 'D:\\Apps\\HeavyRun\\HeavyRun.exe';
export const DEFAULT_MINUTES = 2;
// The long files (minutes each may take); every other file counts DEFAULT_MINUTES.
export const LONG_MINUTES = {
    'whatif-runner-exe.mjs': 15, 'runner-search.mjs': 10, 'whatif-runner.mjs': 10, 'whatif-sure.mjs': 8, 'whatif-rounds.mjs': 8,
    'whatif-window.mjs': 8, 'whatif-get-runner-page.mjs': 5, 'zones-toggle-page.mjs': 4, 'talismans-page.mjs': 4, 'import-popup-page.mjs': 4,
};
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// The counts of a log's text: lines starting ok / PASS / pass / ✔, and FAIL / fail / not ok / ✖ (after the line's own timestamp, if any).
export function countLines(text) {
    let ok = 0, fail = 0;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /, '');
        if (/^(ok|PASS|pass|✔)\b/.test(line) || line.startsWith('✔')) ok++;
        else if (/^(FAIL|fail|not ok|NOT OK)\b/.test(line) || line.startsWith('✖')) fail++;
    }
    return { ok, fail };
}
// Whether to start again through HeavyRun: not already under it, and it exists here.
export const shouldRelaunch = (env, heavyRunExists) => !env.MWI_UNDER_HEAVYRUN && heavyRunExists;
// The HeavyRun minutes for these files: the sum of each one's, at least 1, at most 60.
export const minutesFor = (files) => Math.min(60, Math.max(1, files.reduce((s, f) => s + (LONG_MINUTES[path.basename(f)] ?? DEFAULT_MINUTES), 0)));
// The files to run: the named ones (resolved in tools/test then userscript/test), or all of them.
export function resolveFiles(names, dir = root) {
    const all = [...fs.readdirSync(path.join(dir, 'tools/test')).filter((f) => f.endsWith('.mjs') && f !== 'run-tests.mjs').map((f) => 'tools/test/' + f),
        ...fs.readdirSync(path.join(dir, 'userscript/test')).filter((f) => /\.(c|m)?js$/.test(f)).map((f) => 'userscript/test/' + f)];
    if (!names.length) return all;
    return names.map((n) => {
        const b = path.basename(n.replace(/\\/g, '/'));
        const hit = all.find((f) => path.basename(f) === b) ?? all.find((f) => path.basename(f).replace(/\.(test\.)?(c|m)?js$/, '') === b);
        if (!hit) throw new Error('no such test file: ' + n);
        return hit;
    });
}

async function runOne(file, logDir) {
    const log = fs.createWriteStream(path.join(logDir, path.basename(file) + '.log'));
    const t0 = Date.now(); let text = '', rest = '';
    const write = (chunk) => { rest += chunk; const lines = rest.split(/\r?\n/); rest = lines.pop(); for (const l of lines) { const s = `${stamp()} ${l}\n`; text += s; log.write(s); } };
    const code = await new Promise((resolve) => {
        const p = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, BROWSER: 'true' }, windowsHide: true });
        p.stdout.on('data', write); p.stderr.on('data', write);
        p.on('close', (c) => resolve(c ?? 1)); p.on('error', () => resolve(1));
    });
    if (rest) write('\n');
    log.end();
    const { ok, fail } = countLines(text);
    return { code, ok, fail, secs: Math.round((Date.now() - t0) / 1000) };
}

async function main() {
    const files = resolveFiles(process.argv.slice(2));
    if (shouldRelaunch(process.env, fs.existsSync(HEAVYRUN))) {
        const r = spawnSync(HEAVYRUN, ['--label', `test loop, ${files.length} file(s), one node process at a time; headless Chrome for page tests`, '--minutes', String(minutesFor(files)), '--memory-gb', '3', '--wait', '--',
            process.execPath, fileURLToPath(import.meta.url), ...files], { stdio: 'inherit', env: { ...process.env, MWI_UNDER_HEAVYRUN: '1', BROWSER: 'true' }, windowsHide: true });
        process.exit(r.status ?? 1);
    }
    const logDir = path.join(root, '.test-logs', stamp().replace(/[: ]/g, '-'));
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`${stamp()} logs: ${logDir}`);
    let bad = 0;
    for (const f of files) {
        const r = await runOne(f, logDir);
        if (r.code !== 0) bad++;
        console.log(`${stamp()} ${f} exit=${r.code} ok=${r.ok} fail=${r.fail} ${r.secs}s`);
    }
    console.log(`${stamp()} ${files.length - bad}/${files.length} files passed`);
    process.exit(bad ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
