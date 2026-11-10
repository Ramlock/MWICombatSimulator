// Test: the built page's all-zones result (dist/) draws the XP-vs-profit chart, in our own headless Chrome. The page's Worker is replaced by a stub
// that answers an all-zones start with synthetic simulation results (no simulation runs), so the real result pipeline (display rows, table, chart) is exercised.
// Generic fixture. Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/xp-chart-page.mjs        Exit code 0 on pass, 1 on fail.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../chrome-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
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

// Synthetic results: 3 players, 5 maps. Profit is minus the consumables' price (item price 100 each, no drops), so a map's Y is set by `used`.
// `hours` is the run length; the jungle map is a 12 h run with the same consumables as aqua tier 1 (24 h): its Y must be twice that one's.
const maps = [
    { zone: '/actions/combat/swamp_planet', tier: 0, hours: 24, xp: [1000, 2000, 3000], used: [10, 20, 30], deaths: [0, 0, 0] },
    { zone: '/actions/combat/swamp_planet', tier: 1, hours: 24, xp: [2000, 3000, 4000], used: [40, 40, 40], deaths: [1, 0, 0] },
    { zone: '/actions/combat/aqua_planet', tier: 0, hours: 24, xp: [500, 500, 500], used: [50, 50, 50], deaths: [0, 0, 0] },
    { zone: '/actions/combat/aqua_planet', tier: 1, hours: 24, xp: [3000, 3000, 3000], used: [20, 20, 20], deaths: [0, 2, 0] },
    { zone: '/actions/combat/jungle_planet', tier: 0, hours: 12, xp: [3000, 3000, 3000], used: [20, 20, 20], deaths: [0, 0, 0] },
];
// xp is per hour: the stub gives each player xp * hours in total, half Attack and half Melee.
const synthetic = maps.map((m) => {
    const T = m.hours * 3600 * 1e9;
    const sr = { zoneName: m.zone, difficultyTier: m.tier, simulatedTime: T, encounters: 100, numberOfPlayers: 3, isLabyrinth: false, deaths: {}, experienceGained: {}, consumablesUsed: {}, dropRateMultiplier: {}, rareFindMultiplier: {}, combatDropQuantity: {}, debuffOnLevelGap: {} };
    [1, 2, 3].forEach((n, i) => {
        const p = 'player' + n;
        sr.deaths[p] = m.deaths[i];
        sr.experienceGained[p] = { attack: m.xp[i] * m.hours / 2, melee: m.xp[i] * m.hours / 2 };
        sr.consumablesUsed[p] = { '/items/test_potion': m.used[i] };
        sr.dropRateMultiplier[p] = 1; sr.rareFindMultiplier[p] = 1; sr.combatDropQuantity[p] = 0; sr.debuffOnLevelGap[p] = 0;
    });
    return sr;
});

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-chart-'));
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const setSelect = (id, value) => js(`(() => { const e = document.getElementById('${id}'); e.value = '${value}'; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const pickedCount = () => js(`document.querySelectorAll('#allZonesData tr.xp-chart-picked').length`);
    // The stub: every Worker the page makes ignores messages, except an all-zones start, which is answered with the synthetic results.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__synthetic = ${JSON.stringify(synthetic)};
        window.Worker = class { constructor() { this.onmessage = null; } terminate() {} addEventListener() {}
            postMessage(m) { if (m.type === 'start_simulation_all_zones') setTimeout(() => this.onmessage && this.onmessage({ data: { type: 'simulation_result_allZones', simResults: window.__synthetic } }), 50); } };` });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: base });
    check('the page loads with its zones', await until(`document.getElementById('selectZone')?.options.length > 3`, 30000));
    check('the page is dark', await js(`document.body.classList.contains('dark-mode')`));
    await js(`window.alert = () => {}; for (const i of [1, 2, 3]) { const c = document.getElementById('player' + i); if (c && !c.checked) c.click(); } document.getElementById('simAllZoneToggle').click(); true`);
    await sleep(300);
    await js(`window.prices = { '/items/test_potion': { bid: 100, ask: 100, vendor: 1 } }; document.getElementById('buttonStartSimulation').click(); true`);
    check('the result arrives (5 maps x 3 players = 15 rows)', await until(`document.querySelectorAll('#allZonesData tbody tr').length === 15`, 20000), String(await js(`document.querySelectorAll('#allZonesData tbody tr').length`)));
    await js(`document.getElementById('buttonShowAllSimData').click(); true`);
    check('the dialog opens', await until(`document.getElementById('allSimsModal').classList.contains('show') && document.getElementById('xpChartCanvas').getBoundingClientRect().width > 0`, 10000));

    // The table is exactly what it was: 16 columns, the old headers, no chart column, no extra cell.
    const table = await js(`({ heads: [...document.querySelectorAll('#allZonesData thead th')].map((t) => t.dataset.i18n), cells: [...document.querySelectorAll('#allZonesData tbody tr')].map((r) => r.children.length) })`);
    check('the table has exactly its 16 old columns', table.heads.length === 16 && table.heads[15] === 'common:noRNGProfit' && table.heads[0] === 'common:zoneName', JSON.stringify(table.heads));
    check('every table row has exactly 16 cells', table.cells.every((n) => n === 16), JSON.stringify(table.cells));
    const profitCells = await js(`[...document.querySelectorAll('#allZonesData tbody tr')].map((r) => Number(r.children[15].dataset.sortValue))`);
    check('the profit column is still the run total: 10 potions at 100 = -1000, 20 = -2000', profitCells[0] === -1000 && profitCells[1] === -2000, JSON.stringify(profitCells.slice(0, 3)));

    // The chart.
    const chartState = () => js(`(() => { const c = Chart.getChart('xpChartCanvas'); const m = (ds) => c.data.datasets[ds].data.map((d) => [d.point.zone.split('/').pop(), d.point.tier, d.x, d.y]); return { frontier: m(0), others: m(1), xTitle: c.options.scales.x.title.text, yTitle: c.options.scales.y.title.text }; })()`);
    let s = await chartState();
    check('Party, Total: one dot per map (5)', s.frontier.length + s.others.length === 5, JSON.stringify(s));
    const all = [...s.frontier, ...s.others];
    const find = (list, zone, tier) => list.find((d) => d[0] === zone && d[1] === tier);
    check('Party X is the mean over the players, per hour (swamp tier 0: 2000)', find(all, 'swamp_planet', 0)[2] === 2000, JSON.stringify(find(all, 'swamp_planet', 0)));
    check('Y of a 24 h run is minus the potions\' price per day: swamp tier 0, mean of 10/20/30 potions at 100 = -2000', find(all, 'swamp_planet', 0)[3] === -2000);
    check('a 12 h run with the same potions has twice the Y of the 24 h one (jungle vs aqua tier 1)', find(all, 'jungle_planet', 0)[3] === 2 * find(all, 'aqua_planet', 1)[3], JSON.stringify([find(all, 'jungle_planet', 0), find(all, 'aqua_planet', 1)]));
    check('no frontier dot is beaten on both axes, every other dot is', s.frontier.length >= 1 && s.frontier.every((f) => !all.some((o) => o !== f && o[2] >= f[2] && o[3] >= f[3] && (o[2] > f[2] || o[3] > f[3]))) && s.others.every((f) => all.some((o) => o !== f && o[2] >= f[2] && o[3] >= f[3] && (o[2] > f[2] || o[3] > f[3]))));
    const titles = await js(`({ y: i18next.t('common:xpChart.profitPerDay'), x: i18next.t('common:simulationResults.totalExperience') })`);
    check('the axis titles are the table header text + "per hour", and Profit per day', s.xTitle === titles.x + ' per hour' && s.yTitle === titles.y && titles.y === 'Profit per day', JSON.stringify([s.xTitle, s.yTitle]));

    // Selectors change the points.
    const options = await js(`({ skill: [...document.getElementById('xpChartSkill').options].map((o) => o.value), player: [...document.getElementById('xpChartPlayer').options].map((o) => o.value) })`);
    check('the XP selector: Total first, then the seven skills', options.skill.join() === 'TotalExperience,Stamina,Intelligence,Attack,Melee,Defense,Ranged,Magic', options.skill.join());
    check('the player selector: Party first, then each player', options.player.join() === 'Party,player1,player2,player3', options.player.join());
    await setSelect('xpChartPlayer', 'player3');
    s = await chartState();
    const p3 = find([...s.frontier, ...s.others], 'swamp_planet', 0);
    check('a specific player: that player\'s row (3000 xp per hour, 30 potions = -3000)', p3[2] === 3000 && p3[3] === -3000, JSON.stringify(p3));
    await setSelect('xpChartSkill', 'Attack');
    s = await chartState();
    const pa = find([...s.frontier, ...s.others], 'swamp_planet', 0);
    check('a skill: that skill\'s XP only (half of the total in the fixture)', pa[2] === 1500, JSON.stringify(pa));
    check('the X axis title follows the skill, per hour', s.xTitle === (await js(`i18next.t('skillNames./skills/attack')`)) + ' per hour', s.xTitle);

    // Click a dot: the table rows of that map are scrolled into view and highlighted; Party highlights every player of the map.
    const clickDot = async (ds, i) => {
        await js(`document.getElementById('xpChartPanel').scrollIntoView({ block: 'start' }); true`);
        await sleep(150);
        const pos = await js(`(() => { const c = Chart.getChart('xpChartCanvas'); const e = c.getDatasetMeta(${ds}).data[${i}]; const r = c.canvas.getBoundingClientRect(); return [r.left + e.x, r.top + e.y]; })()`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: pos[0], y: pos[1], button: 'left', clickCount: 1 });
        await sleep(300);
    };
    await setSelect('xpChartPlayer', 'Party');
    await clickDot(0, 0);
    let picked = await js(`[...document.querySelectorAll('#allZonesData tr.xp-chart-picked')].map((r) => r.dataset.mapKey + '#' + r.dataset.player)`);
    const f0 = (await chartState()).frontier[0];
    check('a click on a Party dot highlights the map\'s three player rows', picked.length === 3 && picked.every((k) => k.startsWith('/actions/combat/' + f0[0] + '|' + f0[1] + '#')), JSON.stringify([picked, f0]));
    check('the highlighted row is in view', await js(`(() => { const r = document.querySelector('#allZonesData tr.xp-chart-picked').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()`));
    await setSelect('xpChartPlayer', 'player2');
    check('changing a selector clears the highlight', (await pickedCount()) === 0);
    await clickDot(0, 0);
    picked = await js(`[...document.querySelectorAll('#allZonesData tr.xp-chart-picked')].map((r) => r.dataset.player)`);
    check('a click with a specific player highlights only that player\'s row', picked.length === 1 && picked[0] === 'player2', JSON.stringify(picked));
    await js(`document.querySelectorAll('#allZonesData th')[5].click(); true`);
    check('a re-sort clears the highlight', (await pickedCount()) === 0);
    await clickDot(0, 0);
    await js(`bootstrap.Modal.getInstance(document.getElementById('allSimsModal')).hide(); true`);
    await sleep(800);
    check('closing the dialog clears the highlight', (await pickedCount()) === 0);

    // Hover: the tooltip holds the map name, the tier, X per hour, Y per day and the deaths per hour.
    await js(`document.getElementById('buttonShowAllSimData').click(); true`);
    await until(`document.getElementById('allSimsModal').classList.contains('show') && document.getElementById('xpChartCanvas').getBoundingClientRect().width > 0`, 10000);
    await sleep(700);
    await setSelect('xpChartPlayer', 'Party'); await setSelect('xpChartSkill', 'TotalExperience');
    await js(`document.getElementById('xpChartPanel').scrollIntoView({ block: 'start' }); true`);
    let tip = null, hpos = null;
    for (let attempt = 0; attempt < 6 && !(tip && tip.opacity > 0); attempt++) {
        await sleep(500);
        hpos = await js(`(() => { const c = Chart.getChart('xpChartCanvas'); const e = c.getDatasetMeta(0).data[0]; const r = c.canvas.getBoundingClientRect(); return [r.left + e.x, r.top + e.y, innerWidth, innerHeight, c.canvas.width, r.width]; })()`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hpos[0] - 3, y: hpos[1] - 3 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hpos[0], y: hpos[1] });
        await sleep(400);
        tip = await js(`(() => { const t = Chart.getChart('xpChartCanvas').tooltip; return { opacity: t.opacity, title: t.title, lines: t.body.flatMap((b) => b.lines), tier: t.dataPoints?.[0]?.raw?.point?.tier }; })()`);
        tip.pos = hpos;
    }
        check('hover shows the translated map name, tier, X per hour, Y per day and deaths per hour', tip.opacity > 0 && tip.title.length === 1 && tip.title[0] !== '' && !tip.title[0].startsWith('/') && tip.lines.length === 4 && tip.lines[0] === `Difficulty: ${tip.tier}` && / per hour: /.test(tip.lines[1]) && /^Profit per day: /.test(tip.lines[2]) && /^Deaths Per Hour: /.test(tip.lines[3]), JSON.stringify(tip));
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });

    // Layout, at two sizes: no horizontal bar, the chart inside the dialog, 360 px high.
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await js(`document.getElementById('buttonShowAllSimData').click(); true`);
        await until(`document.getElementById('allSimsModal').classList.contains('show')`, 5000);
        await sleep(700);
        const m = await js(`(() => { const body = document.querySelector('#allSimsModal .modal-body'), dlg = document.querySelector('#allSimsModal .modal-content').getBoundingClientRect(), cv = document.getElementById('xpChartCanvas').getBoundingClientRect(), panel = document.getElementById('xpChartPanel'), tbl = document.getElementById('allZonesData').getBoundingClientRect(), modal = document.getElementById('allSimsModal'); return { hBar: Math.max(body.scrollWidth - body.clientWidth, modal.scrollWidth - modal.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth), panelOverflow: panel.scrollWidth - panel.clientWidth, tableWiderThanBody: Math.round(tbl.width - body.clientWidth), chartInside: cv.left >= dlg.left && cv.right <= dlg.right, chartHeight: Math.round(cv.height), chartWidth: Math.round(cv.width) }; })()`);
        console.log('measure ' + w + 'x' + h + ' ' + JSON.stringify(m));
        // The chart panel never adds width. A bar that remains is the table's own: its 16 columns have a 90 px minimum, wider than the body at 1366.
        check(`${w}x${h}: the chart panel adds no width, the chart is inside the dialog and 360 px high; a horizontal bar exists only if the table alone is wider than the body`, m.panelOverflow <= 0 && m.chartInside && m.chartHeight === 360 && (m.hBar === 0 || m.tableWiderThanBody > 0), JSON.stringify(m));
        await js(`bootstrap.Modal.getInstance(document.getElementById('allSimsModal')).hide(); true`);
        await sleep(500);
    }
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
