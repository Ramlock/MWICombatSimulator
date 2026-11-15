// Measures how fast the What-if window's buttons act on a real search, at the runner's interface, on a full CPU: Start (the request until the
// search runs), Skip and Accept (the press until the race part that ran is no longer the running one: the window then shows the next part or
// the result), Stop (the press until the search is stopped), Resume (the press on the stopped search until it runs again). Each is timed from
// the POST to the first poll that shows the change (polls every 50 ms). Also the runner's /api/version answer time under that load (the port
// holder probe's wait, holderVersion). Generic two-player party, no private data; the real optimizer on every core (no core limit), as the
// runner forks it (lowest priority; the runner's own server one step above). Results go to a temporary folder, removed at the end.
// Usage: node tools/whatif/measure-buttons.mjs [--rounds <n>]   Prints one line per figure and a JSON line; run it under HeavyRun.
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await import(pathToFileURL(path.join(root, 'tools/whatif/runner/server.mjs')).href);
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const presses = Number(opt('rounds', 2)); // Skip and Accept presses each (alternating)
const stamp = () => new Date().toISOString();
const log = (s) => console.log(`${stamp()} ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const generic = (name, weapon, head) => ({
    name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
        { itemLocationHrid: '/item_locations/main_hand', itemHrid: weapon, enhancementLevel: 0 },
        { itemLocationHrid: '/item_locations/head', itemHrid: head, enhancementLevel: 0 }] },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] },
});
const big = JSON.parse(readFileSync(path.join(root, 'tools/calibration/marketplace-2026-11-03.json'), 'utf8'));
const req = {
    setups: [generic('Alpha', '/items/cheese_sword', '/items/cheese_helmet'), generic('Beta', '/items/cheese_mace', '/items/cheese_helmet')],
    options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, marketplace: { ...big, timestamp: 1700000000 } },
    goal: 'profit', budgets: { Alpha: 1e9, Beta: 1e9 }, levers: ['all'], unitHours: 50, confirmHours: 50, firstSeeds: 4, leaders: 4, maxUp: 2, swaps: false,
};

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whatif-measure-'));
const runner = R.createRunner({ resultsDir: tmp, distDir: path.join(root, 'dist') });
const base = (await runner.listen(0)).replace(/\/$/, '');
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
let id = null;
const status = () => call('GET', '/api/search/' + id);
const running = (s) => (s.state === 'running' ? (s.progress?.parts || []).find((r) => r.state === 'running') : null);
const key = (r) => (r ? r.kind + ':' + (r.index ?? 0) : null);
// Time from the action to the first poll for which `done(status)` holds.
async function timed(act, done, limit = 120000) {
    const t0 = performance.now();
    await act();
    for (;;) { const s = await status(); if (done(s)) return Math.round(performance.now() - t0); if (performance.now() - t0 > limit) throw new Error('timed out'); await sleep(50); }
}
async function untilRace(limit = 600000) {
    const t0 = Date.now();
    for (;;) {
        const s = await status(), r = running(s);
        if (s.state !== 'running') return null;
        if (r && r.round !== undefined && r.round !== null && (r.runsDone ?? 0) > 0) { await sleep(1500); const s2 = await status(), r2 = running(s2); if (key(r2) === key(r)) return r2; }
        if (Date.now() - t0 > limit) return null;
        await sleep(200);
    }
}
const figures = { start: null, skip: [], accept: [], stop: [], resume: null, version: [] };
try {
    const t0 = performance.now();
    id = (await call('POST', '/api/search', req)).id;
    for (;;) { const s = await status(); if (s.state === 'running') break; await sleep(50); }
    figures.start = Math.round(performance.now() - t0);
    log(`Start ${figures.start} ms (search ${id})`);
    // Stop and Resume first, twice each, while runs are in flight (the search may end after a few stage presses).
    figures.resume = [];
    for (let i = 0; i < 2; i++) {
        await sleep(6000);
        if ((await status()).state !== 'running') { log('the search is not running: no Stop to time'); break; }
        const stopMs = await timed(() => call('POST', `/api/search/${id}/stop`), (s) => s.state !== 'running');
        figures.stop.push(stopMs);
        log(`Stop ${stopMs} ms (${(await status()).state})`);
        if ((await status()).state !== 'stopped') break;
        const resumeMs = await timed(() => call('POST', `/api/search/${id}/stop`), (s) => s.state === 'running');
        figures.resume.push(resumeMs);
        log(`Resume ${resumeMs} ms`);
    }
    for (let i = 0; i < presses * 2; i++) {
        const mode = i % 2 ? 'accept' : 'skip';
        const r = await untilRace();
        if (!r) { log(`no race part to ${mode} (search ${(await status()).state})`); break; }
        for (let v = 0; v < 3; v++) { const a = performance.now(); await call('GET', '/api/version'); figures.version.push(Math.round(performance.now() - a)); }
        const k = key(r);
        const ms = await timed(() => call('POST', `/api/search/${id}/done`, { mode }), (s) => key(running(s)) !== k);
        figures[mode].push(ms);
        log(`${mode === 'skip' ? 'Skip' : 'Accept'} ${ms} ms (part ${k}, round ${r.round}, ${r.runsDone} runs done)`);
    }
    log(`/api/version under load: ${figures.version.join(', ')} ms`);
    console.log(JSON.stringify(figures));
} finally {
    try { if (id && (await status()).state === 'running') await call('POST', `/api/search/${id}/stop`); } catch { /* the runner is gone */ }
    await sleep(3000);
    runner.server.close();
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a run process still holds a file */ }
}
process.exit(0);
