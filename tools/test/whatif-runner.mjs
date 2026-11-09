// Test: the what-if runner (tools/whatif/runner/server.mjs) and the optimizer's per-player budget, progress report,
// stop and resume and result fields (tools/whatif/optimize.mjs, tools/whatif/budgets.mjs). (1) Budgets as pure
// functions. (2) The request -> optimizer arguments. (3) The interface with a fake search: version, same-origin
// refusals, one search at a time, progress, stop, resume by the same request, results, static files. (4) A real
// optimizer run through the interface on a generic two-player party: a step is paid only from its own player's coin,
// progress arrives, a stop leaves the run store intact and the same request resumes and finishes; result.json carries
// the contract's fields. Generic setups only, no private data. Temporary folders under the OS temp folder, removed.
// Usage: node tools/test/whatif-runner.mjs        Exit code 0 on pass, 1 on fail.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = (p) => import(pathToFileURL(path.join(root, p)).href);
const B = await mod('tools/whatif/budgets.mjs');
const R = await mod('tools/whatif/runner/server.mjs');

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const throws = (f) => { try { f(); return false; } catch { return true; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'whatif-runner-test-'));

// ---- (1) Budgets ----
check(B.parseCoin('1.5M') === 1.5e6 && B.parseCoin('200k') === 2e5 && B.parseCoin('3') === 3 && B.parseCoin('2B') === 2e9 && Number.isNaN(B.parseCoin('x')), 'parseCoin: plain, K, M, B; text is NaN');
check(JSON.stringify(B.parseBudgetList('A=1M, B=0')) === '{"A":1000000,"B":0}' && JSON.stringify(B.parseBudgetList(null)) === '{}', 'parseBudgetList: Name=coin list');
check(throws(() => B.parseBudgetList('A')) && throws(() => B.parseBudgetList('A=x')), 'parseBudgetList: a malformed entry throws');
check(JSON.stringify(B.resolveBudgets(['A', 'B'], { A: 5 }, 9)) === '{"A":5,"B":9}', 'resolveBudgets: --budgets per name, --budget for the rest');
check(throws(() => B.resolveBudgets(['A', 'B'], { A: 5 }, NaN)), 'resolveBudgets: a player with no budget throws (never a silent zero)');
check(throws(() => B.resolveBudgets(['A'], { A: 5, Z: 1 }, NaN)), 'resolveBudgets: a budget for a player not in --players throws');
const budgets = { A: 100, B: 10 }, cand = (player, cost) => ({ player, cost: { cost } });
check(B.affordable(cand('A', 100), budgets, null) && !B.affordable(cand('B', 11), budgets, null), 'affordable: within its own player\'s budget only');
check(!B.affordable(cand('B', 50), budgets, { A: 0, B: 0 }), 'affordable: A\'s coin never pays for B\'s change');
check(B.affordable(cand('B', 0), budgets, { B: 10 }) && B.affordable(cand('B', -5), budgets, { B: 10 }), 'affordable: a free change or a sale is always affordable');
check(!B.affordable(cand('C', 0), budgets, null), 'affordable: a candidate with no budgeted payer is refused');
let spent = B.zeroSpend(budgets);
spent = B.pay(spent, cand('A', 60));
check(spent.A === 60 && spent.B === 0 && !B.affordable(cand('A', 41), budgets, spent) && B.affordable(cand('A', 40), budgets, spent), 'pay: running spend per player; what is left shrinks for that player only');
check(B.pay(spent, cand('A', -30)).A === 60, 'pay: a sale never refunds a budget');
const opt = readFileSync(path.join(root, 'tools/whatif/optimize.mjs'), 'utf8');
check(!/budget - spent|cost <= budget\b/.test(opt) && (opt.match(/affordable\(c, budgets, spent\)/g) || []).length === 2 && /affordable\(c, budgets, null\)/.test(opt), 'optimizer: the screen, the greedy step and the rebuild all check per payer');

