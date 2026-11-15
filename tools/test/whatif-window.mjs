// Test: the What-if window in the built page (dist/), driven in our own headless Chrome against a fake runner that
// implements the runner's interface (docs/codebase/whatif-window.md): the button shows only when /api/version answers,
// the window sends the page's party, budgets and levers, shows progress, Stop and Resume, shows the result, and Apply
// writes into the page's setup (a player the page lacks is named, nothing applied).
// Needs a built dist/ (npx webpack) and network for the page's CDN scripts.
// Usage: node tools/test/whatif-window.mjs [--shots <dir>]   Exit code 0 on pass, 1 on fail. --shots saves dark pictures.
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

// ---- The fake runner ----
const result = {
    goal: 'profit', budgets: { 'Player 1': 1000000 },
    setups: [],
    steps: [
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', fresh: { seeds: 32, seedFrom: 20001, seedTo: 20032, gain: 800, se: 120, gainPerUser: 266, sePerUser: 40, buyerNet: 3300, buyerNetSe: 150, accepted: true }, gain: 900, se: 100, gainPerUser: 300, sePerUser: 33, sharedGainPerUser: 4100, sharedSePerUser: 310, ownSuppliesPerDay: -12500, ownSuppliesSe: 400, buyerNet: 3500, buyerNetSe: 120, paybackOwn: 15.1, cost: 250000, costBound: 'upper', payback: 277.8, costPath: 'books', note: '25 x berserk; upper bound (XP inside the level unknown)', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 's2', player: 'Player 1', desc: 'Player 1 body rainbow_plate_body +4 -> +6', gain: 400, se: 90, gainPerUser: 133, sePerUser: 30, sharedGainPerUser: 900, sharedSePerUser: 70, ownSuppliesPerDay: 1100, ownSuppliesSe: 50, buyerNet: -200, buyerNetSe: 60, paybackOwn: null, cost: 1235000000, payback: 750, costPath: 'buy, sell old', note: '', to: 6, accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'stamina', delta: 1 }] },
    ],
    confirmation: { gain: 1250, se: 140, gainPerUser: 417, sePerUser: 47, sharedGainPerUser: 5000, sharedSePerUser: 330, buyerByPlayer: { 'Player 1': { gain: 3300, se: 150, payback: 33.5 } }, cost: 550000, payback: 440 },
    singles: [
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', lastStage: '8x300', gain: 900, se: 100, gainPerUser: 300, sePerUser: 33, sharedGainPerUser: 4100, sharedSePerUser: 310, ownSuppliesPerDay: -12500, ownSuppliesSe: 400, buyerNet: 3500, buyerNetSe: 120, paybackOwn: 15.1, cost: 250000, payback: 277.8, costPath: 'days of play', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 'x', player: 'Nobody', desc: 'Attack 1 → 2', lastStage: '4x50', gain: 10, se: 80, gainPerUser: 3, sePerUser: 27, sharedGainPerUser: 50, sharedSePerUser: 60, ownSuppliesPerDay: 70, ownSuppliesSe: 5, buyerNet: -20, buyerNetSe: 30, paybackOwn: null, cost: 100000, payback: null, costPath: 'days of play', accepted: false, ops: [{ op: 'level', player: 'Nobody', skill: 'attack', delta: 1 }] },

    ],
    notConfirmed: [{ id: 'nc', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', step: 2, fresh: { seeds: 64, seedFrom: 20001, seedTo: 20064, gain: 30, se: 20, gainPerUser: 10, sePerUser: 7, buyerNet: 40, buyerNetSe: 25, accepted: false }, cost: 100, costPath: 'market' }],
    apart: [{ id: 'u', desc: 'A token item', note: 'no seller' }],
    overBudget: [{ id: 'o', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', cost: 7000000000, costPath: 'market' }, { id: 'o2', player: 'Player 1', desc: 'Player 1 not_a_real_item_x +1 -> +2', cost: 8000000000, costPath: 'market' }, { id: 'o3', player: 'Player 1', desc: 'Player 1 body royal_nature_robe_top +10 -> rainbow_plate_body +10', cost: 12022450000, costPath: 'buy, sell old', note: '', to: 10 }],
    otherStyle: [{ id: 'Player 1:ability2=book:cleave@1', player: 'Player 1', slot: 'ability2', desc: 'Player 1 ability 3 empty -> learn cleave 1', from: null, to: { ability: '/abilities/cleave', level: 1 }, bound: { styles: ['slash'], elements: [] }, wants: { style: 'magic', element: 'fire', kind: 'magic' } }, { id: 'Player 1:body=rainbow_plate_body+0', player: 'Player 1', slot: 'body', desc: 'Player 1 body cotton_robe_top +0 -> rainbow_plate_body +0', from: { item: '/items/cotton_robe_top', level: 0 }, to: { item: '/items/rainbow_plate_body', level: 0 }, bound: { styles: [], elements: [], penalty: ['magicAccuracy'] }, wants: { style: 'magic', element: 'fire', kind: 'magic' } }],
    dominated: [{ id: 's1', player: 'Player 1', slot: 'feet', desc: 'Player 1 feet cotton_boots +0 -> pathseeker_boots_refined +0', from: { item: '/items/cotton_boots', level: 0 }, to: { item: '/items/pathseeker_boots_refined', level: 0 } }, { id: 's2', player: 'Player 1', slot: 'feet', desc: 'Player 1 not_a_real_item_x +1 -> +2', from: { item: '/items/not_a_real_item_x', level: 1 }, to: { item: '/items/not_a_real_item_x', level: 2 } }],
    overPayback: [{ id: 'sl', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', cost: 900000, costPath: 'market', paybackDays: 612 }, { id: 'sl2', player: 'Player 1', desc: 'Player 1 not_a_real_item_x +1 -> +2', cost: 800000, costPath: 'market', paybackDays: null }],
    options: { pricesTimestamp: 1700000000, pricesSource: 'snapshot', zone: '/actions/combat/fly', tier: 0, maxPaybackDays: 365 },
    basePerUser: -9666666.67,
    best: {
        foods: { 'Player 1': { items: [{ item: '/items/donut', trigger: 'self current_hp <= 60' }, { item: '/items/spaceberry_cake', trigger: null }], gain: 120, se: 30, stage: '8x300' }, Nobody: { items: [{ item: '/items/star_fruit_gummy', trigger: null }], unchanged: true } },
        drinks: { 'Player 1': { items: [{ item: '/items/attack_coffee' }, { item: '/items/wisdom_coffee' }], gain: 80, se: 20, stage: '8x300' } },
    },
};

// An earlier result, saved with a helps-the-party group and no buyer net: the group is no longer shown and nothing fails.
const olderResult = (() => { const strip = ({ buyerNet, buyerNetSe, fresh, ...r }) => { if (!fresh) return r; const { buyerNet: fb, buyerNetSe: fbs, ...f } = fresh; return { ...r, fresh: f }; }; return { ...result, steps: result.steps.map(strip), singles: result.singles.map(strip), confirmation: { gain: 1250, se: 140, gainPerUser: 417, sePerUser: 47, cost: 550000, payback: 440 }, helpsParty: [{ ...strip(result.singles[0]), id: 'hp', desc: 'Player 1 food 1 apple -> steak', helpsParty: true, accepted: false }] }; })();
// An invented result of real size: three budget players (a 11-column steps table), Change texts up to 119 characters, the split figures at their largest.
const bigResult = (() => {
    const names = ['Player 1', 'Player 2', 'Player 3'];
    const longDesc = (p, n) => (p + ' ability trigger: game default (all_enemies number_of_active_units >= 1 AND all_enemies current_hp >= 1 AND ' + 'x'.repeat(200)).slice(0, n);
    const big = { sharedGainPerUser: 1234.5e6, sharedSePerUser: 123.45e6, ownSuppliesPerDay: -1234.5e6, ownSuppliesSe: 12.3e6, buyerNet: 1234.5e6, buyerNetSe: 123.45e6, paybackOwn: 138.2, cost: 191.2e6, payback: 138.2, gainPerUser: 1234.5e6, sePerUser: 123.45e6, accepted: true };
    const op = (p) => [{ op: 'level', player: p, skill: 'magic', delta: 1 }];
    const steps = names.map((p, i) => ({ id: 'b' + i, player: p, desc: longDesc(p, 119), ...big, costPath: 'loadout tweak, used x buy price in expenses', note: 'a long note about how this one is bought, with several words', ops: op(p) }));
    const singles = names.flatMap((p, i) => [0, 1].map((k) => ({ id: 'bs' + i + k, player: p, desc: longDesc(p, k ? 119 : 60), lastStage: '8x300', ...big, costPath: 'loadout tweak, used x buy price in expenses', ops: op(p) })));
    singles.push({ id: 'bsx', player: 'Player 1', desc: 'Player 1 food: Spaceberry Cake -> Spaceberry Donut (trigger of Spaceberry Cake kept), Star Fruit Gummy -> Peach Gummy (trigger of Star Fruit Gummy kept), Star Fruit Yogurt -> Dragon Fruit Yogurt (trigger of Star Fruit Yogurt kept)', lastStage: '8x300', ...big, costPath: 'loadout tweak, used x buy price in expenses', ops: op('Player 1') });
    // A free change (cost 0): its Payback cell reads "N/A", in the steps table and in Each change alone.
    const free = { ...big, id: 'bfree', player: 'Player 2', desc: 'Player 2 poke trigger: game default (always)', cost: 0, payback: null, paybackOwn: null, costPath: 'loadout tweak', ops: op('Player 2') };
    steps.push(free);
    singles.push({ ...free, id: 'bsfree', lastStage: '8x300' });
    // The foods and drinks the search chose first: three players with several slots, a food with a long trigger.
    const longTrigger = 'all_enemies number_of_active_units >= 1 AND all_enemies current_hp >= 1 AND self current_mp <= 40';
    const best = {
        foods: Object.fromEntries(names.map((p) => [p, { items: ['donut', 'cake', 'gummy', 'yogurt', 'cupcake'].map((x, k) => ({ item: '/items/' + x, trigger: k < 2 ? longTrigger : null })), gain: 1e6, se: 1e5, stage: '8x300' }])),
        drinks: Object.fromEntries(names.map((p) => [p, { items: ['attack_coffee', 'wisdom_coffee', 'super_attack_coffee'].map((x) => ({ item: '/items/' + x })), gain: 1e6, se: 1e5, stage: '8x300' }])),
    };
    return {
        best,
        goal: 'profit', budgets: Object.fromEntries(names.map((p) => [p, 1e9])), setups: [], steps, singles, apart: [], overBudget: [], dominated: [],
        confirmation: { gainPerUser: 1234.5e6, sePerUser: 123.45e6, buyerByPlayer: Object.fromEntries(names.map((p) => [p, { gain: 1234.5e6, se: 123.45e6, payback: 138.2 }])), cost: 191.2e6, payback: 138.2 },
        options: { pricesTimestamp: 1700000000, pricesSource: 'snapshot', zone: '/actions/combat/fly', tier: 0 }, basePerUser: 85.76e6,
    };
})();
let serveBig = false;
let serveOlder = false;
// serveTrigger: the earlier result's first setup holds a two-term trigger on Poke that the page does not, so the warning has a trigger difference to word.
let serveTrigger = false;
const pokeTrigger = [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/current_hp', comparatorHrid: '/combat_trigger_comparators/less_than_equal', value: 60 },
    { dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/current_mp', comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: 10 }];
const withTrigger = () => ({ ...result, setups: result.setups.map((x, i) => (i ? x : { ...x, triggerMap: { ...(x.triggerMap || {}), '/abilities/poke': pokeTrigger } })) });
// The live report: what the runner would serve as `partial` (with its version) while the search runs; `sinces` is what the window asked with.
let live = null;
const sinces = [];
// The search rounds: what the runner would serve as `round` (with its version, on the same counter).
let rounds = null;
const roundRec = (n, contending, lo, hi) => ({ round: n, stage: 'main', simHours: 450 * n, coverage: 0.99, candidates: { total: 60, contending, paused: 60 - contending, refuted: 0, locked: 0 },
    pools: [{ key: 'free', size: 30, contending: Math.ceil(contending / 2), paused: 30 - Math.ceil(contending / 2), leaders: [
        { id: 'a', player: 'Player 1', desc: 'Magic 1 -> 2', cost: 0, seeds: 4 * n, readingSeeds: 16, tooFew: false, status: 'contending', reading: 1000, low: lo, high: hi, buyerNet: 800, payback: null },
        { id: 'b', player: 'Player 1', desc: 'Stamina 1 -> 2', cost: 500000, seeds: 4, readingSeeds: 2, tooFew: true, status: 'paused', reading: 700, low: null, high: null, buyerNet: null, payback: null }] }] });
const foodsOnly = { goal: 'profit', budgets: { 'Player 1': 1000000 }, setups: [], steps: [], singles: [], notConfirmed: [], apart: [], overBudget: [], dominated: [], options: { zone: '/actions/combat/fly', tier: 0 },
    best: { foods: { 'Player 1': { items: [{ item: '/items/donut', trigger: null }], gain: 120, se: 30, stage: '4x1', fresh: { seeds: 32, seedFrom: 20001, seedTo: 20032, gain: 110, se: 40, gainPerUser: 110, sePerUser: 40, buyerNet: 100, buyerNetSe: 30, accepted: true } } }, drinks: {} } };
let search = null, received = null, polls = 0;
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/version') return send(res, 200, { runner: 'test-runner', engine: 'test-engine' });
    if (url.pathname === '/api/search' && req.method === 'POST') {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
            if (search && search.state === 'running') return send(res, 409, { error: 'a search is running', id: search.id });
            received = JSON.parse(data);
            result.setups = received.setups;
            search = { id: 'search-1', state: 'running' };
            polls = 0;
            send(res, 200, { id: search.id });
        });
        return;
    }
    const m = url.pathname.match(/^\/api\/search\/([^/]+)(\/stop)?$/);
    if (m && search && m[1] === search.id) {
        // As the real runner: Stop answers at once ({ stopping }) and the search reads stopped a moment later (the optimizer's exit, stopDelay ms); Resume answers { resumed }.
        if (m[2] && req.method === 'POST') { if (search.state === 'running') { setTimeout(() => { search.state = 'stopped'; }, stopDelay); return send(res, 200, { id: search.id, stopping: true }); } search.state = 'running'; return send(res, 200, { id: search.id, resumed: true }); }
        if (search.state === 'running' && failNext) search.state = 'error';
        if (search.state === 'running' && ++polls >= 3 && !holdRunning) search.state = 'done';
        const since = Number(url.searchParams.get('since')) || 0;
        sinces.push(since);
        return send(res, 200, { state: search.state, progress: progress(), ...(search.state === 'done' ? { result } : search.state === 'running' && live && live.version > since ? { partial: live.partial, partialVersion: live.version } : {}), ...(search.state === 'running' && rounds && rounds.version > since ? { round: rounds.round, roundVersion: rounds.version } : {}) });
    }
    if (url.pathname === '/api/results') return send(res, 200, [...(serveStopped ? [{ id: 'search-stopped', finished: '2026-01-02 09:00', goal: 'profit', players: ['Player 1'], stopped: true }] : []), ...(search?.state === 'done' ? [{ id: search.id, finished: '2026-01-01 12:00', goal: 'profit', players: ['Player 1'] }] : [])]);
    if (url.pathname === '/api/results/search-stopped') return send(res, 200, stoppedReport());
    if (url.pathname.startsWith('/api/results/')) return send(res, 200, serveBig ? bigResult : serveOlder ? olderResult : serveTrigger ? withTrigger() : result);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
// serveStopped: "Earlier searches" also lists a stopped search (the runner's entry with `stopped: true`), whose report is its partial.json: the
// result so far, marked incomplete, with its last search round.
let serveStopped = false;
const stoppedReport = () => ({ ...result, confirmation: undefined, incomplete: true, stoppedBy: 'stop request', round: roundRec(5, 6, 400, 1600) });
let holdRunning = true;
let failNext = false;
const stopDelay = 300; // the fake optimizer's exit after a stop
let raceProgress = false; // true: the progress message of a race stage in a late round (round 12, 10 ruled out), the long label and counters of the real run
let raceAcceptable = 1; // the race part's acceptable count (0: no leader to accept, so no Accept button)
let raceDone = false; // true: the finished Screen race row of the real run (round 1 finished, 473 in the running, the pick checks still going)
const progress0 = () => ({ stage: 'screen', candidatesLeft: 40, runsDone: 12, runsPlanned: 48, secondsPerRun: 2.5, etaSeconds: 90, ...(raceProgress ? { round: 12, phase: 'reading', stageContending: 40, stagePaused: 63, stageDropped: 10, stageRuns: 735, stageSimHours: 37000, parts: [{ kind: 'foods', index: 0, state: 'running', runsPlanned: 48, runsDone: 12, candidatesLeft: 40, etaSeconds: 90, round: 12, phase: 'reading', contending: 40, paused: 63, dropped: 10, acceptable: raceAcceptable, runs: 735, simHours: 37000 }, { kind: 'steps', index: 0, state: 'waiting', maxSteps: 20 }, { kind: 'confirmation', index: 0, state: 'waiting' }] } : {}) });
const progress = () => { const p = progress0(); if (raceDone) p.parts = [{ kind: 'screen', index: 0, state: 'done', runsPlanned: 986, runsDone: 986, candidatesLeft: 473, etaSeconds: 0, round: 1, phase: 'reading', contending: 473, paused: 0, dropped: 0, runs: 986, simHours: 49000 }, { kind: 'picks', index: 0, state: 'running', runsPlanned: 40, runsDone: 12, fill: 0.3, etaSeconds: 60 }, { kind: 'steps', index: 0, state: 'waiting', maxSteps: 20 }]; return p; };
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- The page ----
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-window-'));
const chrome = await launchChrome({ userDataDir: path.join(prof, 'profile'), width: 1600, height: 1200 });
try {
    const page = await chrome.newPage();
    await page.send('Page.enable');
    const js = async (expression) => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };
    const openFolds = (...ids) => js(`(() => { for (const id of ${JSON.stringify(ids)}) { const b = document.querySelector('.whatif-fold[data-whatif-more~="' + id + '"]'), e = document.getElementById(id); if (b && e && e.hidden) b.click(); } return true; })()`);
    const until = async (expression, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    const shot = async (id, name) => {
        if (!shots) return;
        fs.mkdirSync(path.dirname(path.join(shots, name)), { recursive: true });
        const [x, y, width, height] = await js(`(() => { const b = document.querySelector('#${id} .modal-content').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.writeFileSync(path.join(shots, name), Buffer.from(s.data, 'base64'));
    };

    // A help mark's tooltip, the pointer on the mark (`pick`: an expression giving the mark; `scroll`: 'end' cuts the screen just under the mark, so the tooltip goes above it,
    // 'nearest' just brings it into view): the tooltip shows the mark's sentence, inside the window (cut to the screen), is the top element at its own
    // four corners, and adds no scrollbar (the window's scroll sizes are the same before and after).
    const tipAt = async (pick, scroll = 'nearest') => {
        const was = await js(`[innerWidth, innerHeight]`);
        // At the bottom: the screen is cut just under the mark (the window, 28 px short of the screen's bottom, then scrolls inside itself).
        if (scroll === 'end') { const bottom = await js(`(() => { const m = ${pick}; m.scrollIntoView({ block: 'nearest' }); return m ? Math.ceil(m.getBoundingClientRect().bottom) : 0; })()`); await page.send('Emulation.setDeviceMetricsOverride', { width: was[0], height: bottom + 44, deviceScaleFactor: 1, mobile: false }); await new Promise((r) => setTimeout(r, 200)); }
        if (!await js(`(() => { const m = ${pick}; if (!m) return false; m.scrollIntoView({ block: '${scroll}', inline: 'nearest' }); return true; })()`)) return { noMark: true };
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await new Promise((r) => setTimeout(r, 250));
        const sizes = `(() => { const m = document.getElementById('whatIfModal'), b = m.querySelector('.modal-body'); return [m.scrollWidth, m.scrollHeight, b.scrollWidth, b.scrollHeight].join(); })()`;
        const before = await js(sizes);
        // The pointer onto the mark and the tooltip measured; again if a poll's redraw moved the mark from under the pointer (a scrollbar of the
        // window coming or going shifts it sideways).
        let pos, r;
        for (let i = 0; i < 4; i++) {
            pos = await js(`(() => { const b = (${pick}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
            for (const x of [pos[0] - 1, pos[0]]) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: pos[1] });
            await new Promise((r) => setTimeout(r, 150));
            r = await js(`(() => { const m = ${pick}, tip = document.querySelector('#whatIfModal .whatif-tip'); if (!tip || tip.hidden) return { shown: false, hover: m.matches(':hover'), mark: [m.getBoundingClientRect().x, m.getBoundingClientRect().y].map(Math.round), at: document.elementFromPoint(${pos[0]}, ${pos[1]})?.className, pos: ${JSON.stringify(pos)}.map(Math.round) };
                const t = tip.getBoundingClientRect(), w = document.querySelector('#whatIfModal .modal-content').getBoundingClientRect();
                const inside = t.left >= Math.max(w.left, 0) && t.top >= Math.max(w.top, 0) && t.right <= Math.min(w.right, innerWidth) && t.bottom <= Math.min(w.bottom, innerHeight);
                const top = [[t.left + 6, t.top + 6], [t.right - 6, t.top + 6], [t.left + 6, t.bottom - 6], [t.right - 6, t.bottom - 6]].every(([x, y]) => document.elementFromPoint(x, y)?.closest('.whatif-tip') === tip);
                const mb = m.getBoundingClientRect(); return { shown: true, text: tip.textContent === m.dataset.tip, inside, top, above: t.bottom <= mb.top, atBottom: Math.min(w.bottom, innerHeight) - mb.bottom < 40, box: [t.left, t.top, t.right, t.bottom].map(Math.round), win: [w.left, w.top, w.right, w.bottom].map(Math.round) }; })()`);
            if (r.shown) break;
        }
        r.noScroll = (await js(sizes)) === before;
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await new Promise((r) => setTimeout(r, 50));
        r.hidesAfter = await js(`document.querySelector('#whatIfModal .whatif-tip')?.hidden === true`);
        if (scroll === 'end') { await page.send('Emulation.setDeviceMetricsOverride', { width: was[0], height: was[1], deviceScaleFactor: 1, mobile: false }); await new Promise((r) => setTimeout(r, 200)); }
        return r;
    };
    const tipOk = (r, scroll) => r.shown && r.text && r.inside && r.top && r.noScroll && r.hidesAfter && (scroll !== 'end' || (r.atBottom && r.above));
    await page.send('Page.navigate', { url: base });
    check('the What-if button shows when the runner answers', await until(`document.getElementById('buttonWhatIf')?.style.display === ''`));
    check('the page is dark by default', await js(`document.body.classList.contains('dark-mode')`));
    // Player 1 holds a character (a one-player import into its tab, kept by the page); the other tabs are the page's empty player.
    // The page is then reloaded: a reload keeps the imported group but not the page's ticks.
    const soloSet = { name: 'Player 1', player: { attackLevel: 40, magicLevel: 1, meleeLevel: 40, rangedLevel: 1, defenseLevel: 40, staminaLevel: 40, intelligenceLevel: 1, equipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/cheese_sword', enhancementLevel: 0 }] }, food: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, drinks: { '/action_types/combat': [{ itemHrid: '' }, { itemHrid: '' }, { itemHrid: '' }] }, abilities: [0, 1, 2, 3, 4].map(() => ({ abilityHrid: '', level: 1 })) };
    await js(`document.getElementById('solo-tab').click(), document.getElementById('inputSetSolo').value = ${JSON.stringify(JSON.stringify(soloSet))}, document.getElementById('buttonImportSet').click(), true`);
    await new Promise((r) => setTimeout(r, 500));
    await js(`(() => { const m = bootstrap.Modal.getInstance(document.getElementById('importExportModal')); if (m) m.hide(); return true; })()`);
    await new Promise((r) => setTimeout(r, 500));
    await page.send('Page.navigate', { url: base });
    check('after a reload the What-if button shows again and Player 1 still holds the import', await until(`document.getElementById('buttonWhatIf')?.style.display === '' && document.getElementById('inputLevel_attack').value === '40'`));
    check('after a reload the page ticks no player', await js(`[...document.querySelectorAll('.player-checkbox')].every((c) => !c.checked)`));
    // The page's own choices: Player 2 ticked (a tab with no data), the third zone, tier 2. The window takes the zone and tier; its ticks follow the data.
    await js(`(() => { for (const c of document.querySelectorAll('.player-checkbox')) c.checked = c.id === 'player2'; const z = document.getElementById('selectZone'); z.selectedIndex = 2; document.getElementById('selectDifficulty').value = '2'; return true; })()`);
    const pageState = `({ zone: document.getElementById('selectZone').value, tier: document.getElementById('selectDifficulty').value, ticks: [...document.querySelectorAll('.player-checkbox')].map((c) => c.checked).join() })`;
    const pageChoices = await js(pageState);
    await js(`document.getElementById('buttonWhatIf').click(), true`);
    check('the window opens with a budget per ticked player', await until(`!!document.querySelector('#whatIfBudgets input[data-player="Player 1"]')`));
    check('the budget fields start empty with the placeholder "no limit" (an empty field means no limit)', await js(`(() => { const b = [...document.querySelectorAll('#whatIfBudgets input')]; return b.length > 0 && b.every((x) => x.value === '' && x.placeholder === 'no limit'); })()`));
    check('the window ticks the players that hold data (Player 1, imported), not the page\'s ticks (Player 2, empty), and copies the page\'s zone and tier', await js(`(() => { const boxes = [...document.querySelectorAll('#whatIfPlayers input')]; return boxes.length === 5 && boxes.map((b) => b.checked).join() === 'true,false,false,false,false' && document.querySelector('label[for="whatIfPlayer_1"]').textContent === 'Player 1' && document.getElementById('selectWhatIfZone').value === ${JSON.stringify(pageChoices.zone)} && document.getElementById('selectWhatIfTier').value === '2'; })()`));
    check('the five tick boxes share one row, in equal columns, with no name cut', await js(`(() => { const b = [...document.querySelectorAll('#whatIfPlayers .form-check')].map((e) => e.getBoundingClientRect()); const l = [...document.querySelectorAll('#whatIfPlayers label')]; return b.length === 5 && new Set(b.map((r) => Math.round(r.top))).size === 1 && new Set(b.map((r) => Math.round(r.width))).size === 1 && l.every((e) => e.scrollWidth <= e.clientWidth); })()`));
    check('the zone and tier selectors carry the page\'s options in the same order and names', await js(`(() => { const same = (a, b) => JSON.stringify([...document.getElementById(a).options].map((o) => [o.value, o.textContent])) === JSON.stringify([...document.getElementById(b).options].map((o) => [o.value, o.textContent])); return document.getElementById('selectZone').options.length > 5 && same('selectWhatIfZone', 'selectZone') && same('selectWhatIfTier', 'selectDifficulty'); })()`));
    // An edit in the window: Player 2 ticked, another zone and tier. The page keeps its own.
    await js(`(() => { for (const [id, v] of [['selectWhatIfZone', document.getElementById('selectWhatIfZone').options[4].value], ['selectWhatIfTier', '1']]) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); } document.getElementById('whatIfPlayer_2').click(); return true; })()`);
    check('a player ticked in the window gets a budget row; the page is unchanged', await js(`!!document.querySelector('#whatIfBudgets input[data-player="Player 2"]') && document.querySelectorAll('#whatIfBudgets input').length === 2`) &&
        JSON.stringify(await js(pageState)) === JSON.stringify(pageChoices));
    await js(`document.getElementById('whatIfPlayer_2').click(), document.getElementById('whatIfPlayer_1').click(), true`);
    check('unticking every player shows the message and no budget rows', await js(`document.getElementById('whatIfMessage').textContent === 'Tick at least one player to simulate.' && document.querySelectorAll('#whatIfBudgets input').length === 0`));
    await js(`document.getElementById('buttonWhatIfSearch').click(), true`);
    check('Start with none ticked sends nothing', received === null && (await js(`document.getElementById('whatIfMessage').textContent`)) === 'Tick at least one player to simulate.');
    await js(`document.getElementById('whatIfPlayer_1').click(), true`);
    check('ticking a player again clears the message and brings the budget row back', await js(`document.getElementById('whatIfMessage').textContent === '' && document.querySelectorAll('#whatIfBudgets input').length === 1`));
    // The page's ticks do not decide the window's: every player ticked on the page still gives a window with only the player that holds data.
    const reopen = `document.getElementById('whatIfModal').dispatchEvent(new Event('show.bs.modal')), true`;
    await js(`(() => { for (const c of document.querySelectorAll('.player-checkbox')) c.checked = true; return true; })()`);
    await js(reopen);
    check('a page with every player ticked gives a window with only the player that holds data ticked, and the page keeps its ticks', await js(`[...document.querySelectorAll('#whatIfPlayers input')].map((b) => b.checked).join() === 'true,false,false,false,false' && document.getElementById('whatIfMessage').textContent === '' && document.querySelectorAll('#whatIfBudgets input').length === 1 && [...document.querySelectorAll('.player-checkbox')].every((c) => c.checked)`) &&
        await js(`document.getElementById('selectWhatIfZone').value === ${JSON.stringify(pageChoices.zone)} && document.getElementById('selectWhatIfTier').value === '2'`));
    await js(`(() => { for (const c of document.querySelectorAll('.player-checkbox')) c.checked = c.id === 'player2'; return true; })()`);
    await js(`document.getElementById('whatIfPlayer_1').click(), true`);
    await js(reopen);
    check('opening again copies the page again, dropping the window\'s edits', await js(`document.getElementById('whatIfPlayer_1').checked && document.getElementById('whatIfMessage').textContent === '' && !!document.querySelector('#whatIfBudgets input[data-player="Player 1"]')`));
    // The window's own zone and tier for the request (a zone and tier other than the page's).
    const windowZone = await js(`(() => { const s = document.getElementById('selectWhatIfZone'); s.value = s.options[4].value; s.dispatchEvent(new Event('change', { bubbles: true })); const t = document.getElementById('selectWhatIfTier'); t.value = '1'; return s.value; })()`);
    check('the window lists nine levers (foods and drinks apart, shrines last), all ticked but the two that need an export (disabled, unticked, with a reason); no pairs or skills box', await js(`document.querySelectorAll('#whatIfLevers input').length === 9 && document.getElementById('whatIfLever_shrines') && document.getElementById('inputWhatIfShrineCap')?.value === '' && !document.getElementById('whatIfLever_pairs') && !document.getElementById('whatIfLever_skills') && [...document.querySelectorAll('#whatIfLevers input')].filter((i) => !i.checked).map((i) => i.value).sort().join() === 'abilities,owned' && ['owned', 'abilities'].every((id) => document.getElementById('whatIfLever_' + id).disabled && document.getElementById('whatIfLever_' + id).title !== '')`));
    check('the runner version is shown', await js(`document.getElementById('whatIfVersion').textContent.includes('test-runner')`));
    // The character export per player: no paste box; a mark under each ticked player's budget says where owned items and abilities come from (that player's kept export, from a Tracker import).
    const exportOf = (name, coin = 5) => ({ name, coin, inventory: [{ itemHrid: '/items/cheese_sword', enhancementLevel: 1, count: 1 }], learnedAbilities: [] });
    const statusOf = (player) => js(`document.querySelector('#whatIfBudgets [data-export-status="${player}"]').textContent`);
    const stored = (player) => js(`localStorage.getItem('whatIfExport:${player}')`);
    check('each ticked player has a mark and no paste box; with no export the mark says none', await js(`document.querySelectorAll('#whatIfBudgets [data-export-status]').length === 1 && document.querySelectorAll('#whatIfBudgets textarea, #whatIfModal textarea.whatif-export').length === 0 && getComputedStyle(document.querySelector('#whatIfBudgets [data-export-status]')).backgroundColor !== 'rgb(255, 255, 255)'`) && (await statusOf('Player 1')) === 'items and abilities: none');
    check('without an export, Items you own cannot be ticked by a click', await js(`(() => { const c = document.getElementById('whatIfLever_owned'); c.click(); return c.disabled && !c.checked; })()`));
    // A kept export (what a Tracker import leaves in storage, import-own-export-page.mjs) shows on the next draw of the rows.
    await js(`(localStorage.setItem('whatIfExport:Player 1', ${JSON.stringify(JSON.stringify(exportOf('Player 1', 5)))}), true)`);
    await js(`(document.getElementById('whatIfPlayer_2').click(), true)`);
    check('a player with a kept export reads "Tracker import"; a player ticked later has a mark of their own and none', (await stored('Player 1')) === JSON.stringify(exportOf('Player 1', 5)) && (await statusOf('Player 1')) === 'items and abilities: Tracker import' && (await statusOf('Player 2')) === 'items and abilities: none', (await statusOf('Player 2')) + ' / ' + (await statusOf('Player 1')));
    check('with the kept export, Items you own and Abilities come back ticked', await js(`['owned', 'abilities'].every((id) => { const c = document.getElementById('whatIfLever_' + id); return !c.disabled && c.checked; })`));
    // Owned items ticked by default once an export is kept; a user's untick stays across a window reopen.
    const ownedBox = `(() => { const c = document.getElementById('whatIfLever_owned'); return [c.disabled, c.checked]; })()`;
    await js(`document.getElementById('whatIfLever_owned').click(), true`);
    await js(reopen);
    check('an untick of Items you own stays when the window opens again', JSON.stringify(await js(ownedBox)) === '[false,false]');
    await js(`document.getElementById('whatIfLever_owned').click(), true`);
    // The reopen copied the page's zone, tier and ticks back: the window's own zone and tier again, and Player 2 ticked as before.
    await js(`(() => { const s = document.getElementById('selectWhatIfZone'); s.value = ${JSON.stringify(windowZone)}; s.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('selectWhatIfTier').value = '1'; const p2 = document.getElementById('whatIfPlayer_2'); if (!p2.checked) p2.click(); return true; })()`);
    await js(`document.getElementById('whatIfPlayer_2').click(), true`);
    // Layout: five, three and one players at 1920x1080, 1500x900 and 1100x900; the budgets one cell per player side by side in the right
    // column under the payback limit (name over field over mark), equal cells, equal section gaps, Zone and Tier on one row (each half
    // the left column), Goal inline like Zone and Tier, the button row inside the window, no horizontal scroll.
    const shotsLayout = shots ? path.join(shots, 'layout2') : null;
    const tickOnly = (n) => js(`(() => { for (const b of document.querySelectorAll('#whatIfPlayers input')) { const want = Number(b.value) <= ${n}; if (b.checked !== want) b.click(); } return true; })()`);
    const layout = () => js(`(() => {
        const r = (e) => e.getBoundingClientRect();
        const win = r(document.querySelector('#whatIfModal .modal-content')), body = document.querySelector('#whatIfModal .modal-body');
        const cells = [...document.querySelectorAll('#whatIfBudgets .whatif-pcell')];
        const cols = [0, 1].map((i) => new Set(cells.map((x) => Math.round(r(x.children[i]).width))).size === 1) .concat([new Set(cells.map((x) => Math.round(r(x).width))).size === 1]);
        const tops = cells.map((x) => Math.round(r(x).top)), heights = cells.map((x) => Math.round(r(x).height));
        const stacked = cells.every((x) => { const [n, i, m] = [...x.children].map(r); return n.bottom <= i.top + 0.5 && i.bottom <= m.top + 0.5 && i.height <= 32 && n.left >= r(x).left - 0.5 && i.left >= r(x).left - 0.5; });
        const left = document.querySelector('#whatIfModal .col-md-5'), right = document.querySelector('#whatIfModal .col-md-7'), btn = document.getElementById('buttonWhatIfSearch').parentElement;
        const budgets = document.getElementById('whatIfBudgets'), payback = document.getElementById('inputWhatIfMaxPayback');
        const gapsOf = (col) => { const k = [...col.children].map(r); return k.slice(1).map((c, i) => c.top - k[i].bottom); };
        const gaps = gapsOf(left).concat(gapsOf(right));
        const kids = [...left.children].map(r), rightBottom = [...right.children].reduce((m, c) => Math.max(m, r(c).bottom), 0);
        const g = r(document.getElementById('selectWhatIfGoal')), z = r(document.getElementById('selectWhatIfZone')), t = r(document.getElementById('selectWhatIfTier'));
        const gl = r(document.querySelector('label[for="selectWhatIfGoal"]')), zl = r(document.querySelector('label[for="selectWhatIfZone"]')), tl = r(document.querySelector('label[for="selectWhatIfTier"]'));
        const zg = r(document.getElementById('selectWhatIfZone').parentElement), tg = r(document.getElementById('selectWhatIfTier').parentElement), lw = left.clientWidth - parseFloat(getComputedStyle(left).paddingLeft) - parseFloat(getComputedStyle(left).paddingRight);
        const hintFits = cells.every((x) => { const t = x.children[1], cs = getComputedStyle(t), c = document.createElement('canvas').getContext('2d'); c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return c.measureText(t.placeholder).width <= t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); });
        const goalPlain = getComputedStyle(document.querySelector('label[for="selectWhatIfGoal"]')).fontWeight === getComputedStyle(document.querySelector('label[for="selectWhatIfZone"]')).fontWeight;
        return { hintFits, goalPlain, cells: cells.length, cols, tops, heights, stacked,
            statusTitles: cells.every((x) => x.children[2].title === x.children[2].textContent),
            inRight: right.contains(budgets) && r(budgets).top >= r(payback).bottom && cells.every((x) => r(x).right <= r(right).right + 0.5 && r(x).left >= r(right).left - 0.5),
            noHScroll: body.scrollWidth <= body.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            inside: r(btn).bottom <= win.bottom && r(btn).bottom <= r(body).bottom && body.scrollHeight <= body.clientHeight + 1 && win.bottom <= innerHeight,
            btnBottom: Math.round(r(btn).bottom), winBottom: Math.round(win.bottom),
            gaps: gaps.map((x) => Math.round(x * 10) / 10), leftBottom: Math.round(kids[kids.length - 1].bottom), rightBottom: Math.round(rightBottom),
            zoneTierRow: Math.abs(z.top - t.top) < 1 && left.contains(document.getElementById('selectWhatIfZone')) && Math.abs(zg.width - tg.width) < 1 && zg.width <= lw / 2 + 0.5 && zg.width >= lw / 2 - 16 && tg.right <= r(left).right + 0.5,
            zoneTierW: [Math.round(zg.width), Math.round(tg.width), Math.round(lw)],
            goalInline: Math.abs(gl.top - g.top) < 12 && Math.abs(zl.top - z.top) < 12 && Math.abs(tl.top - t.top) < 12 && gl.right <= g.left + 1.5 && zl.right <= z.left + 1.5 && tl.right <= t.left + 1.5 };
    })()`);
    for (const [w, h] of [[1920, 1080], [1500, 900], [1100, 900]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        for (const n of [5, 3, 1]) {
            await tickOnly(n);
            await new Promise((r) => setTimeout(r, 250));
            const L = await layout(), tag = `${n} players at ${w}x${h}`;
            console.log('     ', tag, JSON.stringify({ gaps: L.gaps, tops: L.tops, heights: L.heights, zoneTierW: L.zoneTierW, btnBottom: L.btnBottom, winBottom: L.winBottom, leftBottom: L.leftBottom, rightBottom: L.rightBottom }));
            check(`${tag}: one budget cell per player side by side on one row, equal cells, name over field over mark, the mark's whole text in its title`, L.cells === n && L.cols.every(Boolean) && new Set(L.tops).size === 1 && new Set(L.heights).size === 1 && L.stacked && L.statusTitles, JSON.stringify(L));
            check(`${tag}: the budgets sit in the right column under the payback limit, and nothing scrolls sideways`, L.inRight && L.noHScroll, JSON.stringify(L));
            check(`${tag}: the Start search row is inside the window, no scrolling`, L.inside, JSON.stringify(L));
            check(`${tag}: every section gap is equal`, L.gaps.length >= 3 && Math.max(...L.gaps) - Math.min(...L.gaps) < 1, JSON.stringify(L.gaps));
            check(`${tag}: the whole budget hint fits inside the field`, L.hintFits, JSON.stringify(L));
            check(`${tag}: the Goal label has the weight of Zone and Tier`, L.goalPlain);
            check(`${tag}: Zone and Tier share one row in the left column, each half its width`, L.zoneTierRow, JSON.stringify(L.zoneTierW));
            check(`${tag}: Goal sits inline with its label like Zone and Tier`, L.goalInline, JSON.stringify(L));
            if (n === 5 && shotsLayout) await shot('whatIfModal', `layout2/layout2-${w}x${h}.png`);
        }
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    await tickOnly(1);
    await js(`(() => { const i = document.querySelector('#whatIfBudgets input'); i.value = 'abc'; return true; })()`);
    await js(`document.getElementById('buttonWhatIfSearch').click(), true`);
    check('a budget that is not a number is refused', await until(`document.getElementById('whatIfMessage').textContent.includes('Player 1')`) && received === null);
    check('the window has a payback limit field next to the budgets (the budgets under it), 0 (no limit) by default', await js(`(() => { const i = document.getElementById('inputWhatIfMaxPayback'); return i.value === '0' && document.querySelector('label[for="inputWhatIfMaxPayback"]').textContent === 'Payback limit (days, 0 = no limit)' && !!i.closest('.modal-body') && (document.getElementById('whatIfBudgets').compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING) !== 0; })()`));
    await js(`(() => { document.getElementById('inputWhatIfMaxPayback').value = '-5'; return true; })()`);
    await js(`(document.querySelector('#whatIfBudgets input').value = '1000000', document.getElementById('buttonWhatIfSearch').click(), true)`);
    check('a payback limit that is not a number of days is refused', await until(`document.getElementById('whatIfMessage').textContent.includes('payback limit')`) && received === null);
    await js(`(() => { document.getElementById('inputWhatIfMaxPayback').value = '365'; document.querySelector('#whatIfBudgets input').value = '1000000'; return true; })()`);
    // The market snapshot: the page's fetch of marketplace.json is answered here (no network for it in the test).
    await js(`(() => { const f = window.fetch; window.__mpCalls = 0; window.fetch = (u, o) => { if (!String(u).includes('marketplace.json')) return f(u, o); window.__mpCalls++;
        return window.__mpFail ? Promise.reject(new Error('offline')) : Promise.resolve(new Response(JSON.stringify({ marketData: { '/items/apple': { 0: { a: 10, b: 9 } } }, timestamp: 1700000000 }), { status: 200 })); }; window.__mpFail = true; return true; })()`);
    await js(`document.getElementById('buttonWhatIfSearch').click(), true`);
    check('a failed price fetch starts no search and says so', await until(`document.getElementById('whatIfMessage').textContent.includes('could not be fetched')`) && received === null && (await js('window.__mpCalls')) >= 1);
    await js(`(window.__mpFail = false, true)`);
    // The budget field reads what the page writes (parseNumber): each text reaches the request as the whole number of coin; "abc" blocks the start and marks the field invalid.
    // The search POST is answered here with an error for these starts, so no search runs; the real start follows.
    await js(`(() => { const f = window.fetch; window.__posts = []; window.__realFetch = f; window.fetch = (u, o) => { if (String(u).endsWith('/api/search') && o?.method === 'POST') { window.__posts.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ error: 'test' }), { status: 400 })); } return f(u, o); }; return true; })()`);
    for (const [text, coins] of [['1 500 k', 1500000], ['1,500,000', 1500000], ['1.5M', 1500000], ['2.6', 3], ['', 0], ['0', 0]]) {
        await js(`(() => { window.__posts.length = 0; document.querySelector('#whatIfBudgets input').value = ${JSON.stringify(text)}; document.getElementById('buttonWhatIfSearch').click(); return true; })()`);
        check(`budget typed as "${text}" reaches the search request as ${coins} (an empty field and 0 both reach it as 0: no limit), and the field keeps what was typed`, await until('window.__posts.length === 1') && (await js('window.__posts[0].budgets["Player 1"]')) === coins && (await js("document.querySelector('#whatIfBudgets input').value")) === text);
    }
    check('a failed start (the runner answers with an error): the button is back to Start, enabled, btn-primary, and the message shows', await until(`(() => { const b = document.getElementById('buttonWhatIfSearch'); return b.textContent === 'Start' && !b.disabled && b.classList.contains('btn-primary') && !b.classList.contains('btn-outline-danger'); })()`) && (await js(`document.getElementById('whatIfMessage').textContent`)) === 'test');
    await js(`(() => { window.__posts.length = 0; document.querySelector('#whatIfBudgets input').value = 'abc'; document.getElementById('buttonWhatIfSearch').click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 600));
    check('a budget typed as "abc" blocks the start (no request) and the field is marked invalid; a good text clears the mark', (await js('window.__posts.length')) === 0 && await js(`document.querySelector('#whatIfBudgets input').classList.contains('is-invalid')`) && await js(`(() => { const i = document.querySelector('#whatIfBudgets input'); i.value = '1 500 k'; i.dispatchEvent(new Event('input', { bubbles: true })); return !i.classList.contains('is-invalid'); })()`));
    check('the budget field is a text field with a decimal keypad hint', await js(`(() => { const i = document.querySelector('#whatIfBudgets input'); return i.type === 'text' && i.inputMode === 'decimal'; })()`));
    await js(`(window.fetch = window.__realFetch, document.querySelector('#whatIfBudgets input').value = '1.5M', true)`);
    const starting = await js(`(() => { const b = document.getElementById('buttonWhatIfSearch'), idle = { text: b.textContent, disabled: b.disabled, primary: b.classList.contains('btn-primary') }; b.click(); return { idle, text: b.textContent, disabled: b.disabled }; })()`);
    check('the one button reads Start (btn-primary, enabled) before the click, and Starting, disabled, right at the click', starting.idle.text === 'Start' && !starting.idle.disabled && starting.idle.primary && starting.text === 'Starting…' && starting.disabled === true, JSON.stringify(starting));
    check('the search running: the button reads Stop, btn-outline-danger, enabled', await until(`(() => { const b = document.getElementById('buttonWhatIfSearch'); return b.textContent === 'Stop' && !b.disabled && b.classList.contains('btn-outline-danger') && !b.classList.contains('btn-primary'); })()`));
    check('progress is shown while it runs', await until(`document.getElementById('whatIfProgress').textContent.includes('candidates left')`));
    check('the request carries the party, budgets, levers, zone and tier', received && received.setups.length >= 1 && received.setups.some((s) => s.name === 'Player 1' && s.player) &&
        received.budgets['Player 1'] === 1500000 && received.maxPayback === 365 && received.levers.join() === 'equip,foods,drinks,owned,abilities,order,triggers,houses,shrines' && !('shrineCap' in received) && received.goal === 'profit' && typeof received.options.tier === 'number' && !!received.options.zone, JSON.stringify(received)?.slice(0, 300));
    check('the request follows the window\'s zone, tier and players, not the page\'s', received.options.zone === windowZone && windowZone !== pageChoices.zone && received.options.tier === 1 && received.players.join() === 'Player 1', JSON.stringify(received.options.zone) + ' ' + JSON.stringify(received.players));
    check('the request carries the export map for the ticked players that have one, nobody else', !!received.export && Object.keys(received.export).join() === 'Player 1' && received.export['Player 1'].coin === 5, JSON.stringify(received.export)?.slice(0, 200));
    check('the request carries the market snapshot the page fetched', received?.options?.marketplace?.timestamp === 1700000000 && !!received.options.marketplace.marketData['/items/apple']);
    await js(`document.getElementById('whatIfModal').dispatchEvent(new Event('show.bs.modal')), true`);
    check('a window opened on a running search shows Stop', await js(`(() => { const b = document.getElementById('buttonWhatIfSearch'); return b.textContent === 'Stop' && !b.disabled && b.classList.contains('btn-outline-danger'); })()`));
    // The reopen copied the page again: the window's settings this search was started with are put back (its zone and tier, the budget).
    await js(`(() => { const set = (id, v, type) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(type, { bubbles: true })); }; set('selectWhatIfZone', ${JSON.stringify(windowZone)}, 'change'); set('selectWhatIfTier', '1', 'change'); const i = document.querySelector('#whatIfBudgets input'); i.value = '1.5M'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    check('the progress bar has a dark track and a fill of its own in dark mode', await js(`(() => { const p = document.querySelector('#whatIfProgress .whatif-progress'); const lum = (c) => c.match(/[0-9]+/g).slice(0, 3).reduce((a, x) => a + Number(x), 0); const t = getComputedStyle(p).backgroundColor, b = getComputedStyle(p.querySelector('.progress-bar')).backgroundColor; return lum(t) < 150 && t !== b && getComputedStyle(p).borderTopWidth !== '0px'; })()`));
    await shot('whatIfModal', 'whatif-progress.png');
    // The live report: the runner's status carries the latest snapshot while the search runs; the window draws the same report from it.
    const resultText = () => js(`document.getElementById('whatIfResult').textContent`);
    check('live: no snapshot yet, no report', (await resultText()).trim() === '');
    live = { partial: { ...foodsOnly, setups: result.setups }, version: 1 };
    check('live: the foods alone are drawn as soon as they arrive, with the running mark, no steps heading, no "no steps" message, no totals', await until(`document.getElementById('whatIfResult').textContent.includes('Best foods')`) && await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return document.querySelector('#whatIfResult .whatif-running .whatif-chip.whatif-st-running')?.title.includes('Running: the report fills in as the search goes.') && t.includes('Player 1Donut') && t.includes('Shared loot gain per user') && !t.includes('fresh runs:') && !t.includes('Chosen changes, in order') && !t.includes('No change gains beyond') && !t.includes('Confirmed on fresh runs') && !t.includes('Apply'); })()`), (await resultText()).slice(0, 400));
    check('live: the window asks for what is newer than what it drew', await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000 && !sinces.includes(1)) await new Promise((r) => setTimeout(r, 200)); return sinces.includes(1); })() && sinces.every((s) => s === 0 || s === 1));
    live = { partial: { ...foodsOnly, setups: result.setups, steps: [result.steps[0]], singles: result.singles, basePerUser: result.basePerUser, apart: result.apart, overBudget: result.overBudget, best: { foods: foodsOnly.best.foods, drinks: result.best.drinks } }, version: 2 };
    check('live: a newer snapshot adds the step, headed "so far", the drinks too; still the running mark and no totals', await until(`document.getElementById('whatIfResult').textContent.includes('Chosen changes, in order')`) && await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('so far') && t.includes('Magic 1→2') && !t.includes('Stamina 1→2') && t.includes('Player 1Attack Coffee') && !!document.querySelector('#whatIfResult .whatif-running .whatif-chip.whatif-st-running')?.title.includes('Running: the report fills in') &&!t.includes('Confirmed on fresh runs') && !t.includes('No change gains beyond'); })()`), (await resultText()).slice(0, 600));
    // The chips above the report share one line at Full HD (so far, the base profit, the over-budget chip), and there is no unknown-cost chip.
    {
        const was = await js(`[innerWidth, innerHeight]`);
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 300));
        const line = await js(`(() => { const row = document.querySelector('#whatIfResult .whatif-context'); if (!row) return null; const raw = [...row.querySelectorAll('.whatif-chip')].map((c) => c.getBoundingClientRect()), chips = raw.map((b) => Math.round(b.top)); return { n: chips.length, tops: [...new Set(chips)], raw: raw.map((b) => [b.top, b.height, b.width].map((v) => +v.toFixed(2))), apart: !!document.querySelector('#whatIfModal [data-left-out="apart"]') }; })()`);
        check('live: at 1920x1080 the chips above the report (so far, base profit, over budget) share one line', !!line && line.n === 3 && line.tops.length === 1, JSON.stringify(line));
        check('live: no unknown-cost chip while the search runs', !!line && !line.apart);
        await page.send('Emulation.setDeviceMetricsOverride', { width: was[0], height: was[1], deviceScaleFactor: 1, mobile: false });
    }
    await shot('whatIfModal', 'whatif-live.png');
    // The search rounds: under the live report, a round counter, contention counts and the table of the leaders; it follows a newer round.
    const roundsText = () => js(`document.getElementById('whatIfRounds').textContent`);
    check('rounds: no round yet, nothing drawn', (await roundsText()).trim() === '');
    rounds = { round: roundRec(3, 40, 900, 1100), version: 3 };
    check('rounds: the section shows the round counter, the contention counts and the leaders with their range', await until(`document.querySelector('#whatIfRounds [data-rounds="round"]')?.textContent === '3'`) && await js(`(() => { const e = document.getElementById('whatIfRounds'); const t = e.textContent; return e.querySelector('[data-rounds="contending"]').textContent === '40' && e.querySelector('[data-rounds="paused"]').textContent === '20' && t.includes('Search rounds') && t.includes('Magic 1→2') &&t.includes('1,000 ± 100') && t.includes('still measuring'); })()`), (await roundsText()).slice(0, 500));
    check('rounds: the section sits under the live report', await js(`(() => { const r = document.getElementById('whatIfResult'), s = document.getElementById('whatIfRounds'); return !!(r.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    check('rounds: the window asks for what is newer than the round it drew', await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000 && !sinces.includes(3)) await new Promise((r) => setTimeout(r, 200)); return sinces.includes(3); })());
    rounds = { round: roundRec(4, 25, 950, 1050), version: 4 };
    check('rounds: a newer round replaces the counter, the counts and the range', await until(`document.querySelector('#whatIfRounds [data-rounds="round"]')?.textContent === '4'`) && await js(`(() => { const e = document.getElementById('whatIfRounds'); return e.querySelector('[data-rounds="contending"]').textContent === '25' && e.textContent.includes('1,000 ± 50') && !e.textContent.includes('1,000 ± 100'); })()`), (await roundsText()).slice(0, 500));
    check('rounds: dark mode (no white table), no scroll axis of its own, one table per pool', await js(`(() => { const e = document.getElementById('whatIfRounds'); const lum = (c) => c.match(/[0-9]+/g).slice(0, 3).reduce((a, x) => a + Number(x), 0); const cs = getComputedStyle(e.querySelector('table')); const ov = [e, ...e.querySelectorAll('*')].every((x) => { const o = getComputedStyle(x); return !/(auto|scroll)/.test(o.overflowX + o.overflowY); }); return ov && lum(getComputedStyle(e.querySelector('table td')).color) > 300 && e.querySelectorAll('table').length === 1 && cs.backgroundColor !== 'rgb(255, 255, 255)'; })()`));
    await shot('whatIfModal', 'whatif-rounds.png');
    // The "so far" rows (TODO item 6), in the page (after the rounds checks, which expect no round before theirs): a round record of the Change being searched (the progress says 'screen') with a candidate whose gain so
    // far is above 0 adds a "so far" row under the chosen changes at the next poll, with no new report; it goes when a later record has it at or below 0.
    {
        const was = rounds, lead = (desc, reading) => ({ id: desc, player: 'Player 2', desc, cost: 5e5, seeds: 8, readingSeeds: 8, status: 'contending', tooFew: false, reading, low: reading - 100, high: reading + 100, buyerNet: reading, netLow: reading - 100, netHigh: reading + 100, payback: 40 });
        rounds = { round: { round: 2, stage: 'screen', simHours: 100, candidates: { contending: 2, paused: 0 }, pools: [{ key: 'Player 2:paid', size: 2, contending: 2, paused: 0, leaders: [lead('Player 2 Cape +1 -> +2', 900), lead('Player 2 Belt +0 -> +1', -30)] }] }, version: 4.3 };
        const soFarRows = `[...document.querySelectorAll('#whatIfResult tr[data-so-far]')].map((r) => ({ text: r.textContent, apply: !!r.querySelector('[data-whatif-apply]'), after: !!r.previousElementSibling?.querySelector('[data-whatif-apply]') || !!r.previousElementSibling?.matches('[data-so-far]') }))`;
        const seen = await until(`document.querySelectorAll('#whatIfResult tr[data-so-far]').length === 1`, 8000), r1 = await js(soFarRows);
        check('so far, in the page: the candidate of the running Change with a gain so far above 0 shows under the chosen changes, after the confirmed row, marked so far, no Apply; the one below 0 does not', seen && r1.length === 1 && r1[0].text.includes('Cape') && r1[0].text.includes('so far') && !r1[0].apply && r1[0].after && !r1[0].text.includes('Belt'), JSON.stringify(r1));
        const ax = await js(`(() => { const b = document.querySelector('#whatIfModal .modal-body'); return { x: b.scrollWidth <= b.clientWidth + 1, dark: document.body.classList.contains('dark-mode') }; })()`);
        check('so far, in the page: one scroll axis (no horizontal scroll), dark mode', ax.x && ax.dark, JSON.stringify(ax));
        await shot('whatIfModal', 'whatif-so-far.png');
        rounds = { round: { ...rounds.round, round: 3, pools: [{ ...rounds.round.pools[0], leaders: [lead('Player 2 Cape +1 -> +2', -10), lead('Player 2 Belt +0 -> +1', 400)] }] }, version: 4.6 };
        const swapped = await until(`(() => { const r = [...document.querySelectorAll('#whatIfResult tr[data-so-far]')]; return r.length === 1 && r[0].textContent.includes('Belt'); })()`, 8000);
        check('so far, in the page: a row that stops being positive goes away and one that becomes positive appears, at the next round record', swapped, JSON.stringify(await js(soFarRows)));
        rounds = { round: was.round, version: 4.9 }; // round 4 back on show, as the checks after this one had it
    }
    // A race stage's progress row has no bar: its label and counters use the whole row, wrap, are never cut and never widen the window.
    raceProgress = true;
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await until(`!!document.querySelector('#whatIfProgress .whatif-part-race')`);
        await new Promise((r) => setTimeout(r, 400));
        const fitRow = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), row = document.querySelector('#whatIfProgress .whatif-part-race'); if (!row) return null; const l = row.querySelector('.whatif-part-label'), x = row.querySelector('.whatif-part-text'), btns = [...row.querySelectorAll('[data-whatif-done]')], cells = [...row.children], edge = body.getBoundingClientRect().right; return { noOverflow: body.scrollWidth <= body.clientWidth, labelWraps: getComputedStyle(l).whiteSpace === 'normal' && l.scrollWidth <= l.clientWidth + 1, textWraps: !x && cells[6]?.textContent === '40' && cells[7]?.textContent === '63' && cells[8]?.textContent === '10' && btns.length === 2 && l.getBoundingClientRect().right <= edge + 0.5 && cells.every((c) => c.getBoundingClientRect().right <= edge + 0.5) && btns.every((b) => b.getBoundingClientRect().right <= edge + 0.5), ellipsis: getComputedStyle(l).textOverflow === 'ellipsis' && getComputedStyle(l).overflow !== 'visible', text: l.textContent }; })()`);
        check(`at ${w}x${h} a race stage row (counters after the status text, on the stage's own line, then the done button) is not cut, wraps, and the window has no horizontal scroll`, !!fitRow && fitRow.noOverflow && fitRow.labelWraps && fitRow.textWraps && !fitRow.ellipsis, JSON.stringify(fitRow));
    }
    // Columns that stay put (TODO row 117): one row drawn in every state it can show (waiting, searching, checking leaders, the winner under check with a long
    // name, a winner left out, done, halted, skipped), in en, pt and zh, in the page's own window at 1920 and 1366 wide: every header's left edge and width is the
    // same in all of them. The rows are drawn by the panel's renderParts into a table beside the live one (the poll redraws that one).
    {
        const panelM = await import(new URL('../../src/whatif/panel.mjs', import.meta.url));
        const loc = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, 'locales', l, 'common.json'), 'utf8')).whatIf]));
        const tOf = (l) => (key, p = {}) => { const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), loc[l]); return typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(p[k])) : key; };
        const longWhat = { player: 'Player 3', desc: 'Off hand holy_buckler +4 -> +10 + Body crimson_plate_body +4 -> +6 + Legs rainbow_plate_legs +3 -> +5' };
        const race = { kind: 'step', index: 3, round: 128, runs: 123456, simHours: 9876543, candidates: 1234, contending: 1180, paused: 999, dropped: 1000, acceptable: 3, separate: { rounds: 999 } };
        const states = [
            ['waiting', { kind: 'step', index: 3, state: 'waiting', runsUpTo: 99999 }, 'running'],
            ['searching', { ...race, state: 'running', phase: 'search' }, 'running'],
            ['checking leaders', { ...race, state: 'running', phase: 'reading', kept: { kept: 98765, total: 123456 } }, 'running'],
            ['checking the winner', { ...race, state: 'done', checking: true, checkWhat: longWhat, checkWho: { index: 3, of: 5 }, checkDone: 12345, checkPlanned: 23456 }, 'running'],
            ['left out, goes on', { ...race, state: 'running', phase: 'search', failed: [{ stage: 'greedy step 3', ...longWhat, seeds: 16, gainPerUser: -1234567, sePerUser: 234567 }] }, 'running'],
            ['done, left out', { ...race, state: 'done', failed: [{ stage: 'greedy step 3', ...longWhat, seeds: 16, gainPerUser: -1234567, sePerUser: 234567 }] }, 'done'],
            ['ended by you', { ...race, state: 'done', skipped: true }, 'done'],
            ['halted', { ...race, state: 'running', phase: 'search' }, 'stopped'],
            ['skipped', { kind: 'confirmation', index: 0, state: 'skipped' }, 'done'],
        ];
        for (const [w, h] of [[1920, 1080], [1366, 768]]) {
            await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
            await new Promise((r) => setTimeout(r, 300));
            const seen = [];
            for (const l of ['en', 'pt', 'zh']) for (const [name, row, searchState] of states) {
                const html = panelM.renderParts({ state: searchState, progress: { elapsedSeconds: 123456, secondsPerRun: 12.34, parts: [row] } }, tOf(l));
                const m = await js(`(() => { const box = document.getElementById('whatIfProgress'); let t = document.getElementById('__colTest'); if (!t) { t = document.createElement('div'); t.id = '__colTest'; box.after(t); } t.innerHTML = ${JSON.stringify(html)}; const ths = [...t.querySelectorAll('thead th')]; const body = document.querySelector('#whatIfModal .modal-body'); return { cols: ths.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10]; }), scroll: body.scrollWidth > body.clientWidth + 1 }; })()`);
                seen.push({ l, name, ...m });
            }
            await js(`document.getElementById('__colTest')?.remove()`);
            const ref = JSON.stringify(seen[0].cols), moved = seen.filter((x) => JSON.stringify(x.cols) !== ref || x.scroll);
            check(`columns at ${w}x${h}: every header's left edge and width are the same across ${states.length} states of a row in en, pt and zh, and no horizontal scroll`, seen.length === states.length * 3 && seen[0].cols.length === 12 && moved.length === 0, JSON.stringify(moved.slice(0, 2).map((x) => [x.l, x.name, x.cols, x.scroll])) + ' ref ' + ref);
        }
    }
    // The pointer rests on "Accept current winner" while the window polls: the redraw keeps the button in the document, so it keeps its node and its
    // hover look at every poll (a node replaced, or taken out of the page and put back, drops its hover and fades back in: the flicker). A real
    // change still shows at once: a press disables both buttons, a failed press gives them back, and no leader to accept takes Accept away.
    {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await until(`!!document.querySelector('#whatIfProgress [data-whatif-done="accept"]')`);
        await new Promise((r) => setTimeout(r, 300));
        const [bx, by] = await js(`(() => { const b = document.querySelector('#whatIfProgress [data-whatif-done="accept"]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
        for (const x of [bx - 2, bx]) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: by });
        await new Promise((r) => setTimeout(r, 300)); // past the button's own hover transition
        await js(`(() => { const box = document.getElementById('whatIfProgress'), b = box.querySelector('[data-whatif-done="accept"]'); window.__accept = b; window.__looks = [];
            const look = () => { const a = box.querySelector('[data-whatif-done="accept"]'), cs = a && getComputedStyle(a); return a && { same: a === b, hover: a.matches(':hover'), bg: cs.backgroundColor, color: cs.color, disabled: a.disabled, cls: a.className }; };
            window.__look0 = look(); window.__obs = new MutationObserver(() => window.__looks.push(look())); window.__obs.observe(box, { childList: true, subtree: true, characterData: true, attributes: true }); return true; })()`);
        const n0 = sinces.length;
        for (let i = 0; i < 100 && sinces.length < n0 + 4; i++) await new Promise((r) => setTimeout(r, 100));
        const rest = await js(`(() => { window.__obs.disconnect(); return { first: window.__look0, looks: window.__looks }; })()`);
        const steady = rest.looks.length > 0 && rest.first.hover && rest.looks.every((l) => l && l.same && l.hover && l.bg === rest.first.bg && l.color === rest.first.color && !l.disabled && l.cls === rest.first.cls);
        check('with the pointer resting on Accept, four polls keep its node, its hover and its colours (no flicker)', sinces.length >= n0 + 4 && steady, JSON.stringify({ first: rest.first, changed: rest.looks.filter((l) => !(l && l.same && l.hover && l.bg === rest.first.bg)).slice(0, 3), n: rest.looks.length }));
        const press = await js(`(() => { const b = window.__accept; b.click(); const skip = document.querySelector('#whatIfProgress [data-whatif-done="skip"]'); return { same: document.querySelector('#whatIfProgress [data-whatif-done="accept"]') === b, disabled: b.disabled, text: b.textContent, skipDisabled: skip.disabled }; })()`);
        check('a press of Accept shows at once, on the same node: Accepting…, both buttons disabled', press.same && press.disabled && press.text === 'Accepting…' && press.skipDisabled, JSON.stringify(press));
        check('the refused press gives both buttons back, Accept still the same node', await until(`(() => { const b = document.querySelector('#whatIfProgress [data-whatif-done="accept"]'); return b === window.__accept && !b.disabled && b.textContent === 'Accept current winner'; })()`));
        await js(`(document.getElementById('whatIfMessage').textContent = '', true)`);
        raceAcceptable = 0;
        check('no leader to accept: the next poll takes Accept away and keeps Skip', await until(`!document.querySelector('#whatIfProgress [data-whatif-done="accept"]') && !!document.querySelector('#whatIfProgress [data-whatif-done="skip"]')`, 5000));
        raceAcceptable = 1;
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }
    // Bug: a help mark's tooltip in the stage list was cut by its cell. Each place: a row of the stage list, its last row, at the bottom of the screen.
    for (const [name, pick, scroll] of [['a row of the stage list', `document.querySelector('#whatIfProgress .whatif-part[data-kind="steps"] .whatif-help')`, 'nearest'],
        ['the last row of the stage list', `document.querySelector('#whatIfProgress tbody tr:last-child .whatif-help')`, 'nearest'],
        ['the last row of the stage list at the bottom of the screen', `document.querySelector('#whatIfProgress tbody tr:last-child .whatif-help')`, 'end']]) {
        const r = await tipAt(pick, scroll);
        check(`the tooltip of a help mark in ${name} shows whole, inside the window, over everything, with no scrollbar added`, tipOk(r, scroll), JSON.stringify(r));
    }
    // The same row once its race has ended (done): wraps like the running one, is never cut, its figures stay inside the window, one scroll axis.
    raceDone = true; raceProgress = true;
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await until(`!!document.querySelector('#whatIfProgress .whatif-part-done.whatif-part-race')`);
        await new Promise((r) => setTimeout(r, 400));
        const fitDone = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), row = document.querySelector('#whatIfProgress .whatif-part-done.whatif-part-race'); if (!row) return null; const l = row.querySelector('.whatif-part-label'), x = row.querySelector('.whatif-part-text'), edge = body.getBoundingClientRect().right, within = [l, x].every((e) => !e || (e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= edge + 0.5)); return { noOverflow: body.scrollWidth <= body.clientWidth, within, wraps: getComputedStyle(l).whiteSpace === 'normal', noButton: !row.querySelector('[data-whatif-done]'), noRunning: !/Running|round [0-9]+ running/.test(row.textContent), counts: row.children[6]?.textContent === '' && row.children[7]?.textContent === '' && row.children[8]?.textContent === '', text: row.textContent }; })()`);
        check(`at ${w}x${h} a finished race stage row is not cut, its figures stay inside the window, it has no done button and no horizontal scroll`, !!fitDone && fitDone.noOverflow && fitDone.within && fitDone.wraps && fitDone.noButton && fitDone.noRunning && fitDone.counts, JSON.stringify(fitDone));
    }
    raceDone = false;
    await page.send('Emulation.clearDeviceMetricsOverride');
    raceProgress = false;
    // The Status column holds the longest of its statuses (all but the "fresh runs: n, m more needed" sentence) on one line at 1920 and 1366 wide;
    // the pick note shows under Best foods only while the pick is not the first row; the current food shows greyed in a slot that stays.
    const cur5 = ['/items/donut', null, '/items/spaceberry_cake', '/items/star_fruit_gummy', '/items/donut'];
    const statusLeader = (id, status, o = {}) => ({ id, player: 'Player 1', desc: 'Player 1 food', change: { kind: 'foods', current: cur5, slots: [{ index: 1, item: '/items/star_fruit_gummy', trigger: null }] }, cost: 100000, seeds: 4, readingSeeds: 16, searchHours: 200, readHours: 400, hours: 600, tooFew: false, status, reading: 1000, low: 900, high: 1100, buyerNet: 800, netLow: 700, netHigh: 900, payback: 12, ...o });
    const statusRec = () => ({ ...roundRec(5, 40, 900, 1100), pools: [{ key: 'Player 1:foods', size: 30, contending: 20, paused: 10, sortedBy: 'payback', leaders: [statusLeader('s1', 'zero'), statusLeader('s2', 'first', { seeds: 108, readingSeeds: 0 }), statusLeader('s3', 'confirmed'), statusLeader('s4', 'contending'), statusLeader('s5', 'paused')] }] });
    const pickEntry = (o) => ({ soFar: true, slots: 3, empty: [2], items: [{ item: '/items/donut', slot: 0, trigger: null, same: true }, { item: '/items/spaceberry_cake', slot: 1, trigger: null }], readingSeeds: 8, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50, ...o });
    const liveWith = (entry, version) => ({ partial: { ...foodsOnly, setups: result.setups, steps: [result.steps[0]], singles: result.singles, basePerUser: result.basePerUser, best: { foods: { 'Player 1': entry }, drinks: result.best.drinks } }, version });
    rounds = { round: statusRec(), version: 5 };
    live = liveWith(pickEntry({ notFirst: true }), 6); // (one version counter for the live report and the rounds)
    await until(`!!document.querySelector('#whatIfRounds tr[data-status="zero"]') && !!document.querySelector('#whatIfResult [data-best-note="foods"]')`);
    await openFolds('whatIfDetails');
    check('See details opens the search rounds with the details', await js(`!document.getElementById('whatIfRounds').hidden && !document.getElementById('whatIfDetails').hidden`));
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 500));
        const st = await js(`(() => { const e = document.getElementById('whatIfRounds'), trs = [...e.querySelectorAll('tbody tr')], body = document.querySelector('#whatIfModal .modal-body'); const cells = trs.map((tr) => tr.lastElementChild); const lines = cells.map((c) => { const r = document.createRange(); r.selectNodeContents(c.querySelector('.whatif-chip') || c); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; }); return { texts: cells.map((c) => c.textContent), lines, heights: trs.map((tr) => Math.round(tr.getBoundingClientRect().height)), noOverflow: body.scrollWidth <= body.clientWidth }; })()`);
        check(`at ${w}x${h} the Status column shows only the five words (no clear change yet, still measuring, clear gain, set aside) each on one line, and the window does not scroll sideways`, JSON.stringify([...st.texts].sort()) === JSON.stringify(['clear gain', 'no clear change yet', 'set aside', 'still measuring', 'still measuring']) && st.lines.every((n) => n === 1) && st.noOverflow, JSON.stringify(st));
    }
    // No header text is cut or runs into its neighbour (Search rounds, Best foods, Best drinks, Chosen changes), at 1920, 1600 and 1366 wide.
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 500));
        const hd = await js(`(() => { const R = document.getElementById('whatIfResult'), E = document.getElementById('whatIfRounds'); const tables = { rounds: E.querySelector('table'), foods: R.querySelector('table[data-best="foods"]'), drinks: R.querySelector('table[data-best="drinks"]'), steps: [...R.querySelectorAll('table')].find((x) => x.textContent.includes('How it is bought')) }; const bad = []; for (const [name, tb] of Object.entries(tables)) { if (!tb) { bad.push(name + ': table missing'); continue; } const ths = [...tb.querySelectorAll('thead th')]; ths.forEach((th, i) => { const b = th.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(th); const tr = r.getBoundingClientRect(); if (th.scrollWidth > th.clientWidth + 1) bad.push(name + ': ' + th.textContent + ' scrollWidth ' + th.scrollWidth + ' > ' + th.clientWidth); if (th.textContent && (tr.right > b.right + 0.5 || tr.left < b.left - 0.5)) bad.push(name + ': ' + th.textContent + ' text outside its cell'); const n = ths[i + 1]; if (n) { const nb = n.getBoundingClientRect(); if (b.right > nb.left + 0.5 && b.left < nb.right) bad.push(name + ': ' + th.textContent + ' overlaps ' + n.textContent); } }); [...tb.querySelectorAll('tbody td.num')].forEach((td) => { if (td.scrollWidth > td.clientWidth + 1) bad.push(name + ': cell ' + td.textContent + ' wider than its cell'); }); } return bad; })()`);
        check(`at ${w}x${h} no header cell of the rounds, Best foods, Best drinks and Chosen changes tables is cut or runs into the next`, Array.isArray(hd) && hd.length === 0, JSON.stringify(hd));
        // The pool's title is the first header cell of its own table (nothing above the table), inside the window, and no header reads "Change".
        const pt = await js(`(() => { const E = document.getElementById('whatIfRounds'), body = document.querySelector('#whatIfModal .modal-body'), tbs = [...E.querySelectorAll('table')]; return { n: tbs.length, first: tbs.every((tb) => { const th = tb.querySelector('thead th'); return !!th && th.classList.contains('whatif-pool-title') && th.textContent.includes('Player 1') && tb.parentElement.firstElementChild === tb && th.getBoundingClientRect().right <= tb.getBoundingClientRect().right + 0.5 && th.getBoundingClientRect().left >= tb.getBoundingClientRect().left - 0.5; }), change: [...E.querySelectorAll('thead th')].some((th) => th.textContent === 'Change'), rows2: tbs.every((tb) => tb.querySelectorAll('thead tr').length === 2), noOverflow: body.scrollWidth <= body.clientWidth, text: (tbs[0]?.querySelector('thead th')?.textContent || '').slice(0, 160) }; })()`);
        check(`at ${w}x${h} each pool's title is the first header cell of its own table, the table is the first thing in its block, no header reads Change, the window does not scroll sideways`, pt.n >= 1 && pt.first && !pt.change && pt.rows2 && pt.noOverflow, JSON.stringify(pt));
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    check('the rounds table: a slot that stays shows the current food greyed, an empty one a greyed "empty"; the changed slot is plain', await js(`(() => { const tr = document.querySelector('#whatIfRounds tbody tr'), td = [...tr.querySelectorAll('td.chg')]; const dim = (c) => !!c.querySelector('.whatif-dim'); return td.length === 5 && dim(td[0]) && !dim(td[1]) && td[1].textContent !== '' && dim(td[2]) && td[3].textContent !== '' && dim(td[3]) && td.every((c) => c.textContent !== ''); })()`), (await roundsText()).slice(0, 400));
    check('the pick note shows under Best foods when the pick is not the table\'s first row, exact English, and the slots read greyed current / plain new / greyed empty', await js(`(() => { const n = document.querySelector('#whatIfResult [data-best-note="foods"]'), t = document.querySelector('#whatIfResult table[data-best="foods"]'), td = [...t.querySelectorAll('tbody tr td.chg')]; return n.textContent === "This one is the search's pick on its search runs; the table above is ordered by the fresh runs." && !!td[0].querySelector('.whatif-dim') && !td[1].querySelector('.whatif-dim') && td[2].textContent === 'empty' && !!td[2].querySelector('.whatif-dim') && n.previousElementSibling === t; })()`));
    live = liveWith(pickEntry({}), 7);
    check('the pick note goes when the pick is the first row', await until(`!document.querySelector('#whatIfResult [data-best-note]') && !!document.querySelector('#whatIfResult table[data-best="foods"]')`));
    check('while it runs the state chip reads Searching', await js(`document.getElementById('whatIfState').textContent === 'Searching'`), await js(`document.getElementById('whatIfState').textContent`));
    // While the button reads Stopping, the stage row keeps Accept and Skip in place, disabled; a failed Stop gives them back.
    raceProgress = true;
    await until(`!!document.querySelector('#whatIfProgress [data-whatif-done="skip"]')`);
    await js(`(() => { const f = window.fetch; window.fetch = (u, o) => { if (String(u).endsWith('/stop')) { window.fetch = f; return new Promise((r) => setTimeout(() => r(new Response(JSON.stringify({ error: 'stop failed (test)' }), { status: 500 })), 1500)); } return f(u, o); }; return true; })()`);
    const stageBtns = `[...document.querySelectorAll('#whatIfProgress [data-whatif-done]')].map((b) => [b.dataset.whatifDone, b.disabled, Math.round(b.getBoundingClientRect().left), b.textContent, getComputedStyle(b).opacity])`;
    const btnsBefore = await js(stageBtns);
    const btnsAtClick = await js(`(document.getElementById('buttonWhatIfSearch').click(), ${stageBtns})`);
    await new Promise((r) => setTimeout(r, 700));
    const btnsLater = await js(stageBtns), labelLater = await js(`document.getElementById('buttonWhatIfSearch').textContent`);
    await shot('whatIfModal', 'stage-buttons-while-stopping.png');
    const keep = (a) => JSON.stringify(a.map(([m, , x, t]) => [m, x, t]));
    check('while Stopping, Accept and Skip stay in place with their labels, disabled with the disabled look, at the click and on later polls', btnsBefore.length === 2 && btnsBefore.every((b) => !b[1]) && [btnsAtClick, btnsLater].every((s) => s.length === 2 && s.every((b) => b[1] && Number(b[4]) < 1) && keep(s) === keep(btnsBefore)) && labelLater === 'Stopping…', JSON.stringify({ btnsBefore, btnsAtClick, btnsLater, labelLater }));
    check('a failed Stop gives Accept and Skip back, enabled', await until(`document.getElementById('buttonWhatIfSearch').textContent === 'Stop'`, 5000) && JSON.stringify(await js(stageBtns)) === JSON.stringify(btnsBefore), JSON.stringify(await js(stageBtns)));
    await js(`(document.getElementById('whatIfMessage').textContent = '', true)`);
    raceProgress = false;
    await until(`!document.querySelector('#whatIfProgress [data-whatif-done]')`);
    // A failed Stop (the runner answers with an error, once): Stopping at the click, then back to Stop with the message.
    await js(`(() => { const f = window.fetch; window.fetch = (u, o) => { if (String(u).endsWith('/stop')) { window.fetch = f; return Promise.resolve(new Response(JSON.stringify({ error: 'stop failed (test)' }), { status: 500 })); } return f(u, o); }; return true; })()`);
    const stopFail = await js(`new Promise((res) => { const b = document.getElementById('buttonWhatIfSearch'); b.click(); const pending = { text: b.textContent, disabled: b.disabled, danger: b.classList.contains('btn-outline-danger') }; setTimeout(() => res({ pending, text: b.textContent, disabled: b.disabled, danger: b.classList.contains('btn-outline-danger'), message: document.getElementById('whatIfMessage').textContent }), 300); })`);
    check('a failed Stop: Stopping (disabled, btn-outline-danger) at the click, then back to Stop, enabled, with the runner message', stopFail.pending.text === 'Stopping…' && stopFail.pending.disabled && stopFail.pending.danger && stopFail.text === 'Stop' && !stopFail.disabled && stopFail.danger && stopFail.message === 'stop failed (test)' && search.state === 'running', JSON.stringify(stopFail));
    await js(`(document.getElementById('whatIfMessage').textContent = '', true)`);
    const sincesAtStop = sinces.length, lastSince = sinces.at(-1);
    const stopSeen = await js(`new Promise((res) => { const b = document.getElementById('buttonWhatIfSearch'), t0 = performance.now(); b.click(); const pending = { text: b.textContent, disabled: b.disabled }; const iv = setInterval(() => { if (!b.disabled && b.textContent !== 'Stop') { clearInterval(iv); res({ ms: performance.now() - t0, pending, enabled: !b.disabled, text: b.textContent, primary: b.classList.contains('btn-primary') && !b.classList.contains('btn-outline-danger') }); } }, 5); })`);
    const stopMs = stopSeen.ms;
    check('Stop pending: right after the click, before the runner has stopped, the button reads "Stopping" and is disabled', stopSeen.pending.text === 'Stopping…' && stopSeen.pending.disabled === true, JSON.stringify(stopSeen.pending));
    check('Stop stops it: nothing changed, so the button reads Resume (btn-primary, enabled)', search.state === 'stopped' && stopSeen.enabled && stopSeen.text === 'Resume' && stopSeen.primary, JSON.stringify(stopSeen));
    const readButton = `(() => { const b = document.getElementById('buttonWhatIfSearch'); return b.textContent + (b.disabled ? ' disabled' : '') + (b.classList.contains('btn-primary') ? ' primary' : ''); })()`;
    const setPayback = (v) => js(`(() => { const i = document.getElementById('inputWhatIfMaxPayback'); i.value = '${v}'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await setPayback(300);
    check('a stopped search with a setting changed (the payback limit): the button reads Start', (await js(readButton)) === 'Start primary', await js(readButton));
    await setPayback(365);
    check('the setting changed back: the button reads Resume again', (await js(readButton)) === 'Resume primary', await js(readButton));
    check(`Stop: Resume shows within 900 ms of the click when the runner stops 300 ms after it (the window polls at once and every 250 ms after a press; was 1 s): ${Math.round(stopMs)} ms`, stopMs < 900);
    check('Stop keeps the report version the window has: no status request after it asks from 0', lastSince > 0 && sinces.slice(sincesAtStop).every((x) => x >= lastSince), JSON.stringify(sinces.slice(sincesAtStop - 1)));
    check('after Stop the state chip reads "Stopped by you"', await until(`document.getElementById('whatIfState').textContent === 'Stopped by you'`), await js(`document.getElementById('whatIfState').textContent`));
    check('after Stop no element of the progress area reads Running; it reads Stopped once, the rows keep their figures', await js(`(() => { const p = document.getElementById('whatIfProgress'); const texts = [p, ...p.querySelectorAll('*')].map((e) => e.textContent); return !texts.some((x) => /Running|round \\d+ running/.test(x)) && /^Stopped/.test(p.textContent.trim()) && !p.querySelector('[data-whatif-done], .whatif-part-running'); })()`), await js(`document.getElementById('whatIfProgress').textContent`));
    check('live: a stopped search keeps its report on screen, marked Stopped', await until(`document.querySelector('#whatIfResult .whatif-running .whatif-chip.whatif-st-halted')?.title.includes('Stopped: this is where the search got to.') === true`) && await js(`![...document.querySelectorAll('#whatIfResult [title], #whatIfResult [data-tip]')].some((e) => (e.title + (e.dataset.tip || '')).includes('Running: the report fills in'))`) && !(await resultText()).includes('Running: the report fills in') && (await resultText()).includes('Magic 1→2'));
    live = null;
    rounds = null;
    holdRunning = false;
    const receivedBefore = received;
    const resumed = await js(`(() => { const b = document.getElementById('buttonWhatIfSearch'); b.click(); return { text: b.textContent, disabled: b.disabled }; })()`);
    check('Resume: right at the click the button reads Starting, disabled', resumed.text === 'Starting…' && resumed.disabled, JSON.stringify(resumed));
    check('Resume continues the stopped search (the same search id, by the runner restarting it), no new search is posted', await until(`document.getElementById('buttonWhatIfSearch').textContent !== 'Starting…'`) && received?.options?.marketplace?.timestamp === 1700000000 && received === receivedBefore);
    check('Resume runs it to the end and the result shows', await until(`document.getElementById('whatIfResult').textContent.includes('Apply 1 to 2')`));
    check('the result shows "≤" and the unknown-cost list', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('≤') && t.includes('A token item'); })()`));
    check('a finished result shows no unknown-cost chip (the list of changes with no known cost stays under See details)', await js(`!document.querySelector('#whatIfModal [data-left-out="apart"]') && !!document.getElementById('whatIfApart')`));
    check('the result shows the snapshot time and the priced over-budget group', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return document.querySelector('#whatIfResult [data-prices-stale] .whatif-chip')?.title.includes('market snapshot of 2023-11-14 22:13 UTC') && t.includes('Priced, over budget') && t.includes('Feet Pathseeker Boots ★ +12→Cotton Boots +0'); })()`));
    check('a finished search: the button reads Start', (await js(readButton)) === 'Start primary', await js(readButton));
    check('the earlier searches list fills', await until(`document.getElementById('selectWhatIfResult').options.length === 1`));
    check('the chosen-changes table reads party gain, error, buyer gain, error, cost, payback, How it is bought, and a row shows its fresh reading and the payback on it (a loss as a minus)', await js(`(() => { const T = [...document.querySelectorAll('#whatIfResult table')].find((x) => x.textContent.includes('How it is bought')); const th = [...T.querySelector('thead tr').children].map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')); const td = [...T.querySelector('tbody tr').children].map((e) => e.textContent); const i = th.indexOf('Shared loot gain per user'); return i === 3 && th.slice(i, i + 5).join('|') === "Shared loot gain per user|Buyer's gain|Cost|Payback days|How it is bought" && !th.some((x) => /Spent|Stage|Shared gain|Own supplies|error/.test(x)) && td[i].startsWith('266') && td[i].endsWith('± 40') && td[i + 1].startsWith('3,300') && td[i + 1].endsWith('± 150') && td[i + 3] === '≤ 76' && td[i + 4] === 'ability books' && T.querySelector('tbody tr').children[i + 4].querySelector('.whatif-chip')?.title === '25 x berserk'; })()`));
    check('the buyer payback of a net of 0 or below is a dash (a loss shows as a minus), and the confirmation shows the party gain and a line per player', await js(`(() => { const r = [...document.querySelectorAll('#whatIfResult table')].find((x) => x.textContent.includes('How it is bought')).querySelectorAll('tbody tr')[1]; const t = document.getElementById('whatIfResult').textContent; const own = [...document.querySelectorAll('#whatIfResult table[data-confirm="players"], #whatIfResult table:not(.whatif-list):not(.whatif-each):not([data-best])')].map((x) => x.textContent).join(' '); return r.children[6].textContent === '—' && r.children[4].textContent.startsWith('-200') && t.includes('Player 13,300 ± 150≤ 34') && t.includes('Party (the shared loot, per user)417 ± 47') && !t.includes('Spent') && !own.includes('Stage'); })()`));
    // The same in the result's tables: a table header, the rightmost header (by the window's right edge), and at the bottom of the screen.
    for (const [name, pick, scroll] of [['a table header', `document.querySelector('#whatIfResult th .whatif-help')`, 'nearest'],
        ['the rightmost table header', `[...document.querySelectorAll('#whatIfResult th .whatif-help')].filter((m) => m.offsetParent).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0]`, 'nearest'],
        ['a table header at the bottom of the screen', `document.querySelector('#whatIfResult th .whatif-help')`, 'end']]) {
        const r = await tipAt(pick, scroll);
        check(`the tooltip of a help mark in ${name} shows whole, inside the window, over everything, with no scrollbar added`, tipOk(r, scroll), JSON.stringify(r));
    }
    await shot('whatIfModal', 'whatif-result.png');
    if (shots) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 400));
        await js(`(() => { const b = document.querySelector('#whatIfModal .modal-body'); b.scrollTop = b.scrollHeight; return true; })()`);
        await new Promise((r) => setTimeout(r, 200));
        const v = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1500, height: 1000, scale: 1 } });
        fs.mkdirSync(path.join(shots, 'split'), { recursive: true });
        fs.writeFileSync(path.join(shots, 'split', 'split-1500.png'), Buffer.from(v.data, 'base64'));
        await page.send('Emulation.clearDeviceMetricsOverride');
    }
    const before = await js(`[document.getElementById('inputLevel_magic').value, document.getElementById('inputLevel_stamina').value]`);
    await js(`document.querySelector('[data-whatif-apply="steps:2"]').click(), true`);
    const after = await js(`[document.getElementById('inputLevel_magic').value, document.getElementById('inputLevel_stamina').value]`);
    check('Apply 1 to 2 writes both steps into the setup', Number(after[0]) === Number(before[0]) + 1 && Number(after[1]) === Number(before[1]) + 1, JSON.stringify({ before, after }));
    check('the window now lists where the page differs from the search, with the skill\'s name, not the field key', await js(`(() => { const t = document.getElementById('whatIfDiff').textContent; return t.includes('Magic level:') && !t.includes('magicLevel'); })()`));
    check('the details are closed behind one See details toggle, and the search rounds with them', await js(`document.getElementById('whatIfDetails').hidden && document.querySelector('[data-whatif-more="whatIfDetails whatIfRounds"]').textContent === 'See details' && (document.getElementById('whatIfRounds').hidden || !document.getElementById('whatIfRounds').innerHTML)`));
    await openFolds('whatIfDetails', 'whatIfEachChange');
    check('grey singles are collapsed behind "Show 1 more not accepted"', await js(`document.getElementById('whatIfMoreSingles').hidden && document.querySelector('[data-whatif-more="whatIfMoreSingles"]').textContent === 'Show 1 more not accepted'`));
    await js(`document.querySelector('[data-whatif-more="whatIfMoreSingles"]').click(), true`);
    check('the toggle opens the grey rows', await js(`!document.getElementById('whatIfMoreSingles').hidden && document.querySelector('[data-whatif-more="whatIfMoreSingles"]').textContent === 'Hide the 1 not accepted'`));
    check('there is no helps-the-party group: five tables outside the detail lists, no heading, no hint, no steak row', await js(`(() => { const r = document.getElementById('whatIfResult'), t = r.textContent; return r.querySelectorAll('table:not(.whatif-list)').length === 5 && !t.includes('Helps the party') && !t.includes('Not bought:') && !/steak/i.test(t); })()`));

    check('the finished result shows the zone and tier once, in the summary bar, a base-profit chip in its own row, and the loss warning under it', await js(`(() => { const r = document.getElementById('whatIfResult'), sel = (id) => document.getElementById(id).selectedOptions[0].textContent; const chips = [...document.querySelectorAll('#whatIfSummaryChips .whatif-chip')]; const zone = chips.find((c) => c.querySelector('.whatif-chip-k')?.textContent === 'Zone'); const base = r.querySelector('.whatif-context .whatif-chip'); const warn = r.querySelector('.whatif-callout.whatif-warn'); return !!zone && zone.textContent.includes(sel('selectWhatIfZone')) && zone.textContent.includes(sel('selectWhatIfTier')) && !r.textContent.includes('Zone:') && !!base && base.textContent.startsWith('profit now, per player per day') && base.textContent.includes('-9,667k') && warn?.textContent === 'At this zone the party loses money at base, so a gain here means losing less.' && !!(base.compareDocumentPosition(warn) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    check('the result shows Best foods and Best drinks above Chosen changes with the page\'s own names, a trigger in parentheses on a food only, no row for an unchanged player, and the baseline line', await js(`(() => { const r = document.getElementById('whatIfResult'), t = r.textContent; const at = (s) => t.indexOf(s); return at('Best foods') > 0 && at('Best foods') < at('Best drinks') && at('Best drinks') < at('Chosen changes, in order') && /Player 1Donut \\(.+Current.+\\)Spaceberry Cake/.test(t) && !t.includes('/items/') && !/\\bdonut\\b/.test(t) && t.includes('Player 1Attack CoffeeWisdom Coffee') && !/Coffee \\(/.test(t) && !r.querySelector('[data-best="foods"]').textContent.includes('Nobody') && (() => { const h = [...r.querySelectorAll('.whatif-h')].find((e) => e.textContent.startsWith('Chosen changes, in order')); return h?.querySelector('.whatif-help')?.dataset.tip === 'Everything below is measured on top of these foods and drinks.' && !!(r.querySelector('table[data-best="drinks"]').compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); })(); })()`), (await js(`document.getElementById('whatIfResult').textContent.slice(0, 2600)`)));
    check('the over-budget list is closed behind one toggle beside its heading and count chip, and shows game names, not ids', await js(`(() => { const ul = document.getElementById('whatIfOverBudget'); const b = document.querySelector('[data-whatif-more="whatIfOverBudget"]'); const line = b.parentElement, rows = ul.querySelectorAll('tbody tr'); return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show' && line.textContent.startsWith('Priced, over budget') && line.querySelector('.whatif-chip-n').textContent === '3' && line.querySelector('.whatif-help').dataset.tip === '(3, not ranked: each is priced above its player\\'s budget)' && ul.textContent.includes('Feet Pathseeker Boots ★ +12→Cotton Boots +0') && !ul.textContent.includes('pathseeker_boots_refined') && ul.textContent.includes('not_a_real_item_x') && rows[0].children[0].textContent === 'Player 1' && rows[0].children[1].textContent.startsWith('Feet Pathseeker') && rows[1].children[0].textContent === 'Player 1' && rows[1].children[1].textContent.startsWith('not_a_real_item_x'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('the skipped swaps are one line with a count chip, a help mark and a Show toggle, closed, one line high', await js(`(() => { const ul = document.getElementById('whatIfDominated'); const b = document.querySelector('[data-whatif-more="whatIfDominated"]'); const line = b.parentElement; return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show' && line.textContent.startsWith('Swaps skipped') && line.querySelector('.whatif-chip-n').textContent === '2' && line.querySelector('.whatif-help').dataset.tip === '2 swaps skipped (no better on any stat)' && line.getBoundingClientRect().height < 40; })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfDominated"]').click(), true`);
    check('the toggle opens the skipped swaps with game names and a second click closes them', await js(`(() => { const ul = document.getElementById('whatIfDominated'); const b = document.querySelector('[data-whatif-more="whatIfDominated"]'); const rows = ul.querySelectorAll('tbody tr'); const open = !ul.hidden && b.textContent === 'Hide' && rows[0].children[0].textContent === 'Player 1' && rows[0].children[1].textContent === 'Feet Cotton Boots +0→Pathseeker Boots ★ +0' && rows[1].children[0].textContent === 'Player 1' && rows[1].children[1].textContent.startsWith('not_a_real_item_x'); b.click(); return open && ul.hidden && b.textContent === 'Show'; })()`));
    check('the toggle opens the over-budget list without touching the grey rows', await js(`!document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Hide' && !document.getElementById('whatIfMoreSingles').hidden`));
    check('an over-budget row bought with the old item sold names its price path on its line (TODO row 99)', await js(`document.getElementById('whatIfOverBudget').querySelectorAll('tbody tr')[2].textContent.includes("(buy, sell old)")`));
    check('a chosen row bought with the old item sold names its price path in How it is bought', await js(`[...document.querySelectorAll('#whatIfResult td')].some((c) => c.textContent.trim() === 'buy, sell old')`));
    await shot('whatIfModal', 'whatif-over-budget-open.png');
    await openFolds('whatIfOtherStyle');
    check('the left-out changes (another style or element) are one fold line with their count chip and help mark, and open to a table with game names: a book and a plate body', await js(`(() => { const ul = document.getElementById('whatIfOtherStyle'), line = document.querySelector('[data-whatif-more="whatIfOtherStyle"]').parentElement, rows = ul.querySelectorAll('tbody tr'); return !ul.hidden && line.textContent.startsWith(i18next.t('common:whatIf.result.otherStyleK')) && line.querySelector('.whatif-chip-n').textContent === '2' && line.querySelector('.whatif-help').dataset.tip === '2 changes left out (another combat style or element)' && rows.length === 2 && rows[0].children[0].textContent === 'Player 1' && /Cleave/.test(rows[0].textContent) && /Rainbow Plate Body/.test(rows[1].textContent); })()`), await js(`document.getElementById('whatIfOtherStyle')?.parentElement?.textContent`));
    if (shots) {
        // The price path pictures (TODO row 99): at 1920 wide, the window's body scrolled to the chosen changes, then to the open over-budget list.
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        const scrollTo = (expr) => js(`(() => { const e = ${expr}, body = document.querySelector('#whatIfModal .modal-body'); body.scrollTop += e.getBoundingClientRect().top - body.getBoundingClientRect().top - 120; return true; })()`);
        await scrollTo(`[...document.querySelectorAll('#whatIfResult table')].find((x) => x.textContent.includes('How it is bought'))`);
        await new Promise((r) => setTimeout(r, 300));
        await shot('whatIfModal', 'price-path-chosen.png');
        await scrollTo(`document.getElementById('whatIfOverBudget')`);
        await new Promise((r) => setTimeout(r, 300));
        await shot('whatIfModal', 'price-path-over-budget.png');
        await scrollTo(`document.getElementById('whatIfOtherStyle')`);
        await new Promise((r) => setTimeout(r, 300));
        await shot('whatIfModal', 'whatif-left-out.png');
    }
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('a second click closes it again', await js(`document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Show'`));
    check('the report has no second fresh line and no seed count anywhere', await js(`(() => { const r = document.getElementById('whatIfResult'); return !r.querySelector('.whatif-fresh') && !/\\bseeds\\b/.test(r.textContent); })()`), await resultText());
    check('the pays-back-too-slowly list is closed behind one toggle with its count and the limit, after the over-budget list, with game names, cost and days', await js(`(() => { const ul = document.getElementById('whatIfOverPayback'); const b = document.querySelector('[data-whatif-more="whatIfOverPayback"]'); const t = document.getElementById('whatIfResult').textContent, line = b.parentElement, rows = ul.querySelectorAll('tbody tr'); return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show' && t.includes('Pays back too slowly') && line.querySelector('.whatif-chip-n').textContent === '2' && line.querySelector('.whatif-help').dataset.tip === '(2, not chosen: each pays back in more than 365 days)' && t.indexOf('Priced, over budget') < t.indexOf('Pays back too slowly') && rows[0].children[0].textContent === 'Player 1' && rows[0].children[1].textContent.startsWith('Feet Pathseeker Boots ★ +12→Cotton Boots +0') && rows[0].children[3].textContent === '612' && ul.querySelector('thead th:last-child').textContent === 'Payback days' && rows[1].textContent.includes('no gain to pay it back'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfOverPayback"]').click(), true`);
    check('the toggle opens the pays-back-too-slowly list and a second click closes it', await js(`(() => { const ul = document.getElementById('whatIfOverPayback'); const b = document.querySelector('[data-whatif-more="whatIfOverPayback"]'); const open = !ul.hidden && b.textContent === 'Hide'; b.click(); return open && ul.hidden && b.textContent === 'Show'; })()`));
    check('an amber left-out chip opens its list and its own toggle then reads Hide; a second click on the chip closes it and the toggle reads Show', await js(`(() => { const chip = document.querySelector('[data-whatif-more~="whatIfOverPayback"]:not([data-show])'); const b = document.querySelector('[data-whatif-more="whatIfOverPayback"][data-show]'); const ul = document.getElementById('whatIfOverPayback'); if (!chip || !b || !ul.hidden) return false; chip.click(); const open = !ul.hidden && b.textContent === 'Hide'; chip.click(); return open && ul.hidden && b.textContent === 'Show'; })()`), await js(`JSON.stringify({ chip: !!document.querySelector('[data-whatif-more~="whatIfOverPayback"]:not([data-show])'), toggle: !!document.querySelector('[data-whatif-more="whatIfOverPayback"][data-show]'), hidden: document.getElementById('whatIfOverPayback')?.hidden, chips: [...document.querySelectorAll('#whatIfResult [data-left-out]')].map((c) => c.dataset.whatifMore) })`));
    check('the picks not confirmed are one heading with a count and a toggle, the list closed by default, with game names, the step and the fresh reading', await js(`(() => { const ul = document.getElementById('whatIfNotConfirmed'); const b = document.querySelector('[data-whatif-more="whatIfNotConfirmed"]'); const line = b.parentElement, c = ul.querySelector('tbody tr').children; return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show' && line.querySelector('.whatif-chip-n').textContent === '1' && ul.textContent.includes('Feet Pathseeker Boots ★ +12') && c[2].textContent === 'at step 2' && c[2].querySelector('.whatif-chip')?.title === 'fresh runs' && c[3].textContent === '—' && c[4].textContent === '10 ± 7' && c[5].textContent === '40 ± 25' && [...ul.querySelectorAll('thead th')].map((h) => h.textContent).slice(-2).join('|') === "Shared loot gain per user|Buyer's gain" && !ul.textContent.includes('seeds') && document.getElementById('whatIfResult').textContent.includes('Not confirmed'); })()`), await js(`(() => { const ul = document.getElementById('whatIfNotConfirmed'); const b = document.querySelector('[data-whatif-more="whatIfNotConfirmed"]'); const c = ul.querySelector('tbody tr').children; return JSON.stringify({ hidden: ul.hidden, btn: b.textContent, n: b.parentElement.querySelector('.whatif-chip-n')?.textContent, title: c[2].querySelector('.whatif-chip')?.title, heads: [...ul.querySelectorAll('thead th')].map((h) => h.textContent), cells: [...c].map((x) => x.textContent) }); })()`));
    const mgf = JSON.parse(await js(`(() => { const i = document.getElementById('inputWhatIfMinGain'), l = document.querySelector('label[for="inputWhatIfMinGain"]'); const bg = getComputedStyle(i).backgroundColor.replace(/[^0-9,.]/g, '').split(',').map(Number); const pb = getComputedStyle(document.getElementById('inputWhatIfMaxPayback')).backgroundColor, sc = getComputedStyle(document.getElementById('inputWhatIfShrineCap')).backgroundColor; return JSON.stringify({ pb, sc, v: i && i.value, l: l && l.textContent, help: !!(l && l.querySelector('.whatif-help')), bg }); })()`));
    check('the smallest gain worth showing: one field in the window, filled with the default share from minGain.mjs, its label and help mark in the dark theme of the page', !!mgf.v && mgf.v === '0.12' && mgf.l.includes('Smallest gain worth showing') && mgf.help && mgf.bg.slice(0, 3).every((x) => x < 128), JSON.stringify(mgf));
    await js(`document.querySelector('[data-whatif-more="whatIfNotConfirmed"]').click(), true`);
    check('the toggle opens the not-confirmed list and a second click closes it', await js(`(() => { const ul = document.getElementById('whatIfNotConfirmed'); const b = document.querySelector('[data-whatif-more="whatIfNotConfirmed"]'); const open = !ul.hidden && getComputedStyle(ul).display !== 'none' && b.textContent === 'Hide'; b.click(); return open && ul.hidden && b.textContent === 'Show'; })()`));
    await js(`i18next.changeLanguage('pt').then(() => true)`);
    check('in Portuguese the names follow the language and the list is closed again', await until(`(() => { const ul = document.getElementById('whatIfOverBudget'); const n = i18next.t('itemNames./items/pathseeker_boots_refined'); return n !== 'Pathseeker Boots ★' && ul.hidden && ul.textContent.includes(n + ' +12') && !ul.textContent.includes('Pathseeker Boots'); })()`));
    check('in Portuguese the warning\'s field follows the language too', await until(`(() => { const t = document.getElementById('whatIfDiff').textContent; const n = i18next.t('skillNames./skills/magic'); return n !== 'Magic' && t.includes(i18next.t('common:whatIf.diff.level', { skill: n }) + ':') && !t.includes('Magic level'); })()`));
    // The page's own language switch (it localizes the page's labels after the language changes).
    const switchTo = (prefix) => js(`(document.querySelector('.language-switcher') ? [...document.querySelectorAll('.language-switcher button')].find((b) => b.textContent.startsWith('${prefix}')).click() : null, true)`);
    await switchTo('Portugu');
    check('in Portuguese the new labels and the zone names follow the language, and the window picks stay', await until(`(() => { const z = document.getElementById('selectWhatIfZone'); const pz = document.getElementById('selectZone'); return document.querySelector('[data-i18n="common:whatIf.players"]').textContent === 'Jogadores' && document.querySelector('label[for="selectWhatIfZone"]').textContent === 'Zona' && i18next.t('common:whatIf.choicesNote').includes('começam marcados') && z.value === ${JSON.stringify(windowZone)} && z.options[3].textContent === pz.options[3].textContent && z.options[3].textContent === i18next.t('actionNames.' + z.options[3].value) && z.options[3].textContent !== 'Porcupine' && document.getElementById('selectWhatIfTier').value === '1'; })()`));
    check('in Portuguese the summary bar\'s zone chip reads Zona and the zone name the window shows', await until(`(() => { const c = [...document.querySelectorAll('#whatIfSummaryChips .whatif-chip')].find((x) => x.querySelector('.whatif-chip-k')?.textContent === 'Zona'); const z = document.getElementById('selectWhatIfZone').selectedOptions[0].textContent; return !!c && c.textContent.includes(z) && z === i18next.t('actionNames.' + document.getElementById('selectWhatIfZone').value); })()`), await js(`i18next.language + ' | ' + i18next.t('common:whatIf.goalLabel') + ' | ' + document.getElementById('whatIfSummaryChips').textContent`));
    await switchTo('English');
    await js(`i18next.changeLanguage('en').then(() => true)`);
    check('back in English the names are English', await until(`document.getElementById('whatIfOverBudget').textContent.includes('Feet Pathseeker Boots ★ +12')`));
    check('the cost path column wraps', await js(`(() => { const e = document.querySelector('#whatIfResult td.wrap'); return !!e && getComputedStyle(e).whiteSpace === 'normal'; })()`));
    check('a chip in a wrapping cell is a block of text, not a flex row (a flex row broke its number spans apart)', await js(`(() => { const c = document.querySelector('#whatIfResult td.wrap .whatif-chip'); return !!c && getComputedStyle(c).display === 'inline-block'; })()`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('the window fits a 1500x900 viewport and scrolls inside itself, with no horizontal scroll', await js(`(() => { const b = document.querySelector('#whatIfModal .modal-content').getBoundingClientRect(); const body = document.querySelector('#whatIfModal .modal-body'); return b.top >= 0 && b.bottom <= innerHeight && b.right <= innerWidth && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth; })()`));
    await js(`document.querySelector('[data-whatif-apply="single:1"]').click(), true`);
    check('a player the page lacks is named, nothing applied', await js(`document.getElementById('whatIfMessage').textContent.includes('Nobody')`) &&
        (await js(`document.getElementById('inputLevel_attack').value`)) === (await js(`document.getElementById('inputLevel_attack').value`)));
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('Show loads an earlier result', await until(`document.getElementById('whatIfResult').textContent.includes('Magic 1')`));
    // The setup warning (TODO row 115): one line with the count, the list closed behind the page's fold toggle; a trigger difference worded as
    // the result table words it (the game's names, the page's language), never as raw data.
    serveTrigger = true;
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const diffState = `(() => { const box = document.getElementById('whatIfDiff'), list = document.getElementById('whatIfDiffList'), b = box.querySelector('[data-whatif-more="whatIfDiffList"]'); const line = box.querySelector('.whatif-fold-line'); return { n: list ? list.querySelectorAll('li').length : -1, hidden: list?.hidden, display: list ? getComputedStyle(list).display : null, toggle: b?.textContent, line: line?.textContent || '', lineH: line ? line.getBoundingClientRect().height : 0, text: box.textContent }; })()`;
    check('the warning on a result computed on another setup is one line with the count of differences, its list closed', await until(`(() => { const d = ${diffState}; return d.n > 1 && d.hidden && d.display === 'none' && d.toggle === 'Show' && d.line.startsWith("The page's setup differs from the one the search ran on in " + d.n + ' places') && d.lineH < 40; })()`), JSON.stringify(await js(diffState)));
    const scrollDiff = () => js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), e = document.getElementById('whatIfDiff'); body.scrollTop += e.getBoundingClientRect().top - body.getBoundingClientRect().top - 160; return true; })()`);
    await scrollDiff();
    await shot('whatIfModal', 'warning-one-line.png');
    await js(`document.querySelector('[data-whatif-more="whatIfDiffList"]').click(), true`);
    const pokeWords = (lng) => `[i18next.t('combatTriggerDependencyNames./combat_trigger_dependencies/self', { lng: '${lng}' }) + ' ' + i18next.t('combatTriggerConditionNames./combat_trigger_conditions/current_hp', { lng: '${lng}' }) + ' <= 60', i18next.t('combatTriggerDependencyNames./combat_trigger_dependencies/self', { lng: '${lng}' }) + ' ' + i18next.t('combatTriggerConditionNames./combat_trigger_conditions/current_mp', { lng: '${lng}' }) + ' >= 10'].join(' ' + i18next.t('common:whatIf.trig.and') + ' ')`;
    const trigLine = `(() => { const li = [...document.querySelectorAll('#whatIfDiffList li')].find((x) => x.textContent.includes(i18next.t('abilityNames./abilities/poke') + ' ' + i18next.t('common:whatIf.trig.trigger') + ':')); return li ? li.textContent : ''; })()`;
    check('a click opens the list: every difference one line, the Magic level by name, the trigger difference worded with the game\'s names', await until(`(() => { const d = ${diffState}; const tl = ${trigLine}; return !d.hidden && d.toggle === 'Hide' && d.text.includes('Magic level:') && tl.endsWith('in the search ' + ${pokeWords('en')}) && !d.text.includes('[{') && !d.text.includes('dependency') && !d.text.includes('/combat_trigger_'); })()`), JSON.stringify(await js(diffState)));
    await scrollDiff();
    await shot('whatIfModal', 'warning-open.png');
    for (const [lng, sh] of [['pt', 'warning-open-pt.png'], ['zh', 'warning-open-zh.png']]) {
        await js(`i18next.changeLanguage('${lng}').then(() => true)`);
        check(`in ${lng} the warning's line, its toggle and the trigger difference follow the language, and the open list stays open across the redraw`, await until(`(() => { const d = ${diffState}; const tl = ${trigLine}; return !d.hidden && d.toggle === i18next.t('common:whatIf.result.dominatedHide') && d.line.startsWith(i18next.t('common:whatIf.diff.count', { n: d.n })) && tl.endsWith(i18next.t('common:whatIf.diff.result') + ' ' + ${pokeWords(lng)}) && !d.text.includes('[{'); })()`), JSON.stringify(await js(diffState)));
        await scrollDiff();
        await shot('whatIfModal', sh);
    }
    await js(`i18next.changeLanguage('en').then(() => true)`);
    await js(`document.querySelector('[data-whatif-more="whatIfDiffList"]').click(), true`);
    check('a second click closes the list again', await js(`document.getElementById('whatIfDiffList').hidden && document.querySelector('[data-whatif-more="whatIfDiffList"]').textContent === 'Show'`));
    serveTrigger = false;
    // A stopped search is listed under Earlier searches, marked as stopped in its entry (en, pt, zh: whatIf.state.stopped), beside the finished
    // ones (one list); Show puts it on screen as the window shows it right after Stop: the stopped mark and its last search round (TODO row 115).
    serveStopped = true;
    // The list is read again when the window opens (the show event, as `reopen` above).
    await js(reopen);
    const entries = `[...document.getElementById('selectWhatIfResult').options].map((o) => [o.value, o.textContent])`;
    check('Earlier searches lists the stopped search, marked as stopped, beside the finished one', await until(`(() => { const e = ${entries}; return e.length === 2 && e[0][0] === 'search-stopped' && e[0][1].endsWith(' · Stopped') && e[1][0] === 'search-1' && !e[1][1].includes('Stopped'); })()`), JSON.stringify(await js(entries)));
    const listShot = async (name) => {
        // The select's own drop-down is drawn by the browser outside the page (no picture has it): for the picture it is shown as an open list (size).
        await js(`(() => { const s = document.getElementById('selectWhatIfResult'); s.size = s.options.length; s.value = 'search-stopped'; document.querySelector('#whatIfModal .modal-body').scrollTop = 0; return true; })()`);
        await shot('whatIfModal', name);
        await js(`(() => { document.getElementById('selectWhatIfResult').size = 0; return true; })()`);
    };
    await listShot('earlier-searches-stopped.png');
    for (const [lng, sh] of [['pt', 'earlier-searches-stopped-pt.png'], ['zh', 'earlier-searches-stopped-zh.png']]) {
        await js(`i18next.changeLanguage('${lng}').then(() => true)`);
        check(`in ${lng} the stopped entry's mark follows the language, the selection kept`, await until(`(() => { const e = ${entries}; return e.length === 2 && e[0][1].endsWith(' · ' + i18next.t('common:whatIf.state.stopped')) && i18next.t('common:whatIf.state.stopped') !== 'Stopped'; })()`), JSON.stringify(await js(entries)));
        await listShot(sh);
    }
    await js(`i18next.changeLanguage('en').then(() => true)`);
    await js(`(() => { document.getElementById('whatIfResult').innerHTML = ''; document.getElementById('whatIfRounds').innerHTML = ''; document.getElementById('selectWhatIfResult').value = 'search-stopped'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    const stoppedState = `(() => { const r = document.getElementById('whatIfResult'), mark = r.querySelector('.whatif-running'); return { mark: mark?.innerHTML || '', halted: !!r.querySelector('.whatif-st-halted'), magic: r.textContent.includes('Magic 1'), rounds: document.getElementById('whatIfRounds').textContent.length }; })()`;
    check('Show puts the stopped search on screen as after Stop: its report with the stopped mark and its last search round', await until(`(() => { const d = ${stoppedState}; return d.magic && d.halted && d.mark.includes('Stopped: this is where the search got to.') && d.rounds > 0; })()`), JSON.stringify(await js(stoppedState)));
    if (shots) { await js(`(() => { document.querySelector('#whatIfModal .modal-body').scrollTop = 0; return true; })()`); await new Promise((r) => setTimeout(r, 300)); }
    await shot('whatIfModal', 'stopped-search-shown.png');
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('Show on the finished search after it draws it with no stopped mark', await until(`(() => { const d = ${stoppedState}; return d.magic && !d.halted && !d.mark; })()`), JSON.stringify(await js(stoppedState)));
    serveStopped = false;
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    serveOlder = true;
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('an older result (a helps-the-party group, no buyer net) loads with no group, no hint, dashes in the buyer cells and the run-again line', await until(`(() => { const r = document.getElementById('whatIfResult'), t = r.textContent, row = [...r.querySelectorAll('table')].find((x) => x.textContent.includes('How it is bought'))?.querySelector('tbody tr'); return t.includes('Magic 1') && !t.includes('Helps the party') && !t.includes('Not bought:') && !!row && row.children[4].textContent === '—'; })()`));
    serveOlder = false;
    // A result of real size fits the window at 1920x1080, 1600x900 and 1366x768: no horizontal scroll in the window's body, every Apply button inside its content edge.
    serveBig = true;
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
        await until(`[...document.querySelectorAll('#whatIfResult table')].some((x) => !x.classList.contains('whatif-each') && x.textContent.includes('How it is bought') && x.querySelectorAll('thead th').length === 11)`);
        await openFolds('whatIfDetails', 'whatIfEachChange');
        await new Promise((r) => setTimeout(r, 400));
        const fit = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), br = body.getBoundingClientRect(), edge = br.right - parseFloat(getComputedStyle(body).paddingRight) - (body.offsetWidth - body.clientWidth); const apply = [...document.querySelectorAll('#whatIfResult [data-whatif-apply]')].filter((b) => b.getBoundingClientRect().width > 0); return { noBar: body.scrollWidth <= body.clientWidth, scrollW: body.scrollWidth, clientW: body.clientWidth, n: apply.length, inside: apply.every((b) => b.getBoundingClientRect().right <= edge + 0.5), tables: [...document.querySelectorAll('#whatIfResult table')].map((t) => t.getBoundingClientRect().right <= edge + 0.5), changeLines: (() => { const t = document.querySelector('#whatIfResult table.whatif-each'); const lines = (c) => { const rg = document.createRange(); rg.selectNodeContents(c); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; }; return t ? Math.max(...[...t.querySelectorAll('td.chg')].map(lines)) : 99; })(), eachScrollW: document.querySelector('#whatIfResult table.whatif-each')?.getBoundingClientRect().width, worst: (() => { const t = document.querySelector('#whatIfResult table.whatif-each'); if (!t) return null; const rg = document.createRange(); const rows = [...t.querySelectorAll('td.chg')].map((c) => { rg.selectNodeContents(c); return { w: Math.round(c.getBoundingClientRect().width), tops: [...new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)))], text: c.textContent.slice(0, 60) }; }); return rows.sort((a, b) => b.tops.length - a.tops.length)[0]; })(), numberLines: Math.max(...[...[...document.querySelectorAll('#whatIfResult table')].find((x) => !x.classList.contains('whatif-each') && x.textContent.includes('How it is bought')).querySelectorAll('tbody td.num')].map((c) => { const rg = document.createRange(); rg.selectNodeContents(c); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; })) }; })()`);
        check(`at ${w}x${h} a result of real size (3 players, 11 columns, changes up to 235 characters) has no horizontal scroll, every Apply button is inside the window, every table fits and no Change is taller than 3 lines${w === 1920 ? ', no number cell of the steps table wraps' : ''}`, fit.noBar && fit.n >= 6 && fit.inside && fit.tables.every(Boolean) && fit.changeLines <= 3 && (w !== 1920 || fit.numberLines === 1), JSON.stringify(fit));
        check(`at ${w}x${h} the free change reads "N/A" in the steps table and in Each change alone, and the best block shows`, await js(`(() => { const r = document.getElementById('whatIfResult'); const free = [...r.querySelectorAll('tbody tr')].filter((tr) => tr.textContent.includes('poke trigger') || tr.textContent.includes('Poke')); return free.length >= 2 && free.every((tr) => tr.textContent.includes('N/A')) && r.textContent.includes('Best foods') && r.querySelectorAll('.whatif-best-table tbody tr').length === 6; })()`));
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await js(`i18next.changeLanguage('pt').then(() => true)`);
    // A trigger change reads whole in the page's language: the window's words and the game's (the free step "poke trigger: game default (always)").
    check('in Portuguese a trigger change reads whole', await until(`document.getElementById('whatIfResult').textContent.includes(i18next.t('abilityNames./abilities/poke') + ' gatilho: padrão do jogo (Sempre)')`), await resultText());
    await js(`(() => { const td = [...document.querySelectorAll('#whatIfResult td.chg')].find((x) => x.textContent.includes('(Sempre)')); td?.scrollIntoView({ block: 'center' }); return true; })()`);
    await shot('whatIfModal', 'trigger-change-pt.png');
    await js(`i18next.changeLanguage('zh').then(() => true)`);
    check('in Chinese a trigger change reads whole', await until(`document.getElementById('whatIfResult').textContent.includes(i18next.t('abilityNames./abilities/poke') + ' 触发条件: 游戏默认（始终）')`), await resultText());
    await js(`(() => { const td = [...document.querySelectorAll('#whatIfResult td.chg')].find((x) => x.textContent.includes('\u59cb\u7ec8')); td?.scrollIntoView({ block: 'center' }); return true; })()`);
    await shot('whatIfModal', 'trigger-change-zh.png');
    await js(`i18next.changeLanguage('en').then(() => true)`);
    serveBig = false;
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 400));
    check('at 1100 wide the five tick boxes still share one row and no name is cut', await js(`(() => { const b = [...document.querySelectorAll('#whatIfPlayers .form-check')].map((e) => e.getBoundingClientRect()); return b.length === 5 && new Set(b.map((r) => Math.round(r.top))).size === 1 && [...document.querySelectorAll('#whatIfPlayers label')].every((e) => e.scrollWidth <= e.clientWidth); })()`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    // A three-player party: only the page's real player tabs count.
    await js(`(() => { for (const n of [4, 5]) document.getElementById('player' + n + '-tab').parentElement.remove(); return true; })()`);
    await js(reopen);
    check('a three-player page gives three tick boxes in the window', await js(`document.querySelectorAll('#whatIfPlayers input').length === 3 && [...document.querySelectorAll('#whatIfPlayers label')].map((l) => l.textContent).join() === 'Player 1,Player 2,Player 3'`));
    await js(`document.getElementById('whatIfPlayer_3').click(), true`);
    check('the budget rows follow the ticks in a three-player window', await js(`[...document.querySelectorAll('#whatIfBudgets input')].map((i) => i.dataset.player).join() === 'Player 1,Player 3'`));
    // A new search clears the earlier result and its warning at the Start click, before the first progress shows (TODO row 115, point 8);
    // the earlier result stays reachable under Earlier searches.
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('before the new search an earlier result and its warning are on show', await until(`document.getElementById('whatIfResult').textContent.includes('Magic 1') && !!document.getElementById('whatIfDiffList')`));
    holdRunning = true;
    const atClick = await js(`(() => { const b = document.getElementById('buttonWhatIfSearch'); b.click(); return { result: document.getElementById('whatIfResult').innerHTML, diff: document.getElementById('whatIfDiff').innerHTML, rounds: document.getElementById('whatIfRounds').innerHTML, button: b.textContent }; })()`);
    check('at the Start click the earlier result, its warning and its rounds are gone, before the runner answers', atClick.result === '' && atClick.diff === '' && atClick.rounds === '' && atClick.button === 'Starting…', JSON.stringify(atClick).slice(0, 300));
    check('the new search runs with no old result in the window', await until(`document.getElementById('whatIfState').textContent === 'Searching' && !!document.getElementById('whatIfProgress').textContent`) && await js(`document.getElementById('whatIfResult').innerHTML === '' && document.getElementById('whatIfDiff').innerHTML === ''`));
    if (shots) { await js(`(() => { document.querySelector('#whatIfModal .modal-body').scrollTop = 0; return true; })()`); await new Promise((r) => setTimeout(r, 300)); }
    await shot('whatIfModal', 'new-search-clears-result.png');
    holdRunning = false;
    check('the new search finishes and its result shows', await until(`document.getElementById('whatIfState').textContent === 'Done' && document.getElementById('whatIfResult').textContent.includes('Magic 1')`));
    await js(`(() => { document.getElementById('whatIfResult').innerHTML = ''; document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('an earlier result is still reachable under Earlier searches', await until(`document.getElementById('selectWhatIfResult').options.length >= 1 && document.getElementById('whatIfResult').textContent.includes('Magic 1')`));
    // A search the runner reports failed: the state chip reads Error, and nothing in the progress area reads Running or Searching.
    failNext = true;
    await js(`document.getElementById('buttonWhatIfSearch').click(), true`);
    check('a failed search: the state chip reads Error, no element of the progress area reads Running or Searching', await until(`document.getElementById('whatIfState').textContent === 'Error'`) && await js(`(() => { const p = document.getElementById('whatIfProgress'); return ![p, ...p.querySelectorAll('*')].some((e) => /Running|Searching/.test(e.textContent)); })()`), await js(`document.getElementById('whatIfState').textContent + ' | ' + document.getElementById('whatIfProgress').textContent.slice(0, 120)`));
    failNext = false;
    search.state = 'done';
    // Kept across page loads: a reload, the page's player ticked again, the window opened.
    await page.send('Page.navigate', { url: base });
    await until(`document.getElementById('buttonWhatIf')?.style.display === ''`);
    await js(`(() => { document.getElementById('player1').checked = true; document.getElementById('buttonWhatIf').click(); return true; })()`);
    check('after a page reload the kept export is still there', await until(`document.querySelector('#whatIfBudgets [data-export-status="Player 1"]')?.textContent === 'items and abilities: Tracker import'`));
    // Character names: an import's name replaces "Player N" in the window's tick boxes; a name two slots share does not.
    await js(`(() => { window.addEventListener('error', (e) => { window.__importErr = e.message; }); document.getElementById('group-combat-tab').click(); document.getElementById('inputSetGroupCombatAll').value = JSON.stringify({ 1: { name: 'Alpha' }, 2: { name: 'Beta' }, 3: { name: 'Beta' } }); document.getElementById('buttonImportSet').click(); return true; })()`);
    const importInfo = await js(`(() => ({ active: document.querySelector('#importTab .nav-link.active')?.id, err: window.__importErr || null }))()`);
    await js(reopen);
    const shownLabels = await js(`[...document.querySelectorAll('#whatIfPlayers label')].map((l) => l.textContent).join()`);
    check('the window shows an import\'s character name instead of Player N; two slots with the same name keep their tab names', shownLabels === 'Alpha,Player 2,Player 3,Player 4,Player 5', shownLabels + ' ' + JSON.stringify(importInfo));
    page.close();
} finally {
    await chrome.close();
    server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}

// The public page: no runner, no button (a server whose /api/version is 404).
{
    const plain = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
        if (url.pathname.startsWith('/api/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    const prof2 = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-window-'));
    const chrome2 = await launchChrome({ userDataDir: path.join(prof2, 'profile'), width: 1200, height: 900 });
    try {
        const page = await chrome2.newPage();
        await page.send('Page.enable');
        await page.send('Page.navigate', { url: `http://127.0.0.1:${plain.address().port}/` });
        await new Promise((r) => setTimeout(r, 4000));
        const r = await page.send('Runtime.evaluate', { expression: `[!!document.getElementById('buttonWhatIf'), document.getElementById('buttonWhatIf')?.style.display, !!document.getElementById('selectZone')?.options.length, document.getElementById('whatIfModal')?.classList.contains('whatif-norunner')]`, returnByValue: true });
        const [exists, display, loaded, getRunner] = r.result.value;
        // The button shows the "get the runner" state of the window (full test: tools/test/whatif-get-runner-page.mjs).
        check('without a runner the page loads and the button opens the "get the runner" window', exists && display === '' && loaded && getRunner, JSON.stringify(r.result.value));
        page.close();
    } finally { await chrome2.close(); plain.close(); try { fs.rmSync(prof2, { recursive: true, force: true }); } catch {} }
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
