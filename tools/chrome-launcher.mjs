// Launches a headless Chrome that this process owns and connects to it over the DevTools protocol, and to nothing else.
// Why: a fixed --remote-debugging-port can already be held by another app (Electron apps such as chat clients listen on
// one), and a script that connects to "whatever answers on the port" then drives that app instead of its own browser.
// So: --remote-debugging-port=0 (Chrome picks a free port), a fresh --user-data-dir, the port read from that directory's
// DevToolsActivePort file, and before any command a check that the listener on that port is the process we spawned.
//
// Usage:
//   import { launchChrome } from './chrome-launcher.mjs';
//   const chrome = await launchChrome({ userDataDir: '<a new folder>' });
//   const page = await chrome.newPage();            // CDP session on a new tab of our own browser
//   await page.send('Page.navigate', { url });  ...  await chrome.close();
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const DEFAULT_CHROME = process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ports this process launched a browser on. connect() refuses any other.
const ownedPorts = new Map(); // port -> pid

export function assertOwnedPort(port) {
    if (!ownedPorts.has(Number(port))) throw new Error(`refused: port ${port} was not opened by a browser this process launched`);
    return ownedPorts.get(Number(port));
}

// DevToolsActivePort: line 1 the port, line 2 the browser target path (/devtools/browser/<id>).
export function parseDevToolsActivePort(text) {
    const [portLine, pathLine] = String(text).split(/\r?\n/);
    const port = Number(portLine);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^\/devtools\/browser\//.test(pathLine ?? '')) throw new Error('bad DevToolsActivePort: ' + JSON.stringify(text));
    return { port, browserPath: pathLine.trim() };
}

// The pids listening on 127.0.0.1:<port> (or [::1]:<port>), from `netstat -ano` (Windows) or `ss -ltnp` (Linux) output.
export function listeningPids(netstatText, port) {
    const pids = new Set();
    for (const line of String(netstatText).split(/\r?\n/)) {
        const win = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (win && Number(win[2]) === port) pids.add(Number(win[3]));
        const lin = line.match(/LISTEN\s+\d+\s+\d+\s+(\S+):(\d+)\s.*pid=(\d+)/);
        if (lin && Number(lin[2]) === port) pids.add(Number(lin[3]));
    }
    return pids;
}

// Throws unless every listener on the port is the browser we spawned.
export function assertListenerIsOurs(netstatText, port, pid) {
    const pids = listeningPids(netstatText, port);
    if (pids.size === 0) throw new Error(`refused: nothing listens on port ${port}`);
    for (const p of pids) if (p !== pid) throw new Error(`refused: port ${port} is held by pid ${p}, not by the launched browser ${pid}`);
}

const netstat = () => process.platform === 'win32'
    ? execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }) + execFileSync('netstat', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8' })
    : execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });

// A minimal CDP client over one WebSocket.
function cdpSocket(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let id = 0;
        const pending = new Map();
        ws.addEventListener('message', (m) => {
            const d = JSON.parse(m.data);
            if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
        });
        ws.addEventListener('error', reject);
        ws.addEventListener('open', () => resolve({
            send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
            close: () => ws.close(),
        }));
    });
}

export async function launchChrome({ userDataDir, chromePath = DEFAULT_CHROME, width = 1600, height = 1100, extraArgs = [], timeoutMs = 20000 } = {}) {
    if (!userDataDir) throw new Error('userDataDir is required (a new folder of your own)');
    if (fs.existsSync(userDataDir) && fs.readdirSync(userDataDir).length) throw new Error(`userDataDir ${userDataDir} is not empty: use a fresh one`);
    fs.mkdirSync(userDataDir, { recursive: true });
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const child = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, `--window-size=${width},${height}`,
        ...extraArgs, 'about:blank'], { stdio: 'ignore' });
    const kill = () => { try { process.platform === 'win32' ? execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) : child.kill('SIGKILL'); } catch {} };
    try {
        const t0 = Date.now();
        while (!fs.existsSync(portFile)) { if (Date.now() - t0 > timeoutMs) throw new Error('Chrome wrote no DevToolsActivePort'); if (child.exitCode !== null) throw new Error('Chrome exited, code ' + child.exitCode); await sleep(100); }
        await sleep(100);
        const { port, browserPath } = parseDevToolsActivePort(fs.readFileSync(portFile, 'utf8'));
        assertListenerIsOurs(netstat(), port, child.pid);
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        if (version.webSocketDebuggerUrl !== `ws://127.0.0.1:${port}${browserPath}`) throw new Error(`refused: /json/version on port ${port} names ${version.webSocketDebuggerUrl}, not this launch's ${browserPath}`);
        ownedPorts.set(port, child.pid);
        return {
            port, pid: child.pid,
            async newPage() {
                assertOwnedPort(port);
                const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
                if (!String(target.webSocketDebuggerUrl).startsWith(`ws://127.0.0.1:${port}/`)) throw new Error('refused: new target is not on our port');
                const page = await cdpSocket(target.webSocketDebuggerUrl);
                await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
                return page;
            },
            async close() { ownedPorts.delete(port); kill(); },
        };
    } catch (e) { kill(); throw e; }
}
