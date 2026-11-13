// Test: a successful Import closes the Import/Export popup; a failed one leaves it open with the pasted text; Export does not close it
// (the built page, dist/, in our own headless Chrome). Paths: Group All players, Group per-player boxes, Solo. Synthetic party (Alice, Bob, Cara).
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/import-popup-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves a dark Full HD picture after an import.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'import-popup-'));
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
    const load = async () => { await page.send('Page.navigate', { url: base }); return until(`document.getElementById('selectZone')?.options.length > 3`, 30000); };
    const shown = (id) => js(`document.getElementById('${id}').classList.contains('show')`);
    const tabs = () => js(`[...document.querySelectorAll('#playerTab .nav-link')].map((t) => t.textContent.trim())`);
    const openPopup = async () => { await js(`document.querySelector('[data-bs-target="#importExportModal"]').click(), true`); return until(`document.getElementById('importExportModal').classList.contains('show') && !document.getElementById('importExportModal').classList.contains('fade') || document.getElementById('importExportModal').classList.contains('show')`); };
    // Closed means the modal lost its "show" class (Bootstrap's fade ends it).
    const closed = () => until(`!document.getElementById('importExportModal').classList.contains('show')`);
    const player = (level) => ({ attackLevel: level, magicLevel: 1, meleeLevel: 1, rangedLevel: 1, defenseLevel: 1, staminaLevel: 1, intelligenceLevel: 1, equipment: [] });
    const set = (name, level) => ({ name, player: player(level), food: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, drinks: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, abilities: [0, 1, 2, 3, 4].map(() => ({ abilityHrid: '', level: 1 })) });
    const setBox = (id, value) => js(`document.getElementById('${id}').value = ${JSON.stringify(value)}, true`);
    const tab = (id) => js(`document.getElementById('${id}').click(), true`);
    const importClick = () => js(`document.getElementById('buttonImportSet').click(), true`);
    const party = { 1: set('Alice', 11), 2: set('Bob', 22), 3: set('Cara', 33) };

    check('the page loads', await load());

    // Group, All players.
    check('the popup opens', await openPopup());
    await tab('group-combat-tab'); await setBox('inputSetGroupCombatAll', JSON.stringify(party));
    await importClick();
    check('all players: a good import closes the popup', await closed());
    check('all players: the tabs show the names', JSON.stringify(await tabs()) === JSON.stringify(['Alice', 'Bob', 'Cara', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('all players: the boxes are emptied', (await js(`document.getElementById('inputSetGroupCombatAll').value`)) === '');
    if (shots) {
        await sleep(500);
        check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
        fs.mkdirSync(shots, { recursive: true });
        await js('window.scrollTo(0, 0), document.querySelector("#playerTab").scrollIntoView(), true'); await sleep(400);
        fs.writeFileSync(path.join(shots, 'import-popup-closed.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }

    // Group, per-player boxes.
    await openPopup(); await tab('group-combat-tab');
    await setBox('inputSetGroupCombatplayer4', JSON.stringify(set('Dan', 44)));
    await importClick();
    check('per-player boxes: a good import closes the popup', await closed());
    check('per-player boxes: the tab shows the name', (await tabs())[3] === 'Dan', JSON.stringify(await tabs()));

    // Solo.
    await openPopup(); await tab('solo-tab');
    await setBox('inputSetSolo', JSON.stringify(set('Eve', 55)));
    await importClick();
    check('solo: a good import closes the popup', await closed());
    check('solo: the tab shows the name', (await tabs())[0] === 'Eve', JSON.stringify(await tabs()));
    check('solo: the box is emptied', (await js(`document.getElementById('inputSetSolo').value`)) === '');

    // It opens again after it closed.
    check('the popup opens again after an import', await openPopup());

    // A bad paste: the popup stays open and the text stays in the box (no import, nothing reset).
    await tab('solo-tab'); await setBox('inputSetSolo', '{nope');
    await importClick(); await sleep(1200);
    check('a bad paste: the popup stays open', await shown('importExportModal'));
    check('a bad paste: the pasted text stays in the box', (await js(`document.getElementById('inputSetSolo').value`)) === '{nope');
    check('a bad paste: the tabs are as they were', JSON.stringify(await tabs()) === JSON.stringify(['Eve', 'Bob', 'Cara', 'Dan', 'Player 5']), JSON.stringify(await tabs()));
    await tab('group-combat-tab'); await setBox('inputSetGroupCombatAll', '{nope');
    await importClick(); await sleep(1200);
    check('a bad group paste: the popup stays open and the text stays', (await shown('importExportModal')) && (await js(`document.getElementById('inputSetGroupCombatAll').value`)) === '{nope');

    // Export does not close it.
    await tab('solo-tab');
    await js(`document.getElementById('buttonExportSet').click(), true`); await sleep(1200);
    check('export: the popup stays open', await shown('importExportModal'));

    // A good import after a bad one closes it.
    await setBox('inputSetGroupCombatAll', ''); await tab('solo-tab'); await setBox('inputSetSolo', JSON.stringify(set('Fay', 66)));
    await importClick();
    check('a good import after a bad one closes the popup', await closed());
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
