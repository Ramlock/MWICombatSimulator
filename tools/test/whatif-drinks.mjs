// Test: the drink filling of the what-if search (tools/whatif/drinkfill.mjs): the combat style from the weapon, the pruning
// rules a to d with their counts on the repo's price file, the fillings (one drink of each of nSlots types, the baseline
// filling left out, placement into slots, op shape), and that a drink put in a slot takes its own item's triggers, never the
// replaced drink's (engine: triggers are keyed by item). Invented players; no private data.
// Usage: node tools/test/whatif-drinks.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href); // registers the loader hooks
const D = await import(pathToFileURL(path.join(root, 'tools/whatif/drinkfill.mjs')).href);
const { applyOps } = await import(pathToFileURL(path.join(root, 'src/whatif/applyOps.mjs')).href);
const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const market = JSON.parse(readFileSync(path.join(root, 'tools/calibration/marketplace-2026-11-03.json'), 'utf8')).marketData;

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const short = (h) => h.split('/').pop();
const I = (n) => '/items/' + n;
const gen = (weapon, drinks, extra = {}) => ({
    name: 'P', guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
        ...(weapon ? [{ itemLocationHrid: '/item_locations/' + (weapon.slot || 'main_hand'), itemHrid: I(weapon.item), enhancementLevel: 0 }] : []),
        { itemLocationHrid: '/item_locations/pouch', itemHrid: I('giant_pouch'), enhancementLevel: 0 }] },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': drinks.map((d) => (d ? { itemHrid: I(d) } : null)) }, ...extra,
});

// ---- Combat style from the weapon ----
const first = (type, style) => Object.values(items).find((it) => it.equipmentDetail?.type === '/equipment_types/' + type && it.equipmentDetail.combatStats?.combatStyleHrids?.[0] === '/combat_styles/' + style)?.hrid.slice(7);
const staff = first('main_hand', 'magic'), bow = first('main_hand', 'ranged'), sword = first('main_hand', 'slash'), hammer = first('two_hand', 'smash'), crossbow = first('two_hand', 'ranged');
check(D.combatStyleOf(gen({ item: staff }, []), items) === 'magic' && D.combatStyleOf(gen({ item: bow }, []), items) === 'ranged', 'style: a magic main hand is magic, a ranged one ranged');
check(D.combatStyleOf(gen({ item: sword }, []), items) === 'melee' && D.combatStyleOf(gen({ item: hammer, slot: 'two_hand' }, []), items) === 'melee', 'style: slash and smash (main or two hand) are melee');
check(D.combatStyleOf(gen({ item: crossbow, slot: 'two_hand' }, []), items) === 'ranged' && D.combatStyleOf(gen(null, []), items) === 'melee', 'style: a two-hand ranged weapon is ranged; no weapon is melee (smash)');

// ---- The pool and the pruning rules on the repo's price file ----
const table = D.drinkTable(items, market);
check(table.length === 26 && table.every((d) => d.ask > 0 && d.type.startsWith('drink:')), 'table: 26 combat drinks with an ask');
const prune = (style, goal, current = []) => D.pruneDrinks({ table, style, goal, current });
let r = prune('melee', 'profit');
check(r.dropped.b.length === 1 && short(r.dropped.b[0]) === 'channeling_coffee' && r.kept.length === 18 && r.kept.some((d) => /swiftness/.test(d.hrid)), 'melee, profit, channeling dropped (rule b), 18 left');
r = prune('ranged', 'exp');
check(short(r.dropped.b[0]) === 'channeling_coffee' && r.dropped.c.length === 1 && short(r.dropped.c[0]) === 'lucky_coffee' && r.kept.some((d) => /wisdom/.test(d.hrid)) && r.kept.some((d) => /ranged_coffee/.test(d.hrid)) && r.kept.length === 18, 'ranged, exp, style rule: lucky dropped, wisdom kept, 18 left');
r = prune('magic', 'profit');
check(short(r.dropped.b[0]) === 'swiftness_coffee' && r.kept.some((d) => /channeling/.test(d.hrid)) && r.kept.filter((d) => /magic_coffee/.test(d.hrid)).length === 3 && r.kept.length === 18, 'magic, profit, style rule: swiftness dropped, channeling and the 3 magic coffees kept, 18 left');
check(r.dropped.d.length === 0, 'rule d drops nothing on this price file (no exact dominance between tiers)');
// The current drinks are not exempt from a to c.
r = prune('melee', 'profit', [I('magic_coffee'), I('wisdom_coffee'), I('channeling_coffee')]);
check(!r.kept.some((d) => ['magic_coffee', 'wisdom_coffee', 'channeling_coffee'].includes(short(d.hrid))), 'current drinks of a dropped style, wisdom or channeling are still dropped by a, b and c');

