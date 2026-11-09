// Test: the built page (dist/) shows the "Held by trigger: details" button in the results panel and opens the pop-up, in our own headless Chrome,
// served by a what-if runner this test launches itself. Generic fixture (a mage with a two-condition skill). Needs a built dist/ (npx webpack) and network for the CDN scripts.
// Usage: node tools/test/held-popup-page.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves two dark pictures (1500x900, cropped to the box).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'held-popup-'));
const runner = spawn(process.execPath, [path.join(root, 'tools/whatif/runner/server.mjs'), '--port', '0', '--results', path.join(prof, 'results')], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((resolve, reject) => {
    let buf = '';
    runner.stdout.on('data', (d) => { buf += d; const m = buf.match(/https?:\/\/127\.0\.0\.1:\d+\//); if (m) resolve(m[0]); });
    runner.on('exit', () => reject(new Error('runner exited')));
    setTimeout(() => reject(new Error('runner did not start')), 20000);
});
const P = '/combat_trigger_';
const term = (dep, cond, value) => ({ dependencyHrid: P + 'dependencies/' + dep, conditionHrid: P + 'conditions/' + cond, comparatorHrid: P + 'comparators/greater_than_equal', value });
const loc = (type, hrid, level = 5) => ({ itemLocationHrid: '/item_locations/' + type, itemHrid: hrid, enhancementLevel: level });
const setup = {
    player: { staminaLevel: 80, intelligenceLevel: 80, attackLevel: 90, meleeLevel: 60, defenseLevel: 80, rangedLevel: 60, magicLevel: 90, equipment: [loc('main_hand', '/items/blooming_trident'), loc('body', '/items/royal_nature_robe_top')] },
    food: { '/action_types/combat': [{ itemHrid: '/items/spaceberry_donut' }, null, null] },
    drinks: { '/action_types/combat': [null, null, null] },
    abilities: [{ abilityHrid: '/abilities/toxic_pollen', level: 30 }, { abilityHrid: '/abilities/water_strike', level: 30 }, { abilityHrid: '/abilities/fireball', level: 30 }, { abilityHrid: '', level: 1 }],
    triggerMap: {
        '/abilities/toxic_pollen': [term('all_enemies', 'current_hp', 4000), term('self', 'current_mp', 600)],
        '/abilities/water_strike': [],
    },
};
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1500, height: 900 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const until = async (expression, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
    const shot = async (name, selector) => {
        if (!shots) return;
        await new Promise((r) => setTimeout(r, 600));
        const [x, y, width, height] = await js(`(() => { const b = (${JSON.stringify(selector)} === 'RESULTS' ? document.getElementById('simulationResultKills').closest('.col-md-5').parentElement.closest('.col-md-5') : document.querySelector(${JSON.stringify(selector)})).getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, name), Buffer.from(s.data, 'base64'));
    };
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: base });
    check('the page loads with its zones', await until(`document.getElementById('selectZone')?.options.length > 3`, 30000));
    await js(`window.alert = () => {}, true`);
    await js(`document.getElementById('buttonImportExport').click(), true`);
    await until(`document.getElementById('importExportModal').classList.contains('show')`, 10000);
    await js(`document.getElementById('solo-tab').click(), true`);
    await new Promise((r) => setTimeout(r, 300));
    await js(`(() => { document.getElementById('inputSetSolo').value = ${JSON.stringify(JSON.stringify(setup))}; document.getElementById('buttonImportSet').click(); const m = bootstrap.Modal.getInstance(document.getElementById('importExportModal')); if (m) m.hide(); return true; })()`);
    await new Promise((r) => setTimeout(r, 800));
    await js(`(() => { const z = document.getElementById('selectZone'); z.value = '/actions/combat/swamp_planet'; z.dispatchEvent(new Event('change', { bubbles: true })); const d = document.getElementById('inputSimulationTime'); d.value = '24'; d.dispatchEvent(new Event('input', { bubbles: true })); for (let i = 1; i <= 5; i++) { const c = document.getElementById('player' + i); if (c && c.checked !== (i === 1)) c.click(); } return true; })()`);
    await js(`document.getElementById('buttonStartSimulation').click(), true`);
    await until(`!!document.getElementById('heldByTriggerButton')`);
    check('the results panel shows the details button when the player had a hold', await until(`!!document.getElementById('heldByTriggerButton')`));
    const panel = await js(`(() => { const d = document.getElementById('simulationResultManaRestored'); const rows = [...d.querySelectorAll(':scope > .row')].map((r) => r.textContent.trim()); return { rows, text: d.textContent }; })()`);
    check('the panel has no Held By Trigger rows, no condition share and no skill rows', !/Held by trigger|toxic|Pollen|previous skill/i.test(panel.text.replace('Held by trigger: details', '')), JSON.stringify(panel.rows));
    check('Mana Run Out Ratio is on one line', await js(`(() => { const r = [...document.querySelectorAll('#simulationResultManaRestored .row')].find((x) => /Run Out Ratio/.test(x.textContent)); return r.firstElementChild.getBoundingClientRect().height < 30; })()`));
    check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
    await js(`document.getElementById('heldByTriggerButton').scrollIntoView({ block: 'center' }), true`);
    await shot('held-panel.png', 'RESULTS');
    await js(`document.getElementById('heldByTriggerButton').click(), true`);
    check('the pop-up opens', await until(`document.getElementById('heldByTriggerModal').classList.contains('show') && document.getElementById('heldByTriggerBody').getBoundingClientRect().width > 0`, 10000));
    const body = await js(`document.getElementById('heldByTriggerBody').innerText`);
    check('the pop-up lists the skill, its conditions with shares, the separate previous-skill group and the overlap line', /Toxic Pollen/.test(body) && /\d+(\.\d+)?%/.test(body) && /A previous skill was out of mana/.test(body) && /Share of the whole simulation time each reason kept the skill from casting while it was ready; reasons can overlap, so they do not add up\./.test(body), body);
    check('the pop-up is dark', await js(`getComputedStyle(document.querySelector('#heldByTriggerModal .modal-content')).backgroundColor !== 'rgb(255, 255, 255)'`));
    check('the modal title is the button text', await js(`document.querySelector('#heldByTriggerModal .modal-title').textContent.trim() === document.getElementById('heldByTriggerButton').textContent.trim()`));
    check('a previous-skill row has name and share on one line, with the same height as a condition row', await js(`(() => { const r = document.querySelector('#heldSkipGroup .held-line'), cond = document.querySelector('#heldTriggerGroup .held-line'); if (!r || !cond) return false; const a = r.children[0].getBoundingClientRect(), b = r.children[1].getBoundingClientRect(); return Math.abs(a.top - b.top) < 2 && Math.abs(r.getBoundingClientRect().height - cond.getBoundingClientRect().height) < 2; })()`));
    check('both group headings read "Held by trigger" / "A previous skill was out of mana", same style and indent', await js(`(() => { const h = [...document.querySelectorAll('#heldByTriggerBody .held-group')]; if (h.length !== 2 || h[0].textContent.trim() !== 'Held by trigger') return false; const a = h[0].getBoundingClientRect(), b = h[1].getBoundingClientRect(), sa = getComputedStyle(h[0]), sb = getComputedStyle(h[1]); return Math.abs(a.left - b.left) < 1 && sa.fontSize === sb.fontSize && sa.fontWeight === sb.fontWeight; })()`));
    check('skill names sit at one indent in both groups, conditions deeper, headings shallowest', await js(`(() => { const x = (s) => { const r = document.createRange(); r.selectNodeContents(document.querySelector(s)); return r.getBoundingClientRect().left; }; const t = x('#heldTriggerGroup .held-ability span'), k = x('#heldSkipGroup .held-skill .col-9 span'), c = x('#heldTriggerGroup .held-condition .col-9'), g = x('#heldTriggerGroup .held-group'); return Math.abs(t - k) < 1 && c > t + 10 && t > g + 10; })()`));
    const sh = await js(`[...document.querySelectorAll('#heldByTriggerBody .held-line .text-end')].map((e) => e.textContent.trim())`);
    check('every share has two decimals', sh.length > 0 && sh.every((x) => /^[0-9]+[.][0-9]{2}%$/.test(x)), JSON.stringify(sh));
    await shot('held-popup.png', '#heldByTriggerModal .modal-content');
    page.close();
} finally {
    await chrome.close();
    runner.kill();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
