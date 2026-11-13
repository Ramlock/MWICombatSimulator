// Test: the What-if window's logic (src/whatif/panel.mjs) and its strings. The window shows the result's own fields
// (per-user gain and error, cost with "≤" for an upper bound, payback, running spend), applies a row's ops to the page's
// slots (naming a player the page lacks instead of applying), lists where the page's setup differs from the search's,
// and every string it uses exists in English, Portuguese and Chinese.
// Usage: node tools/test/whatif-panel.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const panel = await imp('src/whatif/panel.mjs');
const { applyOps } = await imp('src/whatif/applyOps.mjs');
const variants = await imp('tools/whatif/variants.mjs');
const M = await imp('src/marketplace.mjs');
const { formatNumber } = await imp('src/numberFormat.js');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locales = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(read(`locales/${l}/common.json`)).whatIf]));

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const lookup = (o, key) => key.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const used = new Set();
const t = (key, params = {}) => { used.add(key); const s = lookup(locales.en, key); return typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k])) : '#' + key; };

// Table helpers: the steps and Each change alone tables are told from the best-foods tables and the confirmation table by class.
const tablesOf = (h) => [...h.matchAll(/<table([^>]*)>([^]*?)<\/table>/g)].filter((m) => !/whatif-best-table|whatif-confirm/.test(m[1])).map((m) => m[2]);
const confOf = (h) => [...h.matchAll(/<table([^>]*whatif-confirm[^>]*)>([^]*?)<\/table>/g)].map((m) => m[2])[0];
const bestOf = (h, kind) => [...h.matchAll(/<table([^>]*)data-best="(\w+)"([^>]*)>([^]*?)<\/table>/g)].filter((m) => m[2] === kind).map((m) => m[4])[0];
// A span as the page shows it: its exact number, or (a margin, data-scale) the number written in its unit rounded up.
const nums = (s) => s.replace(/<span data-num="([^"]+)"([^>]*)>[^<]*<\/span>/g, (_, n, rest) => { const sc = rest.match(/data-scale="([^"]+)"/); return sc ? formatNumber(n, { scale: Number(sc[1]), up: true, decimals: Number(rest.match(/data-dec="([^"]+)"/)?.[1] ?? 0), iso: false }) : n; });
const txt = (s) => nums(s).replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
const bodyRows = (tb) => tb ? [...tb.slice(tb.indexOf('<tbody')).matchAll(/<tr([^>]*)>([^]*?)<\/tr>/g)].filter((m) => !/whatif-group/.test(m[1])).map((m) => [...m[2].matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((c) => txt(c[1]))) : [];

// A generic party of two, in the page's slot format (ability levels are strings on the page).
const setup = (ring) => ({
    player: { staminaLevel: 50, intelligenceLevel: 50, attackLevel: 50, meleeLevel: 1, defenseLevel: 50, rangedLevel: 1, magicLevel: 60,
        equipment: [{ itemLocationHrid: '/item_locations/ring', itemHrid: '/items/ring_of_rare_find', enhancementLevel: ring }] },
    food: { '/action_types/combat': [{ itemHrid: '/items/apple' }, { itemHrid: '' }] },
    drinks: { '/action_types/combat': [{ itemHrid: '/items/coffee' }] },
    abilities: [{ abilityHrid: '/abilities/heal', level: '20' }, { abilityHrid: '/abilities/fireball', level: '30' }],
    triggerMap: {}, houseRooms: { '/house_rooms/dojo': 3, '/house_rooms/gym': 0 }, zone: '/actions/combat/fly', simulationTime: '100',
});
const slots = [{ id: '1', name: 'Alpha', json: JSON.stringify(setup(5)) }, { id: '2', name: 'Beta', json: JSON.stringify(setup(2)) }];

check('variants.mjs re-exports the shared applyOps', variants.applyOps === applyOps);

{
    const body = panel.searchBody({ slots, goal: 'profit', budgets: { Alpha: 1e6, Beta: 0 }, levers: ['equip', 'houses'], zone: '/actions/combat/x', tier: '4' });
    check('search body: setups carry the tab names', body.setups.map((s) => s.name).join() === 'Alpha,Beta');
    check('search body: players, goal, budgets, levers as given', body.players.join() === 'Alpha,Beta' && body.goal === 'profit' && body.budgets.Alpha === 1e6 && body.budgets.Beta === 0 && body.levers.join() === 'equip,houses');
    check('search body: zone and tier as options, tier a number', body.options.zone === '/actions/combat/x' && body.options.tier === 4);
    check('search body: the slot JSON is sent as it is', body.setups[0].player.equipment[0].enhancementLevel === 5 && body.setups[0].zone === '/actions/combat/fly');
}

// The market snapshot: fetched when a search starts (the fetch injected, no network), sent as it came, none on failure.
const snapshot = { marketData: { '/items/apple': { 0: { a: 10, b: 9 } } }, timestamp: 1700000000 };
const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
{
    const params = { slots, goal: 'profit', budgets: { Alpha: 1, Beta: 0 }, levers: ['equip'], zone: '/actions/combat/x', tier: 2 };
    const r = await panel.searchRequest(params, async () => snapshot);
    check('search request: the snapshot rides in options.marketplace, as it came', JSON.stringify(r.body?.options.marketplace) === JSON.stringify(snapshot) && r.body.options.tier === 2 && r.body.setups.length === 2);
    const bad = await panel.searchRequest(params, async () => { throw new Error('offline'); });
    check('search request: a failed fetch gives an error and no body (no search)', bad.error === 'offline' && !bad.body);
    const empty = await panel.searchRequest(params, async () => ({ marketData: {} }));
    check('search request: an answer with no timestamp gives an error and no body', !!empty.error && !empty.body);
    check('search body: no marketplace, no options.marketplace', !('marketplace' in panel.searchBody(params).options));
    const urls = [];
    const got = await M.fetchMarketplace(async (u) => { urls.push(u); return answer(snapshot); });
    check('fetchMarketplace: the international server, the body parsed', got.timestamp === 1700000000 && urls.length === 1 && urls[0] === M.MARKETPLACE_URLS[0]);
    urls.length = 0;
    const cn = await M.fetchMarketplace(async (u) => { urls.push(u); if (urls.length === 1) throw new Error('down'); return answer(snapshot); });
    check('fetchMarketplace: the CN server when the first fetch throws', cn.timestamp === 1700000000 && urls[1] === M.MARKETPLACE_URLS[1]);
    const rejects = async (f) => { try { await f(); return false; } catch { return true; } };
    check('fetchMarketplace: an HTTP error or a body without a snapshot throws', await rejects(() => M.fetchMarketplace(async () => answer({}, false, 503))) && await rejects(() => M.fetchMarketplace(async () => answer({ marketData: {} }))));
    check('page: Get Prices and the window share fetchMarketplace', (read('src/main.js').match(/fetchMarketplace\(\)/g) || []).length === 2 && !read('src/main.js').includes('game_data/marketplace.json'));
}

{
    const ops = [{ op: 'enhance', player: 'Beta', slot: 'ring', delta: 1 }, { op: 'abilityLevel', player: 'Beta', index: 1, delta: 2 }, { op: 'house', player: 'Beta', room: '/house_rooms/gym', delta: 1 }];
    const out = panel.applyToSlots(slots, ops);
    const beta = JSON.parse(out.slots['2']);
    check('apply: only the slot an op names is written', Object.keys(out.slots).join() === '2');
    check('apply: enhance, ability level (from a string), house room', beta.player.equipment[0].enhancementLevel === 3 && beta.abilities[1].level === 32 && beta.houseRooms['/house_rooms/gym'] === 1);
    check('apply: the slot keeps its format (no name key, other keys kept)', !('name' in beta) && beta.zone === '/actions/combat/fly' && beta.simulationTime === '100');
    check('apply: the input slots are not changed', JSON.parse(slots[1].json).player.equipment[0].enhancementLevel === 2);
    const miss = panel.applyToSlots(slots, [...ops, { op: 'enhance', player: 'Gamma', slot: 'ring', delta: 1 }]);
    check('apply: a player the page lacks is named and nothing is applied', miss.missing?.join() === 'Gamma' && !miss.slots);
}

const result = {
    goal: 'profit', budgets: { Alpha: 5e7, Beta: 2e7 },
    setups: [{ ...setup(5), name: 'Alpha' }, { ...setup(2), name: 'Beta' }],
    steps: [
        { id: 'a', player: 'Alpha', desc: 'Ring +5 → +6', gain: 3000, se: 600, gainPerUser: 1500, sePerUser: 300, cost: 1e6, payback: 333.3, accepted: true, runningSpend: { Alpha: 1e6, Beta: 0 }, ops: [{ op: 'enhance', player: 'Alpha', slot: 'ring', delta: 1 }] },
        { id: 'b', player: 'Beta', desc: 'Fireball 30 → 31 <books>', gain: 2000, se: 500, gainPerUser: 1000, sePerUser: 250, cost: 4e5, costBound: 'upper', payback: 200, accepted: true, runningSpend: { Alpha: 1e6, Beta: 4e5 }, ops: [{ op: 'abilityLevel', player: 'Beta', index: 1, delta: 1 }] },
        { id: 'c', player: 'Beta', desc: 'Gym 0 → 1', gain: 1000, se: 400, gainPerUser: 500, sePerUser: 200, cost: 2e5, payback: 200, accepted: true, runningSpend: { Alpha: 1e6, Beta: 6e5 }, ops: [{ op: 'house', player: 'Beta', room: '/house_rooms/gym', delta: 1 }] },
    ],
    confirmation: { gain: 5800, se: 900, gainPerUser: 2900, sePerUser: 450, cost: 1.6e6, payback: 275.9 },
    singles: [
        { id: 'a', player: 'Alpha', desc: 'Ring +5 → +6', lastStage: '8x300', gain: 3000, se: 600, gainPerUser: 1500, sePerUser: 300, cost: 1e6, payback: 333.3, costPath: 'market', accepted: true, ops: [{ op: 'enhance', player: 'Alpha', slot: 'ring', delta: 1 }] },
        { id: 'd', player: 'Alpha', desc: 'Food 2 → cake', lastStage: '4x50', gain: -100, se: 900, gainPerUser: -50, sePerUser: 450, cost: 0, payback: null, costPath: 'loadout', accepted: false, ops: [{ op: 'food', player: 'Alpha', index: 1, item: '/items/cake' }] },
    ],
    apart: [{ id: 'e', desc: 'Some token item', note: 'no seller' }],
    overBudget: [{ id: 'f', player: 'Beta', desc: 'Big staff +10', cost: 7e9, costPath: 'market' }, { id: 'g', player: 'Alpha', desc: 'Fireball 30 → 40 <books>', cost: 3e8, costBound: 'upper', costPath: 'books' }],
    options: { zone: '/actions/combat/x', pricesTimestamp: 1700000000, pricesSource: 'snapshot' },
};

{
    const html = panel.renderResult(result, t);
    check('result: the party gain per user and its error show in the first two gain columns (an older result: the buyer\'s two are dashes)', html.includes('data-num="1500"') && html.includes('data-num="300"') && !html.includes('data-num="3000"'));
    check('result: "≤" on an upper-bound cost and its payback', /≤ <span data-num="400000"/.test(html) && /≤ <span data-num="200"/.test(html));
    check('result: no running spend per player, no Spent columns', !html.includes('Spent') && !html.includes('data-num="600000"'));
    check('result: Apply on each step, "Apply 1 to n" from step 2', html.includes('data-whatif-apply="steps:1"') && html.includes('Apply 1 to 3') && html.includes('data-whatif-apply="steps:3"'));
    check('result: a single the rule does not accept is grey', /<tr class="whatif-weak"><td>Alpha<\/td><td class="chg">Food 2/.test(html));
    check('result: grey singles sit collapsed in a hidden body behind one toggle with their count', /<tbody class="whatif-more" id="whatIfMoreSingles" hidden><tr class="whatif-weak"><td>Alpha<\/td><td class="chg">Food 2/.test(html) &&
        !/<tbody><tr[^]*Food 2[^]*<\/tbody><tbody class="whatif-more"/.test(html) && (html.match(/data-whatif-more="whatIfMoreSingles"/g) || []).length === 1);
    check('result: the cost path cell wraps', /<td class="wrap">market<\/td>/.test(html));
    check('result: unknown costs listed apart', html.includes('Some token item: no seller'));
    check('result: an older confirmation shows the party gain, the saved cost and payback', html.includes('data-num="2900"') && html.includes('data-num="450"') && html.includes('data-num="275.9"'));
    check('result: no spent-of-budget line', !html.includes('Spent of budget') && !html.includes('data-num="50000000"'));
    check('result: text is escaped', html.includes('&lt;books&gt;') && !html.includes('<books>'));
    check('result: no payback shows a dash, never NaN', !html.includes('NaN') && !html.includes('undefined'));
    check('result: the upper-bound note is shown', html.includes(locales.en.result.upperNote.slice(0, 20)));
    check('result: priced over-budget changes listed in their own group with player and cost, "≤" on an upper bound', html.includes(locales.en.result.overBudget) && html.includes('Beta, Big staff +10: <span data-num="7000000000"') && /Alpha, Fireball 30 → 40 &lt;books&gt;: ≤ <span data-num="300000000"/.test(html));
    check('result: the over-budget group is apart from the unknown-cost list and not in the ranked tables', html.indexOf(locales.en.result.overBudget) < html.indexOf(locales.en.result.apart) && !html.includes('data-whatif-apply="over'));
    const at = (1700000000 + 3 * 86400 + 5 * 3600) * 1000;
    check('result: the snapshot time and its age', panel.renderResult(result, t, at).includes('Prices: market snapshot of 2023-11-14 22:13 UTC (3 days old'));
    check('result: the committed file says so', panel.renderResult({ ...result, options: { pricesTimestamp: 1700000000, pricesSource: 'committed' } }, t, at).includes("simulator's own saved snapshot of 2023-11-14 22:13 UTC (3 days old)"));
    check('result: ages in hours and minutes', panel.age(7200, t) === '2 hours' && panel.age(59, t) === '0 minutes' && panel.age(-5, t) === '0 minutes');
    check('result: no price time, no price line', !panel.renderResult({ ...result, options: {} }, t).includes('Prices:'));
    check('result: no over-budget rows, no group', !panel.renderResult({ ...result, overBudget: [] }, t).includes(locales.en.result.overBudget));
    check('result: no steps reads as such', panel.renderResult({ ...result, steps: [], confirmation: undefined }, t).includes(locales.en.result.noSteps));
}

{
    // The two gains (the party's per user, the buyer's per day), each with its error; the buyer's payback; How it is bought; the confirmation lines.
    const full = JSON.parse(JSON.stringify(result));
    const books = { costPath: 'books', note: '25 x berserk; upper bound (XP inside the level unknown)' };
    Object.assign(full.steps[0], { buyerNet: 1234, buyerNetSe: 77, sharedGainPerUser: 1500, paybackOwn: 22.5, ...books });
    Object.assign(full.steps[1], { buyerNet: 555, buyerNetSe: 66, sharedGainPerUser: 1000, paybackOwn: 51.4, costPath: 'house upgrade', note: '' });
    Object.assign(full.steps[2], { buyerNet: -40, buyerNetSe: 20, sharedGainPerUser: 500, paybackOwn: null, costPath: 'market', note: 'a; b' }); // a net of 0 or below: no payback
    Object.assign(full.singles[0], { buyerNet: 1234, buyerNetSe: 77, sharedGainPerUser: 1500, paybackOwn: 22.5, ...books });
    Object.assign(full.confirmation, { buyerByPlayer: { Alpha: { gain: 1100, se: 80, payback: 12.5 }, Beta: { gain: 600, se: 90, payback: null } } });
    const html = panel.renderResult(full, t);
    // The steps table and the Each change alone table (the best-foods tables and the confirmation table are picked by their own class).
    const heads = (tb) => [...tb.slice(tb.indexOf('<thead>'), tb.indexOf('</thead>')).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    const plain = (s) => nums(s).replace(/<[^>]+>/g, '');
    const rowsOf = (tb) => [...tb.slice(tb.indexOf('<tbody')).matchAll(/<tr([^>]*)>([^]*?)<\/tr>/g)].filter((m) => !/whatif-group/.test(m[1])).map((m) => [...m[2].matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((c) => plain(c[1])));
    const [stepsTb, eachTb] = tablesOf(html);
    const tail = ['Cost', 'Payback days', 'How it is bought', ''], pair = ['Shared loot gain per user', "Buyer's gain"];
    check('columns: Chosen changes reads #, Player, Change, party gain and error, buyer gain and error, Cost, Payback days, How it is bought, Apply', JSON.stringify(heads(stepsTb)) === JSON.stringify(['#', 'Player', 'Change', ...pair, ...tail]), heads(stepsTb).join('|'));
    check('columns: Each change alone reads Player, Change, party gain and error, buyer gain and error, Cost, Payback days, How it is bought, Apply', JSON.stringify(heads(eachTb)) === JSON.stringify(['Player', 'Change', ...pair, ...tail]), heads(eachTb).join('|'));
    check('columns: the two gain headings carry their help text, exact English', html.includes("title=\"what the whole party's loot changes, per user; food and drink cost is not in it\"") &&
        html.includes("title=\"the buyer's loot share minus what the buyer spends on their own food and drink\""));
    const sr = rowsOf(stepsTb);
    check('cells: both gain pairs show with their errors (party first, then the buyer\'s), the buyer payback and How it is bought', JSON.stringify(sr[0]) === JSON.stringify(['1', 'Alpha', 'Ring +5 → +6', '1500 ± 300', '1234 ± 77', '1000000', '22.5', 'books (25 x berserk)', 'Apply']), JSON.stringify(sr[0]));
    check('cells: a negative buyer gain shows as it is; a net of 0 or below shows a dash payback; a note keeps its other text', sr[2][4] === '-40 ± 20' && sr[2][6] === '—' && sr[2][7] === 'market (a; b)', JSON.stringify(sr[2]));
    check('cells: an upper-bound cost marks its payback "≤"; a path with no note shows the path alone', sr[1][5] === '≤ 400000' && sr[1][6] === '≤ 51.4' && sr[1][7] === 'house upgrade', JSON.stringify(sr[1]));
    check('cells: the two gain cells ("value ± error" in one cell, no separate error column) have class num, and so do their headings', [stepsTb, eachTb].every((tb) => /<th class="num"[^>]*>Shared loot gain per user<\/th><th class="num"[^>]*>Buyer's gain<\/th>/.test(tb) && !tb.includes('± error')) && /<td class="chg">Ring[^<]*<\/td>(<td class="num">[^]*?<\/td>){2}<td class="num">/.test(stepsTb));
    const er = rowsOf(eachTb);
    check('Each change alone: the same cells (Player first, no Stage), How it is bought without the caveat text', JSON.stringify(er[0]) === JSON.stringify(['Alpha', 'Ring +5 → +6', '1500 ± 300', '1234 ± 77', '1000000', '22.5', 'books (25 x berserk)', 'Apply']), JSON.stringify(er[0]));
    check('How it is bought: the caveat text is in no cell; the footnote under the table stays', !html.includes('XP inside the level unknown') && html.includes(locales.en.result.upperNote.slice(0, 20)));
    check('gone: no Spent, no Stage, no Shared gain, no Own supplies, no budgets line', !/Spent|Stage|Shared gain|Own supplies/.test(html) && !html.includes('data-num="50000000"') && !html.includes('data-num="20000000"'), html.match(/Spent|Stage|Shared gain|Own supplies/)?.[0]);
    check('gone: no helps table, also for an old result that still carries helpsParty (rows flagged or not)', !html.includes('Helps the party') && tablesOf(html).length === 2 && (() => { const o = panel.renderResult({ ...full, helpsParty: [{ ...full.singles[1], helpsParty: true }] }, t); return !o.includes('Helps the party') && !o.includes('Not bought') && tablesOf(o).length === 2; })());
    const old = panel.renderResult(result, t), oldRows = [rowsOf(tablesOf(old)[0])[0], rowsOf(tablesOf(old)[1])[0]];
    check('cells: a result with no buyerNet shows the party gain and a dash in both buyer cells (both tables), How it is bought in both', oldRows[0][3] === '1500 ± 300' && oldRows[0][4] === '—' && oldRows[1][2] === '1500 ± 300' && oldRows[1][3] === '—' && oldRows[1][5] === '333.3' && oldRows[1][6] === 'market', JSON.stringify(oldRows));
    const exp = panel.renderResult({ ...full, goal: 'exp' }, t), expRow = rowsOf(tablesOf(exp)[0])[0];
    check('cells: on the EXP goal the buyer cells are dashes and the party pair shows', expRow[3] === '1500 ± 300' && expRow[4] === '—' && expRow[5] === '1000000' && expRow[6] === '333.3', JSON.stringify(expRow));
    const confTb = confOf(html), cr = rowsOf(confTb);
    check('confirmation: a table with Player, Gain per day, error, Pays back in (days)', JSON.stringify(heads(confTb).slice(0, 3)) === JSON.stringify(['Player', 'Gain per day', 'Pays back in (days)']), heads(confTb).join('|'));
    check('confirmation: the first row is the party gain ± error and the cost, with no party payback', JSON.stringify(cr[0]) === JSON.stringify(['Party (the shared loot, per user)', '2900 ± 450', '—', 'Cost ≤ 1600000']), JSON.stringify(cr[0]));
    check('confirmation: one row per player with gain, error and payback, a dash for none', JSON.stringify(cr[1].slice(0, 3)) === JSON.stringify(['Alpha', '1100 ± 80', '≤ 12.5']) && JSON.stringify(cr[2].slice(0, 3)) === JSON.stringify(['Beta', '600 ± 90', '—']), JSON.stringify(cr));
    const zero = JSON.parse(JSON.stringify(full));
    Object.assign(zero.confirmation, { cost: 0, buyerByPlayer: { Alpha: { gain: 5, se: 1, payback: 0 }, Beta: { gain: 6, se: 1, payback: 31.5 } } });
    const zr = rowsOf(confOf(panel.renderResult(zero, t)));
    check('confirmation: a saved payback of 0 shows a dash, above 0 shows the number', JSON.stringify(zr[1].slice(0, 3)) === JSON.stringify(['Alpha', '5 ± 1', '—']) && JSON.stringify(zr[2].slice(0, 3)) === JSON.stringify(['Beta', '6 ± 1', '≤ 31.5']), JSON.stringify(zr));
    const zeroOld = JSON.parse(JSON.stringify(result));
    zeroOld.confirmation = { ...zeroOld.confirmation, cost: 5, payback: 0 };
    check('confirmation: a party payback of 0 on a cost above 0 (older result) shows "Payback days —", a payback above 0 shows the number', /Payback days —<\/div>/.test(panel.renderResult(zeroOld, t)) && !/Payback days <span data-num="0"/.test(panel.renderResult(zeroOld, t)));
    zeroOld.confirmation = { ...zeroOld.confirmation, cost: 0, payback: 0 };
    check('confirmation: the same on a cost of exactly 0 says N/A (older result)', panel.renderResult(zeroOld, t).includes('Payback days N/A</div>'));
    check('confirmation: an older result (no buyerByPlayer) keeps its party payback and shows the run-again line, small', old.includes('data-num="275.9"') && old.includes(locales.en.result.oldSplit) && old.includes('<div class="mb-1 small whatif-dim">') && !old.includes('pays back in'));
    check('strings: the new keys exist in en, pt, zh; the removed ones are gone from all three', ['partyGain', 'partyGainTip', 'buyerGain', 'buyerGainTip'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].col[k] === 'string' && locales[l].col[k] !== '')) && ['en', 'pt', 'zh'].every((l) => typeof locales[l].result.playerLine === 'string' && ['{{player}}', '{{gain}}', '{{se}}', '{{payback}}'].every((p) => locales[l].result.playerLine.includes(p)) &&
        ['gain', 'ownSupplies', 'ownSuppliesTip', 'spent', 'stage'].every((k) => !(k in locales[l].col)) && ['ownLine', 'budgets', 'helpsParty', 'helpsPartyHint'].every((k) => !(k in locales[l].result))) && locales.pt.col.partyGain !== locales.en.col.partyGain && locales.pt.result.playerLine !== locales.en.result.playerLine);
    // The two gain figures are explained on screen: a legend under the steps, the confirmation named as the party gain, each player's
    // line split into his loot share and the food and drink he saved; a skill level (time only) has no Apply button.
    {
        const rs = JSON.parse(JSON.stringify(full));
        Object.assign(rs.confirmation, { sharedGainPerUser: 2900, ownSuppliesByPlayer: { Alpha: -1200, Beta: 300 } });
        rs.singles.push({ id: 'sk', player: 'Alpha', desc: 'Alpha ranged 153 -> 155', lastStage: '4x50', gain: 10, se: 1, gainPerUser: 5, sePerUser: 1, cost: 0, payback: null, costPath: 'time (levelled by combat; days in the skill-level table)', accepted: true, timeOnly: true, ops: [] });
        const h2 = panel.renderResult(rs, t), lines = rowsOf(confOf(h2)).map((r) => r.join(' | '));
        check('legend: the steps table is followed by the line saying what party gain and the buyer gain are', h2.includes(locales.en.result.gainLegend) && h2.indexOf(locales.en.result.gainLegend) > h2.indexOf('</table>') && h2.indexOf(locales.en.result.gainLegend) < h2.indexOf('data-confirm="players"'));
        check('confirmation: a player row adds the loot share and the food and drink saved (or bought more)', lines.some((l) => l.includes('Alpha | 1100 ± 80 | ≤ 12.5') && l.includes('(2900 loot share + 1200 food and drink saved)')) && lines.some((l) => l.includes('Beta | 600 ± 90') && l.includes('(2900 loot share - 300 more food and drink bought)')), lines.join('|'));
        check('confirmation: a loot share that reads no change (inside the party error) says so in the note, one that does not shows its number', (() => { const ns = JSON.parse(JSON.stringify(rs)); ns.confirmation.sharedGainPerUser = 100; const l2 = rowsOf(confOf(panel.renderResult(ns, t))).map((r) => r.join(' | ')); return l2.some((l) => l.includes('Alpha | 1100 ± 80') && l.includes('(' + locales.en.result.noChange + ' loot share + 1200 food and drink saved)')) && l2.some((l) => l.includes('(' + locales.en.result.noChange + ' loot share - 300 more food and drink bought)')); })());
        check('confirmation: the note under no change keeps the real value as hover title', panel.renderResult((() => { const ns = JSON.parse(JSON.stringify(rs)); ns.confirmation.sharedGainPerUser = 100; return ns; })(), t).includes('<span title="+100 ± 450">' + locales.en.result.noChange + '</span> loot share'));
        check('confirmation: an older result without the split fields shows no split note', !plain(panel.renderResult(full, t)).includes('loot share'));
        const skillIdx = rs.singles.length - 1;
        check('singles: a time-only row (a skill level) has no Apply button, the others keep theirs', !h2.includes(`data-whatif-apply="single:${skillIdx}"`) && h2.includes('data-whatif-apply="single:0"'));
        check('strings: the new keys exist in en, pt, zh', ['confirmedParty', 'gainLegend', 'playerSplitSaved', 'playerSplitMore'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== '')) && ['{{loot}}', '{{amount}}'].every((p) => ['en', 'pt', 'zh'].every((l) => locales[l].result.playerSplitSaved.includes(p) && locales[l].result.playerSplitMore.includes(p))));
    }
}
{
    check('opsFor: steps 1..n in order', JSON.stringify(panel.opsFor(result, 'steps:2')) === JSON.stringify([...result.steps[0].ops, ...result.steps[1].ops]));
    check('opsFor: one single', panel.opsFor(result, 'single:1')[0].op === 'food');
    const all = panel.applyToSlots(slots, panel.opsFor(result, 'steps:3'));
    const a = JSON.parse(all.slots['1']), b = JSON.parse(all.slots['2']);
    check('apply 1 to 3 writes every step', a.player.equipment[0].enhancementLevel === 6 && b.abilities[1].level === 31 && b.houseRooms['/house_rooms/gym'] === 1);
}
// ---- Apply puts the best foods and drinks (result.baselineOps) in first, then its own ops; an older result applies as before ----
{
    const base = [{ op: 'food', player: 'Alpha', index: 0, item: '/items/cake' }, { op: 'drink', player: 'Alpha', index: 0, item: '/items/swiftness_coffee' }];
    const withBase = { ...result, baselineOps: base };
    const json = JSON.stringify;
    check('apply: a step\'s ops are the baseline ops, then the steps before it and itself, in order', json(panel.opsFor(withBase, 'steps:2')) === json([...base, ...result.steps[0].ops, ...result.steps[1].ops]) && json(panel.opsFor(withBase, 'steps:1')) === json([...base, ...result.steps[0].ops]));
    check('apply: a single\'s ops are the baseline ops, then its own', json(panel.opsFor(withBase, 'single:0')) === json([...base, ...result.singles[0].ops]));
    check('apply: an older result (no baselineOps) applies exactly what it did before; an empty baselineOps too', json(panel.opsFor(result, 'steps:2')) === json([...result.steps[0].ops, ...result.steps[1].ops]) && json(panel.opsFor(result, 'single:0')) === json(result.singles[0].ops) && json(panel.opsFor({ ...result, baselineOps: [] }, 'steps:3')) === json(panel.opsFor(result, 'steps:3')));
    check('apply: a single that does not exist applies nothing, not the baseline alone', panel.opsFor(withBase, 'single:99').length === 0);
    const out = JSON.parse(panel.applyToSlots(slots, panel.opsFor(withBase, 'steps:1')).slots['1']);
    check('apply: one click writes the best food and drink and the step into the setup', out.food['/action_types/combat'][0].itemHrid === '/items/cake' && out.drinks['/action_types/combat'][0].itemHrid === '/items/swiftness_coffee' && out.player.equipment[0].enhancementLevel === 6, json(out.food));
}

{
    const page = panel.pageSetups(slots);
    check('diff: the same setup has no differences', panel.diffSetups(page, result.setups).length === 0);
    const page2 = panel.pageSetups([slots[0], { ...slots[1], json: JSON.stringify(setup(7)) }]);
    const d = panel.diffSetups(page2, result.setups);
    check('diff: one ring level differs', d.length === 1 && d[0].player === 'Beta' && d[0].field === 'ring' && d[0].page.endsWith('+7') && d[0].result.endsWith('+2'));
    const d2 = panel.diffSetups(panel.pageSetups([slots[0]]), result.setups);
    check('diff: a player the page lacks', d2.length === 1 && d2[0].field === 'player' && d2[0].page === 'absent');
    const lv = { ...setup(5) }; lv.abilities = [{ abilityHrid: '/abilities/heal', level: 20 }, { abilityHrid: '/abilities/fireball', level: 30 }];
    check('diff: a level as a string or a number is the same', panel.diffSetups([{ ...lv, name: 'Alpha' }], [result.setups[0]]).length === 0);
    const html = panel.renderDiff(d, t);
    check('diff: rendered with both values', html.includes('Beta, ring') && html.includes('+7') && html.includes('+2'));
    check('diff: none renders nothing', panel.renderDiff([], t) === '');
}

{
    const html = panel.renderProgress({ state: 'running', progress: { stage: 'screen', candidatesLeft: 120, runsDone: 30, runsPlanned: 120, secondsPerRun: 12.5, etaSeconds: 3725 } }, t);
    check('progress: the runner\'s fields as they come', html.includes('screen') && html.includes('data-num="120"') && html.includes('data-num="30"') && html.includes('data-num="12.5"') && html.includes('1:02:05'));
    check('progress: bar at runs done of planned, with its own class for the dark track', html.includes('width: 25%') && html.includes('progress whatif-progress'));
    check('page: dark mode gives the bar a dark track and a fill', /body\.dark-mode \.whatif-progress \{[^}]*background-color/.test(read('index.html')) && /body\.dark-mode \.whatif-progress \.progress-bar \{[^}]*background-color/.test(read('index.html')));
    check('progress: an error shows its text', panel.renderProgress({ state: 'error', progress: {}, error: 'bad <x>' }, t).includes('bad &lt;x&gt;'));
}

// The search rounds: output only, every figure a field of the record.
{
    const leader = (o) => ({ id: 'x', player: 'Player 1', desc: 'Magic 1 -> 2', cost: 1500000, seeds: 12, readingSeeds: 16, tooFew: false, status: 'contending', reading: 1234, low: 1100, high: 1368, buyerNet: 900, payback: 12.5, ...o });
    const rec = { round: 7, stage: 'main', simHours: 3450, coverage: 0.99, candidates: { total: 120, contending: 31, paused: 80, refuted: 2, locked: 0 },
        pools: [
            { key: 'free', size: 40, contending: 10, paused: 30, leaders: [leader({ desc: 'Alpha <books> 30 -> 40', cost: 0, payback: null }), leader({ id: 'y', desc: 'Few seeds', readingSeeds: 3, tooFew: true, reading: 999, low: null, high: null, status: 'paused' })] },
            { key: 'Player 2:paid', size: 80, contending: 21, paused: 50, leaders: [] },
        ] };
    const html = panel.renderRounds(rec, t);
    check('rounds: nothing without a record', panel.renderRounds(null, t) === '' && panel.renderRounds({}, t) === '');
    check('rounds: the round counter, the contention counts and the dropped count', html.includes('data-rounds="round"><span data-num="7"') && html.includes('data-rounds="contending"><span data-num="31"') && html.includes('data-rounds="paused"><span data-num="80"') && html.includes('data-num="2"') && html.includes(t('rounds.coverage', { pct: 99 })));
    check('rounds: a leader shows its figure ± half its range, cut to the precision of the ± (1234, 1100-1368 -> 1230 ± 134: the margin is written in the unit of the figure, rounded up, and keeps its exact half range)', html.includes('data-num="1230"') && /data-num="134"[^>]*data-scale="1"/.test(html) && html.includes(' ± ') && !html.includes('data-num="1234"') && !html.includes('data-num="1100"') && !html.includes(' – '));
    check('rounds: a leader with too few reading seeds is shown as such, with no figure', html.includes(t('rounds.tooFew', { n: 3 })) && !html.includes('data-num="999"'));
    check('rounds: a pool per key, the player named in a per-player pool, the empty pool is ONE grey "None." line with no title and no table', !html.includes('Player 2 · ') && html.includes('data-none>None.</div>') && (html.match(/<table class="whatif-table"/g) || []).length === 1 && (html.match(/data-none/g) || []).length === 1);
    const emptyPools = panel.renderRounds({ ...rec, pools: ['free', 'paid', 'Zed:free'].map((k) => ({ key: k, size: 1, contending: 1, paused: 0, leaders: [] })) }, t);
    check('rounds: a run of empty pools is ONE "None." line (no title, no table), not one per pool', (emptyPools.match(/data-none/g) || []).length === 1 && !emptyPools.includes('<table'), emptyPools.slice(0, 300));
    check('rounds: no payback is a dash, never NaN or undefined', !html.includes('NaN') && !html.includes('undefined') && !html.includes('null'));
    check('rounds: text is escaped', html.includes('&lt;books&gt;') && !html.includes('<books>'));
    check('rounds: no buttons or inputs (output only)', !/<(button|input|select|textarea)/.test(html));
}

// Step 3: range width on the pool heading, one reading seed, few seeds, best so far, singles, legend, export lever boxes.
{
    const leader = (o) => ({ id: 'x', player: 'Player 1', desc: 'Magic 1 -> 2', cost: 0, seeds: 4, readingSeeds: 8, tooFew: false, status: 'confirmed', reading: 100, low: 80, high: 120, buyerNet: 90, payback: null, ...o });
    const pool = (o) => ({ key: 'free', size: 4, contending: 2, paused: 2, leaders: [leader({})], ...o });
    const heading = (html) => txt(html.match(/<b>(Free changes[^]*?)<\/b>/)[1]);
    const second = panel.renderRounds({ round: 2, simHours: 10, coverage: 1, candidates: {}, pools: [pool({ rangeWidth: 40, rangeWidthPrev: 90 })] }, t);
    const first = panel.renderRounds({ round: 1, simHours: 10, coverage: 1, candidates: {}, pools: [pool({ rangeWidth: 40 })] }, t);
    check('range width: two rounds print both widths on the pool heading (now and was)', heading(second).includes('range width 40 (was 90)'), heading(second));
    check('range width: a first round prints the width and no "was"', heading(first).includes('range width 40') && !heading(first).includes('was'), heading(first));
    check('range width: a pool with no width prints neither', !heading(panel.renderRounds({ round: 1, pools: [pool({})] }, t)).includes('range width'));
    const one = panel.renderRounds({ round: 1, pools: [pool({ leaders: [leader({ readingSeeds: 1, low: null, high: null, status: 'few' })] })] }, t);
    check('one fresh run: no figure and no ±, a dim dash with the hover text in both gain columns, the status says how many more runs are needed', !one.includes('data-num="100"') && !one.includes('no range yet') && !tablesOf(one)[0].includes(' ± ') && (one.match(/<td class="num whatif-dim" title="Needs more runs before a figure can be shown">—<\/td>/g) || []).length === 2 && one.includes('still measuring') && one.includes('1 fresh runs so far; 7 more before the range is final'), one);
    const two = panel.renderRounds({ round: 1, pools: [pool({ leaders: [leader({ readingSeeds: 2, status: 'few' }), leader({ id: 'y', readingSeeds: 8, status: 'confirmed' })] })] }, t);
    check('2 fresh runs: figure ± range and "6 more needed"; 8 runs: checked on fresh runs, no note', two.includes('2 fresh runs so far; 6 more before the range is final') && two.includes('data-num="100"') && two.includes('data-num="20"') && two.includes('>clear gain<') && two.includes('>still measuring<') && !two.includes('8 fresh runs so far'), two);
    // Fewer than 4 seeds: no figure in either gain column (one helper, rounds and Best tables); 4 and more draw as before (including the grey ≈ 0 and its row).
    const cellsOf = (html) => bodyRows(tablesOf(html)[0])[0];
    const seedsHtml = (n, o = {}) => panel.renderRounds({ round: 1, pools: [pool({ leaders: [leader({ readingSeeds: n, status: 'few', ...o })] })] }, t);
    const gone = (h) => !h.includes('data-num="100"') && !h.includes('data-num="90"') && !tablesOf(h)[0].includes(' ± ');
    check('4 seeds: the gain and the buyer gain both draw "value ± range" (3 seeds draw the dash, both columns)', !gone(seedsHtml(4)) && gone(seedsHtml(3)) && cellsOf(seedsHtml(4))[3] === '100 ± 20' && cellsOf(seedsHtml(3))[3] === '—' && cellsOf(seedsHtml(3))[4] === '—');
    const zeroN = (n) => seedsHtml(n, { status: 'zero', reading: 5, low: -30, high: 40, buyerNet: 4, netLow: -30, netHigh: 38 });
    check('4 seeds on a range that reaches 0 still draws the grey "≈ 0 ± X" and greys the row; under 4 it is the dash', zeroN(4).includes('<span class="whatif-dim">≈ 0 ± ') && zeroN(4).includes('<tr data-status="zero" class="whatif-dim">') && !zeroN(3).includes('≈ 0'));
    const firstRow = (n) => panel.renderRounds({ round: 1, provisional: true, firstLook: { have: 2, total: 2 }, pools: [pool({ leaders: [leader({ id: 'a', status: 'first', seeds: n, readingSeeds: 0 })] })] }, t);
    check('first look: the figure rests on the search seeds (status first), the same 4-seed rule', cellsOf(firstRow(3))[3] === '—' && cellsOf(firstRow(4))[3] === '100 ± 20' && txt(firstRow(3)).includes('first look: so far 2 of 2 candidates have a first figure'));
    check('no leader with the old "no range" string: the string is gone in en, pt, zh and the new hover string is in all three', ['en', 'pt', 'zh'].every((l) => locales[l].rounds.noRange === undefined && typeof locales[l].rounds.needsMoreRuns === 'string' && locales[l].rounds.needsMoreRuns !== locales.en.rounds.noRange && typeof locales[l].rounds.sortedByLater === 'string' && locales[l].rounds.sortedByLater.includes('{{col}}')) && locales.en.rounds.needsMoreRuns === 'Needs more runs before a figure can be shown' && locales.en.rounds.sortedByLater === 'sorted by {{col}} once figures exist');
    const pend = panel.renderRounds({ round: 1, pools: [pool({ key: 'Player 1:free', sortedBy: null, sortPending: 'buyerNet', leaders: [leader({ readingSeeds: 2, status: 'few' })] }), pool({ key: 'Player 1:paid', sortedBy: null, sortPending: 'payback', leaders: [leader({ readingSeeds: 2, status: 'few' })] })] }, t);
    check('order: a pool with no row at 4 seeds (sortedBy null) says "sorted by <column> once figures exist", never "best first"', txt(pend).includes("sorted by Buyer's gain once figures exist") && txt(pend).includes('sorted by Payback days once figures exist') && !txt(pend).includes('best first'), txt(pend));
    // Best tables: the same helper, both columns, so far and final.
    const bs = (n) => bodyRows(bestOf(panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], soFar: true, readingSeeds: n, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50 } }, drinks: {} } }, t, undefined, null, true), 'foods'))[0];
    check('best so far: 3 seeds draw the dash in both gain columns, 4 draw value ± range', bs(3)[2] === '—' && bs(3)[3] === '—' && bs(4)[2] === '12 ± 3' && bs(4)[3] === '40 ± 10', JSON.stringify([bs(3), bs(4)]));
    const bf = (n) => bodyRows(bestOf(panel.renderResult({ ...result, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], gainPerUser: 123456, sePerUser: 20000, buyerNet: 98765, buyerNetSe: 1234, fresh: { seeds: n, gainPerUser: 123456, sePerUser: 20000, buyerNet: 98765, buyerNetSe: 1234 } } }, drinks: {} } }, t), 'foods'))[0];
    check('best (final): the fresh reading seeds decide: 3 draw the dash in both columns, 4 draw as before', bf(3)[2] === '—' && bf(3)[3] === '—' && bf(4)[2] === '123000 ± 20k' && bf(4)[3] === '98800 ± 2k', JSON.stringify([bf(3), bf(4)]));
    // Best foods so far: the pool leader with figure and range, marked so far; a few-seeds note below the minimum; one seed has no range.
    const so = (o) => ({ items: [{ item: '/items/donut', trigger: null }], soFar: true, readingSeeds: 8, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50, ...o });
    const res = (e) => ({ ...result, rounds: { readingMin: 8 }, best: { foods: { Alpha: e }, drinks: {} } });
    const r8 = bodyRows(bestOf(panel.renderResult(res(so({})), t, undefined, null, true), 'foods'))[0];
    check('best so far: figure and range in place of the error, buyer figure and range, no few-seeds note at 8 seeds', r8[2] === '12 ± 3' && r8[3] === '40 ± 10' && !r8[0].includes('fresh runs'), JSON.stringify(r8));
    const unc = (o) => so({ unchanged: true, unclear: true, items: [{ item: '/items/cake', trigger: null, slot: 0, same: true }], candidate: [{ item: '/items/donut', trigger: null }], ...o });
    const r2h = bestOf(panel.renderResult(res(unc({ readingSeeds: 2 })), t, undefined, null, true), 'foods'), r2 = bodyRows(r2h)[0];
    check('best so far: a leader without a clear gain shows the current food greyed, a dash, the status "no clear change yet" and the candidate with its figures as the tooltip', r2[1] === 'cake' && r2h.includes('<span class="whatif-dim">cake</span>') && r2[2] === '—' && r2[0].includes('no clear change yet') && r2h.includes('title="Best candidate so far: donut (Shared loot gain per user 12 ± 3; Buyer&#39;s gain 40 ± 10; fresh runs: 2)"'.replace('&#39;', "'")) && !r2h.includes('>donut<'), JSON.stringify(r2) + r2h);
    const rc = bodyRows(bestOf(panel.renderResult(res(so({})), t, undefined, null, true), 'foods'))[0];
    check('best so far: a leader with a clear gain (not flagged) shows its items, its figures and no status', rc[1] === 'donut' && rc[2] === '12 ± 3' && !rc[0].includes('no clear change'), JSON.stringify(rc));
    const r1 = bodyRows(bestOf(panel.renderResult(res(unc({ readingSeeds: 1, low: null, high: null, netLow: null, netHigh: null })), t, undefined, null, true), 'foods'))[0];
    check('best so far: one fresh run is no clear gain either (current food, status)', r1[1] === 'cake' && r1[0].includes('no clear change yet'), JSON.stringify(r1));
    check('best so far: the group heading is marked so far', panel.renderResult(res(so({})), t, undefined, null, true).includes('· ' + locales.en.result.soFar));
    // Singles: shown rows are split free / paid; a count line for the ones left out; the legend of a running search.
    const free = { id: 'f', player: 'Alpha', desc: 'Ring free', gain: 20, se: 4, gainPerUser: 10, sePerUser: 2, buyerNet: 10, buyerNetSe: 2, cost: 0, payback: null, costPath: 'market', accepted: true, ops: [] };
    const paid = { ...free, id: 'p', desc: 'Ring paid', cost: 500, payback: 50, paybackOwn: 50 };
    const sing = panel.renderResult({ ...result, singles: [free, paid], singlesNotShown: 3 }, t);
    check('singles: the free rows come under a Free changes sub-heading and the paid under Paid changes', sing.indexOf('data-group="free"') > 0 && sing.indexOf('Ring free') > sing.indexOf('data-group="free"') && sing.indexOf('data-group="paid"') > sing.indexOf('Ring free') && sing.indexOf('Ring paid') > sing.indexOf('data-group="paid"'));
    // With a round table the empty Each change alone says how many were searched and that none has the reading minimum yet; without one, the old lines.
    const yetRes = (extra) => ({ ...result, singles: [], singlesNotShown: 473, round: { round: 1, readingMin: 8 }, ...extra });
    const yetEn = txt(panel.renderResult(yetRes(), t)), yetOne = txt(panel.renderResult(yetRes({ singlesNotShown: 1 }), t)), yetSome = txt(panel.renderResult(yetRes({ singles: [free] }), t));
    check('singles with a round table: 473 searched, none checked on 8 fresh runs yet; not "No changes were measured" nor "not confirmed"', yetEn.includes('473 searched; none has been checked on 8 fresh runs yet.') && !yetEn.includes('No changes were measured') && !yetEn.includes('not confirmed'), yetEn.slice(yetEn.indexOf('473') - 60, yetEn.indexOf('473') + 90));
    check('singles with a round table: singular, and the line after a shown table', yetOne.includes('1 searched; it has not been checked on 8 fresh runs yet.') && yetSome.includes('473 more searched; none has been checked on 8 fresh runs yet, not shown') && !yetSome.includes('not confirmed'));
    check('singles without a round table, or with nothing hidden: the old lines', txt(panel.renderResult({ ...yetRes(), round: undefined }, t)).includes('No changes were measured') && txt(panel.renderResult(yetRes({ singlesNotShown: 0 }), t)).includes('No changes were measured') && txt(panel.renderResult({ ...yetRes({ singles: [free] }), round: undefined }, t)).includes('473 more searched, not confirmed, not shown'));
    check('singles with a round table: pt and zh have the strings with {{n}} and {{need}}', ['noSinglesYet', 'noSinglesYetOne', 'singlesNotShownYet', 'singlesNotShownYetOne'].every((k) => ['en', 'pt', 'zh'].every((l) => locales[l].result[k].includes('{{n}}') && locales[l].result[k].includes('{{need}}'))) && locales.pt.result.noSinglesYet !== locales.en.result.noSinglesYet);
    check('singles: a line says how many more were searched, not confirmed, not shown; none when 0 or absent', txt(sing).includes('3 more searched, not confirmed, not shown') && !panel.renderResult({ ...result, singles: [free], singlesNotShown: 0 }, t).includes('data-singles="not-shown"') && !panel.renderResult({ ...result, singles: [free] }, t).includes('data-singles="not-shown"'), sing.match(/data-singles[^]*?<\/div>/)?.[0]);
    check('legend: a running search says the lists marked so far can still change and the other rows are final', locales.en.result.running.includes('so far') && locales.en.result.running.includes('can still change') && !/rows shown are final/i.test(locales.en.result.running));
    // The export lever boxes: off, unticked and with a tooltip while no ticked player has a kept export; on and ticked as soon as one has.
    const none = panel.exportLeverView({ hasExport: false, wasDisabled: false, wasChecked: true }, (k) => t(k));
    const some = panel.exportLeverView({ hasExport: true, wasDisabled: true, wasChecked: false }, (k) => t(k));
    const kept = panel.exportLeverView({ hasExport: true, wasDisabled: false, wasChecked: false }, (k) => t(k));
    check('export levers: no export -> disabled, unticked, tooltip says why; an export -> enabled and ticked; the user\'s untick is kept afterwards', none.disabled && !none.checked && none.title.length > 10 && !some.disabled && some.checked && some.title === '' && !kept.checked);
    check('levers: eight in the window (foods and drinks apart), all ticked by default, no pairs and no skills box', panel.LEVERS.length === 8 && panel.LEVERS.every((l) => l.def === true) && !panel.LEVERS.some((l) => l.id === 'pairs' || l.id === 'skills'), panel.LEVERS.map((l) => l.id).join());
}

