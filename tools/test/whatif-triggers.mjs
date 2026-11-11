// Test: the what-if trigger search (tools/whatif/triggers.mjs). (1) The counter only observes: a seeded run with the
// probe installed equals the same run without it, and the probe records the quantities. (2) Candidate generation:
// value grid per numeric term, structure changes, added terms, local refinement, the user's own candidates and fixed
// owners. Generic party, no private data.
// Usage: node tools/test/whatif-triggers.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { seedRandom } = await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href); // registers the loader hooks
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { default: Trigger } = await import(src('combatsimulator/trigger.js'));
const T = await import(pathToFileURL(path.join(root, 'tools/whatif/triggers.mjs')).href);

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const P = '/combat_trigger_';
const term = (dep, cond, cmp, value) => ({ dependencyHrid: P + 'dependencies/' + dep, conditionHrid: P + 'conditions/' + cond, comparatorHrid: P + 'comparators/' + cmp, value });
const pollenTriggers = [term('all_enemies', 'current_hp', 'greater_than_equal', 400), term('self', 'current_mp', 'greater_than_equal', 200)];

// ---- (1) The counter only observes ----
function dto() {
    return {
        hrid: 'player1', staminaLevel: 80, intelligenceLevel: 80, attackLevel: 90, meleeLevel: 60, defenseLevel: 80, rangedLevel: 60, magicLevel: 90,
        equipment: { '/equipment_types/main_hand': new Equipment('/items/blooming_trident', 5), '/equipment_types/body': new Equipment('/items/royal_nature_robe_top', 5) },
        food: [new Consumable('/items/spaceberry_donut'), new Consumable('/items/star_fruit_gummy', [term('self', 'current_mp', 'less_than_equal', 300)].map((t) => Trigger.createFromDTO(t))), null],
        drinks: [new Consumable('/items/ultra_magic_coffee'), null, null],
        abilities: [null, new Ability('/abilities/toxic_pollen', 30, pollenTriggers.map((t) => Trigger.createFromDTO(t))), new Ability('/abilities/entangle', 30), null, null],
        houseRooms: {}, labyrinthUpgrades: {}, guildBuffs: {}, achievements: {}, debuffOnLevelGap: 0,
    };
}
async function run(withProbe) {
    seedRandom(7);
    const zone = new Zone('/actions/combat/swamp_planet', 0);
    const p = Player.createFromDTO(structuredClone(dto()));
    p.zoneBuffs = zone.buffs || [];
    p.extraBuffs = [];
    let store = null;
    if (withProbe) store = T.installProbe([p], ['P'], ['P'], Trigger);
    const sim = new CombatSimulator([p], zone, null, {});
    await sim.simulate(2 * 3600e9);
    const r = sim.simResult;
    return { out: JSON.stringify({ e: r.encounters, d: r.deaths, x: r.experienceGained, c: r.consumablesUsed }), store };
}
const plain = await run(false), probed = await run(true);
check(plain.out === probed.out, 'a run with the probe equals the run without it');
check(JSON.parse(plain.out).e > 10, `the run has encounters (${JSON.parse(plain.out).e})`);
const rec = probed.store.P['/abilities/toxic_pollen'];
check(rec['self/current_mp'].n > 0 && rec['all_enemies/current_hp'].n > 0, 'the probe records toxic_pollen quantities');
check(probed.store.P['/items/star_fruit_gummy']['self/current_mp'].n > 0, 'the probe records food quantities');
const sum = T.summarize(probed.store);
check(sum.P['/abilities/toxic_pollen']['self/current_mp'].s.length === 101, 'summary keeps percentiles 0..100');
const g = T.grid(sum.P['/abilities/toxic_pollen']['self/current_mp'].s, P + 'conditions/current_mp');
check(g.length >= 2 && g.every((v, i) => i === 0 || v > g[i - 1]), `MP grid is ascending and distinct (${g.join(', ')})`);
check(T.grid([3, 1, 2, 2, 3, 1, 3], P + 'conditions/number_of_active_units').every(Number.isInteger), 'count grids are integers');

