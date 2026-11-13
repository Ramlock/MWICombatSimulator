// Test: the What-if button on a page with no runner (the public site) opens the window in its "get the runner" state:
// why, the download link (the one constant in src/whatif/runnerDownload.mjs), four steps, in en, pt and zh; the search
// controls are hidden. On a page a runner serves (a fake /api/version) the same window shows the search and no download pane.
// The built page (dist/) in our own headless Chrome. Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/whatif-get-runner-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves a dark Full HD picture.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../chrome-launcher.mjs';
import { RUNNER_DOWNLOAD_URL } from '../../src/whatif/runnerDownload.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const locales = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, 'locales', l, 'common.json'), 'utf8')).whatIf]));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
let runnerUp = false;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
        if (!runnerUp) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(url.pathname === '/api/version' ? JSON.stringify({ runner: '0.0.0', engine: 'test' }) : '[]');
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'get-runner-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await sleep(150); } return false; };
    const load = async (query = '') => { await page.send('Page.navigate', { url: base + query }); return until(`document.getElementById('selectZone')?.options.length > 3`, 30000); };
    const visible = (id) => js(`(() => { const e = document.getElementById('${id}'); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; })()`);
    const text = (sel) => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`);
    const open = async () => { await js(`document.getElementById('buttonWhatIf').click(), true`); return until(`document.getElementById('whatIfModal').classList.contains('show')`); };
    const closeModal = async () => { await js(`document.querySelector('#whatIfModal .btn-close').click(), true`); return until(`!document.getElementById('whatIfModal').classList.contains('show')`); };

    // ---- No runner ----
    check('no runner: the page loads', await load());
    check('no runner: the What-if button is shown', await until(`document.getElementById('buttonWhatIf').style.display === ''`));
    if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await js(`window.scrollTo(0, 0), document.getElementById('buttonWhatIf').scrollIntoView({ block: 'center' }), true`); await sleep(500);
        fs.writeFileSync(path.join(shots, 'whatif-get-runner-button.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    check('no runner: the button opens the window', await open());
    check('no runner: the get-the-runner pane is shown, the search controls are not', (await visible('whatIfGetRunner')) && !(await visible('buttonWhatIfStart')) && !(await visible('whatIfPlayers')) && !(await visible('selectWhatIfGoal')));
    check('no runner: the download link is the one constant', (await js(`document.getElementById('linkWhatIfRunner').href`)) === RUNNER_DOWNLOAD_URL && (await visible('linkWhatIfRunner')), await js(`document.getElementById('linkWhatIfRunner').href`));
    check('no runner: the link opens in a new tab without leaking the page', (await js(`document.getElementById('linkWhatIfRunner').target + ' ' + document.getElementById('linkWhatIfRunner').rel`)) === '_blank noopener');
    const winPart = '#whatIfGetRunner > p:not(:has(a)), #whatIfGetRunner > ol > li';
    const linuxPart = '#whatIfGetRunnerLinux > h6, #whatIfGetRunnerLinux > ol > li, #whatIfGetRunnerLinux > p:not(:has(a))';
    const linuxKeys = ['linuxHeading', 'linuxStep1', 'linuxStep2', 'linuxStep3', 'linuxStep4', 'linuxReport'];
    const linuxOk = async (l) => { const t = await text(linuxPart); return t.length === 6 && linuxKeys.every((k, i) => t[i] === locales[l].get[k]); };
    const paras = await text(winPart);
    check('no runner: one paragraph and the four steps, in English', paras.length === 5 && paras[0] === locales.en.get.why && [1, 2, 3, 4].every((i) => paras[i] === locales.en.get['step' + i]), JSON.stringify(paras));
    check('no runner: the link reads in English', (await text('#linkWhatIfRunner'))[0] === locales.en.get.download);
    check('no runner: the Linux part follows the Windows steps: heading, four steps, report line, in English', await linuxOk('en') && await js(`document.getElementById('whatIfGetRunner').children[3].id === 'whatIfGetRunnerLinux'`) && (await text('#whatIfGetRunnerLinux > h6'))[0].startsWith('Linux (not tested yet'));
    check('no runner: the Linux link is the same constant, new tab, no leak', (await js(`document.getElementById('linkWhatIfRunnerLinux').href`)) === RUNNER_DOWNLOAD_URL && (await js(`document.getElementById('linkWhatIfRunnerLinux').target + ' ' + document.getElementById('linkWhatIfRunnerLinux').rel`)) === '_blank noopener' && (await visible('linkWhatIfRunnerLinux')));
    check('no runner: no runner version in the header', (await text('#whatIfVersion'))[0] === '');
    check('no runner: no horizontal scroll inside the window', await js(`(() => { const b = document.querySelector('#whatIfModal .modal-body'); return b.scrollWidth <= b.clientWidth; })()`));
    check('no runner: the page is dark', await js(`document.body.classList.contains('dark-mode')`));
    if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await sleep(1200);
        fs.writeFileSync(path.join(shots, 'whatif-get-runner-en.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    check('no runner: the window closes', await closeModal());

    // ---- The page's own language flow: ?lng= ----
    for (const l of ['pt', 'zh']) {
        check(`${l}: the page loads`, await load('?lng=' + l));
        check(`${l}: the window opens`, await until(`document.getElementById('buttonWhatIf').style.display === ''`) && await open());
        const p = await text(winPart);
        check(`${l}: the paragraph and the four steps are the ${l} strings, none left in English`, p.length === 5 && p[0] === locales[l].get.why && [1, 2, 3, 4].every((i) => p[i] === locales[l].get['step' + i]) && locales[l].get.why !== locales.en.get.why, JSON.stringify(p));
        check(`${l}: the link reads in ${l}`, (await text('#linkWhatIfRunner'))[0] === locales[l].get.download);
        check(`${l}: the Linux part is the ${l} strings, none left in English`, await linuxOk(l) && locales[l].get.linuxHeading !== locales.en.get.linuxHeading && (await text('#linkWhatIfRunnerLinux'))[0] === locales[l].get.linuxDownload);
        if (shots) { await sleep(1200); fs.writeFileSync(path.join(shots, `whatif-get-runner-${l}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
        await closeModal();
    }

    // ---- A runner answers ----
    runnerUp = true;
    check('runner: the page loads', await load());
    check('runner: the button is shown', await until(`document.getElementById('buttonWhatIf').style.display === ''`));
    check('runner: the window shows the search, no download pane', await open() && await until(`document.getElementById('whatIfVersion').textContent.includes('0.0.0')`) && (await visible('buttonWhatIfStart')) && !(await visible('whatIfGetRunner')) && !(await js(`document.getElementById('whatIfModal').classList.contains('whatif-norunner')`)));
    await closeModal();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