// ---- (2) Request -> arguments ----
const generic = (name, weapon, head) => ({
    name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
        { itemLocationHrid: '/item_locations/main_hand', itemHrid: weapon, enhancementLevel: 0 },
        { itemLocationHrid: '/item_locations/head', itemHrid: head, enhancementLevel: 0 }] },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] },
});
const party = [generic('Alpha', '/items/cheese_sword', '/items/cheese_helmet'), generic('Beta', '/items/cheese_mace', '/items/cheese_helmet')];
const argDir = path.join(tmp, 'args');
const args = R.buildArgs({ setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, prices: 'marketplace-2026-11-03.json' }, goal: 'profit', budgets: { Alpha: 1e6, Beta: 0 }, levers: ['equip'], stages: ['4x1', '4x1'], keep: [2], maxUp: 1, swaps: false }, argDir);
const at = (f) => args[args.indexOf('--' + f) + 1];
check(at('out') === argDir && at('setups') === path.join(argDir, 'setups') && args.includes('--low-priority'), 'buildArgs: out, setups folder, low priority');
check(readFileSync(path.join(argDir, 'setups', 'party.txt'), 'utf8') === 'Alpha\nBeta\n' && JSON.parse(readFileSync(path.join(argDir, 'setups', 'Beta.json'), 'utf8')).name === 'Beta', 'buildArgs: each setup written, party.txt in order');
check(at('budgets') === 'Alpha=1000000,Beta=0' && at('players') === 'Alpha,Beta' && at('levers') === 'equip' && at('stages') === '4x1,4x1' && at('keep') === '2' && at('max-up') === '1' && args.includes('--no-swaps'), 'buildArgs: budgets, players default to the party, lists, camelCase flags, false as --no-');
check(at('zone') === '/actions/combat/fly' && at('tier') === '0' && at('comdrop') === '0' && at('prices') === path.join(root, 'tools', 'calibration', 'marketplace-2026-11-03.json'), 'buildArgs: options, the price snapshot by name');
check(throws(() => R.buildArgs({ setups: party, cacheFrom: 'x' }, argDir)) && throws(() => R.buildArgs({ setups: party, out: 'x' }, argDir)), 'buildArgs: an option the runner does not offer throws (out, cache-from)');
check(throws(() => R.buildArgs({ setups: party, options: { prices: '../../secret.json' } }, argDir)) && throws(() => R.buildArgs({ setups: party, options: { prices: 'nope.json' } }, argDir)), 'buildArgs: a price file outside the snapshots throws');
check(throws(() => R.buildArgs({ setups: [{ ...party[0], name: '../x' }] }, argDir)) && throws(() => R.buildArgs({ setups: [] }, argDir)) && throws(() => R.buildArgs({ setups: party, budgets: { 'A,B': 1 } }, argDir)), 'buildArgs: bad setup names, no setups, a bad budget name throw');
check(throws(() => R.buildArgs({ setups: party, zone: '--out' }, argDir)), 'buildArgs: a value that would be read as a flag throws');
// The window's market snapshot: saved once in the search's folder and passed as --prices; a second call (a resume) keeps it.
const snap = (timestamp) => ({ marketData: { '/items/cheese_sword': { 0: { a: 100, b: 90 } } }, timestamp });
const mpDir = path.join(tmp, 'mp');
const mpArgs = R.buildArgs({ setups: party, options: { marketplace: snap(1700000000) } }, mpDir);
const mpFile = path.join(mpDir, R.MARKETPLACE_FILE);
check(mpArgs[mpArgs.indexOf('--prices') + 1] === mpFile && JSON.parse(readFileSync(mpFile, 'utf8')).timestamp === 1700000000 && !mpArgs.some((a) => /marketplace/.test(a) && a !== mpFile && a !== '--prices'), 'buildArgs: options.marketplace is saved in the search folder and passed as --prices');
const mpArgs2 = R.buildArgs({ setups: party, options: { marketplace: snap(1800000000) } }, mpDir);
check(mpArgs2[mpArgs2.indexOf('--prices') + 1] === mpFile && JSON.parse(readFileSync(mpFile, 'utf8')).timestamp === 1700000000, 'buildArgs: a resume reuses the saved snapshot, never a new one');
check(throws(() => R.buildArgs({ setups: party, options: { marketplace: { marketData: {} } } }, path.join(tmp, 'mp2'))) && throws(() => R.buildArgs({ setups: party, options: { marketplace: [] } }, path.join(tmp, 'mp3'))), 'buildArgs: a marketplace with no timestamp or no marketData throws');
check(throws(() => R.buildArgs({ setups: party, options: { marketplace: snap(1), prices: 'marketplace-2026-11-03.json' } }, path.join(tmp, 'mp4'))), 'buildArgs: prices and marketplace together throw');
check(!R.buildArgs({ setups: party, options: {} }, path.join(tmp, 'mp5')).includes('--prices') && !existsSync(path.join(tmp, 'mp5', R.MARKETPLACE_FILE)), 'buildArgs: no snapshot, no --prices (the optimizer\'s committed default)');
const big = JSON.parse(readFileSync(path.join(root, 'tools/calibration/marketplace-2026-11-03.json'), 'utf8'));
check(JSON.stringify({ setups: party, options: { marketplace: big } }).length < 5e6, `the request limit (50 MB) holds a full marketplace.json (${Math.round(JSON.stringify(big).length / 1024)} KB)`);
check(R.searchId({ a: 1, b: [1, 2] }) === R.searchId({ b: [1, 2], a: 1 }) && R.searchId({ a: 1 }) !== R.searchId({ a: 2 }), 'searchId: the same request (any key order) is the same id');

