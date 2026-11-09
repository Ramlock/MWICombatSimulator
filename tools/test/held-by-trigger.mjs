// Test: the "held by trigger" and "held for mana" stats (src/combatsimulator/simResult.js updateTriggerHolds,
// closeTriggerHolds, syncManaHold; src/combatsimulator/triggerHolds.js). (1) The counters only observe: a seeded run
// equals, field for field, the same run with the counters switched off. (2) Hold bookkeeping on hand-made checks.
// (3) A real run records holds for both conditions of a two-condition skill and a "held for mana" share.
// Generic player, no private data.
// Usage: node tools/test/held-by-trigger.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { seedRandom } = await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href); // registers the loader hooks
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: SimResult } = await import(src('combatsimulator/simResult.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { default: Trigger } = await import(src('combatsimulator/trigger.js'));
const { isOwnMpTrigger, summarizeTriggerHolds } = await import(src('combatsimulator/triggerHolds.js'));

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const P = '/combat_trigger_';
const term = (dep, cond, cmp, value) => ({ dependencyHrid: P + 'dependencies/' + dep, conditionHrid: P + 'conditions/' + cond, comparatorHrid: P + 'comparators/' + cmp, value });

// ---- (2) Bookkeeping on hand-made checks ----
check(isOwnMpTrigger(term('self', 'current_mp', 'greater_than_equal', 1)) && isOwnMpTrigger(term('self', 'missing_mp', 'less_than_equal', 1)), 'own MP: self + current_mp / missing_mp');
check(!isOwnMpTrigger(term('all_allies', 'current_mp', 'greater_than_equal', 1)) && !isOwnMpTrigger(term('self', 'current_hp', 'greater_than_equal', 1)), 'not own MP: allies\' MP, own HP');
{
    const r = new SimResult(null, null, 1);
    const unit = { hrid: 'player1' };
    const ability = { hrid: '/abilities/a', triggers: [term('all_enemies', 'current_hp', 'greater_than_equal', 400), term('self', 'current_mp', 'greater_than_equal', 200)] };
    r.updateTriggerHolds(unit, ability, [0, 1], 0);     // both fail: both counted
    r.updateTriggerHolds(unit, ability, [1], 10);       // first passes: its hold ends
    r.addRanOutOfManaCount(unit, true, 12);             // out of mana inside the MP hold
    r.updateTriggerHolds(unit, ability, [1], 15);       // still held: no new hold
    r.addRanOutOfManaCount(unit, false, 18);
    r.updateTriggerHolds(unit, ability, [], 20);        // fires: MP hold ends
    r.updateTriggerHolds(unit, ability, [0], 30);       // a second hold of the first condition
    r.closeTriggerHolds(unit, 35);                      // death or encounter end
    r.addRanOutOfManaCount(unit, true, 40);             // out of mana alone, open to the end
    const [c0, c1] = r.triggerHolds.player1['/abilities/a'];
    check(c0.count === 2 && c0.total === 15 && !c0.held, `first condition: 2 holds, 10 + 5 time units (${c0.count}, ${c0.total})`);
    check(c1.count === 1 && c1.total === 20 && c1.ownMp, `MP condition: 1 hold, 20 time units (${c1.count}, ${c1.total})`);
    const m = r.manaHolds.player1;
    check(m.count === 2 && m.total === 20 && m.held && m.start === 40, `held for mana: the union, 0-20 and 40-open (${m.count}, ${m.total}, open at ${m.start})`);
    r.simulatedTime = 50;
    const s = summarizeTriggerHolds(r, 'player1');
    check(s.abilities.length === 1 && s.abilities[0].conditions.length === 2, 'summary lists the ability and both conditions');
    check(near(s.abilities[0].conditions[0].share, 15 / 50) && near(s.abilities[0].conditions[1].share, 20 / 50), 'summary share = held time / sim time');
    check(near(s.mana.share, 30 / 50), `summary counts an open hold to the end of the sim (${s.mana.share})`);
    check(near(s.abilities[0].conditions[0].perHour, 2 / (50 / 3600e9)), 'holds per hour = holds / sim hours');
    check(summarizeTriggerHolds(r, 'player2').mana === null && summarizeTriggerHolds(r, 'player2').abilities.length === 0, 'a player with no holds summarizes to nothing');
    const none = new SimResult(null, null, 1);
    none.updateTriggerHolds(unit, { hrid: '/abilities/b', triggers: [] }, [], 0);
    check(Object.keys(none.triggerHolds).length === 0, 'an ability with no conditions records nothing');
}

// ---- (1) and (3) A real run ----
function dto() {
    return {
        hrid: 'player1', staminaLevel: 80, intelligenceLevel: 80, attackLevel: 90, meleeLevel: 60, defenseLevel: 80, rangedLevel: 60, magicLevel: 90,
        equipment: { '/equipment_types/main_hand': new Equipment('/items/blooming_trident', 5), '/equipment_types/body': new Equipment('/items/royal_nature_robe_top', 5) },
        food: [new Consumable('/items/spaceberry_donut'), new Consumable('/items/star_fruit_gummy', [term('self', 'current_mp', 'less_than_equal', 300)].map((t) => Trigger.createFromDTO(t))), null],
        drinks: [new Consumable('/items/ultra_magic_coffee'), null, null],
        abilities: [null,
            new Ability('/abilities/toxic_pollen', 30, [term('all_enemies', 'current_hp', 'greater_than_equal', 4000), term('self', 'current_mp', 'greater_than_equal', 600)].map((t) => Trigger.createFromDTO(t))),
            new Ability('/abilities/entangle', 30, []), null, null], // [] = no conditions (null would take the default ones)
        houseRooms: {}, labyrinthUpgrades: {}, guildBuffs: {}, achievements: {}, debuffOnLevelGap: 0,
    };
}
async function run() {
    seedRandom(7);
    const zone = new Zone('/actions/combat/swamp_planet', 0);
    const p = Player.createFromDTO(structuredClone(dto()));
    p.zoneBuffs = zone.buffs || [];
    p.extraBuffs = [];
    const sim = new CombatSimulator([p], zone, null, {});
    await sim.simulate(4 * 3600e9);
    return sim.simResult;
}
const withStat = await run();
const saved = { u: SimResult.prototype.updateTriggerHolds, c: SimResult.prototype.closeTriggerHolds, s: SimResult.prototype.syncManaHold, t: Ability.prototype.shouldTrigger };
SimResult.prototype.updateTriggerHolds = () => {};
SimResult.prototype.closeTriggerHolds = () => {};
SimResult.prototype.syncManaHold = () => {};
Ability.prototype.shouldTrigger = function (t, s, tg, f, e) { return saved.t.call(this, t, s, tg, f, e); }; // no failed list
const without = await run();
Object.assign(SimResult.prototype, { updateTriggerHolds: saved.u, closeTriggerHolds: saved.c, syncManaHold: saved.s });
Ability.prototype.shouldTrigger = saved.t;
const strip = (r) => JSON.stringify({ ...r, triggerHolds: undefined, manaHolds: undefined });
check(strip(withStat) === strip(without), 'the run with the counters equals the run without them, every result field');
check(withStat.encounters > 10, `the run has encounters (${withStat.encounters})`);
check(Object.keys(without.triggerHolds).length === 0, 'the switched-off run recorded nothing');

const s = summarizeTriggerHolds(withStat, 'player1');
const pollen = s.abilities.find((a) => a.abilityHrid === '/abilities/toxic_pollen');
check(pollen && pollen.conditions.length === 2, 'toxic_pollen is held by both its conditions');
check(pollen.conditions.every((c) => c.share > 0 && c.share < 1 && c.perHour > 0), 'each condition has a share in (0, 1) and holds per hour');
const mp = pollen.conditions.find((c) => c.ownMp);
check(s.mana && s.mana.share + 1e-12 >= mp.share, `held for mana covers the MP condition (${s.mana?.share} >= ${mp.share})`);
const oom = withStat.playerRanOutOfManaTime.player1;
const oomShare = oom ? (oom.totalTimeForOutOfMana + (oom.isOutOfMana ? withStat.simulatedTime - oom.startTimeForOutOfMana : 0)) / withStat.simulatedTime : 0;
check(s.mana.share + 1e-12 >= oomShare, `held for mana covers the run-out ratio (${s.mana.share} >= ${oomShare})`);
check(!s.abilities.some((a) => a.abilityHrid === '/abilities/entangle'), 'a skill with no conditions shows no hold');

console.log('worked example (4 h, swamp planet, seed 7): toxic_pollen');
for (const c of pollen.conditions) console.log(`  ${c.dependencyHrid.split('/').pop()} ${c.conditionHrid.split('/').pop()} ${c.comparatorHrid.split('/').pop()} ${c.value}: held ${(c.share * 100).toFixed(2)}% of the time, ${c.perHour.toFixed(1)} holds/h`);
console.log(`  held for mana: ${(s.mana.share * 100).toFixed(2)}%, ${s.mana.perHour.toFixed(1)} /h; run out ratio ${(oomShare * 100).toFixed(2)}%`);

console.log(fails ? `${fails} FAILED` : 'PASS');
process.exit(fails ? 1 : 0);
