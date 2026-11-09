// Charts of a charm what-if (tools/whatif/charm.mjs), drawn from its result.json only: a dark SVG page, screenshotted
// with our own headless Chrome (tools/chrome-launcher.mjs). Lines are told apart by dash pattern and marker shape and
// labelled directly, never by colour alone.
// Usage: node tools/whatif/charm-charts.mjs --dir <the charm.mjs --out dir>
// Writes <dir>/charts.html and <dir>/chart-gain.png, chart-payback.png, chart-levels.png.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchChrome } from '../chrome-launcher.mjs';

const i = process.argv.indexOf('--dir');
const DIR = i > 0 ? process.argv[i + 1] : null;
if (!DIR) throw new Error('--dir required');
const R = JSON.parse(readFileSync(path.join(DIR, 'result.json'), 'utf8'));
const W = 1200, H = 700, P = { l: 90, r: 230, t: 70, b: 70 };
const FG = '#e6e6e6', DIM = '#8a8a8a', BG = '#121212', GRID = '#2a2a2a';
const DASH = ['', '10 6', '3 5', '14 5 3 5', '6 3'];
const MARK = ['circle', 'square', 'triangle', 'diamond', 'cross'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const M = (x) => (Math.abs(x) >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : (x / 1e3).toFixed(0) + 'K');
const nice = (lo, hi, n = 6) => { const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= step0); const out = []; for (let v = Math.floor(lo / step) * step; ; v += step) { out.push(+v.toFixed(10)); if (v >= hi - 1e-9) break; } return out; }; // covers [lo, hi]
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.fill || FG}" font-size="${o.size || 16}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const marker = (k, x, y, r = 6, fill = FG) => {
    switch (MARK[k % MARK.length]) {
        case 'circle': return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
        case 'square': return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}"/>`;
        case 'triangle': return `<polygon points="${x},${y - r - 1} ${x - r},${y + r} ${x + r},${y + r}" fill="${fill}"/>`;
        case 'diamond': return `<polygon points="${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}" fill="${fill}"/>`;
        default: return `<path d="M${x - r},${y - r}L${x + r},${y + r}M${x - r},${y + r}L${x + r},${y - r}" stroke="${fill}" stroke-width="3"/>`;
    }
};
function frame(title, sub, xs, ys, fx, fy, xLabel, yLabel, yFmt = M) {
    let s = `<rect width="${W}" height="${H}" fill="${BG}"/>` + text(P.l, 32, title, { size: 22, weight: 'bold' }) + text(P.l, 56, sub, { size: 14, fill: DIM });
    for (const y of ys) s += `<line x1="${P.l}" x2="${W - P.r}" y1="${fy(y)}" y2="${fy(y)}" stroke="${GRID}"/>` + text(P.l - 10, fy(y) + 5, yFmt(y), { anchor: 'end', size: 14, fill: DIM });
    for (const x of xs) s += `<line x1="${fx(x)}" x2="${fx(x)}" y1="${P.t}" y2="${H - P.b}" stroke="${GRID}"/>` + text(fx(x), H - P.b + 22, x, { anchor: 'middle', size: 14, fill: DIM });
    s += text((P.l + W - P.r) / 2, H - 20, xLabel, { anchor: 'middle', size: 15 }) + `<text x="22" y="${(P.t + H - P.b) / 2}" fill="${FG}" font-size="15" text-anchor="middle" transform="rotate(-90 22 ${(P.t + H - P.b) / 2})">${esc(yLabel)}</text>`;
    return s;
}
const scale = (lo, hi, a, b) => (v) => a + ((v - lo) / (hi - lo || 1)) * (b - a);
const charms = R.charms.filter((c) => c.branches.some((b) => b.gainUser !== undefined));

