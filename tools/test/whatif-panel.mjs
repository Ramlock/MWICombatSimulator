// Test: the What-if window's logic (src/whatif/panel.mjs) and its strings. The window shows the result's own fields
// (per-user gain and error, cost with "≤" for an upper bound, payback, running spend), applies a row's ops to the page's
// slots (naming a player the page lacks instead of applying), lists where the page's setup differs from the search's,
// and every string it uses exists in English, Portuguese and Chinese.
// Usage: node tools/test/whatif-panel.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const panel = await imp('src/whatif/panel.mjs');
const { applyOps } = await imp('src/whatif/applyOps.mjs');
const variants = await imp('tools/whatif/variants.mjs');
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
};

{
    const html = panel.renderResult(result, t);
    check('result: per-user gain and error are shown, not the party figures', html.includes('data-num="1500"') && html.includes('data-num="300"') && !html.includes('data-num="3000"'));
    check('result: "≤" on an upper-bound cost and its payback', /≤ <span data-num="400000"/.test(html) && /≤ <span data-num="200"/.test(html));
    check('result: "≤" on that player\'s running spend from that step on, not before or for others', /≤ <span data-num="600000"/.test(html) && !/≤ <span data-num="1000000"/.test(html));
    check('result: Apply on each step, "Apply 1 to n" from step 2', html.includes('data-whatif-apply="steps:1"') && html.includes('Apply 1 to 3') && html.includes('data-whatif-apply="steps:3"'));
    check('result: a single below 2 errors is grey', /<tr class="whatif-weak"><td>Alpha<\/td><td>Food 2/.test(html));
    check('result: grey singles sit collapsed in a hidden body behind one toggle with their count', /<tbody class="whatif-more" hidden><tr class="whatif-weak"><td>Alpha<\/td><td>Food 2/.test(html) &&
        !/<tbody><tr[^]*Food 2[^]*<\/tbody><tbody class="whatif-more"/.test(html) && (html.match(/data-whatif-more/g) || []).length === 1);
    check('result: the cost path cell wraps', /<td class="wrap">market<\/td>/.test(html));
    check('result: unknown costs listed apart', html.includes('Some token item: no seller'));
    check('result: confirmation per user', html.includes('data-num="2900"') && html.includes('data-num="450"'));
    check('result: each player spent of budget', html.includes('data-num="50000000"') && html.includes('data-num="20000000"'));
    check('result: text is escaped', html.includes('&lt;books&gt;') && !html.includes('<books>'));
    check('result: no payback shows a dash, never NaN', !html.includes('NaN') && !html.includes('undefined'));
    check('result: the upper-bound note is shown', html.includes(locales.en.result.upperNote.slice(0, 20)));
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
    check('progress: bar at runs done of planned', html.includes('width: 25%'));
    check('progress: an error shows its text', panel.renderProgress({ state: 'error', progress: {}, error: 'bad <x>' }, t).includes('bad &lt;x&gt;'));
}

// Strings: every key the window uses (rendered above, plus main.js and index.html) exists in en, pt and zh.
for (const m of read('src/main.js').matchAll(/whatIfT\('([\w.]+)'[,)]/g)) used.add(m[1]);
for (const m of read('index.html').matchAll(/data-i18n="common:whatIf\.([\w.]+)"/g)) used.add(m[1]);
for (const l of panel.LEVERS) { used.add('lever.' + l.id + '.name'); used.add('lever.' + l.id + '.desc'); }
for (const s of ['running', 'stopped', 'done', 'error']) used.add('state.' + s);
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

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
