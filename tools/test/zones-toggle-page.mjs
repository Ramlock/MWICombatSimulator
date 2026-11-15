// Test: the "Planets only" toggle of the zone pickers (the built page, dist/, in our own headless Chrome).
// On by default (11 zones listed), off lists every zone, the state survives a reload, the What-if window's picker and checkbox follow
// the page's (one state), and a selected zone the toggle would hide stays listed until another is picked.
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts. The What-if window is served by a stand-in runner.
// Usage: node tools/test/zones-toggle-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves dark Full HD pictures
// of the pickers (shown as an open list) in English, Portuguese and Chinese.
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/version') return json(res, { runner: 'test-runner', engine: 'test-engine' });
    if (url.pathname === '/api/results') return json(res, []);
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (url.pathname.startsWith('/api/') || !file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'zones-toggle-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await sleep(200); } return false; };
    const load = async (query = '') => { await page.send('Page.navigate', { url: base + query }); const ok = await until(`document.getElementById('selectZone')?.options.length > 3 && document.getElementById('buttonWhatIf')?.style.display === ''`); await sleep(600); return ok; };
    // The options a user can see in a picker (not hidden), after the picker is focused as when it is opened.
    const shown = (id) => js(`(() => { const s = document.getElementById('${id}'); s.dispatchEvent(new Event('focus')); return [...s.options].filter((o) => !o.hidden).map((o) => o.value); })()`);
    const all = (id) => js(`document.getElementById('${id}').options.length`);
    const toggle = (id) => js(`document.getElementById('${id}')`) && js(`(() => { const t = document.getElementById('${id}'); if (!t) return false; t.click(); return true; })()`);
    const checked = (id) => js(`document.getElementById('${id}')?.checked`);
    const pick = (id, value) => js(`(() => { const s = document.getElementById('${id}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return s.value; })()`);
    const openWhatIf = async () => { await js(`document.getElementById('buttonWhatIf').click(), true`); await until(`document.getElementById('selectWhatIfZone')?.options.length > 3`); await sleep(500); };
    const closeWhatIf = async () => { await js(`(() => { const m = bootstrap.Modal.getInstance(document.getElementById('whatIfModal')); if (m) m.hide(); return true; })()`); await sleep(700); };

    check('the page loads', await load());
    const total = await all('selectZone');
    let list = await shown('selectZone');
    check('default: the toggle is on', await checked('planetsOnlyToggle') === true);
    check('default: 11 zones listed', list.length === 11, String(list.length));
    const nonPlanet = await js(`[...document.getElementById('selectZone').options].find((o) => o.hidden)?.value || ''`);
    check('a zone that is not a planet exists', !!nonPlanet);

    await toggle('planetsOnlyToggle');
    list = await shown('selectZone');
    check('off: every zone listed', list.length === total && total > 11, `${list.length} of ${total}`);
    check('off is kept in the browser', await js(`localStorage.getItem('zonesPlanetsOnly')`) === '0');
    check('reload: off survives', await load() && await checked('planetsOnlyToggle') === false && (await shown('selectZone')).length === total);

    // Pick a non-planet with the toggle off, then turn it on: it stays, selected, until another is picked.
    await pick('selectZone', nonPlanet);
    await toggle('planetsOnlyToggle');
    list = await shown('selectZone');
    check('on with a non-planet selected: it stays listed and selected', list.length === 12 && list.includes(nonPlanet) && await js(`document.getElementById('selectZone').value`) === nonPlanet, String(list.length));
    const planet = list.find((v) => v !== nonPlanet);
    await pick('selectZone', planet);
    list = await shown('selectZone');
    check('another picked: the non-planet goes', list.length === 11 && !list.includes(nonPlanet), String(list.length));
    check('reload: on survives', await load() && await checked('planetsOnlyToggle') === true && (await shown('selectZone')).length === 11);

    // A load or an import sets the zone without a change event: it is listed when the picker opens.
    await js(`(document.getElementById('selectZone').value = ${JSON.stringify(nonPlanet)}, true)`);
    list = await shown('selectZone');
    check('a zone set by a load stays listed', list.includes(nonPlanet) && await js(`document.getElementById('selectZone').value`) === nonPlanet);
    await pick('selectZone', planet);

    // What-if window: same state, both ways.
    await openWhatIf();
    check('What-if: its checkbox is on', await checked('whatIfPlanetsOnlyToggle') === true);
    check('What-if: 11 zones listed', (await shown('selectWhatIfZone')).length === 11);
    await toggle('whatIfPlanetsOnlyToggle');
    check('What-if off: every zone listed there', (await shown('selectWhatIfZone')).length === total);
    check('What-if off: the page checkbox and picker follow', await checked('planetsOnlyToggle') === false && (await shown('selectZone')).length === total);
    await toggle('whatIfPlanetsOnlyToggle');
    check('What-if on again: both lists back to 11', (await shown('selectWhatIfZone')).length === 11 && (await shown('selectZone')).length === 11);
    await closeWhatIf();

    if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        const picture = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        // A native select's open list is not drawn in a headless screenshot, so the list is shown in place (size = its shown options).
        const openList = (id) => js(`(() => { const s = document.getElementById('${id}'); s.dispatchEvent(new Event('focus')); s.size = [...s.options].filter((o) => !o.hidden).length; return true; })()`);
        const closeList = (id) => js(`(document.getElementById('${id}').size = 0, true)`);
        const openSettings = async () => { await js(`bootstrap.Modal.getOrCreateInstance(document.getElementById('startSimulationModal')).show(), true`); await sleep(800); };
        const closeSettings = async () => { await js(`bootstrap.Modal.getOrCreateInstance(document.getElementById('startSimulationModal')).hide(), true`); await sleep(700); };
        await openSettings(); await openList('selectZone'); await picture('zones-planets-only.png'); await closeList('selectZone');
        await toggle('planetsOnlyToggle'); await openList('selectZone'); await picture('zones-all.png'); await closeList('selectZone');
        await toggle('planetsOnlyToggle'); await closeSettings();
        await openWhatIf(); await openList('selectWhatIfZone'); await picture('whatif-zones-planets-only.png'); await closeList('selectWhatIfZone'); await closeWhatIf();
        for (const lng of ['pt', 'zh']) {
            await load('?lng=' + lng); await sleep(800);
            await openSettings(); await openList('selectZone'); await picture(`zones-planets-only-${lng}.png`); await closeList('selectZone'); await closeSettings();
        }
    }
    page.close();
} finally {
    await chrome.close();
    server.close();
}
process.exit(failed ? 1 : 0);