// (a) Gain per day against the charm skill's level gained, one line per charm, the best point marked.
function chartGain() {
    const pts = charms.map((c) => ({ c, p: c.branches.filter((b) => b.gainUser !== undefined).map((b) => ({ x: b.level - R.start.lv[c.skill], y: b.gainUser, b })) }));
    const all = pts.flatMap((q) => q.p);
    const xs = nice(0, Math.max(...all.map((p) => p.x))), ys = nice(Math.min(0, ...all.map((p) => p.y - p.b.se)), Math.max(...all.map((p) => p.y + p.b.se)) * 1.08);
    const fx = scale(0, xs.at(-1), P.l, W - P.r), fy = scale(ys[0], ys.at(-1), H - P.b, P.t);
    let s = frame('Permanent profit gain per day if the charm is sold at that level', `Per user, against keeping the ${R.baselineCharm.hrid.split('/')[2].replace(/_/g, ' ')} +${R.baselineCharm.level} on. ± one standard error shown as a bar. Big ring: each charm's best point.`, xs, ys, fx, fy, 'Levels gained in the charm\'s own skill', 'Gain per day (per user)');
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${fy(0)}" y2="${fy(0)}" stroke="${DIM}" stroke-width="1.5"/>`;
    pts.forEach(({ c, p }, k) => {
        s += `<polyline points="${p.map((q) => fx(q.x) + ',' + fy(q.y)).join(' ')}" fill="none" stroke="${FG}" stroke-width="2.5" stroke-dasharray="${DASH[k % DASH.length]}"/>`;
        for (const q of p) s += `<line x1="${fx(q.x)}" x2="${fx(q.x)}" y1="${fy(q.y - q.b.se)}" y2="${fy(q.y + q.b.se)}" stroke="${DIM}"/>` + marker(k, fx(q.x), fy(q.y));
        const pk = c.peak && p.find((q) => q.b.level === c.peak.level);
        if (pk) s += `<circle cx="${fx(pk.x)}" cy="${fy(pk.y)}" r="13" fill="none" stroke="${FG}" stroke-width="2"/>`;
        const last = p.at(-1);
        const ly = P.t + 20 + k * 52; // legend rows, not at the line ends, so labels never overlap
        s += marker(k, W - P.r + 18, ly) + `<line x1="${W - P.r + 30}" x2="${W - P.r + 70}" y1="${ly}" y2="${ly}" stroke="${FG}" stroke-width="2.5" stroke-dasharray="${DASH[k % DASH.length]}"/>` + text(W - P.r + 78, ly + 5, `${c.skill} (${R.start.lv[c.skill]}→${last.b.level})`, { size: 15 });
        if (pk) s += text(W - P.r + 30, ly + 24, `best: level ${pk.b.level}, ${M(pk.y)}/day`, { size: 13, fill: DIM });
    });
    return s;
}

// (b) Payback days per charm at its best point: per user (headline) and per party.
function chartPayback() {
    const rows = charms.filter((c) => c.peak?.paybackUserDays !== undefined).map((c) => ({ c, u: c.peak.paybackUserDays, p: c.peak.paybackPartyDays }));
    const fin = rows.flatMap((r) => [r.u, r.p]).filter(Number.isFinite);
    const xs = nice(0, Math.max(1, ...fin));
    const fx = scale(0, xs.at(-1), P.l + 130, W - P.r), rowH = (H - P.t - P.b) / Math.max(1, rows.length);
    let s = `<rect width="${W}" height="${H}" fill="${BG}"/>` + text(P.l, 32, 'Days until the charm pays for itself, sold at its best level', { size: 22, weight: 'bold' }) + text(P.l, 56, 'Thick bar: per user (his own coin against his share of the gain). Thin bar: against the whole party\'s gain. Cost includes the wear-day profit.', { size: 14, fill: DIM });
    for (const x of xs) s += `<line x1="${fx(x)}" x2="${fx(x)}" y1="${P.t}" y2="${H - P.b}" stroke="${GRID}"/>` + text(fx(x), H - P.b + 22, x, { anchor: 'middle', size: 14, fill: DIM });
    s += text((P.l + W - P.r) / 2, H - 20, 'Days', { anchor: 'middle', size: 15 });
    rows.forEach(({ c, u, p }, k) => {
        const y = P.t + k * rowH + rowH / 2;
        const bar = (v, h, dy, fill) => (Number.isFinite(v) ? `<rect x="${fx(0)}" y="${y + dy}" width="${fx(v) - fx(0)}" height="${h}" fill="${fill}"/>` : '');
        s += text(P.l + 120, y + 5, `${c.skill} (sell at ${c.peak.level})`, { anchor: 'end', size: 15 });
        s += bar(u, 26, -24, FG) + text(Number.isFinite(u) ? fx(u) + 8 : fx(0) + 8, y - 5, Number.isFinite(u) ? `${u.toFixed(0)} days per user` : 'never pays per user', { size: 14 });
        s += bar(p, 8, 8, DIM) + text(Number.isFinite(p) ? fx(p) + 8 : fx(0) + 8, y + 16, Number.isFinite(p) ? `${p.toFixed(0)} days party` : 'never pays', { size: 13, fill: DIM });
    });
    return s;
}

