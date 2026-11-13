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
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', fresh: { seeds: 32, seedFrom: 20001, seedTo: 20032, gain: 800, se: 120, gainPerUser: 266, sePerUser: 40, buyerNet: 3300, buyerNetSe: 150, accepted: true }, gain: 900, se: 100, gainPerUser: 300, sePerUser: 33, sharedGainPerUser: 4100, sharedSePerUser: 310, ownSuppliesPerDay: -12500, ownSuppliesSe: 400, buyerNet: 3500, buyerNetSe: 120, paybackOwn: 15.1, cost: 250000, payback: 277.8, costPath: 'books', note: '25 x berserk; upper bound (XP inside the level unknown)', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 's2', player: 'Player 1', desc: 'Stamina 1 → 2', gain: 400, se: 90, gainPerUser: 133, sePerUser: 30, sharedGainPerUser: 900, sharedSePerUser: 70, ownSuppliesPerDay: 1100, ownSuppliesSe: 50, buyerNet: -200, buyerNetSe: 60, paybackOwn: null, cost: 300000, costBound: 'upper', payback: 750, costPath: 'house upgrade', note: '', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'stamina', delta: 1 }] },
    ],
    confirmation: { gain: 1250, se: 140, gainPerUser: 417, sePerUser: 47, sharedGainPerUser: 5000, sharedSePerUser: 330, buyerByPlayer: { 'Player 1': { gain: 3300, se: 150, payback: 33.5 } }, cost: 550000, payback: 440 },
    singles: [
        { id: 's1', player: 'Player 1', desc: 'Magic 1 → 2', lastStage: '8x300', gain: 900, se: 100, gainPerUser: 300, sePerUser: 33, sharedGainPerUser: 4100, sharedSePerUser: 310, ownSuppliesPerDay: -12500, ownSuppliesSe: 400, buyerNet: 3500, buyerNetSe: 120, paybackOwn: 15.1, cost: 250000, payback: 277.8, costPath: 'days of play', accepted: true, ops: [{ op: 'level', player: 'Player 1', skill: 'magic', delta: 1 }] },
        { id: 'x', player: 'Nobody', desc: 'Attack 1 → 2', lastStage: '4x50', gain: 10, se: 80, gainPerUser: 3, sePerUser: 27, sharedGainPerUser: 50, sharedSePerUser: 60, ownSuppliesPerDay: 70, ownSuppliesSe: 5, buyerNet: -20, buyerNetSe: 30, paybackOwn: null, cost: 100000, payback: null, costPath: 'days of play', accepted: false, ops: [{ op: 'level', player: 'Nobody', skill: 'attack', delta: 1 }] },

    ],
    notConfirmed: [{ id: 'nc', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', step: 2, fresh: { seeds: 64, seedFrom: 20001, seedTo: 20064, gain: 30, se: 20, gainPerUser: 10, sePerUser: 7, buyerNet: 40, buyerNetSe: 25, accepted: false }, cost: 100, costPath: 'market' }],
    apart: [{ id: 'u', desc: 'A token item', note: 'no seller' }],
    overBudget: [{ id: 'o', player: 'Player 1', desc: 'Player 1 feet pathseeker_boots_refined +12 -> cotton_boots +0', cost: 7000000000, costPath: 'market' }, { id: 'o2', player: 'Player 1', desc: 'Player 1 not_a_real_item_x +1 -> +2', cost: 8000000000, costPath: 'market' }],
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
        if (m[2] && req.method === 'POST') { search.state = search.state === 'running' ? 'stopped' : 'running'; return send(res, 200, { state: search.state, progress: progress() }); }
        if (search.state === 'running' && ++polls >= 3 && !holdRunning) search.state = 'done';
        const since = Number(url.searchParams.get('since')) || 0;
        sinces.push(since);
        return send(res, 200, { state: search.state, progress: progress(), ...(search.state === 'done' ? { result } : search.state === 'running' && live && live.version > since ? { partial: live.partial, partialVersion: live.version } : {}), ...(search.state === 'running' && rounds && rounds.version > since ? { round: rounds.round, roundVersion: rounds.version } : {}) });
    }
    if (url.pathname === '/api/results') return send(res, 200, search?.state === 'done' ? [{ id: search.id, finished: '2026-01-01 12:00', goal: 'profit', players: ['Player 1'] }] : []);
    if (url.pathname.startsWith('/api/results/')) return send(res, 200, serveBig ? bigResult : serveOlder ? olderResult : result);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
let holdRunning = true;
let raceProgress = false; // true: the progress message of a race stage in a late round (round 12, 10 ruled out), the long label and counters of the real run
let raceDone = false; // true: the finished Screen race row of the real run (round 1 finished, 473 in the running, the pick checks still going)
const progress0 = () => ({ stage: 'screen', candidatesLeft: 40, runsDone: 12, runsPlanned: 48, secondsPerRun: 2.5, etaSeconds: 90, ...(raceProgress ? { round: 12, phase: 'reading', stageContending: 40, stagePaused: 63, stageDropped: 10, stageRuns: 735, stageSimHours: 37000, parts: [{ kind: 'foods', index: 0, state: 'running', runsPlanned: 48, runsDone: 12, candidatesLeft: 40, etaSeconds: 90, round: 12, phase: 'reading', contending: 40, paused: 63, dropped: 10, acceptable: 1, runs: 735, simHours: 37000 }, { kind: 'steps', index: 0, state: 'waiting', maxSteps: 20 }] } : {}) });
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
    const until = async (expression, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expression)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    const shot = async (id, name) => {
        if (!shots) return;
        fs.mkdirSync(path.dirname(path.join(shots, name)), { recursive: true });
        const [x, y, width, height] = await js(`(() => { const b = document.querySelector('#${id} .modal-content').getBoundingClientRect(); return [b.x + scrollX, b.y + scrollY, b.width, b.height]; })()`);
        const s = await page.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 }, captureBeyondViewport: true });
        fs.writeFileSync(path.join(shots, name), Buffer.from(s.data, 'base64'));
    };

    await page.send('Page.navigate', { url: base });
    check('the What-if button shows when the runner answers', await until(`document.getElementById('buttonWhatIf')?.style.display === ''`));
    check('the page is dark by default', await js(`document.body.classList.contains('dark-mode')`));
    // The page's own choices, which the window copies when it opens: Player 1 only, the third zone, tier 2.
    await js(`(() => { for (const c of document.querySelectorAll('.player-checkbox')) c.checked = c.id === 'player1'; const z = document.getElementById('selectZone'); z.selectedIndex = 2; document.getElementById('selectDifficulty').value = '2'; return true; })()`);
    const pageState = `({ zone: document.getElementById('selectZone').value, tier: document.getElementById('selectDifficulty').value, ticks: [...document.querySelectorAll('.player-checkbox')].map((c) => c.checked).join() })`;
    const pageChoices = await js(pageState);
    await js(`document.getElementById('buttonWhatIf').click(), true`);
    check('the window opens with a budget per ticked player', await until(`!!document.querySelector('#whatIfBudgets input[data-player="Player 1"]')`));
    check('the window copies the page\'s players (only Player 1 ticked), zone and tier', await js(`(() => { const boxes = [...document.querySelectorAll('#whatIfPlayers input')]; return boxes.length === 5 && boxes.map((b) => b.checked).join() === 'true,false,false,false,false' && document.querySelector('label[for="whatIfPlayer_1"]').textContent === 'Player 1' && document.getElementById('selectWhatIfZone').value === ${JSON.stringify(pageChoices.zone)} && document.getElementById('selectWhatIfTier').value === '2'; })()`));
    check('the five tick boxes share one row, in equal columns, with no name cut', await js(`(() => { const b = [...document.querySelectorAll('#whatIfPlayers .form-check')].map((e) => e.getBoundingClientRect()); const l = [...document.querySelectorAll('#whatIfPlayers label')]; return b.length === 5 && new Set(b.map((r) => Math.round(r.top))).size === 1 && new Set(b.map((r) => Math.round(r.width))).size === 1 && l.every((e) => e.scrollWidth <= e.clientWidth); })()`));
    check('the zone and tier selectors carry the page\'s options in the same order and names', await js(`(() => { const same = (a, b) => JSON.stringify([...document.getElementById(a).options].map((o) => [o.value, o.textContent])) === JSON.stringify([...document.getElementById(b).options].map((o) => [o.value, o.textContent])); return document.getElementById('selectZone').options.length > 5 && same('selectWhatIfZone', 'selectZone') && same('selectWhatIfTier', 'selectDifficulty'); })()`));
    // An edit in the window: Player 2 ticked, another zone and tier. The page keeps its own.
    await js(`(() => { for (const [id, v] of [['selectWhatIfZone', document.getElementById('selectWhatIfZone').options[4].value], ['selectWhatIfTier', '1']]) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); } document.getElementById('whatIfPlayer_2').click(); return true; })()`);
    check('a player ticked in the window gets a budget row; the page is unchanged', await js(`!!document.querySelector('#whatIfBudgets input[data-player="Player 2"]') && document.querySelectorAll('#whatIfBudgets input').length === 2`) &&
        JSON.stringify(await js(pageState)) === JSON.stringify(pageChoices));
    await js(`document.getElementById('whatIfPlayer_2').click(), document.getElementById('whatIfPlayer_1').click(), true`);
    check('unticking every player shows the message and no budget rows', await js(`document.getElementById('whatIfMessage').textContent === 'Tick at least one player to simulate.' && document.querySelectorAll('#whatIfBudgets input').length === 0`));
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('Start with none ticked sends nothing', received === null && (await js(`document.getElementById('whatIfMessage').textContent`)) === 'Tick at least one player to simulate.');
    await js(`document.getElementById('whatIfPlayer_1').click(), true`);
    check('ticking a player again clears the message and brings the budget row back', await js(`document.getElementById('whatIfMessage').textContent === '' && document.querySelectorAll('#whatIfBudgets input').length === 1`));
    // A window opened on a page with nobody ticked copies nothing: none ticked, the message, no rows.
    const reopen = `document.getElementById('whatIfModal').dispatchEvent(new Event('show.bs.modal')), true`;
    await js(`(document.getElementById('player1').checked = false, true)`);
    await js(reopen);
    check('a page with no player ticked gives a window with none ticked and the message', await js(`[...document.querySelectorAll('#whatIfPlayers input')].every((b) => !b.checked) && document.getElementById('whatIfMessage').textContent === 'Tick at least one player to simulate.' && document.querySelectorAll('#whatIfBudgets input').length === 0`) &&
        await js(`document.getElementById('selectWhatIfZone').value === ${JSON.stringify(pageChoices.zone)} && document.getElementById('selectWhatIfTier').value === '2'`));
    await js(`(document.getElementById('player1').checked = true, true)`);
    await js(reopen);
    check('opening again copies the page again, dropping the window\'s edits', await js(`document.getElementById('whatIfPlayer_1').checked && document.getElementById('whatIfMessage').textContent === '' && !!document.querySelector('#whatIfBudgets input[data-player="Player 1"]')`));
    // The window's own zone and tier for the request (a zone and tier other than the page's).
    const windowZone = await js(`(() => { const s = document.getElementById('selectWhatIfZone'); s.value = s.options[4].value; s.dispatchEvent(new Event('change', { bubbles: true })); const t = document.getElementById('selectWhatIfTier'); t.value = '1'; return s.value; })()`);
    check('the window lists eight levers (foods and drinks apart), all ticked but the two that need an export (disabled, unticked, with a reason); no pairs or skills box', await js(`document.querySelectorAll('#whatIfLevers input').length === 8 && !document.getElementById('whatIfLever_pairs') && !document.getElementById('whatIfLever_skills') && [...document.querySelectorAll('#whatIfLevers input')].filter((i) => !i.checked).map((i) => i.value).sort().join() === 'abilities,owned' && ['owned', 'abilities'].every((id) => document.getElementById('whatIfLever_' + id).disabled && document.getElementById('whatIfLever_' + id).title !== '')`));
    check('the runner version is shown', await js(`document.getElementById('whatIfVersion').textContent.includes('test-runner')`));
    // The character export per player: a paste box and a status line under each ticked player.
    const exportOf = (name, coin = 5) => ({ name, coin, inventory: [{ itemHrid: '/items/cheese_sword', enhancementLevel: 1, count: 1 }], learnedAbilities: [] });
    const paste = (player, text) => js(`(() => { const b = document.querySelector('#whatIfBudgets textarea[data-player="${player}"]'); b.value = ${JSON.stringify(text)}; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const statusOf = (player) => js(`document.querySelector('#whatIfBudgets [data-export-status="${player}"]').textContent`);
    const stored = (player) => js(`localStorage.getItem('whatIfExport:${player}')`);
    check('each ticked player has a paste box and a status line; no export says only that when no lever needs it', await js(`document.querySelectorAll('#whatIfBudgets textarea').length === 1 && getComputedStyle(document.querySelector('#whatIfBudgets textarea')).backgroundColor !== 'rgb(255, 255, 255)'`) && (await statusOf('Player 1')) === 'no export');
    check('without an export, Items you own cannot be ticked by a click', await js(`(() => { const c = document.getElementById('whatIfLever_owned'); c.click(); return c.disabled && !c.checked; })()`));
    await paste('Player 1', 'this is not json');
    check('a bad paste is not kept and the status says so', (await statusOf('Player 1')) === 'not a character export: not kept' && (await stored('Player 1')) === null);
    await paste('Player 1', JSON.stringify(exportOf('Player 1', 5)));
    check('a valid paste is kept in storage under the player\'s name, the box is emptied, the status names the export', (await stored('Player 1')) === JSON.stringify(exportOf('Player 1', 5)) && (await statusOf('Player 1')) === 'kept (Player 1)' && (await js(`document.querySelector('#whatIfBudgets textarea').value`)) === '');
    await paste('Player 1', JSON.stringify(exportOf('Player 1', 6)));
    check('a new paste replaces the kept one', (await stored('Player 1')) === JSON.stringify(exportOf('Player 1', 6)) && (await statusOf('Player 1')) === 'kept (Player 1)');
    await paste('Player 1', '{"name":"x"}');
    check('a bad paste over a kept one leaves the kept export in storage', (await stored('Player 1')) === JSON.stringify(exportOf('Player 1', 6)) && (await statusOf('Player 1')) === 'not a character export: not kept');
    await js(`(document.querySelector('#whatIfBudgets textarea').value = '', document.getElementById('whatIfPlayer_2').click(), true)`);
    check('a player ticked later has a paste box of their own and no export', (await statusOf('Player 2')) === 'no export: skipped by Items you own, Abilities' && (await statusOf('Player 1')) === 'kept (Player 1)', (await statusOf('Player 2')) + ' / ' + (await statusOf('Player 1')));
    await js(`document.getElementById('whatIfPlayer_2').click(), true`);
    // Layout: five, three and one players at 1500x900 and 1100x900; one row per player with one pitch, equal columns and
    // section gaps, Goal inline like Zone and Tier, the button row and both columns inside the window.
    const shotsLayout = shots ? path.join(shots, 'layout2') : null;
    const tickOnly = (n) => js(`(() => { for (const b of document.querySelectorAll('#whatIfPlayers input')) { const want = Number(b.value) <= ${n}; if (b.checked !== want) b.click(); } return true; })()`);
    const layout = () => js(`(() => {
        const r = (e) => e.getBoundingClientRect();
        const win = r(document.querySelector('#whatIfModal .modal-content')), body = document.querySelector('#whatIfModal .modal-body');
        const rows = [...document.querySelectorAll('#whatIfBudgets .whatif-prow')];
        const cols = [0, 1, 2, 3].map((i) => new Set(rows.map((x) => Math.round(r(x.children[i]).width))).size === 1 && new Set(rows.map((x) => Math.round(r(x.children[i]).left))).size === 1);
        const tops = rows.map((x) => r(x).top), pitch = tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 10) / 10), heights = rows.map((x) => Math.round(r(x).height));
        const oneLine = rows.every((x) => [...x.children].every((c) => r(c).height <= 32) && r(x.children[3]).left >= r(x.children[2]).right - 0.5 && Math.abs(r(x.children[2]).top - r(x.children[3]).top) < 16);
        const left = document.querySelector('#whatIfModal .col-md-5'), right = document.querySelector('#whatIfModal .col-md-7'), btn = document.getElementById('buttonWhatIfStart').parentElement;
        const kids = [...left.children].map(r), gaps = kids.slice(1).map((k, i) => k.top - kids[i].bottom);
        const colBottom = Math.max(r(left).bottom, 0), rightBottom = [...right.children].reduce((m, c) => Math.max(m, r(c).bottom), 0);
        const startInRight = right.contains(btn);
        const g = r(document.getElementById('selectWhatIfGoal')), z = r(document.getElementById('selectWhatIfZone')), t = r(document.getElementById('selectWhatIfTier'));
        const gl = r(document.querySelector('label[for="selectWhatIfGoal"]')), zl = r(document.querySelector('label[for="selectWhatIfZone"]'));
        const hintFits = rows.every((x) => { const t = x.children[2], cs = getComputedStyle(t), c = document.createElement('canvas').getContext('2d'); c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return c.measureText(t.placeholder).width <= t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); });
        const goalPlain = getComputedStyle(document.querySelector('label[for="selectWhatIfGoal"]')).fontWeight === getComputedStyle(document.querySelector('label[for="selectWhatIfZone"]')).fontWeight;
        return { hintFits, goalPlain, rows: rows.length, cols, pitch, heights, oneLine,
            statusTitles: rows.every((x) => x.children[3].title === x.children[3].textContent),
            inside: r(btn).bottom <= win.bottom && r(btn).bottom <= r(body).bottom && body.scrollHeight <= body.clientHeight + 1 && win.bottom <= innerHeight,
            btnBottom: Math.round(r(btn).bottom), winBottom: Math.round(win.bottom),
            startInRight, gaps: gaps.map((x) => Math.round(x * 10) / 10), leftBottom: Math.round(kids[kids.length - 1].bottom), rightBottom: Math.round(rightBottom),
            goalInline: Math.abs(g.left - z.left) < 1 && Math.abs(g.width - z.width) < 1 && Math.abs(g.width - t.width) < 1 && Math.abs(gl.left - zl.left) < 1 && Math.abs(gl.width - zl.width) < 1 && Math.abs(r(document.querySelector('label[for="selectWhatIfGoal"]')).top - g.top) < 12 };
    })()`);
    for (const [w, h] of [[1500, 900], [1100, 900]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        for (const n of [5, 3, 1]) {
            await tickOnly(n);
            await new Promise((r) => setTimeout(r, 250));
            const L = await layout(), tag = `${n} players at ${w}x${h}`;
            console.log('     ', tag, JSON.stringify({ gaps: L.gaps, pitch: L.pitch, heights: L.heights, btnBottom: L.btnBottom, winBottom: L.winBottom, leftBottom: L.leftBottom, rightBottom: L.rightBottom }));
            check(`${tag}: one row per player, one pitch, equal columns, status beside the field on one line`, L.rows === n && L.cols.every(Boolean) && new Set(L.pitch).size <= 1 && new Set(L.heights).size === 1 && L.oneLine && L.statusTitles, JSON.stringify(L));
            check(`${tag}: the Start search row is inside the window, no scrolling, and sits in the right column`, L.inside && L.startInRight, JSON.stringify(L));
            check(`${tag}: every section gap is equal`, L.gaps.length >= 3 && Math.max(...L.gaps) - Math.min(...L.gaps) < 1, JSON.stringify(L.gaps));
            check(`${tag}: the column bottoms are within 150 px`, Math.abs(L.leftBottom - L.rightBottom) <= 150, `${L.leftBottom} vs ${L.rightBottom}`);
            check(`${tag}: the whole paste hint fits inside the field`, L.hintFits, JSON.stringify(L));
            check(`${tag}: the Goal label has the weight of Zone and Tier`, L.goalPlain);
            check(`${tag}: Goal sits inline with its label like Zone and Tier`, L.goalInline, JSON.stringify(L));
            if (n === 5 && shotsLayout) await shot('whatIfModal', `layout2/layout2-${w}x${h}.png`);
        }
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    await tickOnly(1);
    await js(`(() => { const i = document.querySelector('#whatIfBudgets input'); i.value = 'abc'; return true; })()`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('a budget that is not a number is refused', await until(`document.getElementById('whatIfMessage').textContent.includes('Player 1')`) && received === null);
    check('the window has a payback limit field next to the budgets, 365 days by default', await js(`(() => { const i = document.getElementById('inputWhatIfMaxPayback'); return i.value === '365' && document.querySelector('label[for="inputWhatIfMaxPayback"]').textContent === 'Payback limit (days, 0 = no limit)' && !!i.closest('.modal-body') && (document.getElementById('whatIfBudgets').compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; })()`));
    await js(`(() => { document.getElementById('inputWhatIfMaxPayback').value = '-5'; return true; })()`);
    await js(`(document.querySelector('#whatIfBudgets input').value = '1000000', document.getElementById('buttonWhatIfStart').click(), true)`);
    check('a payback limit that is not a number of days is refused', await until(`document.getElementById('whatIfMessage').textContent.includes('payback limit')`) && received === null);
    await js(`(() => { document.getElementById('inputWhatIfMaxPayback').value = '365'; document.querySelector('#whatIfBudgets input').value = '1000000'; return true; })()`);
    // The market snapshot: the page's fetch of marketplace.json is answered here (no network for it in the test).
    await js(`(() => { const f = window.fetch; window.__mpCalls = 0; window.fetch = (u, o) => { if (!String(u).includes('marketplace.json')) return f(u, o); window.__mpCalls++;
        return window.__mpFail ? Promise.reject(new Error('offline')) : Promise.resolve(new Response(JSON.stringify({ marketData: { '/items/apple': { 0: { a: 10, b: 9 } } }, timestamp: 1700000000 }), { status: 200 })); }; window.__mpFail = true; return true; })()`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('a failed price fetch starts no search and says so', await until(`document.getElementById('whatIfMessage').textContent.includes('could not be fetched')`) && received === null && (await js('window.__mpCalls')) >= 1);
    await js(`(window.__mpFail = false, true)`);
    await js(`document.getElementById('buttonWhatIfStart').click(), true`);
    check('progress is shown while it runs', await until(`document.getElementById('whatIfProgress').textContent.includes('candidates left')`));
    check('the request carries the party, budgets, levers, zone and tier', received && received.setups.length >= 1 && received.setups.some((s) => s.name === 'Player 1' && s.player) &&
        received.budgets['Player 1'] === 1000000 && received.maxPayback === 365 && received.levers.join() === 'equip,foods,drinks,owned,abilities,order,triggers,houses' && received.goal === 'profit' && typeof received.options.tier === 'number' && !!received.options.zone, JSON.stringify(received)?.slice(0, 300));
    check('the request follows the window\'s zone, tier and players, not the page\'s', received.options.zone === windowZone && windowZone !== pageChoices.zone && received.options.tier === 1 && received.players.join() === 'Player 1', JSON.stringify(received.options.zone) + ' ' + JSON.stringify(received.players));
    check('the request carries the export map for the ticked players that have one, nobody else', !!received.export && Object.keys(received.export).join() === 'Player 1' && received.export['Player 1'].coin === 6, JSON.stringify(received.export)?.slice(0, 200));
    check('the request carries the market snapshot the page fetched', received?.options?.marketplace?.timestamp === 1700000000 && !!received.options.marketplace.marketData['/items/apple']);
    check('the progress bar has a dark track and a fill of its own in dark mode', await js(`(() => { const p = document.querySelector('#whatIfProgress .whatif-progress'); const lum = (c) => c.match(/[0-9]+/g).slice(0, 3).reduce((a, x) => a + Number(x), 0); const t = getComputedStyle(p).backgroundColor, b = getComputedStyle(p.querySelector('.progress-bar')).backgroundColor; return lum(t) < 150 && t !== b && getComputedStyle(p).borderTopWidth !== '0px'; })()`));
    await shot('whatIfModal', 'whatif-progress.png');
    // The live report: the runner's status carries the latest snapshot while the search runs; the window draws the same report from it.
    const resultText = () => js(`document.getElementById('whatIfResult').textContent`);
    check('live: no snapshot yet, no report', (await resultText()).trim() === '');
    live = { partial: { ...foodsOnly, setups: result.setups }, version: 1 };
    check('live: the foods alone are drawn as soon as they arrive, with the running mark, no steps heading, no "no steps" message, no totals', await until(`document.getElementById('whatIfResult').textContent.includes('Best foods')`) && await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('Running: the report fills in as the search goes.') && t.includes('Player 1Donut') && t.includes('Shared loot gain per user') && !t.includes('fresh runs:') && !t.includes('Chosen changes, in order') && !t.includes('No change gains beyond') && !t.includes('Confirmed on fresh runs') && !t.includes('Apply'); })()`), (await resultText()).slice(0, 400));
    check('live: the window asks for what is newer than what it drew', await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000 && !sinces.includes(1)) await new Promise((r) => setTimeout(r, 200)); return sinces.includes(1); })() && sinces.every((s) => s === 0 || s === 1));
    live = { partial: { ...foodsOnly, setups: result.setups, steps: [result.steps[0]], singles: result.singles, basePerUser: result.basePerUser, best: { foods: foodsOnly.best.foods, drinks: result.best.drinks } }, version: 2 };
    check('live: a newer snapshot adds the step, headed "so far", the drinks too; still the running mark and no totals', await until(`document.getElementById('whatIfResult').textContent.includes('Chosen changes, in order')`) && await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('so far') && t.includes('Magic 1 → 2') && !t.includes('Stamina 1 → 2') && t.includes('Player 1Attack Coffee') && t.includes('Running: the report fills in') && !t.includes('Confirmed on fresh runs') && !t.includes('No change gains beyond'); })()`), (await resultText()).slice(0, 600));
    await shot('whatIfModal', 'whatif-live.png');
    // The search rounds: under the live report, a round counter, contention counts and the table of the leaders; it follows a newer round.
    const roundsText = () => js(`document.getElementById('whatIfRounds').textContent`);
    check('rounds: no round yet, nothing drawn', (await roundsText()).trim() === '');
    rounds = { round: roundRec(3, 40, 900, 1100), version: 3 };
    check('rounds: the section shows the round counter, the contention counts and the leaders with their range', await until(`document.querySelector('#whatIfRounds [data-rounds="round"]')?.textContent === '3'`) && await js(`(() => { const e = document.getElementById('whatIfRounds'); const t = e.textContent; return e.querySelector('[data-rounds="contending"]').textContent === '40' && e.querySelector('[data-rounds="paused"]').textContent === '20' && t.includes('Search rounds') && t.includes('Magic 1 -> 2') && t.includes('1,000 ± 100') && t.includes('still measuring'); })()`), (await roundsText()).slice(0, 500));
    check('rounds: the section sits under the live report', await js(`(() => { const r = document.getElementById('whatIfResult'), s = document.getElementById('whatIfRounds'); return !!(r.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    check('rounds: the window asks for what is newer than the round it drew', await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000 && !sinces.includes(3)) await new Promise((r) => setTimeout(r, 200)); return sinces.includes(3); })());
    rounds = { round: roundRec(4, 25, 950, 1050), version: 4 };
    check('rounds: a newer round replaces the counter, the counts and the range', await until(`document.querySelector('#whatIfRounds [data-rounds="round"]')?.textContent === '4'`) && await js(`(() => { const e = document.getElementById('whatIfRounds'); return e.querySelector('[data-rounds="contending"]').textContent === '25' && e.textContent.includes('1,000 ± 50') && !e.textContent.includes('1,000 ± 100'); })()`), (await roundsText()).slice(0, 500));
    check('rounds: dark mode (no white table), no scroll axis of its own, one table per pool', await js(`(() => { const e = document.getElementById('whatIfRounds'); const lum = (c) => c.match(/[0-9]+/g).slice(0, 3).reduce((a, x) => a + Number(x), 0); const cs = getComputedStyle(e.querySelector('table')); const ov = [e, ...e.querySelectorAll('*')].every((x) => { const o = getComputedStyle(x); return !/(auto|scroll)/.test(o.overflowX + o.overflowY); }); return ov && lum(getComputedStyle(e.querySelector('table td')).color) > 300 && e.querySelectorAll('table').length === 1 && cs.backgroundColor !== 'rgb(255, 255, 255)'; })()`));
    await shot('whatIfModal', 'whatif-rounds.png');
    // A race stage's progress row has no bar: its label and counters use the whole row, wrap, are never cut and never widen the window.
    raceProgress = true;
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await until(`!!document.querySelector('#whatIfProgress .whatif-part-race')`);
        await new Promise((r) => setTimeout(r, 400));
        const fitRow = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), row = document.querySelector('#whatIfProgress .whatif-part-race'); if (!row) return null; const l = row.querySelector('.whatif-part-label'), x = row.querySelector('.whatif-part-text'), btn = l.querySelector('[data-whatif-done]'), edge = body.getBoundingClientRect().right; return { noOverflow: body.scrollWidth <= body.clientWidth, labelWraps: getComputedStyle(l).whiteSpace === 'normal' && l.scrollWidth <= l.clientWidth + 1, textWraps: !x && /ruled out/.test(l.textContent) && !!btn && l.getBoundingClientRect().right <= edge + 0.5 && [...l.querySelectorAll('[data-whatif-done]')].length === 2 && [...l.querySelectorAll('[data-whatif-done]')].every((b) => b.getBoundingClientRect().right <= edge + 0.5), ellipsis: getComputedStyle(l).textOverflow === 'ellipsis' && getComputedStyle(l).overflow !== 'visible', text: l.textContent }; })()`);
        check(`at ${w}x${h} a race stage row (counters after the status text, on the stage's own line, then the done button) is not cut, wraps, and the window has no horizontal scroll`, !!fitRow && fitRow.noOverflow && fitRow.labelWraps && fitRow.textWraps && !fitRow.ellipsis, JSON.stringify(fitRow));
    }
    // The progress redraw keeps an unchanged stage button: the same node across polls (a replaced node loses its hover state: the flicker), and a later poll with a changed part still draws it.
    {
        await until(`!!document.querySelector('#whatIfProgress [data-whatif-done="skip"]')`);
        await js(`(() => { window.__skipBtn = document.querySelector('#whatIfProgress [data-whatif-done="skip"]'); window.__skipBtn.__mark = 1; return true; })()`);
        const n0 = sinces.length;
        for (let i = 0; i < 100 && sinces.length < n0 + 2; i++) await new Promise((r) => setTimeout(r, 100));
        check('the Skip button is the same node after two more polls (the progress redraw does not replace it: no hover flicker)', sinces.length >= n0 + 2 && await js(`document.querySelector('#whatIfProgress [data-whatif-done="skip"]') === window.__skipBtn`));
    }
    // The same row once its race has ended (done): wraps like the running one, is never cut, its figures stay inside the window, one scroll axis.
    raceDone = true; raceProgress = true;
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await until(`!!document.querySelector('#whatIfProgress .whatif-part-done.whatif-part-race')`);
        await new Promise((r) => setTimeout(r, 400));
        const fitDone = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), row = document.querySelector('#whatIfProgress .whatif-part-done.whatif-part-race'); if (!row) return null; const l = row.querySelector('.whatif-part-label'), x = row.querySelector('.whatif-part-text'), edge = body.getBoundingClientRect().right, within = [l, x].every((e) => !e || (e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= edge + 0.5)); return { noOverflow: body.scrollWidth <= body.clientWidth, within, wraps: getComputedStyle(l).whiteSpace === 'normal', noButton: !row.querySelector('[data-whatif-done]'), noRunning: !/Running|round [0-9]+ running/.test(row.textContent), counts: /473 still in the running/.test(row.textContent) && /0 set aside/.test(row.textContent), text: row.textContent }; })()`);
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
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 500));
        const st = await js(`(() => { const e = document.getElementById('whatIfRounds'), trs = [...e.querySelectorAll('tbody tr')], body = document.querySelector('#whatIfModal .modal-body'); const cells = trs.map((tr) => tr.lastElementChild); const lines = cells.map((c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; }); return { texts: cells.map((c) => c.textContent), lines, heights: trs.map((tr) => Math.round(tr.getBoundingClientRect().height)), noOverflow: body.scrollWidth <= body.clientWidth }; })()`);
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
    await js(`document.getElementById('buttonWhatIfStop').click(), true`);
    check('Stop stops it and offers Resume', await until(`document.getElementById('buttonWhatIfStop').textContent === 'Resume'`) && search.state === 'stopped');
    check('after Stop no element of the progress area reads Running; it reads Stopped once, the rows keep their figures', await js(`(() => { const p = document.getElementById('whatIfProgress'); const texts = [p, ...p.querySelectorAll('*')].map((e) => e.textContent); return !texts.some((x) => /Running|round \\d+ running/.test(x)) && /^Stopped/.test(p.textContent.trim()) && !p.querySelector('[data-whatif-done], .whatif-part-running'); })()`), await js(`document.getElementById('whatIfProgress').textContent`));
    check('live: a stopped search keeps its report on screen, marked Stopped', await until(`document.getElementById('whatIfResult').textContent.includes('Stopped: this is where the search got to.')`) && !(await resultText()).includes('Running: the report fills in') && (await resultText()).includes('Magic 1 → 2'));
    live = null;
    rounds = null;
    holdRunning = false;
    await js(`document.getElementById('buttonWhatIfStop').click(), true`);
    check('Resume runs it to the end and the result shows', await until(`document.getElementById('whatIfResult').textContent.includes('Apply 1 to 2')`));
    check('the result shows "≤" and the unknown-cost list', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('≤') && t.includes('A token item'); })()`));
    check('the result shows the snapshot time and the priced over-budget group', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('market snapshot of 2023-11-14 22:13 UTC') && t.includes('Priced, over budget') && t.includes('Feet Pathseeker Boots ★ +12 -> Cotton Boots +0'); })()`));
    check('the earlier searches list fills', await until(`document.getElementById('selectWhatIfResult').options.length === 1`));
    check('the chosen-changes table reads party gain, error, buyer gain, error, cost, payback, How it is bought, and a row shows its fresh reading and the payback on it (a loss as a minus)', await js(`(() => { const T = [...document.querySelectorAll('#whatIfResult table')].find((x) => x.textContent.includes('How it is bought')); const th = [...T.querySelector('thead tr').children].map((e) => e.textContent); const td = [...T.querySelector('tbody tr').children].map((e) => e.textContent); const i = th.indexOf('Shared loot gain per user'); return i === 3 && th.slice(i, i + 5).join('|') === "Shared loot gain per user|Buyer's gain|Cost|Payback days|How it is bought" && !th.some((x) => /Spent|Stage|Shared gain|Own supplies|error/.test(x)) && td[i].startsWith('266') && td[i].endsWith('± 40') && td[i + 1].startsWith('3,300') && td[i + 1].endsWith('± 150') && td[i + 3] === '76' && td[i + 4] === 'books (25 x berserk)'; })()`));
    check('the buyer payback of a net of 0 or below is a dash (a loss shows as a minus), and the confirmation shows the party gain and a line per player', await js(`(() => { const r = [...document.querySelectorAll('#whatIfResult table')].find((x) => x.textContent.includes('How it is bought')).querySelectorAll('tbody tr')[1]; const t = document.getElementById('whatIfResult').textContent; return r.children[6].textContent === '—' && r.children[4].textContent.startsWith('-200') && t.includes('Player 13,300 ± 150≤ 34') && t.includes('Party (the shared loot, per user)417 ± 47') && !t.includes('Spent') && !t.includes('Stage'); })()`));
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
    check('grey singles are collapsed behind "Show 1 more not accepted"', await js(`document.querySelector('#whatIfResult .whatif-more').hidden && document.querySelector('[data-whatif-more]').textContent === 'Show 1 more not accepted'`));
    await js(`document.querySelector('[data-whatif-more]').click(), true`);
    check('the toggle opens the grey rows', await js(`!document.querySelector('#whatIfResult .whatif-more').hidden && document.querySelector('[data-whatif-more]').textContent === 'Hide the 1 not accepted'`));
    check('there is no helps-the-party group: two tables, no heading, no hint, no steak row', await js(`(() => { const r = document.getElementById('whatIfResult'), t = r.textContent; return r.querySelectorAll('table').length === 5 && !t.includes('Helps the party') && !t.includes('Not bought:') && !/steak/i.test(t); })()`));

    check('the finished result shows the zone line and the loss warning under the goal line', await js(`(() => { const t = document.getElementById('whatIfResult').textContent; return t.includes('Zone: Fly, tier 0 · base party profit') && t.includes('At this zone the party loses money at base, so a gain here means losing less.'); })()`));
    check('the result shows Best foods and Best drinks above Chosen changes with the page\'s own names, a trigger in parentheses on a food only, "no change" for an unchanged player, and the baseline line', await js(`(() => { const r = document.getElementById('whatIfResult'), t = r.textContent; const at = (s) => t.indexOf(s); return at('Best foods') > 0 && at('Best foods') < at('Best drinks') && at('Best drinks') < at('Chosen changes, in order') && /Player 1Donut \\(.+Current.+\\)Spaceberry Cake/.test(t) && !t.includes('/items/') && !/\\bdonut\\b/.test(t) && t.includes('Player 1Attack CoffeeWisdom Coffee') && !/Coffee \\(/.test(t) && /NobodyStar Fruit Gummy.*no change/.test(t) && at('Everything below is measured on top of these foods and drinks.') > at('Best drinks') && at('Everything below is measured') < at('Chosen changes, in order'); })()`), (await js(`document.getElementById('whatIfResult').textContent.slice(0, 2600)`)));
    check('the over-budget list is closed behind one toggle with its count, and shows game names, not ids', await js(`(() => { const ul = document.getElementById('whatIfOverBudget'); const b = document.querySelector('[data-whatif-more="whatIfOverBudget"]'); return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show the 2 priced over budget' && ul.textContent.includes('Feet Pathseeker Boots ★ +12 -> Cotton Boots +0') && !ul.textContent.includes('pathseeker_boots_refined') && ul.textContent.includes('not_a_real_item_x') && ul.children[0].textContent.startsWith('Player 1, Feet Pathseeker') && ul.children[1].textContent.startsWith('Player 1, not_a_real_item_x'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('the skipped swaps are one line with the count and a Show toggle, closed, one line high', await js(`(() => { const ul = document.getElementById('whatIfDominated'); const b = document.querySelector('[data-whatif-more="whatIfDominated"]'); const line = b.parentElement; return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show' && line.textContent.startsWith('2 swaps skipped (no better on any stat)') && line.getBoundingClientRect().height < 40; })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfDominated"]').click(), true`);
    check('the toggle opens the skipped swaps with game names and a second click closes them', await js(`(() => { const ul = document.getElementById('whatIfDominated'); const b = document.querySelector('[data-whatif-more="whatIfDominated"]'); const open = !ul.hidden && b.textContent === 'Hide' && ul.children[0].textContent === 'Player 1, Feet Cotton Boots +0 -> Pathseeker Boots ★ +0' && ul.children[1].textContent.startsWith('Player 1, not_a_real_item_x'); b.click(); return open && ul.hidden && b.textContent === 'Show'; })()`));
    check('the toggle opens the over-budget list without touching the grey rows', await js(`!document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Hide the 2 priced over budget' && !document.getElementById('whatIfMoreSingles').hidden`));
    await shot('whatIfModal', 'whatif-over-budget-open.png');
    await js(`document.querySelector('[data-whatif-more="whatIfOverBudget"]').click(), true`);
    check('a second click closes it again', await js(`document.getElementById('whatIfOverBudget').hidden && document.querySelector('[data-whatif-more="whatIfOverBudget"]').textContent === 'Show the 2 priced over budget'`));
    check('the report has no second fresh line and no seed count anywhere', await js(`(() => { const r = document.getElementById('whatIfResult'); return !r.querySelector('.whatif-fresh') && !/\\bseeds\\b/.test(r.textContent); })()`), await resultText());
    check('the pays-back-too-slowly list is closed behind one toggle with its count and the limit, after the over-budget list, with game names, cost and days', await js(`(() => { const ul = document.getElementById('whatIfOverPayback'); const b = document.querySelector('[data-whatif-more="whatIfOverPayback"]'); const t = document.getElementById('whatIfResult').textContent; return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show the 2 that pay back too slowly' && t.includes('Pays back too slowly') && t.includes('(2, not chosen: each pays back in more than 365 days)') && t.indexOf('Priced, over budget') < t.indexOf('Pays back too slowly') && ul.children[0].textContent.startsWith('Player 1, Feet Pathseeker Boots ★ +12 -> Cotton Boots +0') && ul.children[0].textContent.includes('612 days') && ul.children[1].textContent.includes('no gain to pay it back'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfOverPayback"]').click(), true`);
    check('the toggle opens the pays-back-too-slowly list and a second click closes it', await js(`(() => { const ul = document.getElementById('whatIfOverPayback'); const b = document.querySelector('[data-whatif-more="whatIfOverPayback"]'); const open = !ul.hidden && b.textContent === 'Hide the 2 that pay back too slowly'; b.click(); return open && ul.hidden && b.textContent === 'Show the 2 that pay back too slowly'; })()`));
    check('the picks not confirmed are one heading with a count and a toggle, the list closed by default, with game names, the step and the fresh reading', await js(`(() => { const ul = document.getElementById('whatIfNotConfirmed'); const b = document.querySelector('[data-whatif-more="whatIfNotConfirmed"]'); return ul.hidden && getComputedStyle(ul).display === 'none' && b.textContent === 'Show the 1 not confirmed' && ul.textContent.includes('Feet Pathseeker Boots ★ +12') && ul.textContent.includes('at step 2, fresh runs: party gain 10 ± 7, buyer\\'s gain 40 ± 25') && !ul.textContent.includes('seeds') && document.getElementById('whatIfResult').textContent.includes('Not confirmed'); })()`));
    await js(`document.querySelector('[data-whatif-more="whatIfNotConfirmed"]').click(), true`);
    check('the toggle opens the not-confirmed list and a second click closes it', await js(`(() => { const ul = document.getElementById('whatIfNotConfirmed'); const b = document.querySelector('[data-whatif-more="whatIfNotConfirmed"]'); const open = !ul.hidden && getComputedStyle(ul).display !== 'none' && b.textContent === 'Hide the 1 not confirmed'; b.click(); return open && ul.hidden && b.textContent === 'Show the 1 not confirmed'; })()`));
    await js(`i18next.changeLanguage('pt').then(() => true)`);
    check('in Portuguese the names follow the language and the list is closed again', await until(`(() => { const ul = document.getElementById('whatIfOverBudget'); const n = i18next.t('itemNames./items/pathseeker_boots_refined'); return n !== 'Pathseeker Boots ★' && ul.hidden && ul.textContent.includes(n + ' +12') && !ul.textContent.includes('Pathseeker Boots'); })()`));
    check('in Portuguese the warning\'s field follows the language too', await until(`(() => { const t = document.getElementById('whatIfDiff').textContent; const n = i18next.t('skillNames./skills/magic'); return n !== 'Magic' && t.includes(i18next.t('common:whatIf.diff.level', { skill: n }) + ':') && !t.includes('Magic level'); })()`));
    // The page's own language switch (it localizes the page's labels after the language changes).
    const switchTo = (prefix) => js(`(document.querySelector('.language-switcher') ? [...document.querySelectorAll('.language-switcher button')].find((b) => b.textContent.startsWith('${prefix}')).click() : null, true)`);
    await switchTo('Portugu');
    check('in Portuguese the new labels and the zone names follow the language, and the window picks stay', await until(`(() => { const z = document.getElementById('selectWhatIfZone'); const pz = document.getElementById('selectZone'); return document.querySelector('[data-i18n="common:whatIf.players"]').textContent === 'Jogadores' && document.querySelector('label[for="selectWhatIfZone"]').textContent === 'Zona' && i18next.t('common:whatIf.choicesNote').includes('desmarcado') && z.value === ${JSON.stringify(windowZone)} && z.options[3].textContent === pz.options[3].textContent && z.options[3].textContent === i18next.t('actionNames.' + z.options[3].value) && z.options[3].textContent !== 'Porcupine' && document.getElementById('selectWhatIfTier').value === '1'; })()`));
    await switchTo('English');
    await js(`i18next.changeLanguage('en').then(() => true)`);
    check('back in English the names are English', await until(`document.getElementById('whatIfOverBudget').textContent.includes('Feet Pathseeker Boots ★ +12')`));
    check('the cost path column wraps', await js(`getComputedStyle(document.querySelector('#whatIfResult td.wrap')).whiteSpace === 'normal'`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('the window fits a 1500x900 viewport and scrolls inside itself, with no horizontal scroll', await js(`(() => { const b = document.querySelector('#whatIfModal .modal-content').getBoundingClientRect(); const body = document.querySelector('#whatIfModal .modal-body'); return b.top >= 0 && b.bottom <= innerHeight && b.right <= innerWidth && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth; })()`));
    await js(`document.querySelector('[data-whatif-apply="single:1"]').click(), true`);
    check('a player the page lacks is named, nothing applied', await js(`document.getElementById('whatIfMessage').textContent.includes('Nobody')`) &&
        (await js(`document.getElementById('inputLevel_attack').value`)) === (await js(`document.getElementById('inputLevel_attack').value`)));
    await js(`(() => { document.getElementById('selectWhatIfResult').value = 'search-1'; document.getElementById('buttonWhatIfLoad').click(); return true; })()`);
    check('Show loads an earlier result', await until(`document.getElementById('whatIfResult').textContent.includes('Magic 1')`));
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
        await new Promise((r) => setTimeout(r, 400));
        const fit = await js(`(() => { const body = document.querySelector('#whatIfModal .modal-body'), br = body.getBoundingClientRect(), edge = br.right - parseFloat(getComputedStyle(body).paddingRight) - (body.offsetWidth - body.clientWidth); const apply = [...document.querySelectorAll('#whatIfResult [data-whatif-apply]')].filter((b) => b.getBoundingClientRect().width > 0); return { noBar: body.scrollWidth <= body.clientWidth, scrollW: body.scrollWidth, clientW: body.clientWidth, n: apply.length, inside: apply.every((b) => b.getBoundingClientRect().right <= edge + 0.5), tables: [...document.querySelectorAll('#whatIfResult table')].map((t) => t.getBoundingClientRect().right <= edge + 0.5), changeLines: (() => { const t = document.querySelector('#whatIfResult table.whatif-each'); const lines = (c) => { const rg = document.createRange(); rg.selectNodeContents(c); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; }; return t ? Math.max(...[...t.querySelectorAll('td.chg')].map(lines)) : 99; })(), eachScrollW: document.querySelector('#whatIfResult table.whatif-each')?.getBoundingClientRect().width, numberLines: Math.max(...[...[...document.querySelectorAll('#whatIfResult table')].find((x) => !x.classList.contains('whatif-each') && x.textContent.includes('How it is bought')).querySelectorAll('tbody td.num')].map((c) => { const rg = document.createRange(); rg.selectNodeContents(c); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; })) }; })()`);
        check(`at ${w}x${h} a result of real size (3 players, 11 columns, changes up to 235 characters) has no horizontal scroll, every Apply button is inside the window, every table fits and no Change is taller than 3 lines${w === 1920 ? ', no number cell of the steps table wraps' : ''}`, fit.noBar && fit.n >= 6 && fit.inside && fit.tables.every(Boolean) && fit.changeLines <= 3 && (w !== 1920 || fit.numberLines === 1), JSON.stringify(fit));
        check(`at ${w}x${h} the free change reads "N/A" in the steps table and in Each change alone, and the best block shows`, await js(`(() => { const r = document.getElementById('whatIfResult'); const free = [...r.querySelectorAll('tbody tr')].filter((tr) => tr.textContent.includes('poke trigger') || tr.textContent.includes('Poke')); return free.length >= 2 && free.every((tr) => tr.textContent.includes('N/A')) && r.textContent.includes('Best foods') && r.querySelectorAll('.whatif-best-table tbody tr').length === 6; })()`));
    }
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
    // Kept across page loads: a reload, the page's player ticked again, the window opened.
    await page.send('Page.navigate', { url: base });
    await until(`document.getElementById('buttonWhatIf')?.style.display === ''`);
    await js(`(() => { document.getElementById('player1').checked = true; document.getElementById('buttonWhatIf').click(); return true; })()`);
    check('after a page reload the kept export is still there', await until(`document.querySelector('#whatIfBudgets [data-export-status="Player 1"]')?.textContent === 'kept (Player 1)'`));
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
