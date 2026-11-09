// Test: the What-if window in the built page (dist/), driven in our own headless Chrome against a fake runner that
// implements the runner's interface (docs/codebase/whatif-window.md): the button shows only when /api/version answers,
// the window sends the page's party, budgets and levers, shows progress, Stop and Resume, shows the result, and Apply
// writes into the page's setup (a player the page lacks is named, nothing applied).
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/whatif-window.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves dark pictures.
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

// ---- The fake runner ----
const result = {
    goal: 'profit', budgets: { 'Player 1': 1000000 },
    setups: [],
    steps: [
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', gain: 900, se: 100, gainPerUser: 900, sePerUser: 100, cost: 250000, payback: 277.8, accepted: true, runningSpend: { 'Player 1': 250000 }, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 's2', player: 'Player 1', desc: 'Stamina 1 → 2', gain: 400, se: 90, gainPerUser: 400, sePerUser: 90, cost: 300000, costBound: 'upper', payback: 750, accepted: true, runningSpend: { 'Player 1': 550000 }, ops: [{ op: 'level', player: 'Player 1', skill: 'stamina', delta: 1 }] },
    ],
    confirmation: { gain: 1250, se: 140, gainPerUser: 1250, sePerUser: 140, cost: 550000, payback: 440 },
    singles: [
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', lastStage: '8x300', gain: 900, se: 100, gainPerUser: 900, sePerUser: 100, cost: 250000, payback: 277.8, costPath: 'days of play', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 'x', player: 'Nobody', desc: 'Attack 1 → 2', lastStage: '4x50', gain: 10, se: 80, gainPerUser: 10, sePerUser: 80, cost: 100000, payback: null, costPath: 'days of play', accepted: false, ops: [{ op: 'level', player: 'Nobody', skill: 'attack', delta: 1 }] },
    ],
    apart: [{ id: 'u', desc: 'A token item', note: 'no seller' }],
    overBudget: [{ id: 'o', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', cost: 7000000000, costPath: 'market' }, { id: 'o2', player: 'Player 1', desc: 'Player 1 not_a_real_item_x +1 -> +2', cost: 8000000000, costPath: 'market' }],
    options: { pricesTimestamp: 1700000000, pricesSource: 'snapshot', zone: '/actions/combat/fly', tier: 0 },
    basePerUser: -9666666.67,
};
let search = null, received = null, polls = 0;
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/version') return send(res, 200, { runner: 'test-runner', engine: 'test-engine' });
    if (url.pathname === '/api/search' && req.method === 'POST') {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
            if (search && search.state === 'running') return send(res, 409, { error: 'a search is running', id: search.id });
            received = JSON.parse(data);
            result.setups = received.setups;
            search = { id: 'search-1', state: 'running' };
            polls = 0;
            send(res, 200, { id: search.id });
        });
        return;
    }
    const m = url.pathname.match(/^\/api\/search\/([^/]+)(\/stop)?$/);
    if (m && search && m[1] === search.id) {
        if (m[2] && req.method === 'POST') { search.state = search.state === 'running' ? 'stopped' : 'running'; return send(res, 200, { state: search.state, progress: progress() }); }
        if (search.state === 'running' && ++polls >= 3 && !holdRunning) search.state = 'done';
        return send(res, 200, { state: search.state, progress: progress(), ...(search.state === 'done' ? { result } : {}) });
    }
    if (url.pathname === '/api/results') return send(res, 200, search?.state === 'done' ? [{ id: search.id, finished: '2026-01-01 12:00', goal: 'profit', players: ['Player 1'] }] : []);
    if (url.pathname.startsWith('/api/results/')) return send(res, 200, result);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