// Step 3 (items 18 to 25): change columns, one order, zero range, ±, precision, plain words, hours, closed list, first look.
{
    const leader = (o) => ({ id: 'x', player: 'Player 1', desc: 'Player 1 Magic 1 -> 2', change: null, cost: 0, seeds: 4, readingSeeds: 8, searchHours: 200, readHours: 400, hours: 600, tooFew: false, few: false, status: 'confirmed', reading: 100, low: 80, high: 120, buyerNet: 90, netLow: 70, netHigh: 110, payback: null, ...o });
    const pool = (o) => ({ key: 'Player 1:paid', size: 4, contending: 2, paused: 2, sortedBy: 'payback', leaders: [leader({})], ...o });
    const rec = (pools, o = {}) => ({ round: 3, simHours: 900, coverage: 0.99, readingMin: 8, candidates: { contending: 2, paused: 2 }, pools, ...o });
    const food = (slots) => ({ kind: 'foods', slots: slots.map(([index, item, trigger = null]) => ({ index, item, trigger })) });
    // A ruled-out candidate is not a row of the table (the heading counts it).
    const refHtml = panel.renderRounds(rec([pool({ leaders: [leader({ id: 'a' }), leader({ id: 'r', status: 'refuted' })] })]), t);
    check('ruled out: a refuted candidate is not listed in its pool table', bodyRows(tablesOf(refHtml)[0]).length === 1 && !refHtml.includes('data-status="refuted"'), String(bodyRows(tablesOf(refHtml)[0]).length));
    // fit / precision: no digit finer than the ±; a range that reaches 0 reads ≈ 0.
    check('fit: -2118 with a ± of 337412 is 0; 90412 is 90000; 1234 with 134 is 1230; 0.123456 with 0.0456 is 0.123', panel.fit(-2118, 337412) === 0 && panel.fit(90412, 337412) === 90000 && panel.fit(1234, 134) === 1230 && panel.fit(0.123456, 0.0456) === 0.123);
    // The margin is written in the figure's unit and decimals, rounded up from the raw error (one assertion per row of the case table).
    for (const [v, h, want] of [[2293000, 7500, '2,293k ± 8k'], [2293000, 7001, '2,293k ± 8k'], [2293000, 7000, '2,293k ± 7k'], [303000, 8200, '303k ± 9k'], [1488000, 12000, '1,488k ± 12k'],
        [303000, 300, '303k ± 1k'], [1230000, 45000, '1,230k ± 45k'], [1250000, 3000, '1,250k ± 3k'], [5400, 120, '5,400 ± 120'], [-2118000, 337412, '-2,120k ± 338k'],
        [12300000, 450000, '12M ± 1M'], [4.7, 0.12, '4.7 ± 0.2'], [4.7, 0.1, '4.7 ± 0.1'], [25000000000, 450000000, '25B ± 1B'], [5400000000, 120000000, '5,400M ± 120M']]) {
        const got = formatNumber(panel.fit(v, h), { iso: false }) + ' ± ' + panel.marginText(panel.fit(v, h), h);
        check(`margin: ${v} ± ${h} reads ${want}`, got === want, got);
    }
    check('margin: an error of 0 reads as the plain number (no unit to round up in)', panel.marginText(303000, 0) === '0');
    const zeroHtml = panel.renderRounds(rec([pool({ leaders: [leader({ status: 'zero', buyerNet: -2118, netLow: -339530, netHigh: 335294 }), leader({ id: 'y', buyerNet: 90412, netLow: -247000, netHigh: 427000 })] })]), t);
    const zr = bodyRows(tablesOf(zeroHtml)[0]);
    check('precision: a buyer\'s gain whose range reaches 0 reads "≈ 0 ± 337" (never -2,118 ± 337k), greyed', zr[0][4].startsWith('≈ 0 ± ') && !zr[0][4].includes('-2118') && zeroHtml.includes('<span class="whatif-dim">≈ 0 ± '), JSON.stringify(zr[0]));
    check('precision: 90412 ± 337000 also reaches 0 and reads ≈ 0; the ± has two digits', zr[1][4].startsWith('≈ 0 ± 340'), JSON.stringify(zr[1]));
    check('zero range: status "no clear change yet" with the long wording as its tooltip, row greyed, never "checked on fresh runs"', zr[0][6] === 'no clear change yet' && zeroHtml.includes('title="not yet different from no change"') && zeroHtml.includes('<tr data-status="zero" class="whatif-dim">') && !zr[0][6].includes('fresh'), JSON.stringify(zr[0]));
    // columns: Change, Cost, Hours simulated, Shared loot gain per user, Buyer's gain, Payback days, Status; no Seeds, no Range.
    const heads = [...tablesOf(zeroHtml)[0].slice(0, tablesOf(zeroHtml)[0].indexOf('</thead>')).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    check('columns: the pool title (in place of Change) is the first header cell and the rest follow; no Seeds, no Range', /<thead><tr><th class="whatif-pool-title"[^>]*><b>Player 1 · Paid changes · /.test(tablesOf(zeroHtml)[0].slice(tablesOf(zeroHtml)[0].indexOf('<thead>'))) && !/>Change</.test(tablesOf(zeroHtml)[0].slice(0, tablesOf(zeroHtml)[0].indexOf('</thead>'))) && JSON.stringify(heads) === JSON.stringify(['Cost', 'Hours simulated', 'Shared loot gain per user', "Buyer's gain", 'Payback days', 'Status']), heads.join('|'));
    check('columns: the rounds table\'s two gain heads carry the same tooltips as the other tables (one definition)', tablesOf(zeroHtml)[0].includes('title="what the whole party\'s loot changes, per user; food and drink cost is not in it"') && tablesOf(zeroHtml)[0].includes('title="the buyer\'s loot share minus what the buyer spends on their own food and drink"'));
    check('hours: one cell with search + fresh runs, the split in its title only', zr[0][2] === '600' && zeroHtml.includes('title="200 h of search runs + 400 h of fresh runs"'), JSON.stringify(zr[0]));
    // the player is in the heading: no "Player 1" and no "(trigger kept)" in a row
    check('change: a pool of one player drops the player from the row; the heading names him', zr[0][0] === 'Magic 1 -> 2' && txt(zeroHtml).includes('Player 1 · Paid changes'), JSON.stringify(zr[0]));
    // foods: one cell per slot, only the new food in a slot that changes
    const fp = pool({ leaders: [leader({ id: 'a', desc: 'Player 1 food: a -> donut (trigger kept)', change: food([[1, '/items/donut']]) }), leader({ id: 'b', desc: 'Player 1 food: ...', change: food([[0, '/items/cake'], [2, '/items/gummy', 'HP < 50%']]) })] });
    const fh = panel.renderRounds(rec([fp]), t);
    const fr = bodyRows(tablesOf(fh)[0]);
    const fheads = [...tablesOf(fh)[0].slice(0, tablesOf(fh)[0].indexOf('</thead>')).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    check('foods: Slot 1 to Slot 3 columns, the new food only in the slot that changes, blank where it stays', fheads.slice(-3).join('|') === 'Slot 1|Slot 2|Slot 3' && fr[0].slice(0, 3).join('|') === '|donut|' && fr[1][0] === 'cake' && fr[1][1] === '' && fr[1][2].startsWith('gummy'), JSON.stringify(fr));
    check('foods: no "Player 1 food:" and no "(trigger kept)" on any row; a changed trigger is shown with its food', !txt(fh).includes('food:') && !txt(fh).includes('trigger kept') && fr[1][2] === 'gummy (HP < 50%)', JSON.stringify(fr[1]));
    // order and heading
    const oh = panel.renderRounds(rec([pool({ key: 'Player 1:free', sortedBy: 'buyerNet' }), pool({ key: 'Player 1:paid', sortedBy: 'payback' })]), t);
    check('order: each pool heading says what it is sorted by', txt(oh).includes("Player 1 · Free changes · 2 still in the running, 2 set aside for now · sorted by Buyer's gain, best first") && txt(oh).includes('sorted by Payback days, best first'), txt(oh));
    // ± everywhere: no "low – high"
    const allHtml = zeroHtml + oh + panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], soFar: true, readingSeeds: 8, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50 } }, drinks: {} } }, t, undefined, null, true);
    check('range: written with ± everywhere (rounds, Best so far), never "low – high"', !allHtml.includes(' – ') && allHtml.includes(' ± '));
    // Best so far: a buyer's gain whose range reaches 0
    const uncE = (o) => ({ items: [{ item: '/items/cake', trigger: null, slot: 0, same: true }], soFar: true, unchanged: true, unclear: true, candidate: [{ item: '/items/donut', trigger: null }], readingSeeds: 8, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50, ...o });
    const resU = (e) => ({ ...result, rounds: { readingMin: 8 }, best: { foods: { Alpha: e }, drinks: {} } });
    const bz = bodyRows(bestOf(panel.renderResult(resU(uncE({ readingSeeds: 8, buyerNet: 4, netLow: -30, netHigh: 38 })), t, undefined, null, true), 'foods'))[0];
    check('best so far: a buyer\'s gain whose range reaches 0 shows the current food and the status no clear change yet, not the candidate', bz[1] === 'cake' && bz[0].includes('no clear change yet') && !bz.join('').includes('donut'), JSON.stringify(bz));
    // Each change alone / Best (final): the digits follow the error
    const fin = bodyRows(bestOf(panel.renderResult({ ...result, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], gainPerUser: 123456, sePerUser: 20000, buyerNet: 98765, buyerNetSe: 1234 } }, drinks: {} } }, t), 'foods'))[0];
    check('best (final): the figure is cut to the precision of its error and the margin is written in the unit of the figure, rounded up (123456 ± 20000 -> 123k ± 20k; 98765 ± 1234 -> 99k ± 2k; the test shows the figure as its exact number)', fin[2] === '123000 ± 20k' && fin[3] === '98800 ± 2k', JSON.stringify(fin));
    // the closed "Unknown cost, not ranked" list
    const ap = panel.renderResult({ ...result, apart: [{ id: 'q', player: 'Alpha', desc: 'Ring unknown', note: 'no price' }] }, t);
    check('apart: "Unknown cost, not ranked" starts closed behind one toggle, like the other lists', ap.includes('data-whatif-more="whatIfApart"') && /<ul class="small whatif-more" id="whatIfApart" hidden>/.test(ap) && ap.includes('Show the 1 with no known cost'));
    // the first look: a provisional record
    const fl = panel.renderRounds(rec([pool({ key: 'free', sortedBy: 'buyerNet', size: 240, contending: 240, paused: 0 })], { provisional: true, firstLook: { have: 37, total: 240 } }), t);
    check('first look: the head says "so far 37 of 240 candidates have a first figure", no contention counts, the pool shows its size', txt(fl).includes('first look: so far 37 of 240 candidates have a first figure') && !fl.includes('data-rounds="paused"') && txt(fl).includes('240 candidates'), txt(fl).slice(0, 300));
    // slots that stay: the current food greyed, "empty" greyed for a slot empty now and staying empty (rounds table)
    const cur = ['/items/cake', null, '/items/gummy'];
    const sh = panel.renderRounds(rec([pool({ leaders: [leader({ id: 'a', change: { ...food([[1, '/items/donut']]), current: cur } })] })]), t);
    const shr = bodyRows(tablesOf(sh)[0])[0];
    check('slots: a slot the candidate leaves shows the current food greyed; the changed slot is plain; no blank cell', shr.slice(0, 3).join('|') === 'cake|donut|gummy' && sh.includes('<td class="chg"><span class="whatif-dim">cake</span></td>') && sh.includes('<td class="chg">donut</td>') && !sh.includes('<td class="chg"></td>'), JSON.stringify(shr));
    const shEmpty = panel.renderRounds(rec([pool({ leaders: [leader({ id: 'a', change: { ...food([[0, '/items/donut']]), current: ['/items/cake', null, null] } })] })]), t);
    check('slots: a slot empty now and staying empty shows a greyed "empty"', (shEmpty.match(/<span class="whatif-dim">empty<\/span>/g) || []).length === 2, shEmpty);
    // Best foods and drinks: the same
    const bestSlots = (kind, e) => bodyRows(bestOf(panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: kind === 'foods' ? { Alpha: e } : {}, drinks: kind === 'drinks' ? { Alpha: e } : {} } }, t, undefined, null, true), kind))[0];
    const bf = { soFar: true, slots: 3, empty: [2], items: [{ item: '/items/cake', slot: 0, trigger: null, same: true }, { item: '/items/donut', slot: 1, trigger: null }], readingSeeds: 8, gainPerUser: 12, low: 9, high: 15, buyerNet: 40, netLow: 30, netHigh: 50 };
    const bfHtml = panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: { Alpha: bf }, drinks: { Alpha: { ...bf, items: bf.items.map(({ trigger, ...x }) => x) } } } }, t, undefined, null, true);
    check('Best foods and drinks: the unchanged slot is the current item greyed, the new one plain, an empty slot a greyed "empty"', (bfHtml.match(/<td class="chg"><span class="whatif-dim">cake<\/span><\/td><td class="chg">donut<\/td><td class="chg"><span class="whatif-dim">empty<\/span><\/td>/g) || []).length === 2, bfHtml);
    // the pick note: only when a player's pick is not the first row of the table
    const noteOf = (e, kind = 'foods') => panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: kind === 'foods' ? { Alpha: e } : {}, drinks: kind === 'drinks' ? { Alpha: e } : {} } }, t, undefined, null, true);
    const noteText = "This one is the search's pick on its search runs; the table above is ordered by the fresh runs.";
    check('pick note: shown under the table when the pick is not the first row, in foods and in drinks', txt(noteOf({ ...bf, notFirst: true })).includes(noteText) && txt(noteOf({ ...bf, notFirst: true }, 'drinks')).includes(noteText) && noteOf({ ...bf, notFirst: true }).includes('data-best-note="foods"'));
    check('pick note: not shown when the pick is the first row, or when the entry is final', !txt(noteOf(bf)).includes(noteText) && !txt(noteOf({ ...bf, soFar: false, notFirst: true })).includes(noteText));
    // progress row and heading in words
    const lab = (en) => (k, p) => t(k, p);
    check('round labels: the heading says "round 3 finished"; the first look says "round 3 running"', txt(panel.renderRounds(rec([pool({})]), t)).includes('round 3 finished') && txt(fl).includes('round 3 running'), txt(fl).slice(0, 80));
    const pr = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'foods', state: 'running', round: 9, phase: 'search', contending: 4, paused: 1, dropped: 2, runs: 10, simHours: 50, runsPlanned: 0, runsDone: 0 }, { kind: 'drinks', state: 'done', round: 8, contending: 4, paused: 1, dropped: 2, runs: 10, simHours: 50, runsPlanned: 0, runsDone: 0 }] } }, t);
    check('round labels: the progress row says "round 9 running", a finished stage "round 8 finished"', txt(pr).includes('round 9 running') && txt(pr).includes('round 8 finished') && !txt(pr).includes('round 9 · '), txt(pr));
    // One cell "value ± error" in the Best tables too (final and so far), no separate error column.
    const bestFin = panel.renderResult({ ...result, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], gainPerUser: 123456, sePerUser: 20000, buyerNet: 98765, buyerNetSe: 1234 } }, drinks: {} } }, t);
    const bestHeads = (h) => [...bestOf(h, 'foods').slice(0, bestOf(h, 'foods').indexOf('</thead>')).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    check('best: two gain columns, "value ± error" in one cell, no "± error" column, final and so far', JSON.stringify(bestHeads(bestFin)) === JSON.stringify(['Player', 'Slot 1', 'Shared loot gain per user', "Buyer's gain", '']) && !bestFin.includes('± error') && bodyRows(bestOf(bestFin, 'foods'))[0].length === 5 && bestHeads(bfHtml).length === 7 && !bfHtml.includes('± error'), bestHeads(bestFin).join('|'));
    // Status "party loses loot": the shared gain's whole range is below 0, whatever the buyer's gain reads.
    const loHtml = panel.renderRounds(rec([pool({ leaders: [leader({ id: 'l', status: 'loses', reading: -640000, low: -930000, high: -350000, buyerNet: 5, netLow: -270000, netHigh: 270000 })] })]), t);
    const lor = bodyRows(tablesOf(loHtml)[0])[0];
    check('loses: the status reads "party loses loot" (tooltip: the long wording), the row keeps its figures and is not greyed', lor[6] === 'party loses loot' && lor[3].startsWith('-640000') && loHtml.includes('<tr data-status="loses">') && loHtml.includes('title="the shared loot per user falls, even though the buyer\'s own gain is not clearly different from 0"'), JSON.stringify(lor));
    // Stages the user ended: Best foods heading and one line per other stage; a party-ordered pool list is drawn in the order the core gave.
    const endHtml = panel.renderResult({ ...result, endedByUser: { foods: 3, screen: 2, 'greedy step 1': 4 }, rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, gainPerUser: 5, sePerUser: 1, buyerNet: 4, buyerNetSe: 1 } }, drinks: {} } }, t);
    check('ended by you: the Best foods heading, and a line for the screen and for each greedy step, say after which round', /data-ended="foods">· ended by you after round 3</.test(endHtml) && /data-ended="screen">Screen · ended by you after round 2</.test(endHtml) && /data-ended="greedy step 1">Greedy step 1 · ended by you after round 4</.test(endHtml) && !panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: { foods: {}, drinks: {} } }, t).includes('ended by you'), endHtml);
    // Once the user has ended the stage the heading no longer says "so far": "ended by you after round N" alone (a stage still running keeps "so far").
    const soFarBest = { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, soFar: true, gainPerUser: 5, buyerNet: 4, low: 1, high: 9, netLow: 1, netHigh: 7, readingSeeds: 9 } }, drinks: {} };
    const bestHead = (h) => { const i = h.indexOf('data-best="foods"'); return h.slice(h.lastIndexOf('<div class="fw-bold mt-2">', i), i); };
    const runHtml = panel.renderResult({ ...result, rounds: { readingMin: 8 }, best: soFarBest }, t, Date.now(), null, true), endSoFarHtml = panel.renderResult({ ...result, endedByUser: { foods: 2 }, rounds: { readingMin: 8 }, best: soFarBest }, t, Date.now(), null, true);
    check('ended by you: a stage that is still running says "so far"; once ended by the user its heading says "ended by you after round 2" alone, no "so far"', bestHead(runHtml).includes('so far') && !bestHead(endSoFarHtml).includes('so far') && bestHead(endSoFarHtml).includes('ended by you after round 2'), bestHead(endSoFarHtml));
    const tFor = (l) => (key, params = {}) => { const s = lookup(locales[l], key); return typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k])) : '#' + key; };
    for (const l of ['pt', 'zh']) check(`ended by you: ${l} renders the mark without a missing key`, !panel.renderResult({ ...result, endedByUser: { foods: 3 }, rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, gainPerUser: 5, sePerUser: 1, buyerNet: 4, buyerNetSe: 1 } }, drinks: {} } }, tFor(l)).includes('#result.endedByUser'));
    // "Accept current winner": the pick is taken as it is, marked "accepted as is" in the steps table and the Best table (en/pt/zh); a pick the search locked has no mark.
    const asIsRes = { ...result, steps: [{ ...result.steps[0], acceptedAsIs: true }, result.steps[1]], rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, gainPerUser: 5, sePerUser: 1, buyerNet: 4, buyerNetSe: 1, acceptedAsIs: true }, Beta: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, gainPerUser: 5, sePerUser: 1, buyerNet: 4, buyerNetSe: 1 } }, drinks: {} } };
    const asIsCount = (h) => (h.match(/data-accepted-as-is/g) || []).length;
    check('accepted as is: the mark shows once in the steps table (the accepted step only) and once in the Best table (the accepted player only), en', asIsCount(panel.renderResult(asIsRes, t)) === 2 && panel.renderResult(asIsRes, t).includes(locales.en.result.acceptedAsIs) && asIsCount(panel.renderResult(result, t)) === 0, String(asIsCount(panel.renderResult(asIsRes, t))));
    for (const l of ['pt', 'zh']) check(`accepted as is: ${l} writes the mark in its own words, without a missing key`, panel.renderResult(asIsRes, tFor(l)).includes(locales[l].result.acceptedAsIs) && !panel.renderResult(asIsRes, tFor(l)).includes('#result.acceptedAsIs') && locales[l].result.acceptedAsIs !== locales.en.result.acceptedAsIs);
    // A Skip says "ended by you during round N, its finished runs kept" (N = the rounds finished + 1, so 1 when pressed in round 1); an Accept keeps "after round N".
    const skipRes = { ...result, endedByUser: { foods: 0, screen: 0 }, endedBySkip: { foods: true, screen: true }, rounds: { readingMin: 8 }, best: { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null, slot: 0 }], slots: 1, gainPerUser: 5, sePerUser: 1, buyerNet: 4, buyerNetSe: 1 } }, drinks: {} } };
    const early = panel.renderResult(skipRes, t), later = panel.renderResult({ ...skipRes, endedByUser: { foods: 2, screen: 2 } }, t);
    check('ended by you: a Skip in round 1 reads "ended by you during round 1, its finished runs kept" on the Best heading and the screen line, en', /data-ended="foods">· ended by you during round 1, its finished runs kept</.test(early) && /data-ended="screen">Screen · ended by you during round 1, its finished runs kept</.test(early) && !early.includes('after round 0') && !early.includes('before the first round'), early.slice(0, 200));
    check('ended by you: a Skip after 2 finished rounds reads "during round 3", an Accept after 2 reads "after round 2"', later.includes('ended by you during round 3, its finished runs kept') && panel.renderResult({ ...skipRes, endedBySkip: {}, endedByUser: { foods: 2, screen: 2 } }, t).includes('ended by you after round 2'));
    for (const l of ['pt', 'zh']) check(`ended by you: a Skip in ${l} uses its own line, without a missing key`, panel.renderResult(skipRes, tFor(l)).includes(locales[l].result.endedByUserDuring.replace('{{n}}', '1')) && !panel.renderResult(skipRes, tFor(l)).includes('#result.endedByUser') && locales[l].result.endedByUserDuring !== locales.en.result.endedByUserDuring && locales[l].result.endedByUserEarly === undefined);
    // Every empty list is ONE grey line "None." (one helper, listTable): no header row over nothing, no label of its own.
    const noneOf = (h) => (h.match(/<div class="whatif-dim" data-none>None\.<\/div>/g) || []).length;
    const allWeak = { ...result, singles: result.singles.filter((s) => !s.accepted) };
    const wh = panel.renderResult(allWeak, t, Date.now(), null, false);
    const eachOf = (h) => [...h.matchAll(/<table[^>]*whatif-each[^>]*>([^]*?)<\/table>/g)];
    check('empty list: Each change alone with nothing accepted is the line "None.", the grey rows still behind their toggle, no table in view', noneOf(wh) === 1 && eachOf(wh).length === 1 && /<table[^>]*id="whatIfMoreSingles" hidden>/.test(wh) && wh.includes('data-whatif-more="whatIfMoreSingles"') && !/Paid changes|Free changes/.test(wh));
    check('empty list: with something accepted the table stands and no "None." line is drawn', noneOf(panel.renderResult(result, t)) === 0 && eachOf(panel.renderResult(result, t)).length === 1);
    const noSingles = panel.renderResult({ ...result, singles: [] }, t);
    check('empty list: no singles at all is the existing "No changes were measured." line, no table', !noSingles.includes('whatif-each') && noSingles.includes(locales.en.result.noSingles));
    for (const l of ['en', 'pt', 'zh']) check(`empty list: ${l} has the word`, typeof locales[l].result.none === 'string' && locales[l].result.none.length > 0 && panel.renderResult(allWeak, tFor(l)).includes('data-none>' + locales[l].result.none));
    // The part's own line for a stage the user skipped: "round N · ended by you" in place of "round N finished" (en/pt/zh).
    const plainHtml = (h) => h.replace(/<[^>]+>/g, '');
    const skRow = { kind: 'foods', state: 'done', round: 1, phase: 'search', contending: 2, paused: 0, dropped: 0, runs: 5, simHours: 20, skipped: true };
    for (const l of ['en', 'pt', 'zh']) { const h = plainHtml(panel.renderParts({ state: 'running', progress: { parts: [skRow] } }, tFor(l))); check(`part line: a skipped stage reads "round 1 · ended by you" in place of "round 1 finished", ${l}`, h.includes(locales[l].rounds.roundSkipped.replace('{{n}}', '1')) && !h.includes(locales[l].rounds.roundFinished.replace('{{n}}', '1')) && !h.includes('#rounds.roundSkipped')); }
    const lo = panel.renderParts({ state: 'done', progress: { parts: [{ kind: 'picks', index: 0, state: 'done', runsPlanned: 0, runsDone: 0, leftOut: 9 }] } }, t), loText = plainHtml(lo);
    check('picks part: a check that ran inside the race and left 9 out reads "None confirmed (left out: 9).", done, no bar, never "Not run"', loText.includes('None confirmed (left out: 9).') && !loText.includes('Not run') && !lo.includes('whatif-part-skipped') && !lo.includes('class="progress whatif-progress"'), lo.slice(0, 300));
    for (const l of ['pt', 'zh']) check(`picks part: ${l} has its own none-confirmed line`, plainHtml(panel.renderParts({ state: 'done', progress: { parts: [{ kind: 'picks', index: 0, state: 'done', runsPlanned: 0, runsDone: 0, leftOut: 9 }] } }, tFor(l))).includes(locales[l].progress.picksNoneConfirmed.replace('{{n}}', '9')));
    const stKeys = ['contending', 'paused', 'confirmed', 'few', 'first', 'tooFew', 'zero', 'loses'];
    for (const l of ['en', 'pt', 'zh']) check(`status words: ${l} has every status word and its tooltip, one or two words for the six a user sees`, stKeys.every((k) => typeof locales[l].rounds.status[k] === 'string' && typeof locales[l].rounds.status[k + 'Tip'] === 'string') && typeof locales[l].rounds.status.bestTip === 'string' && (l !== 'en' || stKeys.every((k) => locales.en.rounds.status[k].split(' ').length <= 4)));
    check('status words: the five of the list, en', JSON.stringify(['confirmed', 'zero', 'loses', 'contending', 'paused'].map((k) => locales.en.rounds.status[k])) === JSON.stringify(['clear gain', 'no clear change yet', 'party loses loot', 'still measuring', 'set aside']));
    const ordHtml =panel.renderRounds(rec([pool({ key: 'Zed:free' }), pool({ key: 'Zed:paid' }), pool({ key: 'Amy:free' })]), t);
    const poolHeads = [...ordHtml.matchAll(/<th class="whatif-pool-title"[^>]*><b>([^<]*)<\/b><\/th>/g)].map((x) => x[1].split(' · ')[0] + ' ' + x[1].split(' · ')[1]);
    check('party order: the pool tables are drawn in the order the core gave them (Zed, Zed, Amy), not sorted by name', poolHeads.join("|") === "Zed Free changes|Zed Paid changes|Amy Free changes", poolHeads.join("|"));
    const loBest = panel.renderResult(resU(uncE({ readingSeeds: 8, loses: true, gainPerUser: -640000, low: -930000, high: -350000, buyerNet: 5, netLow: -270000, netHigh: 270000 })), t, undefined, null, true);
    check('loses: Best so far says "party loses loot" under the player, with the long wording as its tooltip, in place of "no clear change yet"', bodyRows(bestOf(loBest, 'foods'))[0][0].includes('party loses loot') && !bodyRows(bestOf(loBest, 'foods'))[0][0].includes('no clear change') && loBest.includes('title="the shared loot per user falls'));
    check('loses: pt and zh have the status and its tooltip', ['pt', 'zh'].every((l) => typeof locales[l].rounds.status.loses === 'string' && typeof locales[l].rounds.status.losesTip === 'string'));
    // Item 27: a search that is stopped, done or failed has no Running line, whatever its last progress record says.
    const raceRow = { kind: 'foods', state: 'running', round: 4, phase: 'search', contending: 3, paused: 1, dropped: 0, runs: 12, simHours: 60, runsPlanned: 0, runsDone: 0 };
    const stepRow = { kind: 'screen', state: 'running', runsPlanned: 100, runsDone: 40 };
    const prog = (state) => ({ state, error: state === 'error' ? 'boom' : undefined, progress: { stage: 'foods', parts: [raceRow, stepRow, { kind: 'drinks', state: 'waiting' }], secondsPerRun: 1.5, elapsedSeconds: 30 } });
    for (const state of ['stopped', 'error']) {
        const h = panel.renderProgress(prog(state), t);
        check(`stopped (${state}): no element of the progress area reads Running`, !/Running/.test(txt(h)) && !/round \d+ running/.test(txt(h)) && !h.includes('data-whatif-done') && !h.includes('whatif-part-running'), txt(h));
        check(`stopped (${state}): the header says the state once, the rows keep their figures`, txt(h).startsWith(state === 'error' ? 'Error' : 'Stopped') && txt(h).includes('round 4 stopped') && txt(h).includes('12 runs') && txt(h).includes('40 / 100 runs') && (h.match(/data-state="halted"/g) || []).length === 2, txt(h));
    }
    const live = panel.renderProgress(prog('running'), t);
    check('running: the header says Running with the part, the race row has its button', txt(live).startsWith('Running · part 1 of 3') && live.includes('data-whatif-done') && txt(live).includes('round 4 running'), txt(live));
    check('stopped, no parts yet: the plain line says Stopped', !/Running/.test(txt(panel.renderProgress({ state: 'stopped', progress: { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0 } }, t))));
    const mainJs = read('src/main.js');
    check('stopped: a resumed search with no report yet drops the old stopped mark (main.js)', /status\.state === 'running' && whatIf\.resultRunning === 'stopped'\) whatIfShowResult\(whatIf\.result, true\)/.test(mainJs));
    for (const l of ['pt', 'zh']) check(`stopped: ${l} has the stopped round label`, typeof locales[l].rounds.roundStopped === 'string' && typeof locales.en.rounds.roundStopped === 'string');
    // Item 28: the pool's title is the header of its own table, in place of the Change column's header.
    const titled = panel.renderRounds(rec([pool({ key: 'Zed:free', size: 351, contending: 100, paused: 251 }), pool({ key: 'Zed:paid' })]), t);
    const headOf = (h) => h.slice(h.indexOf('<thead>'), h.indexOf('</thead>'));
    check('pool title: it is the first header cell of its own table, not a line above it; no Change header', tablesOf(titled).length === 2 && tablesOf(titled).every((tb) => /^<thead><tr><th class="whatif-pool-title"[^>]*><b>Zed · (Free|Paid) changes · /.test(tb.slice(tb.indexOf('<thead>')))) && !titled.includes('<div class="small"><b>Zed') && !/>Change</.test(titled), titled.slice(0, 400));
    const foodTitled = panel.renderRounds(rec([pool({ key: 'Zed:free', leaders: [leader({ id: 'a', change: { ...food([[1, '/items/donut']]), current: cur } })] })]), t);
    check('pool title: a foods table puts it over the slot columns (colspan 3), the slot names on a second header row', /<th class="whatif-pool-title" colspan="3"/.test(foodTitled) && headOf(foodTitled).includes('<tr><th>Slot 1</th><th>Slot 2</th><th>Slot 3</th></tr>') && headOf(foodTitled).includes('rowspan="2"'), headOf(foodTitled));
    const sing = (n) => panel.renderRounds(rec([pool({ key: 'free', sortedBy: 'buyerNet', size: n, contending: n, paused: 0 })], { provisional: true, firstLook: { have: n, total: n } }), t);
    check('singular: "1 candidate" on the pool title and in the first look head, "2 candidates" for two', txt(sing(1)).includes('1 candidate ') && !txt(sing(1)).includes('1 candidates') && txt(sing(1)).includes('of 1 candidate has') && txt(sing(2)).includes('2 candidates'), txt(sing(1)).slice(0, 300));
    const one1 = panel.renderParts({ state: 'running', progress: { parts: [{ kind: 'foods', state: 'done', round: 2, contending: 1, paused: 0, dropped: 0, runs: 1, simHours: 1, runsPlanned: 0, runsDone: 0 }, { kind: 'halving', index: 1, state: 'waiting', runsUpTo: 1, candidatesLeft: 1 }, { kind: 'halving', index: 2, state: 'running', candidatesLeft: 1, runsDone: 0, runsPlanned: 1 }] } }, t);
    check('singular: 1 run, 1 simulated hour, up to 1 run, 1 option left, 0 / 1 run in the progress rows', txt(one1).includes('1 run · 1 simulated hour') && txt(one1).includes('up to 1 run') && !txt(one1).includes('up to 1 runs') && txt(one1).includes('1 option left') && txt(one1).includes('0 / 1 run') && !txt(one1).includes('0 / 1 runs') && !txt(one1).includes('1 runs'), txt(one1));
    check('singular: 1 swap skipped, 1 player skipped', txt(panel.renderResult({ ...result, dominated: [{ player: 'Alpha', desc: 'x' }] }, t)).includes('1 swap skipped') && txt(panel.renderResult({ ...result, skippedNoExport: [{ lever: 'owned', players: ['Alpha'] }] }, t)).includes('1 player skipped'), '');
    const oneKeys = ['progress.optionsLeft', 'progress.upTo', 'progress.runsOf', 'progress.runsCount', 'progress.hoursCount', 'rounds.firstLook', 'rounds.poolSize', 'result.dominated', 'result.otherStyle', 'result.noSinglesYet', 'result.singlesNotShownYet', 'result.skippedNoExport', 'age.days', 'age.hours', 'age.minutes'];
    for (const l of ['en', 'pt', 'zh']) check(`singular: ${l} has the One key of every counted noun (${oneKeys.length}), and the singular text drops the plural ending (not en/pt equal)`, oneKeys.every((k) => typeof lookup(locales[l], k + 'One') === 'string') && (l === 'zh' || oneKeys.every((k) => lookup(locales[l], k + 'One') !== lookup(locales[l], k))), oneKeys.filter((k) => typeof lookup(locales[l], k + 'One') !== 'string').join(','));
    check('singular: pt and zh read right for 1', lookup(locales.pt, 'rounds.poolSizeOne') === '{{n}} candidata' && lookup(locales.pt, 'progress.runsCountOne') === '{{n}} execução' && lookup(locales.zh, 'rounds.poolSizeOne') === '{{n}} 个候选');
    // plain words: none of the old terms in any of the three languages
    const words = (l) => Object.entries(flat({ rounds: locales[l].rounds, progress: locales[l].progress })).filter(([k]) => k !== 'progress.partHalving').map(([, v]) => String(v).replace(/\{\{[^}]*\}\}/g, ''));
    const old = { en: /seeds?\b|contention|reading|dropped|refuted/i, pt: /semente|leitura/i, zh: /种子|读数|淘汰/ };
    for (const l of ['en', 'pt', 'zh']) check(`plain words (${l}): the rounds and progress strings do not use seeds, reading, contention or dropped`, !words(l).some((s) => old[l].test(s)), words(l).filter((s) => old[l].test(s)).join(' | '));
}

