// Test: the "held by trigger" stat (src/combatsimulator/simResult.js updateTriggerHolds, updateSkipHold,
// closeTriggerHolds; src/combatsimulator/combatSimulator.js observeSkippedAbility; src/combatsimulator/triggerHolds.js).
// (1) The counters only observe: a seeded run equals, field for field, the same run with the counters switched off;
// and the per-condition holds are the same with and without the "a previous skill was out of mana" counter.
// (2) Hold bookkeeping on hand-made checks. (3) A real run records holds for both conditions of a two-condition skill
// and "a previous skill was out of mana" for a skill after one short of mana. Generic player, no private data.
// Usage: node tools/test/held-by-trigger.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
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
const { summarizeTriggerHolds } = await import(src('combatsimulator/triggerHolds.js'));
const { hasHold, heldPopupHtml, HELD_OVERLAP_LINE } = await import(src('combatsimulator/heldPopup.js'));

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const P = '/combat_trigger_';
const term = (dep, cond, cmp, value) => ({ dependencyHrid: P + 'dependencies/' + dep, conditionHrid: P + 'conditions/' + cond, comparatorHrid: P + 'comparators/' + cmp, value });

// ---- (2) Bookkeeping on hand-made checks ----
{
    const r = new SimResult(null, null, 1);
    const ability = { hrid: '/abilities/a', triggers: [term('all_enemies', 'current_hp', 'greater_than_equal', 400), term('self', 'current_mp', 'greater_than_equal', 200)] };
    const later = { hrid: '/abilities/b', triggers: [] };
    const unit = { hrid: 'player1', abilities: [null, ability, later] };
    r.updateTriggerHolds(unit, ability, [0, 1], 0);     // both fail: both counted
    r.updateTriggerHolds(unit, ability, [1], 10);       // first passes: its hold ends
    r.updateTriggerHolds(unit, ability, [1], 15);       // still held: no new hold
    r.updateTriggerHolds(unit, ability, [], 20);        // fires: MP hold ends
    r.updateTriggerHolds(unit, ability, [0], 30);       // a second hold of the first condition
    r.updateSkipHold(unit, later, false, 0);            // reached: nothing recorded
    check(!r.skipHolds.player1, 'a skill never stopped by an earlier one records nothing');
    r.updateSkipHold(unit, later, true, 12);            // ready, stopped by an earlier skill out of mana
    r.updateSkipHold(unit, later, true, 14);            // still: no new hold
    r.updateSkipHold(unit, later, false, 18);           // reached (or not ready): the hold ends
    r.updateSkipHold(unit, later, true, 25);            // a second one, open until the encounter ends
    r.closeTriggerHolds(unit, 35);                      // death or encounter end
    const [c0, c1] = r.triggerHolds.player1['/abilities/a'];
    check(c0.count === 2 && c0.total === 15 && !c0.held, `first condition: 2 holds, 10 + 5 time units (${c0.count}, ${c0.total})`);
    check(c1.count === 1 && c1.total === 20, `MP condition: 1 hold, 20 time units (${c1.count}, ${c1.total})`);
    const k = r.skipHolds.player1['/abilities/b'];
    check(k.count === 2 && k.total === 16 && !k.held, `previous skill out of mana: 2 holds, 6 + 10 time units, closed at the end (${k.count}, ${k.total})`);
    check(!('manaHolds' in r), 'no "held for mana" counter');
    r.updateSkipHold(unit, later, true, 40);            // open to the end of the sim
    r.simulatedTime = 50;
    const s = summarizeTriggerHolds(r, 'player1');
    check(s.abilities.map((a) => a.abilityHrid).join() === '/abilities/a,/abilities/b', 'summary lists the abilities in slot order');
    check(s.abilities[0].conditions.length === 2 && s.abilities[0].skip === null && s.abilities[1].conditions.length === 0, 'summary: conditions per ability, no previous-skill row where none');
    check(near(s.abilities[0].conditions[0].share, 15 / 50) && near(s.abilities[0].conditions[1].share, 20 / 50), 'summary share = held time / sim time');
    check(near(s.abilities[1].skip, 26 / 50), `summary counts an open hold to the end of the sim (${s.abilities[1].skip})`);
    check(Object.keys(s.abilities[0].conditions[0]).sort().join() === 'comparatorHrid,conditionHrid,dependencyHrid,share,value', 'summary has the share only, no holds per hour');
    check(summarizeTriggerHolds(r, 'player2').abilities.length === 0, 'a player with no holds summarizes to nothing');
    const none = new SimResult(null, null, 1);
    none.updateTriggerHolds(unit, { hrid: '/abilities/b', triggers: [] }, [], 0);
    check(Object.keys(none.triggerHolds).length === 0, 'an ability with no conditions records no condition hold');
}