// ---- Rule d on invented drinks ----
const mk = (name, ask, flat, ratio, type = 'drink:x') => ({ hrid: I(name), type, ask, buffs: { 'x|attack_level': [flat, ratio] } });
const tiers = [mk('a', 100, 1, 0.08), mk('b', 100, 2, 0.16), mk('c', 90, 2, 0.16), mk('d', 300, 3, 0.22), mk('e', 100, 2, 0.1)];
const dd = D.pruneDrinks({ table: tiers, style: 'melee', goal: 'profit' });
check(dd.kept.map((d) => short(d.hrid)).join() === 'c,d' && dd.dropped.d.map(short).join() === 'a,b,e', 'rule d: a drink another of its type matches on every buff at a lower or equal ask (one strictly) is dropped; a dearer, stronger one stays', dd.kept.map((d) => short(d.hrid)).join());
check(D.pruneDrinks({ table: tiers, style: 'melee', goal: 'profit', current: [I('a')] }).kept.some((d) => short(d.hrid) === 'a'), 'rule d: a current drink is never dropped by d');
check(!D.drinkBeats(mk('p', 100, 2, 0.16), mk('q', 100, 2, 0.16)), 'rule d: equal in everything beats nothing');

// ---- Fillings ----
const base3 = ['attack_coffee', 'defense_coffee', 'stamina_coffee'];
const s0 = gen({ item: sword }, base3);
const cands = (setup, goal = 'profit') => D.drinkFillCands('P', { items, market, baseline: setup.drinks['/action_types/combat'].map((d) => d?.itemHrid || null), setup, goal });
let c = cands(s0);
const idsC = c.cands.map((x) => x.id);
check(c.stats.style === 'melee' && c.stats.kept.length === 18 && c.stats.types === 8, 'fillings: melee profit: 18 drinks of 8 types', `${c.stats.kept.length} ${c.stats.types}`);
// types: attack, defense, intelligence, stamina, melee (3 tiers each = 15), critical, swiftness, lucky (1 each); choose 3.
const sizes = [3, 3, 3, 3, 3, 1, 1, 1];
let total = 0;
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) for (let k = j + 1; k < 8; k++) total += sizes[i] * sizes[j] * sizes[k];
check(c.cands.length === total - 1 && new Set(idsC).size === idsC.length, `fillings: one drink of each of 3 types, ${total} fillings less the baseline = ${total - 1}, ids distinct`, String(c.cands.length));
check(c.stats.fillings === c.cands.length, 'stats: fillings counts the candidates');
check(!idsC.includes('P:drinkfill=attack_coffee+defense_coffee+stamina_coffee'), 'the baseline filling is not a candidate');
check(c.cands.every((x) => x.kind === 'drink-fill' && x.monotone === false && x.player === 'P' && x.cost.cost === 0 && x.cost.known && x.ops.every((o) => o.op === 'drink' && o.player === 'P' && Number.isInteger(o.index) && o.item) && x.ops.length === x.groups.length && x.groups.every((g) => /^P:drink[0-2]$/.test(g)) && /^P drinks: /.test(x.desc)), 'candidate shape: kind drink-fill, free, not monotone, drink ops, groups P:drink<i>, desc "P drinks: ..."');
// Every filling has distinct types and exactly 3 drinks after the ops.
const typeOf = (h) => items[h].consumableDetail.buffs.map((b) => b.uniqueHrid).sort().join('+');
check(c.cands.every((x) => { const after = applyOps([s0], x.ops)[0].drinks['/action_types/combat'].map((d) => d.itemHrid); return after.length === 3 && new Set(after.map(typeOf)).size === 3 && !after.some((h) => /ranged_coffee|magic_coffee|wisdom/.test(h)); }), 'every filling holds 3 drinks of 3 different types, none of a pruned drink');
// Placement: a drink of a baseline drink's type takes that slot.
const up = c.cands.find((x) => x.id === 'P:drinkfill=super_attack_coffee+defense_coffee+stamina_coffee');
check(up && up.ops.length === 1 && up.ops[0].index === 0 && up.ops[0].item === I('super_attack_coffee') && up.desc === 'P drinks: attack_coffee -> super_attack_coffee', 'placement: a tier of the baseline drink\'s type takes its slot, one op, readable desc', JSON.stringify(up));
const mixed = c.cands.find((x) => x.id === 'P:drinkfill=lucky_coffee+defense_coffee+melee_coffee');
check(mixed && mixed.ops.length === 2 && mixed.ops.map((o) => o.index).join() === '0,2' && mixed.groups.join() === 'P:drink0,P:drink2', 'placement: new types take the free slots in slot order (the two new types, lucky and melee, in type order into slots 0 and 2)', JSON.stringify(mixed));
// Fewer slots, empty slots and fewer types than slots.
const s2 = gen({ item: staff }, ['attack_coffee', null]);
const c2 = cands(s2);
check(c2.cands.length > 0 && c2.stats.style === 'magic' && c2.cands.every((x) => { const after = applyOps([s2], x.ops)[0].drinks['/action_types/combat']; return after.length === 2 && after.every(Boolean) && new Set(after.map((d) => typeOf(d.itemHrid))).size === 2; }), '2 slots, one empty: every filling fills both slots with 2 types; magic style');
check(c2.cands.some((x) => x.desc.includes('empty -> ')), 'an empty slot is described as "empty -> ..."');
const tiny = D.drinkFillCands('P', { items: { [I('a')]: { hrid: I('a'), categoryHrid: '/item_categories/drink', consumableDetail: { usableInActionTypeMap: { '/action_types/combat': true }, buffs: [{ uniqueHrid: '/buff_uniques/a', typeHrid: '/buff_types/x', flatBoost: 1, ratioBoost: 0 }] } } }, market: { [I('a')]: { 0: { a: 10 } } }, baseline: [null, null, null], setup: s0, goal: 'profit' });
check(tiny.cands.length === 1 && tiny.cands[0].ops.length === 1 && tiny.cands[0].ops[0].index === 0, 'fewer types than slots: the filling is smaller (one drink)');
check(D.drinkFillCands('P', { items, market, baseline: [], setup: s0, goal: 'profit' }).cands.length === 0, 'no open drink slot: no candidates');