// Strings: every key the window uses (rendered above, plus main.js and index.html) exists in en, pt and zh.
for (const m of read('src/main.js').matchAll(/whatIfT\('([\w.]+)'[,)]/g)) used.add(m[1]);
for (const m of read('index.html').matchAll(/data-i18n="common:whatIf\.([\w.]+)"/g)) used.add(m[1]);
for (const l of panel.LEVERS) { used.add('lever.' + l.id + '.name'); used.add('lever.' + l.id + '.desc'); }
for (const s of ['running', 'stopped', 'done', 'error']) used.add('state.' + s);
for (const k of ['age.days', 'result.pricesSnapshot', 'result.pricesCommitted']) used.add(k);
for (const lang of ['en', 'pt', 'zh']) {
    const missing = [...used].filter((k) => typeof lookup(locales[lang], k) !== 'string');
    check(`strings: ${lang} has every key the window uses (${used.size})`, missing.length === 0, missing.join(', '));
}
check('strings: en, pt and zh have the same keys', ['pt', 'zh'].every((l) => JSON.stringify(Object.keys(JSON.stringify(locales[l]) ? flat(locales[l]) : {}).sort()) === JSON.stringify(Object.keys(flat(locales.en)).sort())));
function flat(o, p = '') { return Object.entries(o).reduce((a, [k, v]) => (typeof v === 'object' ? { ...a, ...flat(v, p + k + '.') } : { ...a, [p + k]: v }), {}); }