// ---- (1) and (3) A real run ----
function dto() {
    return {
        hrid: 'player1', staminaLevel: 80, intelligenceLevel: 80, attackLevel: 90, meleeLevel: 60, defenseLevel: 80, rangedLevel: 60, magicLevel: 90,
        equipment: { '/equipment_types/main_hand': new Equipment('/items/blooming_trident', 5), '/equipment_types/body': new Equipment('/items/royal_nature_robe_top', 5) },
        food: [new Consumable('/items/spaceberry_donut'), null, null],
        drinks: [null, null, null],
        abilities: [null,
            new Ability('/abilities/toxic_pollen', 30, [term('all_enemies', 'current_hp', 'greater_than_equal', 4000), term('self', 'current_mp', 'greater_than_equal', 600)].map((t) => Trigger.createFromDTO(t))),
            new Ability('/abilities/water_strike', 30, []),
            new Ability('/abilities/fireball', 30), null],
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
const strip = (r) => JSON.stringify({ ...r, triggerHolds: undefined, skipHolds: undefined, abilityOrder: undefined });
const withStat = await run();
const saved = { u: SimResult.prototype.updateTriggerHolds, k: SimResult.prototype.updateSkipHold, c: SimResult.prototype.closeTriggerHolds, o: CombatSimulator.prototype.observeSkippedAbility, t: Ability.prototype.shouldTrigger };
// Run 2: the "previous skill out of mana" counter off (the skipped abilities are not evaluated at all).
CombatSimulator.prototype.observeSkippedAbility = () => {};
SimResult.prototype.updateSkipHold = () => {};
const noSkip = await run();
// Run 3: every counter off, and shouldTrigger called with no failed list, as upstream.
SimResult.prototype.updateTriggerHolds = () => {};
SimResult.prototype.closeTriggerHolds = () => {};
Ability.prototype.shouldTrigger = function (t, s, tg, f, e) { return saved.t.call(this, t, s, tg, f, e); };
const without = await run();
Object.assign(SimResult.prototype, { updateTriggerHolds: saved.u, updateSkipHold: saved.k, closeTriggerHolds: saved.c });
CombatSimulator.prototype.observeSkippedAbility = saved.o;
Ability.prototype.shouldTrigger = saved.t;
check(strip(withStat) === strip(without), 'the run with the counters equals the run without them, every result field');
check(strip(withStat) === strip(noSkip), 'the run equals the run without the previous-skill counter, every result field');
check(JSON.stringify(withStat.triggerHolds) === JSON.stringify(noSkip.triggerHolds), 'the per-condition holds are the same with and without the previous-skill counter');
check(withStat.encounters > 10, `the run has encounters (${withStat.encounters})`);
check(Object.keys(without.triggerHolds).length === 0 && Object.keys(without.skipHolds).length === 0, 'the switched-off run recorded nothing');

const s = summarizeTriggerHolds(withStat, 'player1');
const pollen = s.abilities.find((a) => a.abilityHrid === '/abilities/toxic_pollen');
check(pollen && pollen.conditions.length === 2, 'toxic_pollen is held by both its conditions');
check(pollen.conditions.every((c) => c.share > 0 && c.share < 1), 'each condition has a share in (0, 1)');
const skipped = s.abilities.filter((a) => a.skip !== null);
check(skipped.length > 0 && skipped.every((a) => a.skip > 0 && a.skip < 1), `a skill after one short of mana has a previous-skill share in (0, 1) (${skipped.map((a) => a.abilityHrid.split('/').pop()).join(', ')})`);
check(!s.abilities.some((a) => a.abilityHrid === '/abilities/water_strike' && a.conditions.length > 0), 'a skill with no conditions shows no condition hold');
const oom = withStat.playerRanOutOfManaTime.player1;
const oomShare = oom ? (oom.totalTimeForOutOfMana + (oom.isOutOfMana ? withStat.simulatedTime - oom.startTimeForOutOfMana : 0)) / withStat.simulatedTime : 0;

console.log('worked example (4 h, swamp planet, seed 7)');
for (const a of s.abilities) {
    console.log('  ' + a.abilityHrid.split('/').pop());
    for (const c of a.conditions) console.log(`    ${c.dependencyHrid.split('/').pop()} ${c.conditionHrid.split('/').pop()} ${c.comparatorHrid.split('/').pop()} ${c.value}: ${(c.share * 100).toFixed(2)}%`);
    if (a.skip !== null) console.log(`    a previous skill was out of mana: ${(a.skip * 100).toFixed(2)}%`);
}
console.log(`  mana run out ratio ${(oomShare * 100).toFixed(2)}%`);

// ---- (4) The details button and the pop-up body (generic summary, no sim) ----
{
    const fmt = { abilityName: (h) => h.split('/').pop(), conditionHtml: (c) => `${c.dependencyHrid.split('/').pop()} ${c.value}`, percentHtml: (n) => `${n.toFixed(2)}%` };
    const none = { abilities: [] };
    const some = { abilities: [
        { abilityHrid: '/abilities/alpha', conditions: [{ dependencyHrid: P + 'dependencies/self', conditionHrid: P + 'conditions/current_mp', comparatorHrid: P + 'comparators/greater_than_equal', value: 200, share: 0.25 }, { dependencyHrid: P + 'dependencies/all_enemies', conditionHrid: P + 'conditions/current_hp', comparatorHrid: P + 'comparators/greater_than_equal', value: 400, share: 0.5 }], skip: null },
        { abilityHrid: '/abilities/beta', conditions: [], skip: 0.125 },
    ] };
    check(!hasHold(none) && hasHold(some) && hasHold({ abilities: [{ abilityHrid: '/abilities/x', conditions: [], skip: 0.1 }] }), 'the details button shows only when the summary has a hold (condition or previous-skill)');
    const html = heldPopupHtml(some, fmt);
    const [trigPart, skipPart] = [html.slice(html.indexOf('id="heldTriggerGroup"'), html.indexOf('id="heldSkipGroup"')), html.slice(html.indexOf('id="heldSkipGroup"'), html.indexOf('id="heldOverlapLine"'))];
    check(trigPart.includes('alpha') && trigPart.includes('self 200') && trigPart.includes('25.00%') && trigPart.includes('all_enemies 400') && trigPart.includes('50.00%'), 'the pop-up lists the skill and each condition with its share');
    check(!trigPart.includes('beta') && !trigPart.includes('12.50%'), 'the previous-skill share is not under the trigger heading');
    check(skipPart.includes('A previous skill was out of mana') && skipPart.includes('beta') && skipPart.includes('12.50%') && !skipPart.includes('alpha'), 'the previous-skill group is separate, with its skill and share');
    check(html.includes('>' + HELD_OVERLAP_LINE + '<') && HELD_OVERLAP_LINE === 'Share of the whole simulation time each reason kept the skill from casting while it was ready; reasons can overlap, so they do not add up.', 'the overlap line is present word for word');
    check(!heldPopupHtml({ abilities: [{ abilityHrid: '/abilities/beta', conditions: [], skip: 0.1 }] }, fmt).includes('heldTriggerGroup'), 'no trigger group when only a previous-skill hold exists');
    const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
    const fn = main.slice(main.indexOf('function triggerHoldRows'), main.indexOf("// A trigger condition in the game's words"));
    check((fn.match(/createRow\(/g) || []).length === 1 && fn.includes('heldByTriggerButton'), 'the panel adds only the details button row (no condition or skill rows)');
    const html2 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    check(/id="heldByTriggerModal"[\s\S]{0,80}modal-xl|id="heldByTriggerModal"[\s\S]{0,200}modal-xl/.test(html2) && html2.includes('id="heldByTriggerBody"'), 'index.html has the modal-xl pop-up with its body');
    const sr = main.slice(main.indexOf('Mana Run Out Ratio, always shown'), main.indexOf('newChildren.push(...triggerHoldRows'));
    check(sr.includes('col-md-8 text-nowrap'), 'Mana Run Out Ratio stays on one line');
}

console.log(fails ? `${fails} FAILED` : 'PASS');
process.exit(fails ? 1 : 0);