// ---- A drink put in a slot takes its own item's triggers, not the replaced drink's ----
const dtoOf = (setup) => E.buildDtos([setup])[0];
const trigConds = (d) => d.triggers.map((t) => short(t.conditionHrid)).join();
const withMap = gen({ item: sword }, ['attack_coffee', 'defense_coffee', 'stamina_coffee'], { triggerMap: { [I('attack_coffee')]: [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/current_hp', comparatorHrid: '/combat_trigger_comparators/less_than_equal', value: 10 }] } });
const before = dtoOf(withMap), afterSetup = applyOps([withMap], [{ op: 'drink', player: 'P', index: 0, item: I('melee_coffee') }])[0], after = dtoOf(afterSetup);
check(trigConds(before.drinks[0]) === 'current_hp', 'fixture: the replaced drink had its own trigger (current_hp)');
check(after.drinks[0].hrid === I('melee_coffee') && trigConds(after.drinks[0]) === 'melee_coffee', 'a new drink with no triggerMap entry gets the game default (its buff inactive), not the replaced drink\'s trigger', trigConds(after.drinks[0]));
check(JSON.stringify(afterSetup.triggerMap) === JSON.stringify(withMap.triggerMap), 'the drink op does not touch the triggerMap');
const kept = gen({ item: sword }, ['attack_coffee', 'defense_coffee', 'stamina_coffee'], { triggerMap: { [I('melee_coffee')]: [] } });
check(dtoOf(applyOps([kept], [{ op: 'drink', player: 'P', index: 0, item: I('melee_coffee') }])[0]).drinks[0].triggers.length === 0, 'a drink with an entry in the player\'s triggerMap keeps it');
check(c.cands.every((x) => x.ops.every((o) => o.op === 'drink')), 'drink fillings carry no trigger op');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
