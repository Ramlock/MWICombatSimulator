// Test: the what-if consumable candidates keep the game's one-per-type rule (tools/whatif/consumables.mjs), and the
// tier pairs change two slots within their own types. Generic loadout, no private data.
// Usage: node tools/test/whatif-consumable-types.mjs        Exit code 0 on pass, 1 on fail.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumableType, legalIn, swapCands, tierPairCands } from '../whatif/consumables.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const typeOf = (h) => consumableType(items[h]);
const combat = (it) => it.consumableDetail?.usableInActionTypeMap?.['/action_types/combat'];
const FOODS = Object.values(items).filter((it) => it.categoryHrid === '/item_categories/food' && combat(it)).map((it) => it.hrid);
const DRINKS = Object.values(items).filter((it) => it.categoryHrid === '/item_categories/drink' && combat(it)).map((it) => it.hrid);

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// Types from the data: four food types, named as the game names them.
const foodTypes = new Map();
for (const h of FOODS) (foodTypes.get(typeOf(h)) || foodTypes.set(typeOf(h), []).get(typeOf(h))).push(h);
check(foodTypes.size === 4, `four food types (got ${[...foodTypes.keys()].join(', ')})`);
const suffix = { 'food:hp:instant': /donut$/, 'food:hp:over_time': /(cake|cupcake)$/, 'food:mp:instant': /gummy$/, 'food:mp:over_time': /yogurt$/ };
for (const [t, hs] of foodTypes) check(suffix[t] && hs.every((h) => suffix[t].test(h)), `${t} holds only ${suffix[t]} items`);
check(typeOf('/items/attack_coffee') === typeOf('/items/ultra_attack_coffee'), 'attack coffee tiers share a type');
check(typeOf('/items/attack_coffee') !== typeOf('/items/magic_coffee'), 'attack and magic coffee differ');

// The bug this rule fixes: with a gummy in food 2, food 3 must not get another gummy.
const food = ['/items/spaceberry_donut', '/items/star_fruit_gummy', '/items/star_fruit_yogurt'];
const singles = swapCands('P', 'food', food, 3, FOODS, typeOf);
check(!singles.some((c) => c.id === 'P:food2=orange_gummy'), 'no orange_gummy in food 3 beside a star_fruit_gummy');
check(!singles.some((c) => c.id === 'P:food1=dragon_fruit_yogurt'), 'no yogurt in food 2 beside a star_fruit_yogurt');
check(singles.some((c) => c.id === 'P:food1=orange_gummy'), 'food 2 may drop to a lower gummy');
check(singles.some((c) => c.id === 'P:food2=spaceberry_cake'), 'food 3 may take a cake (no cake slotted)');
for (const c of singles) {
    const list = [...food];
    for (const o of c.ops) list[o.index] = o.item;
    const types = list.filter(Boolean).map(typeOf);
    if (new Set(types).size !== types.length) check(false, `${c.id} leaves two of one type`);
}
check(singles.filter((c) => c.ops[0].item === null).length === 3, 'each filled food slot can be emptied');

const drinks = ['/items/ultra_magic_coffee', '/items/channeling_coffee', '/items/lucky_coffee'];
const dSingles = swapCands('P', 'drink', drinks, 3, DRINKS, typeOf);
check(!dSingles.some((c) => c.id === 'P:drink1=magic_coffee'), 'no second magic coffee in drink 2');
check(dSingles.some((c) => c.id === 'P:drink0=super_magic_coffee'), 'drink 1 may change its magic coffee tier');
check(legalIn([null, '/items/orange_gummy', null], 0, '/items/apple_gummy', typeOf) === false, 'legalIn sees another slot');

// Tier pairs: both slots change, each stays in its type.
const pairs = tierPairCands('P', 'food', food, 3, FOODS, typeOf);
check(pairs.some((c) => c.id === 'P:food1+food2=dragon_fruit_gummy+dragon_fruit_yogurt'), 'pair: both MP foods one tier down');
check(pairs.length === 3 * 6 * 6, `pairs: 3 slot pairs x 6 x 6 tiers (got ${pairs.length})`);
check(pairs.every((c) => c.ops.every((o) => typeOf(o.item) === typeOf(food[o.index]) && o.item !== food[o.index])), 'every pair keeps both types and changes both slots');
check(tierPairCands('P', 'drink', drinks, 3, DRINKS, typeOf).length === 0, 'no drink pairs when only one slot has tiers');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
