// Test: a party import that carries the own character's inventory and learned abilities (userscript 0.9.3) feeds the What-if window's kept export,
// in the built page (dist/), in our own headless Chrome. Synthetic fixture only (never a real item list). Needs a built dist/ (npx webpack).
// Usage: node tools/test/import-own-export-page.mjs [--shot <png>] [--shot-player <png>]   Exit code 0 on pass, 1 on fail. --shot saves the What-if window after an import
// (1920x1080, dark); --shot-player saves it after a paste into the "Player 2 import" field.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt > 0 ? process.argv[shotAt + 1] : null;
const shotPlayerAt = process.argv.indexOf('--shot-player');
const shotPlayer = shotPlayerAt > 0 ? process.argv[shotPlayerAt + 1] : null;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

let received = null;
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/version') return send(res, 200, { runner: 'test-runner', engine: 'test-engine' });
    if (url.pathname === '/api/search' && req.method === 'POST') {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => { received = JSON.parse(data); send(res, 200, { id: 'search-1' }); });
        return;
    }
    if (url.pathname.startsWith('/api/search/')) return send(res, 200, { state: 'running', progress: { stage: 'screen', candidatesLeft: 40, runsDone: 12, runsPlanned: 48, secondsPerRun: 2.5, etaSeconds: 90 } });
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// Synthetic: two players. Player 1 is the user's own character (name Ayla): its slot carries the export fields.
const ITEM = '/items/synthetic_test_item_zq';
const own = { inventory: [{ itemHrid: ITEM, enhancementLevel: 3, count: 7 }], learnedAbilities: [{ abilityHrid: '/abilities/synthetic_test_ability_zq', level: 4, experience: 12 }] };
const slot = (n, name) => ({ player: { attackLevel: 40 + n }, name });
const withFields = { 1: { ...slot(1, 'Ayla'), ...own }, 2: slot(2, 'Bram'), selected: [1, 2] };
const without = { 1: slot(1, 'Ayla'), 2: slot(2, 'Bram'), selected: [1, 2] };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'import-own-export-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    const importGroup = (obj) => js(`(() => { document.getElementById('group-combat-tab').click(); document.getElementById('inputSetGroupCombatAll').value = ${JSON.stringify(JSON.stringify(obj))}; document.getElementById('buttonImportSet').click(); return true; })()`);
    const keptGroup = () => js(`localStorage.getItem('importedGroup')`);
    const kept = (name) => js(`localStorage.getItem('whatIfExport:${name}')`);
    const saveWindow = async (file) => {
        const [x, y, width, height] = await js(`(() => { const b = document.querySelector('#whatIfModal .modal-content').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
    };
    const statusOf = (player) => js(`document.querySelector('#whatIfBudgets [data-export-status="${player}"]').textContent`);
    const lever = (id) => js(`(() => { const c = document.getElementById('whatIfLever_${id}'); return c ? { disabled: c.disabled, checked: c.checked } : null; })()`);
    const closeImport = () => js(`(() => { const m = document.getElementById('importExportModal'); document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove()); document.body.classList.remove('modal-open'); document.body.style.overflow = ''; m.classList.remove('show'); m.style.display = 'none'; return true; })()`);

    await page.send('Page.navigate', { url: base });
    check('the What-if button shows when the runner answers', await until(`document.getElementById('buttonWhatIf')?.style.display === ''`));

    // 1. An import from an older userscript (no such fields): as today, nothing kept.
    await importGroup(without);
    const groupWithout = await keptGroup();
    check('an import without the fields keeps no export for anyone', (await kept('Ayla')) === null && (await kept('Bram')) === null && !!groupWithout);

    // 2. The same import with the fields: the sim slots are byte-for-byte the same, the export is kept under the player's name.
    await importGroup(withFields);
    const groupWith = await keptGroup();
    check('the sim setup after an import with the fields is byte-for-byte the one without', groupWith === groupWithout, (groupWith || '').slice(0, 200));
    check('no inventory item or ability list reaches the kept sim slots', !groupWith.includes('synthetic_test') && !groupWith.includes('inventory') && !groupWith.includes('learnedAbilities'));
    const keptOwn = JSON.parse(await kept('Ayla') || 'null');
    check('the own export is kept under the name the window shows that player by, with the two lists and the name', !!keptOwn && keptOwn.name === 'Ayla' && JSON.stringify(keptOwn.inventory) === JSON.stringify(own.inventory) && JSON.stringify(keptOwn.learnedAbilities) === JSON.stringify(own.learnedAbilities), JSON.stringify(keptOwn));
    check('nothing is kept for the other player', (await kept('Bram')) === null);
    check('only the export key and the slots are in storage (the item is in the export key alone)', await js(`Object.keys(localStorage).filter((k) => (localStorage.getItem(k) || '').includes('synthetic_test_item_zq')).join() === 'whatIfExport:Ayla'`));
    await closeImport();

    // 3. The window: the own player's mark says Tracker import; the other still has none; the two boxes are on.
    await js(`document.getElementById('buttonWhatIf').click(), true`);
    check('the window opens with both players', await until(`!!document.querySelector('#whatIfBudgets input[data-player="Ayla"]') && !!document.querySelector('#whatIfBudgets input[data-player="Bram"]')`));
    check('the own player\'s mark reads "items and abilities: Tracker import"', (await statusOf('Ayla')) === 'items and abilities: Tracker import', await statusOf('Ayla'));
    check('the other player still has no export', (await statusOf('Bram')) === 'items and abilities: none', await statusOf('Bram'));
    const owned = await lever('owned'), abil = await lever('abilities');
    check('"Items you own" and "Abilities" are enabled and ticked', owned && abil && !owned.disabled && owned.checked && !abil.disabled && abil.checked, JSON.stringify([owned, abil]));
    if (shot) {
        await new Promise((r) => setTimeout(r, 600));
        const dark = await js(`document.body.classList.contains('dark-mode')`);
        check('the page is dark', dark);
        await saveWindow(shot);
    }

    // 4. The search request carries the export for that player, nobody else.
    await js(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('marketplace.json') ? Promise.resolve(new Response(JSON.stringify({ marketData: { '/items/apple': { 0: { a: 10, b: 9 } } }, timestamp: 1700000000 }), { status: 200 })) : f(u, o); document.querySelectorAll('#whatIfBudgets input[data-player]').forEach((i) => { i.value = '1000000'; }); document.getElementById('buttonWhatIfSearch').click(); return true; })()`);
    check('the request is sent', await until(`true`) && await (async () => { const t0 = Date.now(); while (!received && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 200)); return !!received; })());
    check('the request carries the export for Ayla and nobody else', !!received?.export && Object.keys(received.export).join() === 'Ayla' && JSON.stringify(received.export.Ayla.inventory) === JSON.stringify(own.inventory) && JSON.stringify(received.export.Ayla.learnedAbilities) === JSON.stringify(own.learnedAbilities), JSON.stringify(received?.export)?.slice(0, 200));
    check('the request\'s levers include Items you own and Abilities', !!received && received.levers.includes('owned') && received.levers.includes('abilities'), JSON.stringify(received?.levers));

    // 5. A later import without the fields leaves the kept export as it was (an older script never clears one).
    await js(`(() => { document.getElementById('buttonImportExport').click(); return true; })()`);
    await importGroup(without);
    check('an import without the fields leaves a kept export alone', JSON.stringify(JSON.parse(await kept('Ayla') || 'null')) === JSON.stringify(keptOwn));

    // 6. The per-player import fields (Group Combat tab, "Player N import", the all-players field empty): a Tracker character export
    // pasted into "Player 2 import" sets that slot and keeps that player's export for the What-if window, as the all-players import does.
    const own2 = { inventory: [{ itemHrid: '/items/synthetic_test_item_p2', enhancementLevel: 0, count: 2 }], learnedAbilities: [{ abilityHrid: '/abilities/synthetic_test_ability_p2', level: 2, experience: 5 }] };
    const importBoxes = (boxes) => js(`(() => { document.getElementById('buttonImportExport').click(); document.getElementById('group-combat-tab').click(); document.getElementById('inputSetGroupCombatAll').value = ''; const b = ${JSON.stringify(Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, JSON.stringify(v)])))}; for (const n of ['1', '2', '3', '4', '5']) document.getElementById('inputSetGroupCombatplayer' + n).value = b[n] || ''; document.getElementById('buttonImportSet').click(); return true; })()`);
    const reopenWindow = () => js(`(document.getElementById('whatIfModal').dispatchEvent(new Event('show.bs.modal')), true)`);
    await importBoxes({ 1: { player: { attackLevel: 41 }, name: 'Player 1' }, 2: { player: { attackLevel: 52 }, name: 'Player 2', ...own2 } });
    const groupBoxes = await keptGroup();
    check('a Tracker export pasted into "Player 2 import" sets that slot (its level reaches the kept group) without the two lists', !!groupBoxes && groupBoxes.includes('52') && !groupBoxes.includes('synthetic_test_item_p2') && !groupBoxes.includes('synthetic_test_ability_p2'), String(JSON.parse(groupBoxes || '{}').slots?.['2']).slice(0, 400));
    const kept2 = JSON.parse(await kept('Player 2') || 'null');
    check('the per-player paste keeps that player\'s export, under the name the window shows, with the two lists and the name', !!kept2 && kept2.name === 'Player 2' && JSON.stringify(kept2.inventory) === JSON.stringify(own2.inventory) && JSON.stringify(kept2.learnedAbilities) === JSON.stringify(own2.learnedAbilities), JSON.stringify(kept2));
    check('a per-player paste without the lists keeps nothing for that player', (await kept('Player 1')) === null);
    await closeImport();
    await reopenWindow();
    check('in the What-if window Player 2\'s mark reads "items and abilities: Tracker import", Player 1\'s "none"', await until(`document.querySelector('#whatIfBudgets [data-export-status="Player 2"]')?.textContent === 'items and abilities: Tracker import' && document.querySelector('#whatIfBudgets [data-export-status="Player 1"]')?.textContent === 'items and abilities: none'`), await js(`[...document.querySelectorAll('#whatIfBudgets [data-export-status]')].map((m) => m.dataset.exportStatus + ': ' + m.textContent).join(' | ')`));
    if (shotPlayer) { await js(`document.getElementById('buttonWhatIf').click(), true`); await until(`document.getElementById('whatIfModal').classList.contains('show') && document.querySelector('#whatIfModal .modal-content').getBoundingClientRect().width > 0`); await new Promise((r) => setTimeout(r, 600)); await saveWindow(shotPlayer); await js(`document.querySelector('#whatIfModal .btn-close').click(), true`); await until(`!document.getElementById('whatIfModal').classList.contains('show')`); }
    await importBoxes({ 2: { player: { attackLevel: 53 }, name: 'Player 2' } });
    await closeImport();
    await reopenWindow();
    check('a later per-player paste without the lists leaves the kept export and the mark as they were', JSON.stringify(JSON.parse(await kept('Player 2') || 'null')) === JSON.stringify(kept2) && await until(`document.querySelector('#whatIfBudgets [data-export-status="Player 2"]')?.textContent === 'items and abilities: Tracker import'`));
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
