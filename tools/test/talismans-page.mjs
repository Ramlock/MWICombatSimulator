// Test: the page's talismans, in the built page (dist/), in our own headless Chrome. Invented players and lines only.
// A party import whose Player 1 slot carries `talismans` (the Tracker's own slot) shows them read-only with that player's equipment (each line's
// modifier name and grade, and the talisman power) in English, Portuguese and Chinese; Player 2 (no field) shows nothing; the kept slot JSON (what the
// What-if search's setups are made of, src/whatif/panel.mjs pageSetups) carries the field for Player 1 only, and the field survives a tab switch and a
// page reload; there is no input or edit control in the block. Needs a built dist/ (npx webpack).
// Usage: node tools/test/talismans-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves the equipment column in en, pt and zh,
// and with Player 2 (none), at 1920x1080, dark.
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
    if (url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const TALISMANS = { power: 0.2, lines: [{ modifier: 'magic_damage', grade: 3 }, { modifier: 'armor', grade: 2 }, { modifier: 'echo', grade: 1 }, { modifier: 'melee_accuracy', grade: 4 }] };
const slot = (n) => ({ player: { attackLevel: 40 + n, magicLevel: 50, equipment: [] }, name: 'Player ' + n });
const group = { 1: { ...slot(1), talismans: TALISMANS }, 2: slot(2), 3: slot(3), selected: [1, 2, 3] };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'talismans-page-'));
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
    const view = () => js(`(() => { const b = document.getElementById('talismanView'); return b ? { hidden: b.hidden, text: b.innerText.replace(/\\s+/g, ' ').trim(), inputs: b.querySelectorAll('input, select, textarea, button').length } : null; })()`);
    const kept = async () => { const g = JSON.parse(await js(`localStorage.getItem('importedGroup')`) || 'null'); const slots = g?.slots ?? g; return Object.fromEntries(Object.entries(slots || {}).map(([k, v]) => [k, typeof v === 'string' ? JSON.parse(v) : v])); };
    // The page's own language buttons (js/i18n.js): their click changes the language and redraws every data-i18n text.
    const lang = async (l) => { const text = { en: 'English', zh: '中文', pt: 'Português' }[l]; await js(`([...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(text)}).click(), true)`); await until(`i18next.language === '${l}'`); await new Promise((r) => setTimeout(r, 300)); };
    const tab = (n) => js(`(document.querySelector('#playerTab .nav-link[data-bs-target], #playerTab .nav-link:nth-child(1)') && document.querySelectorAll('#playerTab .nav-link')[${n - 1}].click(), true)`);
    const shot = async (name) => {
        if (!shots) return;
        await new Promise((r) => setTimeout(r, 400));
        const [x, y, width, height] = await js(`(() => { const v = document.getElementById('talismanView'); const col = (v.closest('.card') || v.parentElement); const b = col.getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(s.data, 'base64'));
    };

    await page.send('Page.navigate', { url: base });
    check('the page loads', await until(`!!document.getElementById('buttonImportSet') && typeof i18next !== 'undefined' && i18next.isInitialized`));
    check('a fresh page shows no talisman block', (await view())?.hidden === true);

    await js(`(() => { document.getElementById('buttonImportExport').click(); document.getElementById('group-combat-tab').click(); document.getElementById('inputSetGroupCombatAll').value = ${JSON.stringify(JSON.stringify(group))}; document.getElementById('buttonImportSet').click(); return true; })()`);
    await tab(1);
    let v = await view();
    check('Player 1 shows the block, read-only (no input or control)', v && !v.hidden && v.inputs === 0, JSON.stringify(v));
    check('en: each line\'s name and grade and the talisman power', v && /Magic Damage G3/.test(v.text) && /Armor G2/.test(v.text) && /Echo G1/.test(v.text) && /Melee Accuracy G4/.test(v.text) && /Talisman Power \+20%/.test(v.text), v?.text);
    check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
    check('no horizontal scroll on the page', await js(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
    await shot('talismans-en');

    await lang('pt');
    v = await view();
    check('pt: the game's own words for every line and the label (Dano mágico, Armadura, Eco, Precisão corpo a corpo, Talismãs, Poder de talismã)', v && /Dano mágico G3/.test(v.text) && /Armadura G2/.test(v.text) && /Eco G1/.test(v.text) && /Precisão corpo a corpo G4/.test(v.text) && /Talismãs/.test(v.text) && /Poder de talismã \+20%/.test(v.text) && !/Echo|Melee|Talisman/.test(v.text), v?.text);
    await shot('talismans-pt');
    await lang('zh');
    v = await view();
    check('zh: the game's own words for every line and the label (魔法伤害, 护甲, 回响, 近战精准度, 符石, 符石威力)', v && /魔法伤害 G3/.test(v.text) && /护甲 G2/.test(v.text) && /回响 G1/.test(v.text) && /近战精准度 G4/.test(v.text) && /符石/.test(v.text) && /符石威力 \+20%/.test(v.text) && !/[A-Za-z]{3,}/.test(v.text), v?.text);
    await shot('talismans-zh');
    await lang('en');

    await tab(2);
    v = await view();
    check('Player 2 (no field) shows nothing', v && v.hidden && v.text === '', JSON.stringify(v));
    await shot('talismans-none');
    await tab(1);
    check('back on Player 1 the block shows again', (await view())?.hidden === false);

    const k = await kept();
    check('the kept slot JSON carries the field for Player 1 only, as imported', JSON.stringify(k['1']?.talismans) === JSON.stringify(TALISMANS) && !('talismans' in (k['2'] || {})) && !('talismans' in (k['3'] || {})), JSON.stringify(Object.keys(k)));

    await page.send('Page.navigate', { url: base });
    check('after a reload the restored group shows Player 1\'s block', await until(`!document.getElementById('talismanView').hidden`) && /Magic Damage G3/.test((await view()).text));
    const k2 = await kept();
    check('after a reload the kept slot still carries the field', JSON.stringify(k2['1']?.talismans) === JSON.stringify(TALISMANS));
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