// (c) The charm skill's level against days, each charm's run against the baseline: one panel per charm.
function chartLevels() {
    const n = charms.length, cols = 2, rows = Math.ceil(n / cols), pw = (W - 60) / cols, ph = (H - 90) / rows;
    let s = `<rect width="${W}" height="${H}" fill="${BG}"/>` + text(40, 32, 'Level of the charm\'s skill over the days worn', { size: 22, weight: 'bold' }) + text(40, 56, `Solid: wearing that charm. Dotted: the baseline (${R.baselineCharm.hrid.split('/')[2].replace(/_/g, ' ')} +${R.baselineCharm.level}) over the same days.`, { size: 14, fill: DIM });
    const step = (segs, sk, fx, fy, end) => segs.map((g, j) => `${j ? 'L' : 'M'}${fx(g.t0 / 24)},${fy(g.lv[sk])}L${fx(Math.min(g.t1 / 24, end))},${fy(g.lv[sk])}`).join('');
    charms.forEach((c, k) => {
        const ox = 30 + (k % cols) * pw, oy = 70 + Math.floor(k / cols) * ph, q = { l: ox + 55, r: ox + pw - 20, t: oy + 30, b: oy + ph - 40 };
        const days = Math.max(c.levels.at(-1)?.t1 ?? 0, 1) / 24;
        const base = R.baseline.filter((g) => g.t0 / 24 < days);
        const lv = [...c.levels.map((g) => g.lv[c.skill]), ...base.map((g) => g.lv[c.skill])];
        const ys = nice(Math.min(...lv), Math.max(...lv) + 1, 4), xs = nice(0, days, 5);
        const fx = scale(0, xs.at(-1), q.l, q.r), fy = scale(ys[0], ys.at(-1), q.b, q.t);
        s += text(q.l, oy + 18, `${c.skill} charm`, { size: 17, weight: 'bold' });
        for (const y of ys) s += `<line x1="${q.l}" x2="${q.r}" y1="${fy(y)}" y2="${fy(y)}" stroke="${GRID}"/>` + text(q.l - 8, fy(y) + 5, y, { anchor: 'end', size: 13, fill: DIM });
        for (const x of xs) s += text(fx(x), q.b + 18, x, { anchor: 'middle', size: 13, fill: DIM });
        s += text((q.l + q.r) / 2, q.b + 34, 'days', { anchor: 'middle', size: 13, fill: DIM });
        s += `<path d="${step(base, c.skill, fx, fy, days)}" fill="none" stroke="${DIM}" stroke-width="2.5" stroke-dasharray="3 5"/>`;
        s += `<path d="${step(c.levels, c.skill, fx, fy, days)}" fill="none" stroke="${FG}" stroke-width="2.5"/>`;
        const e = c.levels.at(-1), eb = base.at(-1);
        if (e) s += text(fx(days) - 4, fy(e.lv[c.skill]) - 8, `worn: ${e.lv[c.skill]}`, { anchor: 'end', size: 13 });
        if (eb) s += text(fx(days) - 4, fy(eb.lv[c.skill]) - 8, `baseline: ${eb.lv[c.skill]}`, { anchor: 'end', size: 13, fill: DIM });
    });
    return s;
}

const charts = [['chart-gain', chartGain()], ['chart-payback', chartPayback()], ['chart-levels', chartLevels()]];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${BG};font-family:Segoe UI,Arial,sans-serif}svg{display:block;margin:0 0 20px 0}</style></head><body>${charts.map(([id, s]) => `<svg id="${id}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`).join('')}</body></html>`;
const htmlFile = path.join(DIR, 'charts.html');
writeFileSync(htmlFile, html);
const prof = mkdtempSync(path.join(os.tmpdir(), 'charm-charts-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: W + 40, height: H * 3 + 120 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: 'file:///' + htmlFile.replace(/\\/g, '/') });
    await new Promise((r) => setTimeout(r, 1500));
    for (const [id] of charts) {
        const r = await page.send('Runtime.evaluate', { expression: `(() => { const b = document.getElementById('${id}').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`, returnByValue: true });
        const [x, y, width, height] = r.result.value;
        const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        writeFileSync(path.join(DIR, id + '.png'), Buffer.from(shot.data, 'base64'));
        console.log('wrote', path.join(DIR, id + '.png'));
    }
    page.close();
} finally { await chrome.close(); try { rmSync(prof, { recursive: true, force: true }); } catch {} }
