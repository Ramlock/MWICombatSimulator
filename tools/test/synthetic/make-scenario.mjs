// Writes tools/test/synthetic/scenario.json: a small synthetic party (generic names), a generic price snapshot and about twenty paid changes plus the
// foods and drinks fillings the core builds from them, each with a known true gain, cost and noise (tools/whatif/synthetic.mjs describes the file).
// Usage: node tools/test/synthetic/make-scenario.mjs [--print-ids]. The numbers are made up; no real name, price or Coin figure is in it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const NAMES = ['Alice', 'Bob', 'Cara'], TIER = { Alice: 'crimson', Bob: 'rainbow', Cara: 'burble' };
const SLOTS = { head: 'helmet', body: 'plate_body', legs: 'plate_legs' };
const L0 = 4, BID0 = 1_000_000, TAX = 0.04; // every worn piece is +4 and sells (bid) at 1M

const setup = (name) => ({
    name, zone: '/actions/combat/fly', simulationTime: 24,
    player: {
        attackLevel: 70, magicLevel: 1, meleeLevel: 70, rangedLevel: 1, defenseLevel: 70, staminaLevel: 70, intelligenceLevel: 70,
        equipment: [
            { itemLocationHrid: '/item_locations/main_hand', itemHrid: `/items/${TIER[name]}_sword`, enhancementLevel: 5 },
            { itemLocationHrid: '/item_locations/head', itemHrid: `/items/${TIER[name]}_helmet`, enhancementLevel: L0 },
            { itemLocationHrid: '/item_locations/body', itemHrid: `/items/${TIER[name]}_plate_body`, enhancementLevel: L0 },
            { itemLocationHrid: '/item_locations/legs', itemHrid: `/items/${TIER[name]}_plate_legs`, enhancementLevel: L0 },
            { itemLocationHrid: '/item_locations/pouch', itemHrid: '/items/large_pouch', enhancementLevel: 0 },
        ],
    },
    food: { '/action_types/combat': [{ itemHrid: '/items/blueberry_donut' }, { itemHrid: '/items/apple_gummy' }, { itemHrid: '/items/blueberry_cake' }] },
    drinks: { '/action_types/combat': [{ itemHrid: '/items/melee_coffee' }, { itemHrid: '/items/lucky_coffee' }] },
    abilities: [{ abilityHrid: '/abilities/poke', level: 10 }],
    triggerMap: {}, houseRooms: {}, achievements: {}, guildCombatBuffLevels: { force: 0, tempo: 0, spirit: 0, rarity: 0, scholar: 0 },
});

// Gold cost to go from +4 to +4+d, by player and slot, and the loot gain (party, per day) it truly has. cost = ask(+4+d) - bid(+4) after tax.
// Cases: see CASES below.
const ENH = {
    // Alice: a clear winner (body +2: pays back in 20 days), a slow one (body +1), a change under the 1% bar (head +1, +2), a paid change that fails the payback limit (head +3)
    'Alice:body+1': { cost: 700_000, loot: 40_000 }, 'Alice:body+2': { cost: 1_000_000, loot: 150_000 }, 'Alice:body+3': { cost: 6_000_000, loot: 160_000 },
    'Alice:head+1': { cost: 200_000, loot: 9_000 }, 'Alice:head+2': { cost: 900_000, loot: 10_000 }, 'Alice:head+3': { cost: 9_000_000, loot: 60_000 },
    // legs: losers
    'Alice:legs+1': { cost: 300_000, loot: -45_000 }, 'Alice:legs+2': { cost: 900_000, loot: -45_000 }, 'Alice:legs+3': { cost: 4_000_000, loot: -30_000 },
    // Bob: a tied pair (head +1 and head +2 gain the same), a pick that looks good on the search seeds and fails on fresh ones (body +2), the rest small
    'Bob:head+1': { cost: 500_000, loot: 70_000 }, 'Bob:head+2': { cost: 560_000, loot: 70_000 }, 'Bob:head+3': { cost: 6_000_000, loot: 75_000 },
    'Bob:body+1': { cost: 600_000, loot: 20_000 }, 'Bob:body+2': { cost: 800_000, loot: -10_000, searchBonus: 140_000 }, 'Bob:body+3': { cost: 5_000_000, loot: 12_000 },
    'Bob:legs+1': { cost: 400_000, loot: 8_000 }, 'Bob:legs+2': { cost: 1_100_000, loot: 11_000 }, 'Bob:legs+3': { cost: 5_000_000, loot: 14_000 },
    // Cara: a player whose profit is zero or below (her supplies are above her share of the loot): one paying change, the rest do nothing
    'Cara:body+2': { cost: 1_000_000, loot: 90_000 }, 'Cara:head+1': { cost: 300_000, loot: 3_000 }, 'Cara:head+2': { cost: 700_000, loot: 2_000 }, 'Cara:head+3': { cost: 3_000_000, loot: 4_000 },
    'Cara:body+1': { cost: 500_000, loot: 6_000 }, 'Cara:body+3': { cost: 4_000_000, loot: 10_000 }, 'Cara:legs+1': { cost: 400_000, loot: 1_000 }, 'Cara:legs+2': { cost: 800_000, loot: 0 }, 'Cara:legs+3': { cost: 3_000_000, loot: 1_000 },
};

