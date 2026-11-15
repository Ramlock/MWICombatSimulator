// Test: the top-right controls (Dark Mode, ISO numbers, language) never sit on the page's content at 1920x1080, scrolled or not: they scroll
// with the page (index.html #topRightControls, position absolute), so at the top they are in their own row and scrolled they leave the screen.
// Needs a built dist/ (npx webpack). Usage: node tools/test/top-bar-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail.
// --shots saves dark Full HD pictures, scrolled, in en, pt and zh (page3-top-bar-<lang>.png).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'top-bar-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (e, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(e)) return true; await sleep(200); } return false; };
    // The visible text elements (leaf elements with text) outside the bar whose box crosses the bar's box, as "tag: text".
    const overlaps = () => js(`(() => {
        const bar = document.getElementById('topRightControls'), b = bar.getBoundingClientRect(), out = [];
        for (const el of document.body.querySelectorAll('*')) {
            if (bar.contains(el) || el.children.length || !el.textContent.trim() || !el.offsetParent) continue;
            const r = el.getBoundingClientRect();
            if (r.width && r.height && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) out.push(el.tagName + ': ' + el.textContent.trim().slice(0, 30));
        }
        return out;
    })()`);
    for (const lang of ['en', 'pt', 'zh']) {
        await page.send('Page.navigate', { url: base + '?lng=' + lang });
        check(`${lang}: the page loads`, await until(`document.getElementById('selectZone')?.options.length > 3`)); await sleep(800);
        check(`${lang}: the bar scrolls with the page (not fixed)`, await js(`getComputedStyle(document.getElementById('topRightControls')).position`) !== 'fixed');
        let o = await overlaps();
        check(`${lang}: nothing under the bar at the top`, o.length === 0, JSON.stringify(o));
        await js(`(window.scrollTo(0, 700), true)`); await sleep(300);
        o = await overlaps();
        check(`${lang}: nothing under the bar scrolled`, o.length === 0, JSON.stringify(o));
        check(`${lang}: one scroll axis (no horizontal overflow)`, await js(`document.documentElement.scrollWidth <= window.innerWidth`));
        if (shots) {
            fs.mkdirSync(shots, { recursive: true });
            const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(shots, `page3-top-bar-${lang}.png`), Buffer.from(data, 'base64'));
        }
    }
} finally { await chrome.close(); server.close(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { } }
process.exit(failed ? 1 : 0);