// ---- HTTP helper ----
function call(base, method, p, body, headers = {}) {
    const u = new URL(p, base);
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
            const parts = [];
            res.on('data', (b) => parts.push(b));
            res.on('end', () => { const t = Buffer.concat(parts).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ } resolve({ status: res.statusCode, json: j, text: t, type: res.headers['content-type'] }); });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

// ---- (3) The interface with a fake search ----
const dist = path.join(tmp, 'dist');
mkdirSync(path.join(dist, 'js'), { recursive: true });
writeFileSync(path.join(dist, 'index.html'), '<script src="bundle.abcd1234.js"></script>');
writeFileSync(path.join(dist, 'js', 'a.js'), 'var a=1;');
writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
const fakes = [];
const fakeLaunch = (a, dir) => { const h = { args: a, dir, stopped: false, onProgress: null, onExit: null, stop() { h.stopped = true; setTimeout(() => h.onExit(3, ''), 10); } }; fakes.push(h); return h; };
const resultsDir = path.join(tmp, 'results');
const fake = R.createRunner({ resultsDir, distDir: dist, launch: fakeLaunch, lowPriority: false });
const base = await fake.listen(0);
const port = new URL(base).port;
const v = await call(base, 'GET', '/api/version');
check(v.status === 200 && v.json.engine === 'abcd1234' && v.json.runner.startsWith(R.RUNNER_VERSION), 'version: runner and engine (the bundle hash)');
check((await call(base, 'GET', '/api/version', undefined, { Origin: 'https://evil.example' })).status === 403, 'a foreign Origin is refused');
check((await call(base, 'GET', '/api/version', undefined, { Host: 'evil.example:' + port })).status === 403, 'a foreign Host (DNS rebinding) is refused');
check((await call(base, 'GET', '/api/version', undefined, { Origin: `http://localhost:${port}` })).status === 200, 'the runner\'s own origin is accepted');
check((await call(base, 'POST', '/api/search', 'x=1', { 'Content-Type': 'text/plain' })).status === 415, 'a search request that is not JSON is refused (415)');
check((await call(base, 'POST', '/api/search', '{bad')).status === 400, 'malformed JSON is refused (400)');
check((await call(base, 'POST', '/api/search', { setups: party, bogus: 1 })).status === 400, 'an unknown option is refused (400)');
const body = { setups: party, goal: 'profit', budgets: { Alpha: 5, Beta: 0 }, levers: ['equip'] };
const s1 = await call(base, 'POST', '/api/search', body);
check(s1.status === 200 && s1.json.id === R.searchId(body) && fakes.length === 1 && fakes[0].args.includes('--budgets'), 'search: starts, the id is the request\'s hash');
const s2 = await call(base, 'POST', '/api/search', { ...body, goal: 'exp' });
check(s2.status === 409 && s2.json.running === s1.json.id && s2.json.id === s1.json.id && fakes.length === 1, 'one search at a time: a second is refused with the running id');
fakes[0].onProgress({ stage: 'screen', candidatesLeft: 7, runsDone: 3, runsPlanned: 10, secondsPerRun: 2.5, etaSeconds: 9 });
const g1 = await call(base, 'GET', '/api/search/' + s1.json.id);
check(g1.json.state === 'running' && g1.json.progress.runsDone === 3 && g1.json.progress.candidatesLeft === 7, 'progress: the optimizer\'s report is served while it runs');
const st = await call(base, 'POST', `/api/search/${s1.json.id}/stop`);
await sleep(50);
const g2 = await call(base, 'GET', '/api/search/' + s1.json.id);
check(st.status === 200 && fakes[0].stopped && g2.json.state === 'stopped' && fake.running === null, 'stop: the search is told to stop and reads stopped');
const s3 = await call(base, 'POST', '/api/search', body);
check(s3.json.id === s1.json.id && fakes.length === 2 && fakes[1].dir === fakes[0].dir, 'resume: the same request again runs in the same folder (its run store)');
await call(base, 'POST', `/api/search/${s1.json.id}/stop`);
await sleep(50);
const rs = await call(base, 'POST', `/api/search/${s1.json.id}/stop`);
check(rs.status === 200 && rs.json.resumed && fakes.length === 3 && fakes[2].dir === fakes[0].dir && JSON.stringify(fakes[2].args) === JSON.stringify(fakes[0].args), 'resume: stop on a stopped search resumes it from its own request (the window\'s Resume)');
fakes.splice(1, 1); // keep fakes[1] as the running one below
writeFileSync(path.join(fakes[1].dir, 'result.json'), JSON.stringify({ goal: 'profit', players: ['Alpha', 'Beta'], steps: [] }));
fakes[1].onExit(0, '');
const g3 = await call(base, 'GET', '/api/search/' + s1.json.id);
check(g3.json.state === 'done' && g3.json.result.players.length === 2, 'done: the result is served with the state');
check((await call(base, 'POST', '/api/search', body)).json.id === s1.json.id && fakes.length === 2, 'a finished request is not run again');
const s4 = await call(base, 'POST', '/api/search', { ...body, goal: 'exp' });
fakes[2].onExit(1, 'line 1\nError: boom');
const g4 = await call(base, 'GET', '/api/search/' + s4.json.id);
check(g4.json.state === 'error' && g4.json.error.includes('boom'), 'error: a failed optimizer reads error with its last lines');
// A search with the window's snapshot through the interface: saved once, passed, and the Resume keeps the same file.
const mpBody = { setups: party, options: { marketplace: snap(1700000000) }, goal: 'exp', budgets: { Alpha: 1, Beta: 1 }, levers: ['equip'] };
const m1 = await call(base, 'POST', '/api/search', mpBody);
const mh = fakes[fakes.length - 1], mFile = path.join(mh.dir, R.MARKETPLACE_FILE);
check(m1.status === 200 && mh.args[mh.args.indexOf('--prices') + 1] === mFile && JSON.parse(readFileSync(mFile, 'utf8')).timestamp === 1700000000, 'search: the window\'s snapshot is saved in the search folder and passed to the optimizer');
const mStat = readFileSync(mFile, 'utf8');
await call(base, 'POST', `/api/search/${m1.json.id}/stop`);
await sleep(50);
const mr = await call(base, 'POST', `/api/search/${m1.json.id}/stop`);
const mh2 = fakes[fakes.length - 1];
check(mr.json.resumed && mh2 !== mh && mh2.args[mh2.args.indexOf('--prices') + 1] === mFile && readFileSync(mFile, 'utf8') === mStat, 'resume: the same saved snapshot is passed again');
mh2.stop(); await sleep(50);
const list = await call(base, 'GET', '/api/results');
check(list.json.length === 1 && list.json[0].id === s1.json.id && list.json[0].goal === 'profit' && !!Date.parse(list.json[0].finished), 'results: finished searches with id, finished, goal, players');
check((await call(base, 'GET', '/api/results/' + s1.json.id)).json.goal === 'profit' && (await call(base, 'GET', '/api/results/000000000000')).status === 404 && (await call(base, 'GET', '/api/results/..%2F..')).status === 404, 'results/<id>: one result; unknown or malformed ids are 404');
check((await call(base, 'GET', '/api/search/zzz')).status === 404, 'search/<id>: a malformed id is 404');
const idx = await call(base, 'GET', '/');
check(idx.status === 200 && idx.text.includes('bundle.abcd1234.js') && idx.type.startsWith('text/html'), 'static: / serves dist/index.html');
check((await call(base, 'GET', '/js/a.js')).type.startsWith('text/javascript'), 'static: files under dist/ with their type');
check((await call(base, 'GET', '/..%2Fsecret.txt')).status === 404 && (await call(base, 'GET', '/../secret.txt')).status === 404, 'static: nothing outside dist/ is served');
await fake.close();