const FOODS = { 'blueberry_donut': 900, 'strawberry_donut': 2200, 'blueberry_cake': 1100, 'strawberry_cake': 2500, 'apple_gummy': 800, 'orange_gummy': 1900, 'apple_yogurt': 1000, 'orange_yogurt': 2300 };
const DRINKS = { 'melee_coffee': 600, 'super_melee_coffee': 1800, 'ultra_melee_coffee': 4500, 'lucky_coffee': 700, 'swiftness_coffee': 900, 'critical_coffee': 800, 'wisdom_coffee': 700, 'stamina_coffee': 650, 'defense_coffee': 650, 'attack_coffee': 640 };

function market() {
    const m = { '/items/philosophers_mirror': { 0: { a: 625_000_000, b: 617_500_000 } } };
    const put = (h, lvl, a, b) => { (m[h] ??= {})[String(lvl)] = { a, b, p: a, v: 100 }; };
    for (const n of NAMES) for (const [slot, piece] of Object.entries(SLOTS)) {
        const h = `/items/${TIER[n]}_${piece}`;
        put(h, L0, 0, BID0);
        for (let d = 1; d <= 3; d++) { const e = ENH[`${n}:${slot}+${d}`]; put(h, L0 + d, Math.round(e.cost + BID0 * (1 - TAX)), 0); }
    }
    for (const [f, a] of Object.entries(FOODS)) put(`/items/${f}`, 0, a, Math.round(a * 0.9));
    for (const [d, a] of Object.entries(DRINKS)) put(`/items/${d}`, 0, a, Math.round(a * 0.9));
    return m;
}

// Foods and drinks: an op that puts this item in a slot. Alice's best foods are the strawberry cake and the orange gummy (the cake carries it), Bob's the strawberry donut.
const item = (n) => `/items/${n}`;
const CONS = [
    { match: { op: 'food', player: 'Alice', item: item('strawberry_cake') }, loot: 25_000, supplies: -9_000 },
    { match: { op: 'food', player: 'Alice', item: item('orange_gummy') }, loot: 12_000, supplies: -4_000 },
    { match: { op: 'food', player: 'Bob', item: item('strawberry_donut') }, loot: 30_000, supplies: -6_000 },
    { match: { op: 'food', player: 'Bob', item: item('strawberry_cake') }, loot: 28_000, supplies: -6_000 },
    { match: { op: 'food', player: 'Cara' }, loot: -20_000, supplies: 5_000 },
    { match: { op: 'drink', player: 'Alice', item: item('super_melee_coffee') }, loot: 55_000, supplies: 3_000 },
    { match: { op: 'drink', player: 'Alice', item: item('swiftness_coffee') }, loot: 30_000, supplies: 1_000 },
    { match: { op: 'drink', player: 'Bob', item: item('swiftness_coffee') }, loot: 40_000, supplies: 1_000 },
    { match: { op: 'drink', player: 'Cara' }, loot: -15_000, supplies: 2_000 },
];

const effects = [
    ...Object.entries(ENH).map(([id, e]) => { const [player, rest] = id.split(':'); const [slot, delta] = rest.split('+'); return { match: { op: 'enhance', player, slot, delta: Number(delta) }, loot: e.loot, ...(e.searchBonus ? { searchBonus: e.searchBonus } : {}), note: id }; }),
    ...CONS,
];

const scenario = {
    name: 'synthetic-3-player',
    description: 'Three generic melee players, +4 gear on head, body and legs, a generic price snapshot; every change the core builds has a known true gain (effects). Cara spends more than her share of the loot (profit below zero).',
    players: NAMES.map(setup),
    market: { marketData: market(), timestamp: 1_800_000_000 },
    budgets: Object.fromEntries(NAMES.map((n) => [n, 1_000_000_000])),
    request: { goal: 'profit', levers: ['equip', 'consumables'], slots: 'head,body,legs', swaps: false, 'max-up': 3, 'max-payback': 365, 'max-steps': 4 },
    model: {
        lootPerDay: 3_000_000, lootSd50: 15_000, supplies: { Alice: 150_000, Bob: 200_000, Cara: 1_200_000 }, suppliesSd50: 3_000,
        need: { Alice: { hp: 8000, mp: 4000 }, Bob: { hp: 8000, mp: 4000 }, Cara: { hp: 8000, mp: 4000 } }, noiseSalt: 'e', deathsPerHour: 0.1, encountersPerHour: 120, expPerHour: 1_000_000, msPerRun: 300,
    },
    effects,
};
writeFileSync(path.join(here, 'scenario.json'), JSON.stringify(scenario, null, 1) + '\n');
console.log('wrote', path.join(here, 'scenario.json'), 'effects', effects.length);
