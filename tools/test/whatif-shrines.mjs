// Test: the what-if levers for an item in an empty slot and for the guild shrines, on a generic party (no real player).
// (1) The swap pricing with no old item. (2) The optimizer (tools/whatif/optimize.mjs) with every budget at 0, so every paid
// change is priced and listed over budget and no run is made: the empty slots offer market items at +0 for their buy price
// through the swap loop; the weapon slots stay closed while a two-hand weapon is held.
// Usage: node tools/test/whatif-shrines.mjs [--skip-optimizer]       Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const R = await imp('tools/whatif/runner/server.mjs');
const { makePricer } = await imp('tools/whatif/prices.mjs');
const PRICES = 'marketplace-2026-11-03.json';
const market = JSON.parse(fs.readFileSync(path.join(root, 'tools/calibration', PRICES), 'utf8')).marketData;
const ask = (h, l = 0) => market[h]?.[String(l)]?.a;
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shrines-'));

// ---- (1) The swap pricing with no old item ----
const pricer = makePricer(market);
const helm = '/items/cheese_helmet';
const empty = pricer.swap(null, 0, helm, 0);
check('pricing: an empty slot costs the buy price, nothing sold', empty.known && empty.cost === ask(helm) && empty.path === 'buy' && !/no buyer/.test(empty.note || ''), JSON.stringify(empty));
check('pricing: a swap from an item still sells the old one', /sell old/.test(pricer.swap('/items/cheese_sword', 0, '/items/cheese_spear', 0).path));

// ---- (2) The optimizer ----
if (process.argv.includes('--skip-optimizer')) { fs.rmSync(tmp, { recursive: true, force: true }); console.log(failed ? `${failed} failed (optimizer parts skipped)` : 'all passed (optimizer parts skipped)'); process.exit(failed ? 1 : 0); }
const generic = (name, equipment, extra = {}) => ({
    name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: equipment.map(([slot, itemHrid]) => ({ itemLocationHrid: '/item_locations/' + slot, itemHrid, enhancementLevel: 0 })) },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] }, ...extra,
});
const party = [generic('Alpha', [['main_hand', '/items/cheese_sword'], ['head', helm]]), generic('Beta', [['two_hand', '/items/wooden_bow']])];
const run = (name, body) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    const a = R.buildArgs({ setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, prices: PRICES }, goal: 'profit', budgets: { Alpha: 0, Beta: 0 },
        unitHours: 1, confirmHours: 1, maxRounds: 1, maxSteps: 1, z: 0, ...body }, d).filter((x) => x !== '--low-priority');
    try { execFileSync(process.execPath, [path.join(root, 'tools/whatif/optimize.mjs'), ...a], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 600) }; }
    return { res: JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')) };
};
const eq = run('equip', { levers: ['equip'] });
check('optimizer, equip lever: no throw', !eq.error, eq.error);
if (eq.res) {
    const over = eq.res.overBudget;
    const feet = over.filter((c) => c.id.startsWith('Alpha:feet='));
    check('empty slot: Alpha\'s empty feet slot offers market feet items, as "empty -> <item> +0"', feet.length > 0 && feet.every((c) => / feet empty -> \S+ \+0$/.test(c.desc)), JSON.stringify(feet.slice(0, 3)));
    check('empty slot: each costs the item\'s +0 buy price, bought only', feet.every((c) => c.cost === ask('/items/' + c.id.split('=')[1].replace(/\+0$/, '')) && c.costPath === 'buy'), JSON.stringify(feet.slice(0, 3)));
    check('empty slot: only +0 is offered for an empty slot', over.filter((c) => / empty -> /.test(c.desc)).every((c) => c.id.endsWith('+0')));
    check('empty slot: Alpha (one-hand weapon) gets off-hand items, never a two-hand weapon', over.some((c) => c.id.startsWith('Alpha:off_hand=')) && !over.some((c) => c.id.startsWith('Alpha:two_hand=')));
    check('empty slot: Beta (two-hand weapon) gets no main-hand or off-hand item', !over.some((c) => /^Beta:(main_hand|off_hand)=/.test(c.id)));
    check('empty slot: a filled slot keeps its swaps and upgrades', over.some((c) => c.id === 'Alpha:head+1') && over.some((c) => c.id.startsWith('Alpha:head=') && / head cheese_helmet \+0 -> /.test(c.desc)));
}
// The owned items of an empty slot's type, with Items you own on (free: they join the race, so one short round runs).
const own = run('owned', { levers: ['owned'], export: { Alpha: { name: 'Alpha', inventory: [{ itemHrid: '/items/cheese_boots', enhancementLevel: 2, count: 1 }], learnedAbilities: [] } } });
check('optimizer, owned lever: no throw', !own.error, own.error);
if (own.res) check('empty slot: an owned item of the slot\'s type is offered at its own level', own.res.candidateList.some((c) => c.id === 'Alpha:feet=own:cheese_boots+2' && / feet empty -> owned cheese_boots \+2$/.test(c.desc) && c.cost === 0), JSON.stringify(own.res.candidateList));
// The window's word for an empty slot follows the shown language.
const panel = await imp('src/whatif/panel.mjs');
check('window: "empty" in a change reads in the shown language', panel.localizeDesc('Alpha feet empty -> cheese_boots +0', panel.namesFrom({ itemNames: { '/items/cheese_boots': '奶酪靴' } }, undefined, { empty: '空' }), ['Alpha']) === 'Alpha feet 空 -> 奶酪靴 +0');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