// ---- (4) A real optimizer run on a generic party ----
// Beta has no coin: no paid change of Beta's may be screened or bought. Two short stages; 1 or 2 simulated hours.
const real = R.createRunner({ resultsDir: path.join(tmp, 'real'), distDir: dist, lowPriority: false });
const rb = await real.listen(0);
const req = { setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, marketplace: { ...big, timestamp: 1700000000 } }, goal: 'profit', budgets: { Alpha: 1e9, Beta: 0 }, levers: ['equip'], stages: ['4x2', '4x2'], keep: [4], maxUp: 2, swaps: false, z: 0, jobs: 2 };
const wait = async (id, until, ms = 300000) => { const t = Date.now(); const trace = []; for (;;) { const r = (await call(rb, 'GET', '/api/search/' + id)).json; trace.push(r.progress); if (until(r) || Date.now() - t > ms) return { r, trace }; await sleep(150); } };
const r1 = await call(rb, 'POST', '/api/search', req);
const id = r1.json.id, dir = path.join(tmp, 'real', id);
const first = await wait(id, (r) => r.state !== 'running' || (r.progress?.runsDone ?? 0) >= 2);
await call(rb, 'POST', `/api/search/${id}/stop`);
const stopped = await wait(id, (r) => r.state !== 'running', 60000);
const runsAtStop = existsSync(path.join(dir, 'runs.jsonl')) ? readFileSync(path.join(dir, 'runs.jsonl'), 'utf8') : '';
const partial = existsSync(path.join(dir, 'partial.json')) ? JSON.parse(readFileSync(path.join(dir, 'partial.json'), 'utf8')) : null;
check(first.trace.some((p) => p && p.stage === 'screen' && p.runsPlanned > 0), 'progress: the screen stage reports runs planned');
check(stopped.r.state === 'stopped' && partial?.stoppedBy === 'stop request', 'stop: the real search stops with exit code 3 and says so in partial.json');
check(runsAtStop.split('\n').filter(Boolean).length >= 2 && runsAtStop.split('\n').filter(Boolean).every((l) => JSON.parse(l).checkpoints), 'stop: the run store keeps every finished run, whole lines');
await call(rb, 'POST', '/api/search', req);
const fin = await wait(id, (r) => r.state !== 'running');
const runsAfter = readFileSync(path.join(dir, 'runs.jsonl'), 'utf8');
const res = fin.r.result;
check(fin.r.state === 'done' && !!res, 'resume: the same request finishes');
check(runsAfter.startsWith(runsAtStop) && res?.timing.runsThisCall === runsAfter.split('\n').filter(Boolean).length - runsAtStop.split('\n').filter(Boolean).length, 'resume: the runs before the stop are reused, not run again');
check(fin.trace.some((p) => p && p.runsDone > 0 && p.secondsPerRun > 0 && p.etaSeconds != null), 'progress: runs done, seconds per run measured, time left');
check(fin.r.progress?.stage === 'done', 'progress: the last stage is done');
if (res) {
    check(JSON.stringify(res.budgets) === JSON.stringify({ Alpha: 1e9, Beta: 0 }) && res.setups.length === 2 && res.options.zone === '/actions/combat/fly' && res.options.levers.includes('equip') && res.partySize === 2, 'result: budgets per player, the base setups, the run options at the top');
    check(res.options.pricesTimestamp === 1700000000 && res.options.pricesSource === 'snapshot' && res.options.prices.endsWith(id + '/' + R.MARKETPLACE_FILE) && existsSync(path.join(dir, R.MARKETPLACE_FILE)), 'result: the request\'s snapshot was used, its timestamp beside options.prices');
    check(res.overBudget.length > 0 && res.overBudget.every((c) => c.player === 'Beta' && c.cost > 0 && c.desc && c.id) && !res.candidateList.some((c) => res.overBudget.some((o) => o.id === c.id)), 'result: Beta\'s priced changes are listed as over budget (id, player, desc, cost), never screened');
    check(readFileSync(path.join(dir, 'result.md'), 'utf8').includes('## Priced, over budget, not ranked'), 'result.md: the over-budget list');
    check(Array.isArray(res.dominated) && res.dominated.length === 0, 'result: the dominated group is present (empty: this search has no market swaps)');
    check(res.candidateList.every((c) => !c.id.startsWith('Beta:') || c.cost <= 0) && res.candidateList.some((c) => c.id.startsWith('Alpha:') && c.cost > 0), 'budget per player: Beta\'s paid changes are never screened, Alpha\'s are');
    check(res.singles.length > 0 && res.singles.every((s) => s.player && Array.isArray(s.ops) && s.ops.length && typeof s.accepted === 'boolean' && Math.abs(s.gainPerUser * 2 - s.gain) < 1e-6 && Math.abs(s.sePerUser * 2 - s.se) < 1e-6), 'rows: player, ops, accepted, gainPerUser and sePerUser (party figure / party size)');
    check(res.steps.every((s) => s.runningSpend && s.runningSpend.Beta === 0 && s.runningSpend.Alpha <= 1e9 && s.player === 'Alpha'), 'steps: each carries every player\'s running spend; Beta spends nothing');
    let sum = 0;
    check(res.steps.every((s) => { sum += s.cost; return Math.abs(s.runningSpend.Alpha - sum) < 1e-6; }), 'steps: Alpha\'s running spend is the sum of Alpha\'s steps');
    {   // basePerUser: the party base (mean over the last stage's base seeds, from the run store) over the party size.
        const lines = readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const baseKey = lines.find((l) => l.tag === 'base')?.key, h = Number(res.stages.at(-1).split('x')[1]), k = Number(res.stages.at(-1).split('x')[0]) * res.baseMult;
        const vals = lines.filter((l) => l.tag === 'base' && l.key === baseKey && l.checkpoints.some((c) => c.simHours === h)).sort((a, b) => a.seed - b.seed).slice(0, k).map((l) => l.checkpoints.find((c) => c.simHours === h).party.profitAfterTaxPerDay);
        const party = vals.reduce((a, x) => a + x, 0) / vals.length;
        check(vals.length === k && Number.isFinite(res.basePerUser) && Math.abs(res.basePerUser * res.partySize - party) < 1e-6 * Math.max(1, Math.abs(party)), 'result: basePerUser is the party base over the last stage base seeds divided by the party size', `${res.basePerUser} x ${res.partySize} vs ${party} (${vals.length} of ${k})`);
    }
    check(res.singles.every((s) => [s.sharedGainPerUser, s.sharedSePerUser, s.ownSuppliesPerDay, s.ownSuppliesSe].every(Number.isFinite) && s.sharedSePerUser >= 0 && s.ownSuppliesSe >= 0 && (s.paybackOwn === null || Math.abs(s.paybackOwn - s.cost / (s.sharedGainPerUser - s.ownSuppliesPerDay)) < 1e-6 * s.paybackOwn)) && res.singles.every((s) => (s.paybackOwn === null) === !(s.cost > 0 && s.sharedGainPerUser - s.ownSuppliesPerDay > 0)), 'rows: shared gain per user, own supplies and the buyer payback (cost / (shared - supplies), null unless both above 0)');
    check(res.steps.every((s) => Number.isFinite(s.sharedGainPerUser) && Number.isFinite(s.ownSuppliesPerDay) && 'paybackOwn' in s), 'steps: the split fields are present');
    check(!res.confirmation || (Number.isFinite(res.confirmation.sharedGainPerUser) && Object.keys(res.confirmation.ownSuppliesByPlayer).join() === Object.keys(res.budgets).join() && Object.keys(res.confirmation.paybackOwnByPlayer).join() === Object.keys(res.budgets).join() && res.confirmation.paybackOwnByPlayer.Beta === null), 'confirmation: shared gain per user, supplies change and buyer payback per player (Beta bought nothing: no payback)');
    check(readFileSync(path.join(dir, 'result.md'), 'utf8').includes('Own supplies per day') && readFileSync(path.join(dir, 'result.md'), 'utf8').includes('Payback days (buyer)'), 'result.md: the split columns');
    check(!res.confirmation || (res.confirmation.gainPerUser * 2 - res.confirmation.gain < 1e-6 && res.confirmation.runningSpend), 'confirmation: per-user figures and spend');
    console.log(`     (${res.steps.length} steps, ${res.singles.length} singles, ${res.timing.runsThisCall} runs after the resume)`);
}
// A request with no snapshot: result.json says the committed file was used, and its date.
const plainReq = { setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0 }, goal: 'profit', budgets: { Alpha: 0, Beta: 0 }, levers: ['equip'], stages: ['4x1'], keep: [1], onlyCandidates: ['none'], z: 0, jobs: 2 };
const p1 = await call(rb, 'POST', '/api/search', plainReq);
const pf = (await wait(p1.json.id, (r) => r.state !== 'running')).r;
if (pf.state !== 'done') console.log(JSON.stringify(pf).slice(0, 600));
check(pf.state === 'done' && pf.result.options.pricesSource === 'committed' && pf.result.options.pricesTimestamp === big.timestamp && pf.result.options.prices === 'tools/calibration/marketplace-2026-11-03.json', 'result: no snapshot in the request: the committed file, its name and its timestamp', JSON.stringify(pf.error || pf.result?.options));
await real.close();

