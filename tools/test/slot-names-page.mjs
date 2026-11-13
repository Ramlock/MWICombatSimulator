// Test: every import path of the built page (dist/) shows the character name the import carried on the player tab and in the
// Select Players labels, in our own headless Chrome. Paths: Solo, Group All players, the per-player boxes. Generic fixture.
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/slot-names-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves a dark Full HD picture of the tabs.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-names-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await sleep(200); } return false; };
    // The page keeps the imported group (src/savedGroup.mjs); each load here starts blank, as these tests expect.
    const load = async () => { try { await js(`localStorage.removeItem('importedGroup'), true`); } catch {} await page.send('Page.navigate', { url: base }); return until(`document.getElementById('selectZone')?.options.length > 3`); };
    const tabs = () => js(`[...document.querySelectorAll('#playerTab .nav-link')].map((t) => t.textContent.trim())`);
    const labels = () => js(`[1, 2, 3, 4, 5].map((i) => document.querySelector('label[for="player' + i + '"]').textContent.trim())`);
    const hideImport = async () => { await js(`(() => { const m = bootstrap.Modal.getInstance(document.getElementById('importExportModal')); if (m) m.hide(); return true; })()`); await sleep(500); };
    const click = async () => { await js(`document.getElementById('buttonImportSet').click(), true`); await sleep(500); await hideImport(); };
    const player = (level) => ({ attackLevel: level, magicLevel: 1, meleeLevel: 1, rangedLevel: 1, defenseLevel: 1, staminaLevel: 1, intelligenceLevel: 1, equipment: [] });
    const set = (name, level) => ({ ...(name === undefined ? {} : { name }), player: player(level), food: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, drinks: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, abilities: [0, 1, 2, 3, 4].map(() => ({ abilityHrid: '', level: 1 })) });
    const def = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    check('the page loads', await load());
    check('the tabs start as Player N', same(await tabs(), def));

    // Solo: into the current tab, then into another.
    const solo = (obj) => js(`document.getElementById('solo-tab').click(), document.getElementById('inputSetSolo').value = ${JSON.stringify(JSON.stringify(obj))}, true`);
    await solo(set('Aaa', 11)); await click();
    check('solo: the tab shows the name', same(await tabs(), ['Aaa', 'Player 2', 'Player 3', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('solo: the Select Players label follows', same(await labels(), ['Aaa', 'Player 2', 'Player 3', 'Player 4', 'Player 5']), JSON.stringify(await labels()));
    await js(`document.getElementById('player2-tab').click(), true`); await sleep(300);
    await solo(set('Bbb', 12)); await click();
    check('solo: another tab shows its own name', same(await tabs(), ['Aaa', 'Bbb', 'Player 3', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    await js(`document.getElementById('player3-tab').click(), true`); await sleep(300);
    await solo(set(undefined, 13)); await click();
    check('solo: an import with no name leaves the tab as it is', same(await tabs(), ['Aaa', 'Bbb', 'Player 3', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    await js(`document.getElementById('player1-tab').click(), true`); await sleep(300);
    check('solo: switching tabs keeps the names', same(await tabs(), ['Aaa', 'Bbb', 'Player 3', 'Player 4', 'Player 5']));

    // A tab the player edited by hand stays until the slot's name changes.
    await js(`document.getElementById('player1-tab').textContent = 'Tank', true`);
    await solo(set('Aaa', 14)); await click();
    check('an edited tab is not overwritten by an import of the same name', (await tabs())[0] === 'Tank', JSON.stringify(await tabs()));
    await solo(set('Zzz', 14)); await click();
    check('a changed name replaces the edit', (await tabs())[0] === 'Zzz', JSON.stringify(await tabs()));

    // Group: All players.
    await load();
    const all = (obj) => js(`document.getElementById('group-combat-tab').click(), document.getElementById('inputSetGroupCombatAll').value = ${JSON.stringify(JSON.stringify(obj))}, true`);
    await all({ 1: set('Aaa', 21), 2: set('Bbb', 22), 3: set('Ccc', 23) }); await click();
    check('all players: every tab shows its name', same(await tabs(), ['Aaa', 'Bbb', 'Ccc', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('all players: the labels follow', same(await labels(), ['Aaa', 'Bbb', 'Ccc', 'Player 4', 'Player 5']), JSON.stringify(await labels()));
    await all({ 1: set('Same', 31), 2: set('Same', 32) }); await click();
    check('all players: a name two slots share leaves those tabs as they were', same((await tabs()).slice(0, 3), ['Aaa', 'Bbb', 'Ccc']), JSON.stringify(await tabs()));
    await all({ 1: set('Aaa', 41) }); await click();
    check('all players: once only one slot holds the shared name, its tab shows it; the other keeps its name', same(await tabs(), ['Aaa', 'Same', 'Ccc', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    await all({ 4: JSON.stringify(set('Ddd', 24)) }); await click();
    check('all players: a slot given as a string carries its name too', (await tabs())[3] === 'Ddd', JSON.stringify(await tabs()));

    // Group: the per-player boxes.
    await load();
    const boxes = (obj) => js(`document.getElementById('group-combat-tab').click(), ${Object.entries(obj).map(([i, v]) => `document.getElementById('inputSetGroupCombatplayer${i}').value = ${JSON.stringify(JSON.stringify(v))}`).join(', ')}, true`);
    await boxes({ 1: set('Aaa', 51), 2: set('Bbb', 52), 5: set('Eee', 55) }); await click();
    check('per-player boxes: each tab shows its name, the others stay', same(await tabs(), ['Aaa', 'Bbb', 'Player 3', 'Player 4', 'Eee']), JSON.stringify(await tabs()));
    check('per-player boxes: the labels follow', same(await labels(), ['Aaa', 'Bbb', 'Player 3', 'Player 4', 'Eee']), JSON.stringify(await labels()));

    if (shots) {
        await load();
        await all({ 1: set('Aaa', 61), 2: set('Bbb', 62), 3: set('Ccc', 63) }); await click();
        await sleep(600);
        check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, 'slot-names-tabs.png'), Buffer.from(shot.data, 'base64'));
    }
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