let holdRunning = true;
const progress = () => ({ stage: 'screen', candidatesLeft: 40, runsDone: 12, runsPlanned: 48, secondsPerRun: 2.5, etaSeconds: 90 });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- The page ----
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-window-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1600, height: 1200 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    const shot = async (id, name) => {
        if (!shots) return;
        fs.mkdirSync(shots, { recursive: true });
        const [x, y, width, height] = await js(`(() => { const b = document.querySelector('#${id} .modal-content').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.writeFileSync(path.join(shots, name), Buffer.from(s.data, 'base64'));
    };

    await page.send('Page.navigate', { url: base });
    check('the What-if button shows when the runner answers', await until(`document.getElementById('buttonWhatIf')?.style.display === ''`));
    check('the page is dark by default', await js(`document.body.classList.contains('dark-mode')`));
    await js(`(() => { const c = document.getElementById('player1'); if (!c.checked) c.click(); return true; })()`);
    await js(`document.getElementById('buttonWhatIf').click(), true`);
    check('the window opens with a budget per ticked player', await until(`!!document.querySelector('#whatIfBudgets input[data-player="Player 1"]')`));
    check('the window lists the levers, equipment ticked', await js(`document.querySelectorAll('#whatIfLevers input').length === 11 && document.getElementById('whatIfLever_equip').checked && !document.getElementById('whatIfLever_houses').checked`));
    check('the runner version is shown', await js(`document.getElementById('whatIfVersion').textContent.includes('test-runner')`));
    await js(`(() => { const i = document.querySelector('#whatIfBudgets input'); i.value = 'abc'; return true; })()`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('a budget that is not a number is refused', await until(`document.getElementById('whatIfMessage').textContent.includes('Player 1')`) && received === null);
    await js(`(() => { document.querySelector('#whatIfBudgets input').value = '1000000'; document.getElementById('whatIfLever_houses').click(); return true; })()`);
    // The market snapshot: the page's fetch of marketplace.json is answered here (no network for it in the test).
    await js(`(() => { const f = window.fetch; window.__mpCalls = 0; window.fetch = (u, o) => { if (!String(u).includes('marketplace.json')) return f(u, o); window.__mpCalls++;
        return window.__mpFail ? Promise.reject(new Error('offline')) : Promise.resolve(new Response(JSON.stringify({ marketData: { '/items/apple': { 0: { a: 10, b: 9 } } }, timestamp: 1700000000 }), { status: 200 })); }; window.__mpFail = true; return true; })()`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('a failed price fetch starts no search and says so', await until(`document.getElementById('whatIfMessage').textContent.includes('could not be fetched')`) && received === null && (await js('window.__mpCalls')) >= 1);
    await js(`(window.__mpFail = false, true)`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('progress is shown while it runs', await until(`document.getElementById('whatIfProgress').textContent.includes('candidates left')`));
    check('the request carries the party, budgets, levers, zone and tier', received && received.setups.length >= 1 && received.setups.some((s) => s.name === 'Player 1' && s.player) &&
        received.budgets['Player 1'] === 1000000 && received.levers.join() === 'equip,houses' && received.goal === 'profit' && typeof received.options.tier === 'number' && !!received.options.zone, JSON.stringify(received)?.slice(0, 300));
    check('the request carries the market snapshot the page fetched', received?.options?.marketplace?.timestamp === 1700000000 && !!received.options.marketplace.marketData['/items/apple']);
    check('the progress bar has a dark track and a fill of its own in dark mode', await js(`(() => { const p = document.querySelector('#whatIfProgress .whatif-progress'); const lum = (c) => c.match(/[0-9]+/g).slice(0, 3).reduce((a, x) => a + Number(x), 0); const t = getComputedStyle(p).backgroundColor, b = getComputedStyle(p.querySelector('.progress-bar')).backgroundColor; return lum(t) < 150 && t !== b && getComputedStyle(p).borderTopWidth !== '0px'; })()`));
    await shot('whatIfModal', 'whatif-progress.png');
    await js(`document.getElementById('buttonWhatIfStop').click(), true`);
    check('Stop stops it and offers Resume', await until(`document.getElementById('buttonWhatIfStop').textContent === 'Resume'`) && search.state === 'stopped');
    holdRunning = false;
    await js(`document.getElementById('buttonWhatIfStop').click(), true`);
    check('Resume runs it to the end and the result shows', await until(`document.getElementById('whatIfResult').textContent.includes('Apply 1 to 2')`));
    check('the result shows "≤" and the unknown-cost list', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('≤') && t.includes('A token item'); })()`));
    check('the result shows the snapshot time and the priced over-budget group', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('market snapshot of 2023-11-14 22:13 UTC') && t.includes('Priced, over budget') && t.includes('Feet Pathseeker Boots ★ +12 -> Cotton Boots +0'); })()`));
    check('the earlier searches list fills', await until(`document.getElementById('selectWhatIfResult').options.length === 1`));
    await shot('whatIfModal', 'whatif-result.png');
    const before = await js(`[document.getElementById('inputLevel_magic').value, document.getElementById('inputLevel_stamina').value]`);
    await js(`document.querySelector('[data-whatif-apply="steps:2"]').click(), true`);
    const after = await js(`[document.getElementById('inputLevel_magic').value, document.getElementById('inputLevel_stamina').value]`);
    check('Apply 1 to 2 writes both steps into the setup', Number(after[0]) === Number(before[0]) + 1 && Number(after[1]) === Number(before[1]) + 1, JSON.stringify({ before, after }));
    check('the window now lists where the page differs from the search, with the skill\'s name, not the field key', await js(`(() => { const t = document.getElementById('whatIfDiff').textContent; return t.includes('Magic level:') && !t.includes('magicLevel'); })()`));
    check('grey singles are collapsed behind "Show 1 more below 2 errors"', await js(`document.querySelector('#whatIfResult .whatif-more').hidden && document.querySelector('[data-whatif-more]').textContent === 'Show 1 more below 2 errors'`));
    await js(`document.querySelector('[data-whatif-more]').click(), true`);
    check('the toggle opens the grey rows', await js(`!document.querySelector('#whatIfResult .whatif-more').hidden && document.querySelector('[data-whatif-more]').textContent === 'Hide the 1 below 2 errors'`));
    check('the finished result shows the zone line and the loss warning under the goal line', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('Zone: Fly, tier 0 · base party profit') && t.includes('At this zone the party loses money at base, so a gain here means losing less.'); })()`));
    check('the over-budget list is closed behind one toggle with its count, and shows game names, not ids', await js(`(() => { const ul = document.getElementById('whatIfOverBudget'); const b = document.querySelector('[data-whatif-more="whatIfOverBudget"]'); return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show the 2 priced over budget' && ul.textContent.includes('Feet Pathseeker Boots ★ +12 -> Cotton Boots +0') && !ul.textContent.includes('pathseeker_boots_refined') && ul.textContent.includes('not_a_real_item_x') && ul.children[0].textContent.startsWith('Player 1, Feet Pathseeker') && ul.children[1].textContent.startsWith('Player 1, not_a_real_item_x'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('the toggle opens the over-budget list without touching the grey rows', await js(`!document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Hide the 2 priced over budget' && !document.getElementById('whatIfMoreSingles').hidden`));
    await shot('whatIfModal', 'whatif-over-budget-open.png');
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('a second click closes it again', await js(`document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Show the 2 priced over budget'`));
    await js(`i18next.changeLanguage('pt').then(() => true)`);
    check('in Portuguese the names follow the language and the list is closed again', await until(`(() => { const ul = document.getElementById('whatIfOverBudget'); const n = i18next.t('itemNames./items/pathseeker_boots_refined'); return n !== 'Pathseeker Boots ★' && ul.hidden && ul.textContent.includes(n + ' +12') && !ul.textContent.includes('Pathseeker Boots'); })()`));
    check('in Portuguese the warning\'s field follows the language too', await until(`(() => { const t = document.getElementById('whatIfDiff').textContent; const n = i18next.t('skillNames./skills/magic'); return n !== 'Magic' && t.includes(i18next.t('common:whatIf.diff.level', { skill: n }) + ':') && !t.includes('Magic level'); })()`));
    await js(`i18next.changeLanguage('en').then(() => true)`);
    check('back in English the names are English', await until(`document.getElementById('whatIfOverBudget').textContent.includes('Feet Pathseeker Boots ★ +12')`));
    check('the cost path column wraps', await js(`getComputedStyle(document.querySelector('#whatIfResult td.wrap')).whiteSpace === 'normal'`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('the window fits a 1500x900 viewport and scrolls inside itself, with no horizontal scroll', await js(`(() => { const b = document.querySelector('#whatIfModal .modal-content').getBoundingClientRect(); const body = document.querySelector('#whatIfModal .modal-body'); return b.top >= 0 && b.bottom <= innerHeight && b.right <= innerWidth && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth; })()`));
    await js(`document.querySelector('[data-whatif-apply="single:1"]').click(), true`);
    check('a player the page lacks is named, nothing applied', await js(`document.getElementById('whatIfMessage').textContent.includes('Nobody')`) &&
        (await js(`document.getElementById('inputLevel_attack').value`)) === (await js(`document.getElementById('inputLevel_attack').value`)));
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('Show loads an earlier result', await until(`document.getElementById('whatIfResult').textContent.includes('Magic 1')`));
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}

// The public page: no runner, no button (a server whose /api/version is 404).
{
    const plain = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
        if (url.pathname.startsWith('/api/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    const prof2 = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-window-'));
    const chrome2 = await launchChrome({ userDataDir: path.join(prof2, 'profile'), width: 1200, height: 900 });
    try {
        const page = await chrome2.newPage();
        await page.send('Page.enable');
        await page.send('Page.navigate', { url: `http://127.0.0.1:${plain.address().port}/` });
        await new Promise((r) => setTimeout(r, 4000));
        const r = await page.send('Runtime.evaluate', { expression: `[!!document.getElementById('buttonWhatIf'), document.getElementById('buttonWhatIf')?.style.display, !!document.getElementById('selectZone')?.options.length]`, returnByValue: true });
        const [exists, display, loaded] = r.result.value;
        check('without a runner the page loads and the button stays hidden', exists && display === 'none' && loaded, JSON.stringify(r.result.value));
        page.close();
    } finally { await chrome2.close(); plain.close(); try { fs.rmSync(prof2, { recursive: true, force: true }); } catch {} }
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