// ---- (2) Candidates ----
const setup = {
    name: 'P',
    abilities: [null, { abilityHrid: '/abilities/toxic_pollen', level: 30 }, { abilityHrid: '/abilities/entangle', level: 30 }],
    food: { '/action_types/combat': [{ itemHrid: '/items/star_fruit_gummy' }] },
    drinks: { '/action_types/combat': [{ itemHrid: '/items/ultra_magic_coffee' }] },
    triggerMap: { '/abilities/toxic_pollen': pollenTriggers, '/items/star_fruit_gummy': [term('self', 'current_mp', 'less_than_equal', 300)] },
};
const pct = (lo, hi) => ({ n: 1000, s: Array.from({ length: 101 }, (_, q) => lo + (hi - lo) * q / 100) });
const probe = { P: {
    '/abilities/toxic_pollen': { 'all_enemies/current_hp': pct(0, 5000), 'self/current_mp': pct(100, 1100), 'all_enemies/number_of_active_units': { n: 100, s: Array.from({ length: 101 }, (_, q) => 1 + Math.floor(q / 34)) } },
    '/items/star_fruit_gummy': { 'self/current_mp': pct(0, 1000) },
} };
const c = T.triggerCands(setup, 'P', probe, {});
const ids = c.map((x) => x.id);
check(ids.includes('P:trig:toxic_pollen:0=500') && ids.includes('P:trig:toxic_pollen:1=600'), 'value candidates on the deciles of each numeric term');
check(c.filter((x) => x.id.startsWith('P:trig:toxic_pollen:0=')).length === 9, 'nine grid points for enemies\' total HP');
check(ids.includes('P:trig:toxic_pollen:drop0') && ids.includes('P:trig:toxic_pollen:flip1'), 'drop and flip candidates');
check(ids.includes('P:trig:toxic_pollen:default'), 'game default candidate');
check(ids.includes('P:trig:toxic_pollen:addn=2') && ids.includes('P:trig:toxic_pollen:addn=3'), 'area ability: active enemies >= n');
check(ids.includes('P:trig:toxic_pollen:adddebuff'), 'debuff ability: its own debuff inactive on the target');
check(!ids.some((x) => x.startsWith('P:trig:toxic_pollen:addmp=')), 'no added MP term when the owner already tests my MP');
const hpOnly = { ...setup, triggerMap: { ...setup.triggerMap, '/abilities/toxic_pollen': [pollenTriggers[0]] } };
const addmp = T.triggerCands(hpOnly, 'P', probe, { owners: ['/abilities/toxic_pollen'] }).filter((x) => x.id.includes(':addmp='));
check(addmp.length === 3 && addmp.every((x) => x.ops[0].triggers.length === 2 && x.ops[0].triggers[1].value > 45), `costly ability: my MP >= x at three points above its cost (${addmp.map((x) => x.id.split('=')[1])})`);
check(c.find((x) => x.id === 'P:trig:toxic_pollen:1=600').ops[0].triggers[0].value === 400, 'a value candidate keeps the other terms');
check(ids.includes('P:trig:star_fruit_gummy:0=500') && ids.includes('P:trig:star_fruit_gummy:default'), 'food: value grid and default');
check(ids.some((x) => x.startsWith('P:trig:entangle:')) === false || c.filter((x) => x.owner === '/abilities/entangle').every((x) => !/:\d=/.test(x.id)), 'no value candidates without a numeric term or a probe');
check(new Set(c.map((x) => JSON.stringify([x.owner, x.ops[0].triggers]))).size === c.length, 'no two candidates give the same list');
check(c.every((x) => x.groups.length === 1 && x.groups[0] === 'P:trigger:' + x.owner && x.cost.cost === 0), 'one group per owner, no cost');
check(!c.some((x) => x.owner === '/items/ultra_magic_coffee') && T.triggerCands(setup, 'P', probe, { owners: ['/items/ultra_magic_coffee'] }).length === 0, 'a drink owner gets no trigger candidates (drinks have 100% uptime), even when named');
const only = T.triggerCands(setup, 'P', probe, { owners: ['/items/star_fruit_gummy'] });
check(only.length > 0 && only.every((x) => x.owner === '/items/star_fruit_gummy'), '--trigger-owners limits the owners');
check(T.triggerCands(setup, 'P', probe, { fixed: ['/abilities/toxic_pollen'] }).every((x) => x.owner !== '/abilities/toxic_pollen'), 'a fixed owner is skipped');
check(T.triggerCands(setup, 'P', probe, { owners: ['toxic_pollen'] }).every((x) => x.owner === '/abilities/toxic_pollen'), 'an owner may be named by the last part of its hrid');
const user = T.triggerCands(setup, 'P', probe, { owners: ['/abilities/toxic_pollen'], user: { '/abilities/toxic_pollen': [[term('self', 'current_mp', 'greater_than_equal', 333)]] } });
check(user.length === 1 && user[0].ops[0].triggers[0].value === 333, 'the user\'s candidates replace the generated ones');
const loc = T.localCands(setup, 'P', probe, '/abilities/toxic_pollen').map((x) => x.ops[0].triggers);
const has = (a, b) => loc.some((ts) => ts[0].value === a && ts[1].value === b);
check(loc.length === 4 && has(500, 200) && has(450, 200) && has(400, 300) && has(400, 250), `local candidates: grid neighbours and midpoints (${loc.map((ts) => ts.map((t) => t.value).join('/')).join(' ')})`);
check(T.effectiveTriggers({ triggerMap: {} }, '/items/star_fruit_gummy')[0].conditionHrid.endsWith('missing_mp'), 'no stored trigger: the game default');

