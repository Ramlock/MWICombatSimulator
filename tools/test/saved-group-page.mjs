// Test: the imported group is kept when Import runs and comes back when the page loads (the built page, dist/, in our own headless Chrome).
// Paths: All players, the per-player boxes, Solo. Also: a new import replaces the kept group, a kept value that is not usable is ignored,
// storage that refuses a write leaves Import working, and the What-if window reads the same names after a reload. Synthetic party (Alice, Bob, Cara).
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts. The What-if window is served by a stand-in runner (version + empty results).
// Usage: node tools/test/saved-group-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves dark Full HD pictures: tabs and What-if window after a reload.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-group-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1920, height: 1080 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    let thrown = [];
    page.on('Runtime.exceptionThrown', (p) => thrown.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await sleep(200); } return false; };
    // The page is ready when the zones are listed, the What-if button is shown (the stand-in runner answered) and a restore had its turn.
    const load = async () => { await page.send('Page.navigate', { url: base }); const ok = await until(`document.getElementById('selectZone')?.options.length > 3 && document.getElementById('buttonWhatIf')?.style.display === ''`); await sleep(600); return ok; };
    const tabs = () => js(`[...document.querySelectorAll('#playerTab .nav-link')].map((t) => t.textContent.trim())`);
    const labels = () => js(`[1, 2, 3, 4, 5].map((i) => document.querySelector('label[for="player' + i + '"]').textContent.trim())`);
    const kept = () => js(`localStorage.getItem('importedGroup')`);
    const hideImport = async () => { await js(`(() => { const m = bootstrap.Modal.getInstance(document.getElementById('importExportModal')); if (m) m.hide(); return true; })()`); await sleep(500); };
    const click = async () => { await js(`document.getElementById('buttonImportSet').click(), true`); await sleep(500); await hideImport(); };
    const goTab = async (n) => { await js(`document.getElementById('player${n}-tab').click(), true`); await sleep(400); };
    const screen = () => js(`({ attack: document.getElementById('inputLevel_attack').value, stamina: document.getElementById('inputLevel_stamina').value, food: document.getElementById('selectFood_0').value, ability: document.getElementById('selectAbility_1').value, abilityLevel: document.getElementById('inputAbilityLevel_1').value })`);
    const whatIfNames = async () => {
        await js(`document.getElementById('buttonWhatIf').click(), true`);
        await until(`document.querySelectorAll('#whatIfPlayers label').length > 0`);
        await sleep(400);
        const names = await js(`[...document.querySelectorAll('#whatIfPlayers label')].map((l) => l.textContent)`);
        await js(`(() => { for (const c of document.querySelectorAll('#whatIfPlayers input')) { if (!c.checked) c.click(); } return true; })()`);
        await sleep(500);
        const budgets = await js(`[...document.querySelectorAll('#whatIfBudgets .whatif-pname')].map((l) => l.textContent)`);
        return { names, budgets };
    };
    const closeWhatIf = async () => { await js(`(() => { const m = bootstrap.Modal.getInstance(document.getElementById('whatIfModal')); if (m) m.hide(); return true; })()`); await sleep(700); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const def = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];

    check('the page loads', await load());
    // Item names the page offers (a food, an ability), so the setups below are ones the page can show.
    const food = await js(`[...document.querySelectorAll('#selectFood_0 option')].map((o) => o.value).filter(Boolean).slice(0, 3)`);
    const ability = await js(`[...document.querySelectorAll('#selectAbility_1 option')].map((o) => o.value).filter(Boolean).slice(0, 3)`);
    const player = (level, stamina) => ({ attackLevel: level, magicLevel: 1, meleeLevel: 1, rangedLevel: 1, defenseLevel: 1, staminaLevel: stamina, intelligenceLevel: 1, equipment: [] });
    const set = (name, level, i) => ({
        ...(name === undefined ? {} : { name }), player: player(level, level + 1),
        food: { '/action_types/combat': [{ itemHrid: food[i] }, { itemHrid: '' }, { itemHrid: '' }] },
        drinks: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] },
        abilities: [{ abilityHrid: '', level: 1 }, { abilityHrid: ability[i], level: 10 + i }, { abilityHrid: '', level: 1 }, { abilityHrid: '', level: 1 }, { abilityHrid: '', level: 1 }],
    });
    const all = (obj) => js(`document.getElementById('group-combat-tab').click(), document.getElementById('inputSetGroupCombatAll').value = ${JSON.stringify(JSON.stringify(obj))}, true`);
    const boxes = (obj) => js(`document.getElementById('group-combat-tab').click(), ${Object.entries(obj).map(([i, v]) => `document.getElementById('inputSetGroupCombatplayer${i}').value = ${JSON.stringify(JSON.stringify(v))}`).join(', ')}, true`);
    const solo = (obj) => js(`document.getElementById('solo-tab').click(), document.getElementById('inputSetSolo').value = ${JSON.stringify(JSON.stringify(obj))}, true`);
    const party = { 1: set('Alice', 11, 0), 2: set('Bob', 22, 1), 3: set('Cara', 33, 2) };

    // Nothing imported, nothing kept: the page starts as it always did.
    check('nothing imported: nothing is kept', (await kept()) === null);
    check('nothing imported: the tabs are Player N', same(await tabs(), def));

    // All players: kept at Import, back after a reload.
    await all(party); await click();
    const text = JSON.parse((await kept()) || 'null');
    check('import: the group is kept (version 1, the five slots)', text?.v === 1 && same(Object.keys(text.slots), ['1', '2', '3', '4', '5']), JSON.stringify(text)?.slice(0, 200));
    check('import: the names are in the kept slots', same([1, 2, 3].map((i) => JSON.parse(text.slots[i]).name), ['Alice', 'Bob', 'Cara']));
    check('import: the pasted text is not kept as it is', !(await kept()).includes('"selected"') && !(await kept()).includes('inputSetGroupCombatAll'));
    const before = await whatIfNames(); await closeWhatIf();
    check('before the reload: the window shows the names', same(before.names.slice(0, 3), ['Alice', 'Bob', 'Cara']), JSON.stringify(before));
    thrown = [];
    check('the page loads again', await load());
    check('reload: no error on load', thrown.length === 0, JSON.stringify(thrown));
    check('reload: the tabs show the names', same(await tabs(), ['Alice', 'Bob', 'Cara', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('reload: the Select Players labels follow', same(await labels(), ['Alice', 'Bob', 'Cara', 'Player 4', 'Player 5']), JSON.stringify(await labels()));
    const s1 = await screen();
    check('reload: the first tab shows Alice\'s setup', s1.attack === '11' && s1.stamina === '12' && s1.food === food[0] && s1.ability === ability[0] && s1.abilityLevel === '10', JSON.stringify(s1));
    await goTab(2);
    const s2 = await screen();
    check('reload: the second tab shows Bob\'s setup', s2.attack === '22' && s2.stamina === '23' && s2.food === food[1] && s2.ability === ability[1] && s2.abilityLevel === '11', JSON.stringify(s2));
    await goTab(3);
    const s3 = await screen();
    check('reload: the third tab shows Cara\'s setup', s3.attack === '33' && s3.stamina === '34' && s3.food === food[2] && s3.ability === ability[2] && s3.abilityLevel === '12', JSON.stringify(s3));
    await goTab(4);
    check('reload: a slot that held nothing is the blank default', (await screen()).attack === '1');
    await goTab(1);
    const after = await whatIfNames();
    check('reload: the window reads the same names as before', same(after, before), JSON.stringify({ before, after }));
    if (shots) {
        await sleep(300);
        check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
        fs.mkdirSync(shots, { recursive: true });
        const picture = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await picture('saved-group-whatif-after-reload.png');
        await closeWhatIf();
        await js('window.scrollTo(0, 0), document.querySelector("#playerTab").scrollIntoView(), true'); await sleep(400);
        await picture('saved-group-tabs-after-reload.png');
    } else await closeWhatIf();

    // A new import replaces the kept group (and the page itself holds it the same way: a slot the import does not carry stays as it was).
    await all({ 1: set('Dan', 44, 0) }); await click();
    const replaced = JSON.parse(await kept());
    check('a new import replaces the kept group', JSON.parse(replaced.slots[1]).name === 'Dan' && JSON.parse(replaced.slots[2]).name === 'Bob', JSON.stringify(replaced).slice(0, 200));
    await load();
    check('after another reload: the new import shows, the slots it did not carry are as the page held them', same(await tabs(), ['Dan', 'Bob', 'Cara', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('after another reload: the new setup shows', (await screen()).attack === '44');

    // Solo and the per-player boxes keep too.
    await goTab(5);
    await solo(set('Eve', 55, 0)); await click();
    await load();
    check('solo: the imported player is kept with the name', same(await tabs(), ['Dan', 'Bob', 'Cara', 'Player 4', 'Eve']), JSON.stringify(await tabs()));
    await goTab(5);
    check('solo: and its setup', (await screen()).attack === '55');
    await boxes({ 2: set('Fay', 66, 1) }); await click();
    await load();
    check('per-player boxes: the imported player is kept with the name', same(await tabs(), ['Dan', 'Fay', 'Cara', 'Player 4', 'Eve']), JSON.stringify(await tabs()));
    await goTab(2);
    check('per-player boxes: and its setup', (await screen()).attack === '66');

    // A kept value that is not usable is ignored: the page starts blank, no error.
    const ignored = async (name, value) => {
        await js(`localStorage.setItem('importedGroup', ${JSON.stringify(value)}), true`);
        thrown = [];
        const ok = await load();
        check(name + ': the page loads, no error', ok && thrown.length === 0, JSON.stringify(thrown));
        check(name + ': the tabs are Player N and the setup is blank', same(await tabs(), def) && (await screen()).attack === '1', JSON.stringify(await tabs()));
    };
    await ignored('a value that is not JSON', '{nope');
    await ignored('a value of an older shape (the bare slot map)', JSON.stringify({ 1: JSON.stringify(set('Alice', 11, 0)) }));
    await ignored('another version', JSON.stringify({ v: 2, slots: { 1: JSON.stringify(set('Alice', 11, 0)) } }));
    await ignored('a slot that is not a player', JSON.stringify({ v: 1, slots: { 1: JSON.stringify({ name: 'Alice' }) } }));
    await ignored('an empty value', '');
    await ignored('null', 'null');
    // After an ignored value, an import works and keeps again.
    await all(party); await click();
    check('after an ignored value: an import keeps again', JSON.parse(await kept()).v === 1);

    // Storage that refuses a write: Import still works, nothing is thrown, nothing comes back after a reload.
    await js(`localStorage.removeItem('importedGroup'), true`);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };` });
    await load();
    thrown = [];
    await all(party); await click();
    check('storage full: Import still works', same(await tabs(), ['Alice', 'Bob', 'Cara', 'Player 4', 'Player 5']), JSON.stringify(await tabs()));
    check('storage full: nothing is thrown', thrown.length === 0, JSON.stringify(thrown));
    check('storage full: nothing was kept', (await kept()) === null);
    await load();
    check('storage full: after a reload the page starts blank', same(await tabs(), def));
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