// The page: the button is hidden until the runner answers, the window and its parts exist, and main.js starts it.
{
    const html = read('index.html');
    check('page: the What-if button is hidden by default', /id="buttonWhatIf"[^>]*style="display: none;"/.test(html));
    check('page: the window and its parts', ['whatIfModal', 'selectWhatIfGoal', 'whatIfBudgets', 'whatIfLevers', 'buttonWhatIfStart', 'buttonWhatIfStop', 'selectWhatIfResult', 'whatIfProgress', 'whatIfResult', 'whatIfDiff'].every((id) => html.includes(`id="${id}"`)));
    const main = read('src/main.js');
    check('page: main.js starts the window', /\ninitWhatIf\(\);/.test(main));
    check('page: Apply saves the current tab first', /function whatIfSlots[\s\S]*?savePreviousPlayer\(currentPlayerTabId\)/.test(main));
    check('levers: no seals or labyrinth', !panel.LEVERS.some((l) => /seal|labyrinth/i.test(l.id)));
}

// Game names in the descriptions (generic fixtures; the real game bundles of js/i18n.js, run as locale-coverage.mjs does).
{
    const context = { document: { addEventListener() {} } };
    vm.runInNewContext(read('js/i18n.js') + '\n;globalThis.__bundles = { en: Wa.en.translation, pt: Pa };', context);
    const { en, pt } = context.__bundles;
    const N = { en: panel.namesFrom(en, en), pt: panel.namesFrom(pt, en) };
    const players = ['Alpha', 'Beta'];
    const L = (lng, desc, p = players) => panel.localizeDesc(desc, N[lng], p);
    const boots = 'Alpha feet pathseeker_boots_refined +12 -> cotton_boots +0';
    check('names: an equipment swap shows the slot and the item names, the refined one with the page\'s own mark (en)',
        L('en', boots) === 'Alpha Feet Pathseeker Boots ★ +12 -> Cotton Boots +0', L('en', boots));
    check('names: the same in pt', L('pt', boots) === `Alpha ${pt.equipmentTypeNames['/equipment_types/feet']} ${pt.itemNames['/items/pathseeker_boots_refined']} +12 -> ${pt.itemNames['/items/cotton_boots']} +0` &&
        L('pt', boots) !== L('en', boots), L('pt', boots));
    check('names: an ability level and a learned book',
        L('en', 'Beta poke 5 -> 6') === 'Beta Poke 5 -> 6' && L('en', 'Beta ability 2 empty -> learn fireball 30') === 'Beta ability 2 empty -> learn Fireball 30', L('en', 'Beta ability 2 empty -> learn fireball 30'));
    check('names: an owned item, a skill and the ability order',
        L('en', 'Beta ring ring_of_rare_find +3 -> owned ring_of_rare_find +5') === `Beta ${en.equipmentTypeNames['/equipment_types/ring']} ${en.itemNames['/items/ring_of_rare_find']} +3 -> owned ${en.itemNames['/items/ring_of_rare_find']} +5` &&
        L('en', 'Alpha magic 60 -> 61') === 'Alpha Magic 60 -> 61' && L('en', 'Alpha ability order poke, fireball') === 'Alpha ability order Poke, Fireball', L('en', 'Alpha ability order poke, fireball'));
    check('rounds: a leader\'s change reads in the game names, the player kept in front', panel.renderRounds({ round: 1, pools: [{ key: 'free', size: 1, contending: 1, paused: 0, leaders: [{ player: 'Alpha', desc: 'Alpha drink 1 stamina_coffee -> empty', cost: 0, seeds: 4, readingSeeds: 8, status: 'contending', reading: 5, low: 1, high: 9 }] }] }, t, N.en).includes(`Alpha drink 1 ${en.itemNames['/items/stamina_coffee']} -&gt; empty`));
    check('names: a drink swap, "empty" stays', L('en', 'Alpha drink 1 stamina_coffee -> empty') === `Alpha drink 1 ${en.itemNames['/items/stamina_coffee']} -> empty`, L('en', 'Alpha drink 1 stamina_coffee -> empty'));
    check('names: a house room is written as its English name and shown in the page\'s language',
        L('en', 'Alpha Dairy Barn 3 -> 4') === 'Alpha Dairy Barn 3 -> 4' && L('pt', 'Alpha Dairy Barn 3 -> 4') === `Alpha ${pt.houseRoomNames['/house_rooms/dairy_barn']} 3 -> 4` && pt.houseRoomNames['/house_rooms/dairy_barn'] !== 'Dairy Barn');
    const trig = 'Alpha poke trigger: self puncture >= 1 AND targeted_enemy current_hp <= 50';
    check('names: a trigger desc reads its owner as an item or ability and its terms as dependency and condition (a condition id can also be an ability id)',
        L('en', trig) === `Alpha Poke trigger: ${en.combatTriggerDependencyNames['/combat_trigger_dependencies/self']} ${en.combatTriggerConditionNames['/combat_trigger_conditions/puncture']} >= 1 AND ${en.combatTriggerDependencyNames['/combat_trigger_dependencies/targeted_enemy']} ${en.combatTriggerConditionNames['/combat_trigger_conditions/current_hp']} <= 50` &&
        en.combatTriggerConditionNames['/combat_trigger_conditions/puncture'] !== en.abilityNames['/abilities/puncture'], L('en', trig));
    check('names: the runner\'s own trigger words stay (drop, game default, always)', L('en', 'Alpha poke trigger: drop self puncture >= 1').includes('trigger: drop ') && L('en', 'Alpha poke trigger: game default (always)') === 'Alpha Poke trigger: game default (always)');
    check('names: an id with no name stays as it is', L('en', 'Alpha feet not_a_real_item_x +1 -> +2') === `Alpha ${en.equipmentTypeNames['/equipment_types/feet']} not_a_real_item_x +1 -> +2`);
    check('names: the player name is never touched, even when it is an id', L('en', 'poke poke 5 -> 6', ['poke']) === 'poke Poke 5 -> 6');
    check('names: without a name source the desc stays as it came', panel.localizeDesc(boots, null, players) === boots && panel.localizeDesc(undefined, N.en) === '');
    check('names: an id missing from the shown language falls back to English, as the page does', panel.localizeDesc('Alpha poke 1 -> 2', panel.namesFrom({ abilityNames: {} }, en), players) === 'Alpha Poke 1 -> 2');
    // The runner's own words must never resolve to a name (a future game id that equals one would be caught here).
    const words = 'ability order trigger learn owned empty always drop add game default and food drink drinks'.split(' ');
    const tables = ['itemNames', 'abilityNames', 'skillNames', 'equipmentTypeNames', 'combatTriggerDependencyNames', 'combatTriggerConditionNames'];
    const resolves = words.filter((w) => tables.some((tb) => N.en.get(tb, w) !== null));
    check('names: none of the runner\'s own words is a game id', resolves.length === 0, resolves.join(','));

    const h = (lng, r = result) => panel.renderResult(r, t, undefined, N[lng]);
    const withIds = { ...result,
        steps: result.steps.map((x, i) => (i === 0 ? { ...x, desc: boots } : x)),
        singles: result.singles.map((x, i) => (i === 0 ? { ...x, desc: boots } : x)),
        overBudget: [{ id: 'o', player: 'Alpha', desc: boots, cost: 7e9, costPath: 'market' }],
        apart: [{ id: 'u', desc: 'Beta ability 2 empty -> learn fireball 30', note: 'no seller' }] };
    const shownEn = h('en', withIds), shownPt = h('pt', withIds);
    check('names: steps, singles, the over-budget list and the unknown-cost list all show names', (shownEn.match(/Pathseeker Boots ★ \+12/g) || []).length === 3 && shownEn.includes('learn Fireball 30: no seller') && !shownEn.includes('pathseeker_boots_refined'), shownEn.slice(0, 200));
    check('names: the same in pt', shownPt.split(pt.itemNames['/items/pathseeker_boots_refined'] + ' +12').length === 4 && !shownPt.includes('pathseeker_boots_refined'));
    check('names: the apply buttons and the ops do not depend on the shown text', shownEn.includes('data-whatif-apply="steps:1"') && JSON.stringify(panel.opsFor(withIds, 'steps:1')) === JSON.stringify(result.steps[0].ops));
    check('names: without names the descs show as they came (the existing output)', panel.renderResult(withIds, t).includes('pathseeker_boots_refined'));

    // The row's own player leads the desc and has its own column: the shown desc leaves the lead off.
    check('player lead: a desc that starts with the row\'s player shows without it, with and without names',
        panel.localizeDesc(boots, N.en, players, 'Alpha') === 'Feet Pathseeker Boots ★ +12 -> Cotton Boots +0' && panel.localizeDesc(boots, null, players, 'Alpha') === 'feet pathseeker_boots_refined +12 -> cotton_boots +0');
    check('player lead: a desc without the prefix is unchanged, and another player\'s lead stays',
        panel.localizeDesc('feet pathseeker_boots_refined +12 -> +13', N.en, players, 'Alpha') === 'Feet Pathseeker Boots ★ +12 -> +13' && panel.localizeDesc('Beta feet cotton_boots +0 -> +1', N.en, players, 'Alpha') === 'Beta Feet Cotton Boots +0 -> +1');
    const lead = { ...withIds, steps: [{ ...withIds.steps[0], player: 'Alpha' }], singles: [{ ...withIds.singles[0], player: 'Alpha' }], overBudget: [{ id: 'o', player: 'Alpha', desc: boots, cost: 7e9, costPath: 'market' }, { id: 'p', player: 'Beta', desc: 'poke 5 -> 6', cost: 8e9, costPath: 'market' }] };
    const leadHtml = h('en', lead);
    check('player lead: steps and singles show the player once (its column), the over-budget row once before the comma, a desc without a prefix as it is',
        leadHtml.includes('<td>Alpha</td><td class="chg">Feet Pathseeker Boots ★ +12') && !leadHtml.includes('Alpha Feet') && leadHtml.includes('<li>Alpha, Feet Pathseeker Boots ★ +12') && leadHtml.includes('<li>Beta, Poke 5 -&gt; 6'), leadHtml.slice(0, 300));
    check('player lead: the unknown-cost list has no player column, so its lead stays', leadHtml.includes('Beta ability 2 empty -&gt; learn Fireball 30: no seller'));
    check('player lead: without names the lead is dropped too, and the ops are untouched', panel.renderResult(lead, t).includes('<td>Alpha</td><td class="chg">feet pathseeker_boots_refined') && JSON.stringify(lead.steps[0].ops) === JSON.stringify(result.steps[0].ops));

    // The "where the page differs" warning shows names for every id a difference holds (generic fixtures; diffSetups stays raw).
    const trigTerm = (cond, v) => [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/' + cond, comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: v }];
    const sp = (extra) => ({ ...setup(5), triggerMap: {}, ...extra });
    const pageD = [{ ...sp({ triggerMap: { '/abilities/heal': trigTerm('current_mp', 10) }, houseRooms: { '/house_rooms/dojo': 4 } }), name: 'Alpha',
        player: { ...setup(5).player, magicLevel: 70, equipment: [{ itemLocationHrid: '/item_locations/ring', itemHrid: '/items/ring_of_rare_find', enhancementLevel: 7 }] },
        food: { '/action_types/combat': [{ itemHrid: '/items/donut' }, { itemHrid: '' }] }, drinks: { '/action_types/combat': [{ itemHrid: '/items/not_a_real_drink_x' }] },
        abilities: [{ abilityHrid: '/abilities/heal', level: '25' }, { abilityHrid: '/abilities/fireball', level: '30' }] }];
    const diffRaw = panel.diffSetups(pageD, [result.setups[0]]);
    const fields = diffRaw.map((d) => d.field);
    const tPt = (key, params = {}) => lookup(locales.pt, key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k]));
    const diffOf = (lng) => panel.renderDiff(diffRaw, lng === 'pt' ? tPt : t, N[lng]);
    const dEn = diffOf('en'), dPt = diffOf('pt');
    check('diff names: the fixture holds every kind of id (slot, skill level, food, drink, ability, room, trigger)', ['ring', 'magicLevel', 'food 1', 'drink 1', 'ability 1', '/house_rooms/dojo', 'triggers /abilities/heal'].every((f) => fields.includes(f)), fields.join());
    check('diff names: an item with its enhancement, a slot, a skill level, a food and an ability with its level show names (en)',
        dEn.includes(`Alpha, ${en.equipmentTypeNames['/equipment_types/ring']}: here ${en.itemNames['/items/ring_of_rare_find']} +7, in the search ${en.itemNames['/items/ring_of_rare_find']} +5`) &&
        dEn.includes(`${en.skillNames['/skills/magic']} level: here 70, in the search 60`) && dEn.includes(`food 1: here ${en.itemNames['/items/donut']}, in the search ${en.itemNames['/items/apple']}`) &&
        dEn.includes(`ability 1: here ${en.abilityNames['/abilities/heal']} 25, in the search ${en.abilityNames['/abilities/heal']} 20`), dEn);
    check('diff names: a room and a trigger field show names, the trigger terms\' dependency, condition and comparator too',
        dEn.includes(`${en.houseRoomNames['/house_rooms/dojo']}: here 4, in the search 3`) && dEn.includes(`triggers ${en.abilityNames['/abilities/heal']}: here`) &&
        dEn.includes(en.combatTriggerDependencyNames['/combat_trigger_dependencies/self']) && dEn.includes(en.combatTriggerConditionNames['/combat_trigger_conditions/current_mp']) &&
        dEn.includes(en.combatTriggerComparatorNames['/combat_trigger_comparators/greater_than_equal'].replace('>', '&gt;')) && !dEn.includes('/combat_trigger_') && !dEn.includes('/abilities/') && !dEn.includes('/house_rooms/'), dEn);
    check('diff names: the same in pt, with the page\'s language and the locale string for the level',
        dPt.includes(pt.itemNames['/items/ring_of_rare_find']) && dPt.includes(pt.equipmentTypeNames['/equipment_types/ring']) && dPt.includes(`nível de ${pt.skillNames['/skills/magic']}: `) && dPt.includes(pt.houseRoomNames['/house_rooms/dojo']) &&
        dPt.includes(pt.abilityNames['/abilities/heal']) && pt.itemNames['/items/ring_of_rare_find'] !== en.itemNames['/items/ring_of_rare_find']);
    check('diff names: an id with no name stays as it is (the hrid, the level suffix kept)', dEn.includes(`drink 1: here /items/not_a_real_drink_x, in the search /items/coffee`), dEn);
    check('diff names: the difference and its data stay raw; without names the warning shows them as they came',
        diffRaw.find((d) => d.field === 'ring').page === '/items/ring_of_rare_find +7' && panel.renderDiff(diffRaw, t).includes('magicLevel: here 70') && panel.renderDiff(diffRaw, t).includes('/items/ring_of_rare_find +7') && panel.diffLabel('feet', null, t) === 'feet');
    check('diff names: the player-missing difference and a dash stay', panel.renderDiff(panel.diffSetups([], result.setups), t, N.en).includes('player: here absent, in the search present') && panel.renderDiff([{ player: 'A', field: 'food 2', page: null, result: '/items/donut' }], t, N.en).includes(`here —, in the search ${en.itemNames['/items/donut']}`));
    const slotIds = 'head body legs feet hands main_hand two_hand off_hand pouch back neck earrings ring trinket charm'.split(' ');
    const unnamed = slotIds.filter((s) => N.en.get('equipmentTypeNames', s) === null);
    check('diff names: every equipment slot the page holds has a slot name (unnamed: ' + (unnamed.join(',') || 'none') + ')', unnamed.length === 0, unnamed.join());
    check('diff names: all seven skill levels have a skill name', 'stamina intelligence attack melee defense ranged magic'.split(' ').every((s) => N.en.get('skillNames', s) !== null && N.pt.get('skillNames', s) !== null));
    check('diff names: the level string exists in en, pt, zh', ['en', 'pt', 'zh'].every((l) => /\{\{skill\}\}/.test(locales[l].diff.level)));

    // The zone line and the loss warning (generic fixtures; the zone name follows the language).
    const zoned = (extra) => ({ ...result, options: { ...result.options, zone: '/actions/combat/fly', tier: 0, ...(extra || {}) } });
    const loss = { ...zoned(), basePerUser: -29000000 / 3 };
    const lossEn = h('en', loss), lossPt = h('pt', loss);
    check('zone line: zone name, tier and the base per user (the field as it is, "per user per day")', lossEn.includes('Zone: Fly, tier 0 · base party profit <span data-num="-9666666.666666666"') && /per user per day<\/div>/.test(lossEn), lossEn.slice(0, 500));
    check('zone line: the zone name follows the language, the strings come from the locale', lossPt.includes(`Zone: ${pt.actionNames['/actions/combat/fly']}, tier 0`) && pt.actionNames['/actions/combat/fly'] !== 'Fly' && lossEn.includes('Zone: Fly, tier 0'));
    check('zone line: it sits under the goal line, before the steps', lossEn.indexOf('Goal:') < lossEn.indexOf('Zone: Fly') && lossEn.indexOf('Zone: Fly') < lossEn.indexOf(locales.en.result.steps));
    check('warning: a base below 0 shows the loss line, in every language', lossEn.includes(locales.en.result.baseLoses) && lossPt.includes(locales.en.result.baseLoses) && lossEn.indexOf('Zone: Fly') < lossEn.indexOf(locales.en.result.baseLoses));
    const gain = h('en', { ...zoned(), basePerUser: 12345 });
    check('warning: a base of 0 or above shows the zone line and no warning', gain.includes('Zone: Fly, tier 0 · base party profit <span data-num="12345"') && !gain.includes(locales.en.result.baseLoses) && !h('en', { ...zoned(), basePerUser: 0 }).includes(locales.en.result.baseLoses));
    check('zone line: the loss compares the raw field, not a shown figure; an exp goal shows neither the base nor the warning', !h('en', { ...zoned(), goal: 'exp', basePerUser: -5 }).includes(locales.en.result.baseLoses) && !h('en', { ...zoned(), goal: 'exp', basePerUser: -5 }).includes(locales.en.result.baseProfit) && h('en', { ...zoned(), goal: 'exp', basePerUser: -5 }).includes('Zone: Fly, tier 0'));
    const old = h('en', { ...result, options: { pricesTimestamp: 1700000000, pricesSource: 'snapshot' } });
    check('zone line: a result with no zone shows neither line nor warning and does not crash (also with no options)', !old.includes('Zone:') && !old.includes(locales.en.result.baseLoses) && !h('en', { ...result, options: undefined }).includes('Zone:') && panel.renderResult(zoned({ zone: '/actions/combat/not_a_zone' }), t).includes('Zone: not_a_zone, tier 0'));
    check('zone line: a zone with no tier, and a result with a zone but no base figure, show what they have', h('en', { ...zoned(), options: { zone: '/actions/combat/fly' } }).includes('Zone: Fly<') && !h('en', zoned()).includes(locales.en.result.baseProfit));
    check('zone line: the strings exist in en, pt and zh', ['zone', 'zoneNoTier', 'baseProfit', 'baseLoses'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== '')) && ['zone', 'zoneNoTier'].every((k) => ['en', 'pt', 'zh'].every((l) => locales[l].result[k].includes('{{zone}}'))));

    // The skipped swaps (result.dominated): one line with the count, the list closed behind a toggle, names like the other lists.
    const skipped = [{ id: 's1', player: 'Alpha', slot: 'feet', desc: boots, from: { item: '/items/pathseeker_boots_refined', level: 12 }, to: { item: '/items/cotton_boots', level: 0 } },
        { id: 's2', player: 'Beta', slot: 'ring', desc: 'Beta ring not_a_real_item_x +1 -> ring_of_rare_find +1', from: { item: '/items/not_a_real_item_x', level: 1 }, to: { item: '/items/ring_of_rare_find', level: 1 } }];
    const domEn = h('en', { ...result, dominated: skipped }), domPt = panel.renderResult({ ...result, dominated: skipped }, tPt, undefined, N.pt);
    check('skipped swaps: one line with the count, the list closed behind one toggle that opens it (Show / Hide)',
        domEn.includes('<span class="fw-bold">2 swaps skipped (no better on any stat)</span>') && /<ul class="small whatif-more" id="whatIfDominated" hidden>/.test(domEn) && (domEn.match(/data-whatif-more="whatIfDominated"/g) || []).length === 1 &&
        domEn.includes('data-show="Show" data-hide="Hide">Show</button>'), domEn.slice(domEn.indexOf('swaps skipped') - 80, domEn.indexOf('swaps skipped') + 400));
    check('skipped swaps: rows show the player and the game names, an id with no name stays, like the over-budget list',
        domEn.includes('<li>Alpha, Feet Pathseeker Boots ★ +12 -&gt; Cotton Boots +0</li>') && domEn.includes(`<li>Beta, ${en.equipmentTypeNames['/equipment_types/ring']} not_a_real_item_x +1 -&gt; ${en.itemNames['/items/ring_of_rare_find']} +1</li>`) && !domEn.includes('pathseeker_boots_refined'), domEn);
    check('skipped swaps: in pt the line and the names follow the language', domPt.includes(locales.pt.result.dominated.replace('{{n}}', '2')) && domPt.includes(pt.itemNames['/items/cotton_boots'] + ' +0') && locales.pt.result.dominated !== locales.en.result.dominated);
    check('skipped swaps: an absent or empty group shows nothing', !h('en', result).includes('swaps skipped') && !h('en', { ...result, dominated: [] }).includes('swaps skipped') && !h('en', { ...result, dominated: [] }).includes('whatIfDominated'));
    check('skipped swaps: the strings exist in en, pt, zh, the line takes the count', ['dominated', 'dominatedShow', 'dominatedHide'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== '')) && ['en', 'pt', 'zh'].every((l) => locales[l].result.dominated.includes('{{n}}')));
    // The swaps to another style's gear (result.otherStyle): the same fold, its own count line and toggle.
    const other = [{ ...skipped[0], bound: { styles: ['melee'], elements: [] }, wants: { style: 'ranged', element: null } }, { ...skipped[1], bound: { styles: ['magic'], elements: ['fire'] }, wants: { style: 'magic', element: 'water' } }];
    const osEn = h('en', { ...result, otherStyle: other }), osPt = panel.renderResult({ ...result, otherStyle: other }, tPt, undefined, N.pt);
    check('other style: one line with the count, the list closed behind its own toggle, names like the other lists', osEn.includes("<span class=\"fw-bold\">2 swaps skipped (only another style's bonuses)</span>") && /<ul class="small whatif-more" id="whatIfOtherStyle" hidden>/.test(osEn) && (osEn.match(/data-whatif-more="whatIfOtherStyle"/g) || []).length === 1 && osEn.includes('<li>Alpha, Feet Pathseeker Boots ★ +12 -&gt; Cotton Boots +0</li>') && !osEn.includes('id="whatIfDominated"'));
    check('other style: singular, pt, none when absent or empty', txt(panel.renderResult({ ...result, otherStyle: [other[0]] }, t)).includes("1 swap skipped (only another style's bonuses)") && osPt.includes(locales.pt.result.otherStyle.replace('{{n}}', '2')) && !h('en', result).includes("only another style's") && !h('en', { ...result, otherStyle: [] }).includes('whatIfOtherStyle'));
    check('other style: the strings exist in en, pt, zh and take the count', ['otherStyle', 'otherStyleOne'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k].includes('{{n}}'))) && locales.pt.result.otherStyle !== locales.en.result.otherStyle && locales.zh.result.otherStyle !== locales.en.result.otherStyle);
    check('skipped swaps: the group sits after the over-budget list and before the unknown-cost list',domEn.indexOf(locales.en.result.overBudget) < domEn.indexOf('swaps skipped') && domEn.indexOf('swaps skipped') < domEn.indexOf(locales.en.result.apart));

    // The over-budget list folds.
    const ob = h('en');
    check('over budget: the heading keeps its count, the list is closed behind one toggle', ob.includes(locales.en.result.overBudget) && ob.includes('(2, not ranked') &&
        /<button[^>]*data-whatif-more="whatIfOverBudget"[^>]*>Show the 2 priced over budget<\/button>/.test(ob) && /<ul class="small whatif-more" id="whatIfOverBudget" hidden>/.test(ob));
    check('over budget: the toggle carries its open and closed text and targets its own list, apart from the singles\' toggle',
        ob.includes('data-show="Show the 2 priced over budget"') && ob.includes('data-hide="Hide the 2 priced over budget"') && ob.includes('data-whatif-more="whatIfMoreSingles"') && ob.includes('id="whatIfMoreSingles"'));
    check('over budget: the strings exist in en, pt and zh', ['overBudgetShow', 'overBudgetHide'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k].includes('{{n}}'))));
}