// ---- (5) The runner's own page reaches its interface; a page of another origin does not (design section 7 item 1) ----
// A headless Chrome this test launches itself (tools/chrome-launcher.mjs), on the built simulator (dist/).
const { launchChrome } = await mod('tools/chrome-launcher.mjs');
const chromeExe = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome';
if (!existsSync(chromeExe) || !existsSync(path.join(root, 'dist', 'index.html'))) console.log('skip browser check: no Chrome or no dist/');
else {
    const launched = [];
    const web = R.createRunner({ resultsDir: path.join(tmp, 'web'), distDir: path.join(root, 'dist'), launch: (a, d) => { const h = fakeLaunch(a, d); launched.push(h); return h; }, lowPriority: false });
    const url = await web.listen(0);
    const other = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<p>other</p>'); });
    await new Promise((r) => other.listen(0, '127.0.0.1', r));
    const chrome = await launchChrome({ userDataDir: path.join(tmp, 'chrome') });
    try {
        const page = await chrome.newPage();
        const go = async (u) => { await page.send('Page.navigate', { url: u }); for (let i = 0; i < 100; i++) { const r = await page.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }); if (r.result.value === 'complete') return; await sleep(100); } };
        const ev = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
        await go(url);
        const ver = await ev(`fetch('/api/version').then((r) => r.json()).then((j) => j.engine, (e) => 'failed: ' + e)`);
        const engine = (await call(url, 'GET', '/api/version')).json.engine;
        check(ver === engine && engine !== 'unknown', 'browser: the simulator page served by the runner reads /api/version on the same address');
        check(await ev(`performance.getEntriesByType('resource').some((e) => /\\/bundle\\.[0-9a-f]+\\.js$/.test(e.name) && e.responseStatus === 200)`), 'browser: the built simulator\'s bundle loads from the runner');
        const posted = await ev(`fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ setups: party, goal: 'profit', budgets: { Alpha: 1, Beta: 1 } })}) }).then((r) => r.json()).then((j) => j.id || j.error, (e) => 'failed: ' + e)`);
        check(/^[0-9a-f]{12}$/.test(posted) && launched.length === 1, 'browser: the page starts a search with a JSON POST');
        await go(`http://127.0.0.1:${other.address().port}/`);
        const foreign = await ev(`fetch(${JSON.stringify(url + 'api/version')}).then((r) => 'read ' + r.status, () => 'blocked')`);
        await ev(`fetch(${JSON.stringify(url + 'api/search')}, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{}' }).then(() => 'sent', () => 'blocked')`);
        check(foreign === 'blocked' && launched.length === 1, 'browser: a page of another origin can neither read the interface nor start a search');
    } finally { await chrome.close(); other.close(); await web.close(); }
}

// Chrome lets go of its profile some seconds after it is killed.
for (let i = 0; ; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch (e) { if (i === 30) { console.log(`warning: could not remove ${tmp}: ${e.code}`); break; } await sleep(1000); } }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
