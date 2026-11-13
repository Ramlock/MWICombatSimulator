// Test: WhatIfRunner.exe, the one-file runner (tools/runner-zip/build-exe.ps1, entry tools/runner-zip/exe-entry.cjs), as a user starts it.
// The exe is copied into a folder whose path has spaces, and run with a temporary home folder (USERPROFILE), so it unpacks there
// and never touches the real one. Every start is hidden; the browser is a stub ($BROWSER = node with a preload) that records the
// address and whether the runner answered /api/version at that moment. Cases: (1) a first start on a free port: the header, the
// unpack folder <home>/MWI-WhatIf/runner-<build id>, older builds' folders removed except one a live start still marks, the page
// opened once it listens, the page served; (2) a second start on the same port while the first runs: exit 3, its message, the page
// opened on the running one; (3) a port held by a runner of another version: exit 4, its message, nothing opened; (4) a port held by
// another program: exit 1, EADDRINUSE and the "another port" hint, nothing opened; (5) no write access to the data folder: exit 1 and
// one line; (6) a short real search through the first start (the optimizer and its run workers are the exe itself, forked).
// Usage: node tools/test/whatif-runner-exe.mjs --exe <WhatIfRunner.exe> [--commit <short sha VERSION.txt must name>] [--work <scratch dir, default the OS temp folder>]
//        [--captures <dir>: writes the console text of starts 1, 2 and 4 as one-file-first-start.txt, one-file-second-start.txt,
//        one-file-port-taken.txt]. Needs Windows (icacls for case 5). Exit code 0 on pass, 1 on fail.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const opt = (n) => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : process.argv[i + 1]; };
const exeSrc = opt('exe');
if (!exeSrc || !fs.existsSync(exeSrc)) { console.error('usage: --exe <WhatIfRunner.exe>'); process.exit(2); }
const captures = opt('captures');
const work = fs.mkdtempSync(path.join(opt('work') || os.tmpdir(), 'runner-exe-'));
const exe = path.join(work, 'dir with spaces', 'WhatIfRunner.exe');
fs.mkdirSync(path.dirname(exe), { recursive: true });
fs.copyFileSync(exeSrc, exe);
const home = path.join(work, 'home');
const data = path.join(home, 'MWI-WhatIf');
fs.mkdirSync(data, { recursive: true });

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The browser stub: runs in every node process that inherits NODE_OPTIONS, acts only when started with an http address as its script.
const openedFile = path.join(work, 'opened.jsonl');
const stub = path.join(work, 'opener.mjs');
fs.writeFileSync(stub, `import fs from 'node:fs';
const arg = process.argv[1] || '';
const m = /127\\.0\\.0\\.1:(\\d+)/.exec(arg);
if (!/\\.(mjs|exe)$/i.test(arg) && m) {
    let answered = false;
    try { const r = await fetch('http://127.0.0.1:' + m[1] + '/api/version'); answered = r.ok; } catch {}
    fs.appendFileSync(${JSON.stringify(openedFile)}, JSON.stringify({ port: Number(m[1]), answered }) + '\\n');
    process.exit(0);
}
`);
const env = { ...process.env, USERPROFILE: home, HOME: home, BROWSER: process.execPath, NODE_OPTIONS: `--import=${pathToFileURL(stub).href}` };
const opened = () => (fs.existsSync(openedFile) ? fs.readFileSync(openedFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// Starts the exe hidden. resolves { child, out(), code } once it prints its listening line or exits.
function start(args, envOver = {}) {
    const child = spawn(exe, args, { env: { ...env, ...envOver }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const exited = new Promise((r) => child.on('exit', (code) => r(code)));
    return new Promise((resolve) => {
        const t0 = Date.now();
        const tick = setInterval(() => { if (/What-if runner http:\/\//.test(out) || Date.now() - t0 > 60000) { clearInterval(tick); resolve({ child, out: () => out, exited }); } }, 100);
        exited.then((code) => { clearInterval(tick); resolve({ child, out: () => out, exited, code }); });
    });
}
const save = (name, text) => { if (captures) { fs.mkdirSync(captures, { recursive: true }); fs.writeFileSync(path.join(captures, name), text.replace(/\r?\n/g, '\r\n')); } };
const killTree = (pid) => { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } };

let first = null;
try {
    // Older builds' folders: one plain (removed), one a live start still marks (kept: this test's own pid), one half-written by a dead start (removed).
    const old = path.join(data, 'runner-000000000000'), kept = path.join(data, 'runner-111111111111');
    let deadPid = 999999; while ((() => { try { process.kill(deadPid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })()) deadPid--;
    const part = path.join(data, `runner-222222222222.part-${deadPid}`);
    for (const d of [old, kept, part]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.txt'), 'x'); }
    fs.writeFileSync(path.join(kept, `.in-use-${process.pid}`), '');

    // (1) First start.
    const port = await freePort();
    const t0 = Date.now();
    first = await start([String(port)]);
    const o1 = first.out();
    check(first.code === undefined && o1.includes(`What-if runner http://127.0.0.1:${port}/`), '1: first start listens on the port given', o1);
    console.log(`     first start to listening: ${((Date.now() - t0) / 1000).toFixed(1)} s (includes unpacking)`);
    check(o1.includes('What-if runner. Leave this window open while you use the page.') && o1.includes('Closing this window (or pressing Ctrl+C) stops the runner and any search in progress.'), '1: the two header lines');
    const dirs = fs.readdirSync(data).filter((n) => /^runner-[0-9a-f]{12}$/.test(n) && n !== 'runner-111111111111');
    check(dirs.length === 1 && fs.existsSync(path.join(data, dirs[0], '.done')) && fs.existsSync(path.join(data, dirs[0], 'tools', 'whatif', 'runner', 'server.mjs')), '1: unpacked once into <home>/MWI-WhatIf/runner-<build id>', JSON.stringify(fs.readdirSync(data)));
    const versionTxt = fs.readFileSync(path.join(data, dirs[0], 'VERSION.txt'), 'utf8').trim();
    console.log(`     VERSION.txt: ${versionTxt}; build id ${dirs[0].slice(7)}`);
    if (opt('commit')) check(versionTxt.endsWith('commit ' + opt('commit')), `1: VERSION.txt names commit ${opt('commit')}`, versionTxt);
    check(fs.existsSync(path.join(data, dirs[0], `.in-use-${first.child.pid}`)), '1: the start marks its folder as in use');
    check(!fs.existsSync(old) && !fs.existsSync(part) && fs.existsSync(kept), '1: older builds removed, the one a live start marks kept', JSON.stringify(fs.readdirSync(data)));
    check(!fs.readdirSync(os.tmpdir()).some((n) => n.includes(dirs[0])), '1: nothing unpacked into %TEMP%');
    await sleep(1500);
    const op1 = opened();
    check(op1.length === 1 && op1[0].port === port && op1[0].answered, '1: the page opened once, after the runner answered', JSON.stringify(op1));
    const page = await fetch(`http://127.0.0.1:${port}/`);
    check(page.status === 200 && (await page.text()).includes('bundle.'), '1: the page is served');
    const version = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json();
    check(typeof version.runner === 'string' && typeof version.engine === 'string', '1: /api/version answers', JSON.stringify(version));
    save('one-file-first-start.txt', o1);

    // (2) Second start on the same port.
    const s2 = await start([String(port)]);
    const c2 = await s2.exited, o2 = s2.out();
    check(c2 === 3 && o2.includes('The What-if runner is already running') && o2.includes('Nothing was started: the runner was already running. Use the page that just opened, and close this window.'), '2: second start: exit 3 and its message', `${c2} ${o2}`);
    await sleep(1500);
    check(opened().length === 2 && opened()[1].port === port && opened()[1].answered, '2: the page opened on the running runner', JSON.stringify(opened()));
    save('one-file-second-start.txt', o2);

    // (3) A runner of another version on the port.
    const other = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ runner: '0.0.1', engine: 'feedbeef' })); });
    const p3 = await freePort(); await new Promise((r) => other.listen(p3, '127.0.0.1', r));
    const s3 = await start([String(p3)]);
    const c3 = await s3.exited, o3 = s3.out();
    other.close();
    check(c3 === 4 && o3.includes('runner 0.0.1, engine feedbeef') && o3.includes(`Nothing was started: a runner of another version is already running on port ${p3}.`), '3: another version: exit 4 and its message', `${c3} ${o3}`);
    await sleep(1000);
    check(opened().length === 2, '3: nothing opened');

    // (4) Another program on the port.
    const stranger = http.createServer((q, s) => { s.writeHead(404); s.end('no'); });
    const p4 = await freePort(); await new Promise((r) => stranger.listen(p4, '127.0.0.1', r));
    const s4 = await start([String(p4)]);
    const c4 = await s4.exited, o4 = s4.out();
    stranger.close();
    check(c4 === 1 && o4.includes(`EADDRINUSE: port ${p4} is used by another program`) && o4.includes('The runner stopped.') && o4.includes('WhatIfRunner.exe 8788'), '4: port taken by another program: exit 1, EADDRINUSE and the hint', `${c4} ${o4}`);
    await sleep(1000);
    check(opened().length === 2, '4: nothing opened');
    save('one-file-port-taken.txt', o4);

    // (6) A short real search through the first start.
    const req = {
        setups: ['Alpha', 'Beta'].map((name, i) => ({ name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
            player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
                { itemLocationHrid: '/item_locations/main_hand', itemHrid: i ? '/items/cheese_mace' : '/items/cheese_sword', enhancementLevel: 0 },
                { itemLocationHrid: '/item_locations/head', itemHrid: '/items/cheese_helmet', enhancementLevel: 0 }] },
            abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] } })),
        options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, prices: 'marketplace-2026-11-03.json' },
        goal: 'profit', budgets: { Alpha: 1e9, Beta: 0 }, levers: ['equip'], stages: ['4x2', '4x2'], keep: [4], maxUp: 2, swaps: false, z: 0,
    };
    const st = await (await fetch(`http://127.0.0.1:${port}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })).json();
    let r = null; const ts = Date.now();
    while (Date.now() - ts < 600000) { r = await (await fetch(`http://127.0.0.1:${port}/api/search/${st.id}`)).json(); if (r.state !== 'running') break; await sleep(1000); }
    check(r?.state === 'done' && r.result && Array.isArray(r.result.steps), '6: a short real search finishes (optimizer and run workers forked from the exe)', JSON.stringify({ state: r?.state, error: r?.error }));
    console.log(`     search: ${((Date.now() - ts) / 1000).toFixed(0)} s`);

    killTree(first.child.pid); await first.exited; first = null;

    // (5) No write access to the data folder (a fresh home, so nothing is unpacked yet).
    const home5 = path.join(work, 'home5'), data5 = path.join(home5, 'MWI-WhatIf');
    fs.mkdirSync(data5, { recursive: true });
    const user = `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${os.userInfo().username}`;
    execFileSync('icacls', [data5, '/deny', `${user}:(OI)(CI)(W,D,DC)`], { stdio: 'ignore', windowsHide: true });
    try {
        const s5 = await start([String(await freePort())], { USERPROFILE: home5, HOME: home5 });
        const c5 = await s5.exited, o5 = s5.out();
        const closing = o5.split(/\r?\n/).filter((l) => l.trim() && !/What-if runner\. Leave|Closing this window/.test(l));
        check(c5 === 1 && closing.length === 1 && /^ The runner could not unpack its files into .+ \(E[A-Z]+\)\. It needs write access to .+MWI-WhatIf\.$/.test(closing[0]), '5: no write access: exit 1 and one line', `${c5} ${JSON.stringify(closing)}`);
        console.log('     ' + closing[0]?.trim());
    } finally { execFileSync('icacls', [data5, '/remove:d', user], { stdio: 'ignore', windowsHide: true }); }
} finally {
    if (first) { killTree(first.child.pid); await first.exited; }
    await sleep(500);
    try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { console.log('note: could not remove', work, e.message); }
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
