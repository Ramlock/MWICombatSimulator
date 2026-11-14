// The one entry of WhatIfRunner.exe, a Node single executable application built by build-exe.ps1. Docs: docs/codebase/runner-zip.md.
// A SEA's main must be CommonJS and can require only built-in modules, so this file unpacks the embedded tree (the zip's
// files: dist/, src/, tools/, node_modules/heap-js, VERSION.txt) once per build and runs the ES modules from there, unchanged.
// Two ways in, told apart by the arguments (inside a SEA, process.argv is [exe, exe, ...args]):
//   - a child the runner forks (its server, the optimizer, a run worker): child_process.fork starts process.execPath, which is
//     this exe, with the script as the first argument; that script (a .mjs inside the unpack folder) is imported as Node would run it.
//   - anything else is the user's start, `WhatIfRunner.exe [port]` (default 8787): what start-runner.cmd does for the zip. It
//     starts the same server.mjs with --open as a child, and when that child ends by itself it says why and keeps the window
//     open until a key is pressed (a double-clicked exe's console closes on exit).
'use strict';
const sea = require('node:sea');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// The runner's data folder: the parent of server.mjs's default results folder (<home>/MWI-WhatIf/results).
const DATA = path.join(os.homedir(), 'MWI-WhatIf');
const ID = sea.getAsset('build-id', 'utf8').trim();
const DIR = path.join(DATA, 'runner-' + ID);
const SERVER = path.join(DIR, 'tools', 'whatif', 'runner', 'server.mjs');
const EXIT_ALREADY_RUNNING = 3, EXIT_OTHER_VERSION = 4; // server.mjs's exit codes (it exports them; this CommonJS file cannot import it before unpacking)

const args = process.argv.slice(2);
const inDir = (p) => { const r = path.resolve(p); return r.toLowerCase().startsWith(DIR.toLowerCase() + path.sep); };

if (args[0] && /\.mjs$/i.test(args[0]) && inDir(args[0])) runScript(args[0], args.slice(1));
else launch(/^\d+$/.test(args[0] || '') ? args[0] : '8787');

function runScript(script, rest) {
    process.argv = [process.execPath, path.resolve(script), ...rest];
    import(pathToFileURL(path.resolve(script)).href).catch((e) => { console.error(e); process.exit(1); });
}

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Writes the embedded tree to DIR once: into DIR.part-<pid> first, renamed when complete, so a half-written folder is never used
// and two first starts at once do not collide (the loser of the rename uses the winner's folder).
function unpack() {
    if (fs.existsSync(path.join(DIR, '.done'))) return;
    const part = `${DIR}.part-${process.pid}`;
    fs.rmSync(part, { recursive: true, force: true });
    for (const k of sea.getAssetKeys()) {
        if (k === 'build-id') continue;
        const f = path.join(part, k);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.from(sea.getRawAsset(k)));
    }
    fs.writeFileSync(path.join(part, '.done'), ID);
    for (let i = 0; ; i++) {
        try { fs.renameSync(part, DIR); return; } catch (e) {
            if (fs.existsSync(path.join(DIR, '.done'))) { fs.rmSync(part, { recursive: true, force: true }); return; }
            if (i >= 20) throw e;
            sleep(250); // an antivirus scan of the new files can hold the folder for a moment
        }
    }
}

// Removes the folders of other builds (runner-<id>, and runner-<id>.part-<pid> left by a start that died), except one a
// running exe still uses: each start marks its folder with .in-use-<pid> and removes the mark when it ends.
function removeOldBuilds() {
    let names = [];
    try { names = fs.readdirSync(DATA); } catch { return; }
    for (const n of names) {
        const m = /^runner-[0-9a-f]+(?:\.part-(\d+))?$/.exec(n);
        if (!m || n === path.basename(DIR)) continue;
        const d = path.join(DATA, n);
        if (m[1] && alive(Number(m[1]))) continue;
        let marks = [];
        try { marks = fs.readdirSync(d).map((x) => /^\.in-use-(\d+)$/.exec(x)).filter(Boolean); } catch { continue; }
        if (marks.some((x) => alive(Number(x[1])))) continue;
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* in use after all: tried again next start */ }
    }
}

function launch(port) {
    process.title = 'What-if runner (close this window to stop)';
    try { unpack(); } catch (e) {
        return finish(1, [`The runner could not unpack its files into ${DIR} (${e.code || e.message}). It needs write access to ${DATA}.`]);
    }
    const mark = path.join(DIR, `.in-use-${process.pid}`);
    try { fs.writeFileSync(mark, ''); } catch { /* only protects this folder from another build's cleanup */ }
    const unmark = () => { try { fs.rmSync(mark, { force: true }); } catch { /* gone already */ } };
    process.on('exit', unmark);
    for (const s of ['SIGINT', 'SIGBREAK', 'SIGHUP']) process.on(s, () => process.exit(130)); // Ctrl+C or the window closed: the runner child gets the same event
    removeOldBuilds();

    console.log('');
    console.log(' What-if runner. Leave this window open while you use the page.');
    console.log(' Closing this window (or pressing Ctrl+C) stops the runner and any search in progress.');
    console.log('');
    const child = spawn(process.execPath, [SERVER, '--port', port, '--open'], { stdio: 'inherit', windowsHide: true });
    child.on('error', (e) => finish(1, [`The runner could not start: ${e.message}`]));
    child.on('exit', (code) => {
        if (code === EXIT_ALREADY_RUNNING) return finish(code, ['Nothing was started: the runner was already running. Use the page that just opened, and close this window.']);
        if (code === EXIT_OTHER_VERSION) return finish(code, [`Nothing was started: a runner of another version is already running on port ${port}.`, "Close the other runner's window (or stop it), then start this again."]);
        finish(code ?? 1, [`The runner stopped. If the message above says EADDRINUSE, something that is not the runner is using port ${port}:`, `close that program (or start this again with another port, for example: WhatIfRunner.exe 8788).`]);
    });
}

// Prints the closing lines and, in a console, waits for a key so they can be read; without a console (a hidden or piped start) it exits at once.
function finish(code, lines) {
    console.log('');
    for (const l of lines) console.log(' ' + l);
    console.log('');
    if (!process.stdin.isTTY) process.exit(code);
    process.stdout.write('Press any key to close this window . . .');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(code));
}