// Window polish: a heading sits over its numbers (th class num exactly where the first body row's td has it).
{
    const full = JSON.parse(JSON.stringify(result));
    Object.assign(full.steps[0], { buyerNet: 1234, buyerNetSe: 77, sharedGainPerUser: 1500, paybackOwn: 22.5, costPath: 'books' });
    Object.assign(full.confirmation, { buyerByPlayer: { Alpha: { gain: 1100, se: 80, payback: 12.5 }, Beta: { gain: 600, se: 90, payback: null } } });
    const fullHtml = panel.renderResult(full, t);
    const tables = [...fullHtml.matchAll(/<table[^>]*>([^]*?)<\/table>/g)].map((m) => m[1]);
    check('headings: the steps, the confirmation and Each change alone tables are rendered', tables.length === 3 && tablesOf(fullHtml).length === 2 && !!confOf(fullHtml));
    const classesOf = (src, tag) => [...src.matchAll(new RegExp(`<${tag}( [^>]*)?>`, 'g'))].map((m) => /class="[^"]*\bnum\b/.test(m[1] || ''));
    const alignOk = (tb) => {
        const ths = classesOf(tb.slice(tb.indexOf('<thead>'), tb.indexOf('</thead>')), 'th');
        const body = tb.slice(tb.indexOf('<tbody')).replace(/<tr class="whatif-group"[^]*?<\/tr>/g, '');
        const row = body.slice(body.indexOf('<tr'), body.indexOf('</tr>'));
        const tds = classesOf(row, 'td');
        return ths.length > 0 && ths.length === tds.length && ths.every((v, i) => v === tds[i]) && ths.some(Boolean);
    };
    check('headings: in every table the th at each column has class num exactly when the first body row\'s td does', tables.filter((x) => !x.includes('Slot 1')).every(alignOk), tables.map((x) => alignOk(x)).join());
}

