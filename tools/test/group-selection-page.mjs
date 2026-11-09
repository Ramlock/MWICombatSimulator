// Test: the built page's group paste (dist/) ticks the players and sets the zone and tier the pasted object names, in our own headless Chrome.
// Generic fixture. Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/group-selection-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves one dark picture (1500x900, cropped to the panel).
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

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'group-selection-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1500, height: 900 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    await page.send('Page.navigate', { url: base });
    check('the page loads with its zones', await until(`document.getElementById('selectZone')?.options.length > 3 && document.getElementById('selectDungeon')?.options.length > 0`));
    const ids = await js(`({ zone: document.getElementById('selectZone').options[2].value, zone2: document.getElementById('selectZone').options[3].value, dungeon: document.getElementById('selectDungeon').options[0].value })`);
    // paste(obj): the page's Import Group box, as a user would use it.
    const paste = (obj) => js(`(() => { document.getElementById('group-combat-tab').click(); document.getElementById('inputSetGroupCombatAll').value = ${JSON.stringify(JSON.stringify(obj))}; document.getElementById('buttonImportSet').click(); return true; })()`);
    const state = () => js(`({ ticked: [1,2,3,4,5].filter((i) => document.getElementById('player' + i).checked), zone: document.getElementById('selectZone').value, dungeon: document.getElementById('selectDungeon').value, toggle: document.getElementById('simDungeonToggle').checked, tier: document.getElementById('selectDifficulty').value })`);
    const slot = (n) => ({ player: { attackLevel: 40 + n }, name: 'Player ' + n });
    const three = { 1: slot(1), 2: slot(2), 3: slot(3) };

    const before = await state();
    await paste(three);
    check('an older paste (slots only) changes no tick, zone or tier', JSON.stringify(await state()) === JSON.stringify(before));

    await paste({ ...three, selected: [1, 2, 3], fight: { zone: ids.zone, tier: 2, kind: 'combat' } });
    let s = await state();
    check('a three-player group ticks three boxes', JSON.stringify(s.ticked) === '[1,2,3]', JSON.stringify(s));
    check('the zone and tier are set', s.zone === ids.zone && s.tier === '2' && !s.toggle, JSON.stringify(s));

    await paste({ ...three, selected: [2] });
    check('only selected: the ticks change, zone and tier stay', JSON.stringify((s = await state()).ticked) === '[2]' && s.zone === ids.zone && s.tier === '2', JSON.stringify(s));

    await paste({ ...three, fight: { zone: ids.zone2, tier: 1, kind: 'combat' } });
    check('only fight: zone and tier change, the ticks stay', (s = await state()).zone === ids.zone2 && s.tier === '1' && JSON.stringify(s.ticked) === '[2]', JSON.stringify(s));

    await paste({ ...three, selected: [1, 3], fight: { zone: '/actions/combat/not_a_zone', tier: 9, kind: 'combat' } });
    check('a zone or tier the page lacks is left as it is; the ticks and slots still import', (s = await state()).zone === ids.zone2 && s.tier === '1' && JSON.stringify(s.ticked) === '[1,3]', JSON.stringify(s));
    await js(`document.getElementById('player3-tab').click(), true`);
    check('the slots of that paste were imported (player 3 shows its level)', await until(`document.getElementById('inputLevel_attack').value === '43'`));

    await paste({ ...three, selected: [1, 2, 3], fight: { zone: ids.dungeon, tier: 1, kind: 'dungeon' } });
    s = await state();
    check('a dungeon: the dungeon option is on, its zone and the tier are set, only the selected are ticked', s.toggle && s.dungeon === ids.dungeon && s.tier === '1' && JSON.stringify(s.ticked) === '[1,2,3]', JSON.stringify(s));

    if (shots) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
        await paste({ ...three, selected: [1, 2, 3], fight: { zone: ids.zone, tier: 2, kind: 'combat' } });
        // The tick boxes, zone and tier sit in the simulation setup window: open it and crop to its content.
        await js(`document.getElementById('buttonSimulationSetup').click(), true`);
        check('the setup window shows the controls', await until(`document.getElementById('playerCheckBox').getBoundingClientRect().width > 0`));
        await new Promise((r) => setTimeout(r, 600));
        const [x, y, width, height] = await js(`(() => { const b = document.getElementById('playerCheckBox').closest('.modal-content').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, 'group-selection.png'), Buffer.from(shot.data, 'base64'));
        check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
    }
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
