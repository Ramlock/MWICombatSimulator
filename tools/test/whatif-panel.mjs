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
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locales = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(read(`locales/${l}/common.json`)).whatIf]));

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const lookup = (o, key) => key.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const used = new Set();
const t = (key, params = {}) => { used.add(key); const s = lookup(locales.en, key); return typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k])) : '#' + key; };

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
    check('result: per-user gain and error are shown, not the party figures', html.includes('data-num="1500"') && html.includes('data-num="300"') && !html.includes('data-num="3000"'));
    check('result: "≤" on an upper-bound cost and its payback', /≤ <span data-num="400000"/.test(html) && /≤ <span data-num="200"/.test(html));
    check('result: "≤" on that player\'s running spend from that step on, not before or for others', /≤ <span data-num="600000"/.test(html) && !/≤ <span data-num="1000000"/.test(html));
    check('result: Apply on each step, "Apply 1 to n" from step 2', html.includes('data-whatif-apply="steps:1"') && html.includes('Apply 1 to 3') && html.includes('data-whatif-apply="steps:3"'));
    check('result: a single below 2 errors is grey', /<tr class="whatif-weak"><td>Alpha<\/td><td>Food 2/.test(html));
    check('result: grey singles sit collapsed in a hidden body behind one toggle with their count', /<tbody class="whatif-more" id="whatIfMoreSingles" hidden><tr class="whatif-weak"><td>Alpha<\/td><td>Food 2/.test(html) &&
        !/<tbody><tr[^]*Food 2[^]*<\/tbody><tbody class="whatif-more"/.test(html) && (html.match(/data-whatif-more="whatIfMoreSingles"/g) || []).length === 1);
    check('result: the cost path cell wraps', /<td class="wrap">market<\/td>/.test(html));
    check('result: unknown costs listed apart', html.includes('Some token item: no seller'));
    check('result: confirmation per user', html.includes('data-num="2900"') && html.includes('data-num="450"'));
    check('result: each player spent of budget', html.includes('data-num="50000000"') && html.includes('data-num="20000000"'));
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
    check('opsFor: steps 1..n in order', JSON.stringify(panel.opsFor(result, 'steps:2')) === JSON.stringify([...result.steps[0].ops, ...result.steps[1].ops]));
    check('opsFor: one single', panel.opsFor(result, 'single:1')[0].op === 'food');
    const all = panel.applyToSlots(slots, panel.opsFor(result, 'steps:3'));
    const a = JSON.parse(all.slots['1']), b = JSON.parse(all.slots['2']);
    check('apply 1 to 3 writes every step', a.player.equipment[0].enhancementLevel === 6 && b.abilities[1].level === 31 && b.houseRooms['/house_rooms/gym'] === 1);
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
        leadHtml.includes('<td>Alpha</td><td>Feet Pathseeker Boots ★ +12') && !leadHtml.includes('Alpha Feet') && leadHtml.includes('<li>Alpha, Feet Pathseeker Boots ★ +12') && leadHtml.includes('<li>Beta, Poke 5 -&gt; 6'), leadHtml.slice(0, 300));
    check('player lead: the unknown-cost list has no player column, so its lead stays', leadHtml.includes('Beta ability 2 empty -&gt; learn Fireball 30: no seller'));
    check('player lead: without names the lead is dropped too, and the ops are untouched', panel.renderResult(lead, t).includes('<td>Alpha</td><td>feet pathseeker_boots_refined') && JSON.stringify(lead.steps[0].ops) === JSON.stringify(result.steps[0].ops));

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
    check('skipped swaps: the group sits after the over-budget list and before the unknown-cost list', domEn.indexOf(locales.en.result.overBudget) < domEn.indexOf('swaps skipped') && domEn.indexOf('swaps skipped') < domEn.indexOf(locales.en.result.apart));

    // The over-budget list folds.
    const ob = h('en');
    check('over budget: the heading keeps its count, the list is closed behind one toggle', ob.includes(locales.en.result.overBudget) && ob.includes('(2, not ranked') &&
        /<button[^>]*data-whatif-more="whatIfOverBudget"[^>]*>Show the 2 priced over budget<\/button>/.test(ob) && /<ul class="small whatif-more" id="whatIfOverBudget" hidden>/.test(ob));
    check('over budget: the toggle carries its open and closed text and targets its own list, apart from the singles\' toggle',
        ob.includes('data-show="Show the 2 priced over budget"') && ob.includes('data-hide="Hide the 2 priced over budget"') && ob.includes('data-whatif-more="whatIfMoreSingles"') && ob.includes('id="whatIfMoreSingles"'));
    check('over budget: the strings exist in en, pt and zh', ['overBudgetShow', 'overBudgetHide'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof locales[l].result[k] === 'string' && locales[l].result[k].includes('{{n}}'))));
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