// One food row per player (hiddenFood): the other food rows stay in the file but are left out of Each change alone.
{
    const row = (extra) => ({ lastStage: '8x300', sharedSePerUser: 100, ownSuppliesPerDay: 0, costPath: 'loadout tweak', cost: 0, payback: null, paybackOwn: null, sePerUser: 50, sharedGainPerUser: 100, ops: [{ op: 'food', player: 'Alpha', index: 0, item: '/items/steak' }], ...extra });
    const shownFood = row({ id: 'ff1', player: 'Alpha', desc: 'Alpha food: shown-row', gain: 500, se: 100, gainPerUser: 250, accepted: true });
    const hiddenFood = row({ id: 'ff2', player: 'Alpha', desc: 'Alpha food: hidden-row', gain: 400, se: 100, gainPerUser: 200, accepted: true, hiddenFood: true });
    const hiddenWeak = row({ id: 'ff3', player: 'Beta', desc: 'Beta food: hidden-weak', gain: 10, se: 100, gainPerUser: 5, accepted: false, hiddenFood: true });


    const singles = [...result.singles, shownFood, hiddenFood, hiddenWeak];
    const html = panel.renderResult({ ...result, singles }, t);
    check('one food row: the best food row is in Each change alone', html.includes('shown-row'));
    check('one food row: the other food rows (accepted or not) are in neither Each change alone nor the grey body', !html.includes('hidden-row') && !html.includes('hidden-weak'));



    const none = panel.renderResult({ ...result, singles: [...result.singles, hiddenWeak, hiddenFood] }, t);
    check('one food row: a hidden row is not shown, the other kinds keep theirs', !none.includes('hidden-weak') && !none.includes('hidden-row') && none.includes('Food 2'));
    const older = panel.renderResult({ ...result, singles: [...result.singles, { ...hiddenFood }, { ...hiddenWeak }].map((s) => { const { hiddenFood: h, ...rest } = s; return rest; }) }, t);
    check('one food row: a result without the field shows every row as before', older.includes('hidden-row') && older.includes('hidden-weak'));
    check('one food row: the apply keys keep their indexes (a hidden row is skipped, not renumbered)', panel.opsFor({ ...result, singles }, 'single:' + (result.singles.length)).length === 1 && html.includes('data-whatif-apply="single:' + result.singles.length + '"'));
}
// One row per setting (hiddenAlt): two values of one trigger are two rows in the file and one in Each change alone; the hidden row is in no count.
{
    const trigRow = (extra) => ({ lastStage: '8x300', sharedSePerUser: 100, ownSuppliesPerDay: 0, costPath: 'loadout tweak', cost: 0, payback: null, paybackOwn: null, sePerUser: 50, sharedGainPerUser: 100, player: 'Alpha', ops: [{ op: 'trigger', player: 'Alpha', hrid: '/abilities/fly_trap', triggers: [] }], ...extra });
    const kept = trigRow({ id: 'tg1', desc: 'Alpha fly_trap trigger: kept-4550', gain: 640, se: 300, gainPerUser: 320, accepted: true });
    const alt = trigRow({ id: 'tg2', desc: 'Alpha fly_trap trigger: alt-6400', gain: 556, se: 100, gainPerUser: 278, accepted: true, hiddenAlt: true });
    const altWeak = trigRow({ id: 'tg3', desc: 'Alpha fly_trap trigger: alt-weak', gain: 10, se: 100, gainPerUser: 5, accepted: false, hiddenAlt: true });
    const singles = [...result.singles, kept, alt, altWeak];
    const html = panel.renderResult({ ...result, singles }, t);
    check('one row per setting: the kept row is in Each change alone, the alternatives (accepted or not) are in neither it nor the grey body', html.includes('kept-4550') && !html.includes('alt-6400') && !html.includes('alt-weak'));
    const applyKeys = (h) => (h.match(/data-whatif-apply="single:\d+"/g) || []).length;
    check('one row per setting: no Apply button for a hidden row, and the apply keys keep their indexes', applyKeys(html) === applyKeys(panel.renderResult({ ...result, singles: [...result.singles, kept] }, t)) && panel.opsFor({ ...result, singles }, 'single:' + (result.singles.length + 1)).length === 1 && html.includes('data-whatif-apply="single:' + result.singles.length + '"'));
    const grey = (h) => (h.match(/data-whatif-more="whatIfMoreSingles"[^>]*data-show="([^"]*)"/) || [])[1];
    check('one row per setting: a hidden row is in no count (the grey toggle counts the same as without the hidden rows)', grey(html) === grey(panel.renderResult({ ...result, singles: [...result.singles, kept] }, t)));
    const only = panel.renderResult({ ...result, singles: [kept, alt, altWeak] }, t);
    check('one row per setting: with only the kept row and its alternatives, one row is drawn and no grey toggle', only.includes('kept-4550') && !only.includes('alt-6400') && !only.includes('alt-weak') && !only.includes('data-whatif-more="whatIfMoreSingles"'));
    const older = panel.renderResult({ ...result, singles: [kept, alt].map((s) => { const { hiddenAlt: h, ...rest } = s; return rest; }) }, t);
    check('one row per setting: a result without the field shows every row as before', older.includes('kept-4550') && older.includes('alt-6400'));
}
// ---- A gain within one error of zero reads "no change" (title: the real value); one error or more shows the number ----
{
    const row = (id, gpu, spu, net, netSe) => ({ id, player: 'Alpha', desc: 'Ring ' + id, lastStage: '8x300', gain: gpu * 2, se: spu * 2, gainPerUser: gpu, sePerUser: spu, buyerNet: net, buyerNetSe: netSe, cost: 0, payback: null, costPath: 'market', accepted: true, ops: [] });
    const nc = locales.en.result.noChange;
    const res = { ...result, steps: [row('in', 100, 242, 1000, 100), row('edge', 242, 242, -50, 100)], singles: [row('neg', -200, 242, 1000, 100), row('big', 288, 242, 300, 100)], confirmation: { gainPerUser: 100, sePerUser: 242, cost: 0, buyerByPlayer: { Alpha: { gain: 30, se: 80, payback: null }, Beta: { gain: 600, se: 90, payback: null } } } };
    const html = panel.renderResult(res, t);
    const cellsOf = (id) => { const tr = html.split('<tr').find((x) => x.includes('Ring ' + id)); return [...tr.matchAll(/<td([^>]*)>([^]*?)<\/td>/g)].map((m) => ({ attrs: m[1], html: m[2] })); };
    const inRow = cellsOf('in');
    check('no change: a party gain below 1 error shows the words, with the real value in the title', inRow[3].html === nc && /title="[^"]*242[^"]*"/.test(inRow[3].attrs) && inRow[3].attrs.includes('class="num"'));
    check('no change: the error is not in a cell of its own (one gain cell, then the buyer\'s)', !inRow.some((c) => c.html === '—') && inRow[4].html.includes('±'));
    check('no change: the buyer cells beside it still show numbers (1000 is beyond 1 error)', inRow[4].html.includes('data-num="1000"') && inRow[4].html.includes('data-num="100"'));
    const edgeRow = cellsOf('edge');
    check('no change: exactly 1 error shows the number; the buyer at -0.5 errors reads no change', edgeRow[3].html.includes('data-num="240"') && edgeRow[4].html === nc);
    const negRow = cellsOf('neg');
    check('no change: a negative within 1 error shows the words too (Each change alone)', negRow[2].html === nc && /title="[^"]*-[^"]*"/.test(negRow[2].attrs));
    check('no change: 288 against 242 is beyond 1 error and shows the number', cellsOf('big')[2].html.includes('data-num="290"'));
    const cf = confOf(html);
    const cfRows = [...cf.slice(cf.indexOf('<tbody')).matchAll(/<tr[^>]*>([^]*?)<\/tr>/g)].map((m) => m[1]);
    check('no change: the confirmation table shows the words, titled, on the party row and on a small player row; a clear one keeps its numbers', /title="[^"]*">no change</.test(cfRows[0]) && /title="[^"]*">no change</.test(cfRows[1]) && cfRows[1].includes('Alpha') && cfRows[2].includes('Beta') && cfRows[2].includes('data-num="600"'), cfRows.join('\n'));
}
// ---- Best foods and drinks block (result.best), the baseline line and the cost-0 wording ----
{
    const plain = (s) => nums(s).replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
    const nm = panel.namesFrom({ itemNames: { '/items/donut': 'Donut', '/items/cake': 'Cake', '/items/gummy': 'Gummy', '/items/coffee_x': 'Coffee X' }, combatTriggerDependencyNames: { '/combat_trigger_dependencies/self': 'Self' }, combatTriggerConditionNames: { '/combat_trigger_conditions/current_hp': 'Current HP' } });
    const best = { foods: { Alpha: { items: [{ item: '/items/donut', trigger: 'self current_hp <= 60' }, { item: '/items/cake', trigger: null }], gain: 10, se: 2 }, Beta: { items: [{ item: '/items/gummy', trigger: null }], unchanged: true } }, drinks: { Alpha: { items: [{ item: '/items/coffee_x' }], gain: 4, se: 1 } } };
    const withBest = { ...result, best };
    const html = panel.renderResult(withBest, t, undefined, nm), plainHtml = plain(html);
    const idx = (s) => html.indexOf(s);
    check('best: a Best foods and a Best drinks block sit above the chosen changes', idx(locales.en.result.bestFoods) > 0 && idx(locales.en.result.bestFoods) < idx(locales.en.result.bestDrinks) && idx(locales.en.result.bestDrinks) < idx(locales.en.result.steps));
    const fr = bodyRows(bestOf(html, 'foods')), dr = bodyRows(bestOf(html, 'drinks'));
    check('best: one row per player in slot order; a food shows its trigger in parentheses with the names, one without a trigger shows none', fr[0][0] === 'Alpha' && fr[0][1] === 'Donut (Self Current HP <= 60)' && fr[0][2] === 'Cake' && !fr[0][2].includes('('), JSON.stringify(fr));
    check('best: a drink never shows a trigger', dr[0][0] === 'Alpha' && dr[0][1] === 'Coffee X' && !dr[0][1].includes('('), JSON.stringify(dr));
    check('best: a player left unchanged shows his current items and a no change cell; a changed one does not', fr[1][0] === 'Beta' && fr[1][1] === 'Gummy' && fr[1].some((c) => c === locales.en.result.noChange) && !fr[0].some((c) => c === locales.en.result.noChange), JSON.stringify(fr));
    check('best: the no change cell is one cell over the two gain columns, centred (whatif-span)', /<td colspan="2" class="whatif-dim whatif-span">no change<\/td>/.test(bestOf(html, 'foods')) && read('index.html').includes('.whatif-table td.whatif-span { text-align: center; }'), bestOf(html, 'foods'));
    check('best: one table per kind with Player, a column per slot, gain, error, buyer gain, error', bestOf(html, 'foods').includes('<th>Player</th><th>Slot 1</th><th>Slot 2</th>') && bestOf(html, 'drinks').includes('<th>Player</th><th>Slot 1</th><th class="num"'));
    check('best: the baseline line follows the block', idx(locales.en.result.bestBaseline) > idx(locales.en.result.bestDrinks) && idx(locales.en.result.bestBaseline) < idx(locales.en.result.steps));
    check('best: without names the ids show as they came (item slug, trigger text)', bodyRows(bestOf(panel.renderResult(withBest, t), 'foods'))[0].slice(0, 3).join('|') === 'Alpha|donut (self current_hp <= 60)|cake');
    check('best: an older result without best shows no block and does not fail', !panel.renderResult(result, t).includes(locales.en.result.bestFoods) && !panel.renderResult({ ...result, best: undefined }, t, undefined, nm).includes(locales.en.result.bestBaseline));
    check('best: an empty best (consumables off) shows no block', !panel.renderResult({ ...result, best: { foods: {}, drinks: {} } }, t).includes(locales.en.result.bestFoods));
    {
        const bestG = { foods: { Alpha: { items: [{ item: '/items/donut', trigger: null }], gainPerUser: -13, sePerUser: 49, buyerNet: 2204, buyerNetSe: 44, ownSuppliesPerDay: -2217 }, Beta: { items: [{ item: '/items/gummy', trigger: null }], gainPerUser: 500, sePerUser: 50, buyerNet: 900, buyerNetSe: 40 }, Gamma: { items: [{ item: '/items/cake', trigger: null }], unchanged: true } }, drinks: {} };
        const g = bodyRows(bestOf(panel.renderResult({ ...result, best: bestG }, t, undefined, nm), 'foods'));
        const nc = locales.en.result.noChange;
        check('best: a changed row says the party gain (no change inside one error), the buyer gain and the saved split in the note', g[0][2] === '≈ 0 ± 49' && g[0][3] === '2204 ± 44' && g[0][4].includes('(' + nc + ' loot share + 2217 food and drink saved)'), JSON.stringify(g[0]));
        const g2 = bodyRows(bestOf(panel.renderResult({ ...result, best: { foods: { Beta: { ...bestG.foods.Beta, ownSuppliesPerDay: -300 } }, drinks: {} } }, t, undefined, nm), 'foods'));
        check('best: a loot share that is not inside its error shows its number in the note', g2[0][4].includes('500 loot share + 300 food and drink saved'), JSON.stringify(g2[0]));
        check('best: a loot share inside one error of the party gain reads no change in the note (the old bare -13 is gone)', !g[0][4].includes('-13 loot share'));
        check('best: a changed row without the saved figure has an empty note; an unchanged one is the no change row', g[1][2] === '500 ± 50' && g[1][3] === '900 ± 40' && g[1][4] === '' && g[2][1] === 'Cake' && g[2][2] === nc, JSON.stringify(g));
        check('best: the pt and zh bestGain strings exist and differ from en', ['pt', 'zh'].every((l) => typeof locales[l].result.bestGain === 'string' && locales[l].result.bestGain !== locales.en.result.bestGain));
    }
    check('best: the pt and zh strings exist for every new key', ['bestFoods', 'bestDrinks', 'bestBaseline', 'noCost', 'playerLineFree', 'playerLineFreeNoChange'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== '')) && locales.pt.result.bestBaseline !== locales.en.result.bestBaseline);
    // Cost-0 wording: the Payback cell and the per-player lines; a cost above 0 with no gain keeps the dash.
    const free = { id: 'f', player: 'Alpha', desc: 'Ring free', lastStage: '8x300', gain: 20, se: 4, gainPerUser: 10, sePerUser: 2, sharedGainPerUser: 10, sharedSePerUser: 2, buyerNet: 10, buyerNetSe: 2, cost: 0, payback: null, paybackOwn: null, costPath: 'market', accepted: true, ops: [] };
    const paid = { ...free, id: 'p', desc: 'Ring paid', cost: 500, paybackOwn: null };
    const res = { ...result, steps: [free, paid], singles: [free, paid], confirmation: { gainPerUser: 10, sePerUser: 2, cost: 500, runningSpend: { Alpha: 0, Beta: 500 }, buyerByPlayer: { Alpha: { gain: 10, se: 2, payback: null }, Beta: { gain: 30, se: 5, payback: null } } } };
    const out = panel.renderResult(res, t);
    const payOf = (id) => { const tr = out.split('<tr').find((x) => x.includes('Ring ' + id)); return [...tr.matchAll(/<td([^>]*)>([^]*?)<\/td>/g)].map((m) => m[2]); };
    check('cost 0: the Payback cell of a free change says N/A (steps and each alone)', payOf('free')[6] === locales.en.result.noCost && out.split(locales.en.result.noCost).length - 1 >= 2, JSON.stringify(payOf('free')));
    check('cost 0: a cost above 0 with no positive gain keeps the dash', payOf('paid')[6] === '—');
    const cr = bodyRows(confOf(out));
    check('cost 0: the confirmation row of a player who bought nothing says N/A; one who bought keeps the dash', cr.some((r) => r[0] === 'Alpha' && r[2] === locales.en.result.noCost) && cr.some((r) => r[0] === 'Beta' && r[2] === '—'), JSON.stringify(cr));
    check('cost 0: an older confirmation with no running spend keeps the dash', bodyRows(confOf(panel.renderResult({ ...res, confirmation: { ...res.confirmation, runningSpend: undefined } }, t))).some((r) => r[0] === 'Alpha' && r[2] === '—'));
}
// The pick check (sure.mjs): a step's fresh reading is a small second line inside each gain cell; the picks left out sit closed.
{
    const plain = (s) => nums(s).replace(/<[^>]+>/g, '');
    const step ={ id: 's', player: 'Alpha', desc: 'Ring one', lastStage: '8x300', gain: 20, se: 4, gainPerUser: 10, sePerUser: 2, sharedGainPerUser: 10, sharedSePerUser: 2, buyerNet: 30, buyerNetSe: 5, cost: 500, payback: 20, paybackOwn: 20, costPath: 'market', accepted: true, ops: [{ op: 'enhance', player: 'Alpha', slot: 'ring', delta: 1 }], fresh: { seeds: 32, seedFrom: 20001, seedTo: 20032, gain: 18, se: 5, gainPerUser: 9, sePerUser: 2.5, buyerNet: 25, buyerNetSe: 6, accepted: true } };
    const plainStep = { ...step, id: 'p', desc: 'Ring two', fresh: undefined };
    const out = panel.renderResult({ ...result, steps: [step, plainStep], notConfirmed: [] }, t);
    const cells = (name) => { const tr = out.split('<tr').find((x) => x.includes(name)); return [...tr.matchAll(/<td([^>]*)>([^]*?)<\/td>/g)].map((m) => plain(m[2])); };
    const c1 = cells('Ring one'), c2 = cells('Ring two');
    const cellsOf = (r, name) => { const tr = panel.renderResult(r, t).split('<tr').find((x) => x.includes(name)); return [...tr.matchAll(/<td([^>]*)>([^]*?)<\/td>/g)].map((m) => plain(m[2])); };
    check('fresh: a chosen change shows its fresh reading in place of the search reading (party 9 ± 2.5 shows 9 ± 3: the margin takes the decimals of the figure, rounded up; buyer 25 ± 6), and no second line', c1[3] === '9 ± 3' && c1[4] === '25 ± 6' && !out.includes('whatif-fresh') && !out.includes('seeds'), JSON.stringify(c1));
    check('fresh: a step without a reading shows its search reading (10 ± 2, 30 ± 5)', c2[3] === '10 ± 2' && c2[4] === '30 ± 5', JSON.stringify(c2));
    check('fresh: no legend line for a second line that is gone', !('freshLegend' in locales.en.result) && !out.includes('Second line'));
    check('fresh: a fresh gain within one error reads no change (the word replaces the value and its error)', cellsOf({ ...result, steps: [{ ...step, fresh: { ...step.fresh, gainPerUser: 1, sePerUser: 2 } }] }, 'Ring one')[3] === locales.en.result.noChange);
    check('size floor: a figure under basePerUser / 10000 reads no change, however small its error (25 ± 6 against a floor of 100)', cellsOf({ ...result, basePerUser: 1e6, steps: [step] }, 'Ring one')[4] === locales.en.result.noChange && cellsOf({ ...result, basePerUser: 1e6, steps: [step] }, 'Ring one')[3] === locales.en.result.noChange);
    check('size floor: no basePerUser or a negative one gives no floor; a figure over the floor shows its number', cellsOf({ ...result, basePerUser: undefined, steps: [step] }, 'Ring one')[4] === '25 ± 6' && cellsOf({ ...result, basePerUser: -1e6, steps: [step] }, 'Ring one')[4] === '25 ± 6' && cellsOf({ ...result, basePerUser: 100, steps: [step] }, 'Ring one')[4] === '25 ± 6');
    check('fresh: the payback of a chosen change is its cost over the fresh buyer gain (500 / 25 = 20; 500 / 50 = 10); without a positive fresh gain it shows what the row says', cellsOf({ ...result, steps: [step] }, 'Ring one')[6] === '20' && cellsOf({ ...result, steps: [{ ...step, paybackOwn: 99, fresh: { ...step.fresh, buyerNet: 50 } }] }, 'Ring one')[6] === '10' && cellsOf({ ...result, steps: [{ ...step, paybackOwn: 99, fresh: { ...step.fresh, buyerNet: -5 } }] }, 'Ring one')[6] === '99' && cellsOf({ ...result, steps: [{ ...step, cost: 0, paybackOwn: undefined }] }, 'Ring one')[6] === locales.en.result.noCost);
    const nc = { ...step, id: 'n', desc: 'Ring three', step: 2, fresh: { seeds: 64, gainPerUser: 3, sePerUser: 2, buyerNet: 8, buyerNetSe: 5, accepted: false } };
    const h2 = panel.renderResult({ ...result, steps: [step], notConfirmed: [nc, { ...nc, id: 'm', desc: 'Ring four', step: 3 }] }, t);
    const i = h2.indexOf('id="whatIfNotConfirmed"');
    check('not confirmed: a heading with its count and a toggle, the list closed by default and apart from the steps', h2.includes(locales.en.result.notConfirmed) && h2.includes('data-whatif-more="whatIfNotConfirmed"') && /<ul class="small whatif-more" id="whatIfNotConfirmed" hidden>/.test(h2) && h2.includes('Show the 2 not confirmed') && !h2.slice(0, h2.indexOf(locales.en.result.notConfirmed)).includes('Ring three'));
    check('not confirmed: each row has the player, the change, its step, its fresh gain and error (no seed count)', plain(h2.slice(i)).includes("Alpha, Ring three: at step 2, fresh runs: party gain 3 ± 2, buyer's gain 8 ± 5") && !plain(h2.slice(i)).includes('seeds') && plain(h2.slice(i)).includes('Ring four: at step 3'));
    check('not confirmed: an EXP result shows the gain only', plain(panel.renderResult({ ...result, goal: 'exp', steps: [], notConfirmed: [{ ...nc, fresh: { seeds: 16, gainPerUser: 3, sePerUser: 2, accepted: false } }] }, t)).includes('at step 2, fresh runs: gain 3 ± 2'));
    check('not confirmed: an older result (no field) or an empty list shows nothing', !panel.renderResult(result, t).includes(locales.en.result.notConfirmed) && !panel.renderResult({ ...result, notConfirmed: [] }, t).includes(locales.en.result.notConfirmed));
    // Two causes, two labels: a leader refused by the pick check inside the race (inRace) is "left out in the race", never "the fresh runs did not confirm them"; the confirmation's own entries keep the old wording.
    const mixed = panel.renderResult({ ...result, steps: [step], notConfirmed: [{ ...nc, id: 'r1', desc: 'Ring five', inRace: true }, { ...nc, id: 'r2', desc: 'Ring six', inRace: true }, nc] }, t);
    const mi = mixed.indexOf('id="whatIfLeftOut"'), mj = mixed.indexOf('id="whatIfNotConfirmed"');
    check('left out in the race: its own heading, count, note and closed list; the entries that were locked and not confirmed stay in "Not confirmed", counted apart', mi > 0 && mj > 0 && mixed.includes(locales.en.result.leftOut) && plain(mixed).includes('(2 led a race at some point; the pick check on their readings in the race did not confirm them, so they were left out)') && mixed.includes('Show the 2 left out in the race') && mixed.includes('Show the 1 not confirmed') && mixed.slice(mi, mj > mi ? mj : undefined).includes('Ring five') && !mixed.slice(mj).includes('Ring five') && mixed.slice(mj).includes('Ring three') && plain(mixed.slice(mi, mj > mi ? mj : undefined)).includes('at step 2, readings in the race: party gain 3 ± 2'));
    check('left out in the race: the old "fresh runs did not confirm" note is only on the entries that were checked on fresh runs; a result with only race entries has no "Not confirmed" list; EXP shows the gain only', !plain(panel.renderResult({ ...result, steps: [step], notConfirmed: [{ ...nc, inRace: true }] }, t)).includes('fresh runs did not confirm') && !panel.renderResult({ ...result, steps: [step], notConfirmed: [{ ...nc, inRace: true }] }, t).includes('whatIfNotConfirmed') && plain(panel.renderResult({ ...result, goal: 'exp', steps: [], notConfirmed: [{ ...nc, inRace: true, fresh: { seeds: 16, gainPerUser: 3, sePerUser: 2, accepted: false } }] }, t)).includes('at step 2, readings in the race: gain 3 ± 2'));
    // "Chosen changes" with no pick: the one line says why. "No change gains beyond its error" only when every candidate was decided.
    const none = (extra) => panel.renderResult({ ...result, steps: [], confirmation: undefined, endedByUser: undefined, ...extra }, t);
    check('no steps: a screen that ended on the round limit with changes still in the running says so (the rounds and the count, singular too), not "No change gains beyond its error"', plain(none({ endedByCap: { screen: { rounds: 8, left: 5 } } })).includes('The search reached its round limit (8 rounds) with 5 changes still in the running; none was picked.') && plain(none({ endedByCap: { screen: { rounds: 8, left: 1 } } })).includes('with 1 change still in the running') && !none({ endedByCap: { screen: { rounds: 8, left: 5 } } }).includes(locales.en.result.noSteps) && none({ endedByCap: { screen: { rounds: 8, left: 5 } } }).includes('data-no-steps="cap"'));
    check('no steps: ended by the user with no pick says that; a cap on the foods or drinks only, or a cap with nothing left, keeps "No change gains beyond its error"', plain(none({ endedByUser: { screen: 2 } })).includes('You ended the search for changes before it picked one') && !none({ endedByUser: { screen: 2 } }).includes(locales.en.result.noSteps) && none({ endedByCap: { foods: { rounds: 8, left: 4 }, drinks: { rounds: 8, left: 9 } } }).includes(locales.en.result.noSteps) && none({ endedByCap: { screen: { rounds: 8, left: 0 } } }).includes(locales.en.result.noSteps) && none({}).includes(locales.en.result.noSteps) && none({ endedByUser: { foods: 1 } }).includes(locales.en.result.noSteps));
    check('no steps and left out: pt and zh have every new key, with the same placeholders as English', ['noStepsCap', 'noStepsCapOne', 'noStepsUser', 'leftOut', 'leftOutNote', 'leftOutShow', 'leftOutHide', 'leftOutItem', 'leftOutItemExp'].every((k) => ['pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== locales.en.result[k] && (locales.en.result[k].match(/\{\{\w+\}\}/g) || []).every((ph) => locales[l].result[k].includes(ph)))));
    const keys = ['overPayback', 'overPaybackNote', 'overPaybackShow', 'overPaybackHide', 'overPaybackDays', 'overPaybackNever', 'bestGainExp', 'notConfirmed', 'notConfirmedNote', 'notConfirmedShow', 'notConfirmedHide', 'notConfirmedItem', 'notConfirmedItemExp'];
    check('fresh: the pt and zh strings exist for every new key, differ from en and keep the placeholders; no locale string says seeds or sementes', keys.every((k) => ['pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== locales.en.result[k] && (locales[l].result[k].match(/\{\{\w+\}\}/g) || []).sort().join() === (locales.en.result[k].match(/\{\{\w+\}\}/g) || []).sort().join())) && !['en', 'pt', 'zh'].some((l) => Object.entries(locales[l].result).some(([k, v]) => /\{\{seeds\}\}/.test(v) || (k !== 'notConfirmed' && k !== 'fewSeeds' && /\bseeds\b|sementes|种子/.test(v)))));
}
// The live report (his go 2026-11-11: the whole report unfolds as the search goes): the same renderer, with a running mark; a partial
// result with only the foods, then with steps, then the final one. The foods and drinks carry their own fresh line.
{
    const plain = (s) => nums(s).replace(/<[^>]+>/g, '');
    const fresh = { seeds: 32, gainPerUser: 12, sePerUser: 3.5, buyerNet: 41, buyerNetSe: 6.5, accepted: true };
    const foods = { Alpha: { items: [{ item: '/items/donut', trigger: null }], gain: 22, se: 6, gainPerUser: 11, sePerUser: 3, buyerNet: 40, buyerNetSe: 6, ownSuppliesPerDay: -29, stage: '8x300', fresh }, Beta: { items: [{ item: '/items/cake', trigger: null }], unchanged: true } };
    const live0 = { goal: 'profit', budgets: { Alpha: 100 }, setups: [], options: { zone: '/actions/combat/fly', tier: 0 }, best: { foods, drinks: {} }, steps: [], singles: [{ id: 'hf', player: 'Alpha', desc: 'Alpha food', hiddenFood: true }], notConfirmed: [] };
    const h0 = panel.renderResult(live0, t, undefined, null, true);
    check('live: the running mark shows, with only the foods the foods group shows and nothing else of the table', h0.includes(locales.en.result.running) && h0.includes(locales.en.result.bestFoods) && !h0.includes(locales.en.result.bestDrinks) && tablesOf(h0).length === 0 && !h0.includes('data-best="drinks"'));
    check('live: no "no steps" and no "no singles" message and no steps heading while running; the baseline line waits for both groups', !h0.includes(locales.en.result.noSteps) && !h0.includes(locales.en.result.noSingles) && !h0.includes(locales.en.result.steps) && !h0.includes(locales.en.result.singles) && !h0.includes(locales.en.result.bestBaseline));
    check('live: no totals line while running (the confirmation is not in a snapshot)', !h0.includes('data-confirm="players"'));
    check('live: the foods line shows the filling\'s fresh reading in place of the search one (party 12 ± 3.5 shows 12 ± 4, buyer 41 ± 6.5 shows 41 ± 7: rounded up), no second line and no seeds; an unchanged player has none', JSON.stringify(bodyRows(bestOf(h0, 'foods'))[0].slice(0, 4)) === JSON.stringify(['Alpha', 'donut', '12 ± 4', '41 ± 7']) && !h0.includes('whatif-fresh') && !plain(h0).includes('seeds'));
    const old = JSON.parse(JSON.stringify(live0)); delete old.best.foods.Alpha.fresh;
    check('live: a filling with no fresh reading (an older result) shows its search reading (11 ± 3, 40 ± 6)', JSON.stringify(bodyRows(bestOf(panel.renderResult(old, t, undefined, null, true), 'foods'))[0].slice(0, 4)) === JSON.stringify(['Alpha', 'donut', '11 ± 3', '40 ± 6']));
    const step = { id: 's', player: 'Alpha', desc: 'Ring one', lastStage: '8x300', gain: 20, se: 4, gainPerUser: 10, sePerUser: 2, sharedGainPerUser: 10, sharedSePerUser: 2, buyerNet: 30, buyerNetSe: 5, ownSuppliesPerDay: -20, cost: 100, payback: 3, paybackOwn: 3, costPath: 'market', accepted: true, ops: [], fresh };
    const live1 = { ...live0, best: { foods, drinks: { Alpha: { items: [{ item: '/items/attack_coffee' }], unchanged: true } } }, steps: [step], singles: [...live0.singles, { ...step, id: 'x', fresh: undefined }] };
    const h1 = panel.renderResult(live1, t, undefined, null, true);
    check('live: with steps the heading reads so far, the steps table and the each-change table draw, still no totals and no no-steps message', h1.includes(locales.en.result.steps + ' <span') && plain(h1).includes('· ' + locales.en.result.soFar) && tablesOf(h1).length === 2 && !h1.includes('data-confirm="players"') && !h1.includes(locales.en.result.noSteps) && h1.includes(locales.en.result.bestBaseline));
    const done = panel.renderResult({ ...live1, confirmation: { gain: 20, se: 4, gainPerUser: 10, sePerUser: 2, cost: 100, payback: 3, buyerByPlayer: { Alpha: { gain: 30, se: 5, payback: 3 } } } }, t);
    check('live: the final report has no running mark and no so far, and the totals', !done.includes(locales.en.result.running) && !done.includes(locales.en.result.soFar) && !!confOf(done));
    check('live: a stopped search keeps what it got, marked as stopped', panel.renderResult(live1, t, undefined, null, 'stopped').includes(locales.en.result.stoppedMark) && !panel.renderResult(live1, t, undefined, null, 'stopped').includes(locales.en.result.running));
    check('live: a finished result with no steps still says so, and an EXP food line shows the party fresh gain only (no seeds)', panel.renderResult({ ...live0, best: undefined }, t).includes(locales.en.result.noSteps) && JSON.stringify(bodyRows(bestOf(panel.renderResult({ ...live0, goal: 'exp', best: { foods: { Alpha: { items: [{ item: '/items/donut' }], gain: 5, se: 1, gainPerUser: 5, sePerUser: 1, stage: '8x300', fresh: { seeds: 16, gainPerUser: 4, sePerUser: 1 } } }, drinks: {} } }, t, undefined, null, true), 'foods'))[0].slice(0, 4)) === JSON.stringify(['Alpha', 'donut', '4 ± 1', '—']));
    // Not confirmed: a filling left out says where.
    const nc = (kind, step) => ({ id: 'n' + kind, player: 'Alpha', desc: 'Alpha ' + kind + ' filling', kind, step, fresh: { seeds: 16, gainPerUser: 9, sePerUser: 2, buyerNet: 3, buyerNetSe: 4, accepted: false } });
    const h = plain(panel.renderResult({ ...live1, notConfirmed: [nc('food', null), nc('drink', null), { ...nc(undefined, 4), kind: undefined }] }, t));
    check('not confirmed: a filling is listed as left out in the foods or the drinks, a pick as at its step', h.includes('Alpha, food filling: in the foods, fresh runs: party gain 9 ± 2') && h.includes('Alpha, drink filling: in the drinks, fresh runs') && h.includes('at step 4, fresh runs'));
    check('live: the pt and zh strings exist for every new key and keep the placeholders', ['running', 'stoppedMark', 'soFar', 'notConfirmedAtStep', 'notConfirmedAtFood', 'notConfirmedAtDrink', 'notConfirmedItem'].every((k) => ['pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k] !== locales.en.result[k] && (locales.en.result[k].match(/\{\{\w+\}\}/g) || []).every((ph) => locales[l].result[k].includes(ph)))));
    check('live: the status URL carries the version the window has, none at 0', panel.API.status('a b', 0) === '/api/search/a%20b' && panel.API.status('x', 7) === '/api/search/x?since=7');
}
// The payback limit (his picks 2026-11-11): the list of changes left out for paying back too slowly, closed by default after the
// over-budget list, in the one list renderer; and the field in the request.
{
    const plain = (s) => nums(s).replace(/<[^>]+>/g, '');
    const slow = { id: 'sl', player: 'Alpha', desc: 'Ring nine', cost: 90000, costPath: 'market', paybackDays: 612, accepted: true, ops: [] };
    const res = { ...result, options: { ...(result.options || {}), maxPaybackDays: 365 }, overBudget: [{ id: 'ob', player: 'Alpha', desc: 'Ring eight', cost: 5e9, costPath: 'market' }], overPayback: [slow, { ...slow, id: 'sl2', desc: 'Ring ten', paybackDays: null }] };
    const h = panel.renderResult(res, t), j = h.indexOf('id="whatIfOverPayback"');
    check('over payback: a heading with the note (count and days from the options), a Show link, the list closed by default', h.includes('Pays back too slowly') && plain(h).includes('(2, not chosen: each pays back in more than 365 days)') && h.includes('data-whatif-more="whatIfOverPayback"') && h.includes('data-show="Show the 2 that pay back too slowly"') && h.includes('data-hide="Hide the 2 that pay back too slowly"') && /<ul class="small whatif-more" id="whatIfOverPayback" hidden>/.test(h));
    check('over payback: each item has the player, the change, its cost and its days (or that nothing pays it back)', plain(h.slice(j)).includes('Alpha, Ring nine: 90000, pays back in 612 days') && plain(h.slice(j)).includes('Alpha, Ring ten: 90000, no gain to pay it back'), plain(h.slice(j, j + 400)));
    check('over payback: the list sits after "Priced, over budget"; none without the field (an older result) or with an empty list', h.indexOf('id="whatIfOverBudget"') > 0 && h.indexOf('id="whatIfOverBudget"') < j && !panel.renderResult({ ...res, overPayback: undefined }, t).includes('whatIfOverPayback') && !panel.renderResult({ ...res, overPayback: [] }, t).includes('whatIfOverPayback'));
    const body = (maxPayback) => panel.searchBody({ slots: [{ id: '1', name: 'Alpha', json: '{}' }], goal: 'profit', budgets: { Alpha: 1 }, levers: ['equip'], maxPayback });
    check('request: the payback limit goes in the body as a number (0 = no limit), and is left out when the window sends none', body('365').maxPayback === 365 && body(0).maxPayback === 0 && body('0').maxPayback === 0 && !('maxPayback' in body(undefined)) && !('maxPayback' in body('')));
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
