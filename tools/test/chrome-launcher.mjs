// Test: tools/chrome-launcher.mjs refuses any browser it did not launch.
// Usage: node tools/test/chrome-launcher.mjs [--live]   (--live also launches a real headless Chrome)   Exit code 0 on pass.
import { assertOwnedPort, assertListenerIsOurs, listeningPids, parseDevToolsActivePort, launchChrome } from '../chrome-launcher.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const failures = [];
const throws = (name, fn) => { try { fn(); failures.push(name + ': did not refuse'); } catch {} };
const ok = (name, fn) => { try { fn(); } catch (e) { failures.push(name + ': ' + e.message); } };

// A port this process did not launch on is refused, whatever listens there.
throws('unlaunched port 9333', () => assertOwnedPort(9333));
throws('unlaunched port 9222', () => assertOwnedPort(9222));

// The listener check: another app on the port (127.0.0.1 or [::1]) is refused; only our own pid passes.
const netstat = [
    '  TCP    127.0.0.1:9333         0.0.0.0:0              LISTENING       4242',
    '  TCP    [::1]:9333             [::]:0                 LISTENING       5151',
    '  TCP    127.0.0.1:51234        0.0.0.0:0              LISTENING       5151',
].join('\r\n');
throws('port held by another app', () => assertListenerIsOurs(netstat, 9333, 5151));
throws('nothing listening', () => assertListenerIsOurs(netstat, 40000, 5151));
ok('our own port', () => assertListenerIsOurs(netstat, 51234, 5151));
ok('both stacks seen', () => { if (listeningPids(netstat, 9333).size !== 2) throw new Error('expected 2 listeners'); });

ok('DevToolsActivePort parsed', () => { const r = parseDevToolsActivePort('51234\n/devtools/browser/abc-123'); if (r.port !== 51234) throw new Error('port'); });
throws('bad DevToolsActivePort', () => parseDevToolsActivePort('9333\n'));

if (process.argv.includes('--live')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-launcher-test-'));
    try {
        const chrome = await launchChrome({ userDataDir: path.join(dir, 'profile') });
        if (chrome.port === 9333) failures.push('live: got the fixed port 9333');
        ok('live: own port accepted', () => assertOwnedPort(chrome.port));
        const page = await chrome.newPage();
        const r = await page.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
        if (r.result.value !== 2) failures.push('live: evaluate');
        // A page alert must not block the next command; it is accepted and logged.
        await page.send('Runtime.evaluate', { expression: "setTimeout(() => alert('dialog-check'), 0); 0" });
        await new Promise((res) => setTimeout(res, 300));
        const after = await page.send('Runtime.evaluate', { expression: '2+2', returnByValue: true }, 5000);
        if (after.result.value !== 4) failures.push('live: command after a dialog');
        if (!page.dialogs.includes('alert: dialog-check')) failures.push('live: dialog not logged: ' + JSON.stringify(page.dialogs));
        page.close();
        await chrome.close();
        throws('live: port refused after close', () => assertOwnedPort(chrome.port));
    } catch (e) { failures.push('live: ' + e.message); }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

if (failures.length) { console.log(failures.join('\n')); console.log(`FAIL ${failures.length}`); process.exit(1); }
console.log('PASS: refuses ports it did not launch and listeners that are not its own browser' + (process.argv.includes('--live') ? '; live launch on its own port' : ''));