// ---- (3) The chain guard: a toggle back to an earlier state is never offered again (tools/whatif/pools.mjs) ----
{
    const { applyOps } = await import(pathToFileURL(path.join(root, 'src/whatif/applyOps.mjs')).href);
    const { dropChainStates } = await import(pathToFileURL(path.join(root, 'tools/whatif/pools.mjs')).href);
    const { createHash } = await import('node:crypto');
    const keyOf = (ops) => createHash('sha1').update(JSON.stringify(applyOps([setup], ops))).digest('hex').slice(0, 16);
    const OWNER = '/abilities/toxic_pollen';
    const first = (x) => x.ops[0].triggers[1].value, other = (x) => x.ops[0].triggers[0].value;
    const chain = new Set([keyOf([])]);
    // State A is the setup as it is (my MP >= 200); step 1 accepts A -> B (my MP >= 300).
    const fromA = T.localCands(setup, 'P', probe, OWNER);
    const toB = fromA.find((x) => first(x) === 300 && other(x) === 400);
    check(!!toB && fromA.some((x) => first(x) === 250), 'toggle: from A the candidate to B (MP 300) is generated');
    const base = [...toB.ops];
    chain.add(keyOf(base));
    // Round two: the candidates are rebuilt from the new value; the one back to 400 is state A again.
    const setupB = applyOps([setup], base)[0];
    const fromB = T.localCands(setupB, 'P', probe, OWNER);
    const back = fromB.find((x) => first(x) === 200 && other(x) === 400);
    check(!!back, 'toggle: from B the candidate back to A (MP 200) is generated (the premise of the bug)');
    const { kept, dropped } = dropChainStates(fromB, base, keyOf, chain);
    check(dropped.length === 1 && dropped[0] === back && !kept.includes(back), 'toggle: B to A is dropped by its run key, before it can be estimated');
    check(kept.length === fromB.length - 1 && kept.every((x, i) => x === fromB.filter((y) => y !== back)[i]), 'toggle: the other candidates of B are kept, in their order');
    // The key is the resulting state, not the ops: ops [A, B] and [B, A, B] are one state, and so are [B] and [B, A, B] on top of A.
    const opA = { op: 'trigger', player: 'P', hrid: OWNER, triggers: pollenTriggers }, opB = toB.ops[0];
    check(keyOf([opB]) === keyOf([opA, opB]) && keyOf([opB, opA, opB]) === keyOf([opB]) && keyOf([opA]) === keyOf([]), 'key: a full-list trigger op applied last-wins, so a state reached by another path has the same key');
    const viaLongPath = dropChainStates([{ id: 'x', ops: [opA, opB] }, { id: 'y', ops: [opA] }], [opB], keyOf, chain);
    check(viaLongPath.dropped.length === 2 && viaLongPath.kept.length === 0, 'a candidate whose state equals an earlier one by another path is dropped (B + [A, B] is B; B + [A] is A)');
    // A new state is kept, and the original base counts as in the chain.
    const fresh = fromA.find((x) => first(x) === 250);
    check(dropChainStates([fresh], [], keyOf, chain).kept.length === 1 && dropChainStates([{ id: 'orig', ops: [opA] }], [], keyOf, chain).dropped.length === 1, 'a state not yet in the chain is kept; the original base is in the chain');
}

// ---- (4) One trigger, one step: the merged text of a trigger moved twice ----
{
    const a = 'Player 3 rain_of_arrows trigger: all_enemies current_hp >= 200 -> 4600', b = 'Player 3 rain_of_arrows trigger: all_enemies current_hp >= 4600 -> 3000';
    check(T.joinTriggerDesc(a, b) === 'Player 3 rain_of_arrows trigger: all_enemies current_hp >= 200 -> 3000', 'merged trigger text: 200 -> 4600 then 4600 -> 3000 reads 200 -> 3000');
    check(T.joinTriggerDesc(T.joinTriggerDesc(a, b), 'Player 3 rain_of_arrows trigger: all_enemies current_hp >= 3000 -> 2500') === 'Player 3 rain_of_arrows trigger: all_enemies current_hp >= 200 -> 2500', 'a third move folds in the same way');
    const other = 'Player 3 rain_of_arrows trigger: add all_enemies number_of_active_units >= 2';
    check(T.joinTriggerDesc(a, other) === a + '; then ' + other, 'texts that do not chain keep both, joined with "then"');
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
