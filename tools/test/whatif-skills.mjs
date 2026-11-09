// Test: the skill-level levers (tools/whatif/levers/skills.mjs). Synthetic setups, rates and results only, no
// private data, no simulator run.
// Usage: node tools/test/whatif-skills.mjs        Exit code 0 on pass, 1 on fail.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XP, MAX_LEVEL, toNext, advance } from '../whatif/charm.mjs';
import { parseSkillLeft, trainedSkills, startOf, expToReach, hoursAt, foldTime, skillCands, ratesOf, slotUnlock, skillReport } from '../whatif/levers/skills.mjs';
import { applyOps } from '../whatif/variants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = (f) => JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data', f), 'utf8'));
const items = data('itemDetailMap.json'), styles = data('combatStyleDetailMap.json'), reqList = data('abilitySlotsLevelRequirementList.json');
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const throws = (f) => { try { f(); return false; } catch { return true; } };

// A weapon of a given style from the game data, so the fixtures stay generic.
const weaponOf = (style) => Object.values(items).find((it) => it.equipmentDetail?.combatStats?.combatStyleHrids?.[0] === style && /main_hand|two_hand/.test(it.equipmentDetail.type)).hrid;
const setup = (name, style, lv) => ({ name, player: { staminaLevel: lv.stamina ?? 50, intelligenceLevel: lv.intelligence ?? 50, attackLevel: lv.attack ?? 50, meleeLevel: lv.melee ?? 50, defenseLevel: lv.defense ?? 50, rangedLevel: lv.ranged ?? 50, magicLevel: lv.magic ?? 50, equipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: weaponOf(style), enhancementLevel: 0 }] }, abilities: [], houseRooms: {} });
const P1 = setup('P1', '/combat_styles/magic', { intelligence: 60, magic: 199 }), P2 = setup('P2', '/combat_styles/ranged', { intelligence: 95 });
const party = [P1, P2];

// Parsing the typed experience left.
const left = parseSkillLeft('P1:stamina=300.5K,magic=1.5M;P2:ranged=12');
check(near(left.P1.stamina, 300500) && near(left.P1.magic, 1.5e6) && left.P2.ranged === 12, 'parseSkillLeft: K, M and plain figures, two players');
check(Object.keys(parseSkillLeft(null)).length === 0 && Object.keys(parseSkillLeft(true)).length === 0, 'parseSkillLeft: nothing typed');
check(near(parseSkillLeft('P:a=2B').P.a, 2e9), 'parseSkillLeft: B suffix');
check(throws(() => parseSkillLeft('stamina=5')) && throws(() => parseSkillLeft('P:stamina=five')), 'parseSkillLeft: malformed input throws');

// Trained skills: the style's skill map.
check(JSON.stringify(trainedSkills(P1, items, styles).sort()) === JSON.stringify(['attack', 'defense', 'intelligence', 'magic', 'stamina']), 'trainedSkills: magic style');
check(trainedSkills(P2, items, styles).includes('ranged') && !trainedSkills(P2, items, styles).includes('magic'), 'trainedSkills: ranged style');

// Start: experience inside the level = span - left; level start when not typed; out of span throws.
const st = startOf(P1, ['stamina', 'attack'], { stamina: 1000 });
check(st.stamina.lv === 50 && near(st.stamina.xpIn, toNext(50) - 1000) && st.stamina.source === 'typed', 'startOf: typed left gives the progress inside the level');
check(st.attack.xpIn === 0 && /not known/.test(st.attack.source), 'startOf: untyped starts at the level start, said so');
check(throws(() => startOf(P1, ['stamina'], { stamina: toNext(50) + 1 })) && throws(() => startOf(P1, ['stamina'], { stamina: -1 })), 'startOf: left outside the level span throws');

// Experience to reach and hours, against charm.mjs's advance at a constant rate.
check(expToReach(50, 0, 1) === toNext(50) && expToReach(50, 100, 2) === toNext(50) + toNext(51) - 100, 'expToReach: one and two levels, minus progress');
check(expToReach(MAX_LEVEL, 0, 1) === null && expToReach(MAX_LEVEL - 1, 0, 1) === XP[MAX_LEVEL - 1] - XP[MAX_LEVEL - 2], 'expToReach: none past the top');
const rate = 12345.6, h3 = hoursAt(expToReach(80, 777, 3), rate);
const after = advance({ lv: { s: 80 }, xp: { s: 777 } }, { s: rate }, h3);
const before = advance({ lv: { s: 80 }, xp: { s: 777 } }, { s: rate }, h3 * 0.999);
check(after.lv.s === 83 && before.lv.s === 82, 'hoursAt: the level is reached exactly then (charm.mjs advance)');
check(hoursAt(5, 0) === Infinity && hoursAt(null, 5) === null && hoursAt(0, 5) === 0, 'hoursAt: no rate, no level, nothing left');
check(foldTime(0, 1e6) === 0 && foldTime(2, 1e6) === 2e6, 'foldTime: hours away x profit per hour');

// Candidates: trained skills, +1..+maxUp, stop at the top level, time only, the level op applies.
const cands = skillCands(party, 'P1', { maxUp: 2, items, styles });
check(cands.length === 9 && cands.every((c) => c.timeOnly && c.kind === 'skill' && c.cost.known && c.cost.cost === 0 && !c.monotone), 'skillCands: 4 skills x 2 + magic 199 -> 200 only; time only, cost 0, not monotone');
check(!cands.some((c) => c.id === 'P1:magic+2') && cands.some((c) => c.id === 'P1:magic+1'), 'skillCands: none past level 200');
const c = cands.find((x) => x.id === 'P1:stamina+2'), applied = applyOps(party, c.ops);
check(applied[0].player.staminaLevel === 52 && party[0].player.staminaLevel === 50 && applied[1].player.staminaLevel === 50, 'skillCands: the level op raises only that player and skill');

// Rates and the 5th slot gate.
const cp = (p1, p2, profit) => ({ party: { profitAfterTaxPerDay: profit }, players: { P1: { expPerHourBySkill: p1 }, P2: { expPerHourBySkill: p2 } } });
const cps = [cp({ magic: 100, intelligence: 10 }, { ranged: 50 }, 48e6), cp({ magic: 300, intelligence: 30 }, { ranged: 70 }, 72e6)];
const r1 = ratesOf(cps, 'P1');
check(near(r1.magic, 200) && near(r1.intelligence, 20) && r1.ranged === undefined, 'ratesOf: mean over the base runs, per player');
const gate = reqList[5];
const u1 = slotUnlock(P1, reqList, { xpIn: 0, source: 'x' }, 20);
check(!u1.open && u1.gate === gate && near(u1.days, (XP[gate - 1] - XP[60 - 1]) / 20 / 24), 'slotUnlock: days to the gate level at the rate');
check(slotUnlock(setup('P3', '/combat_styles/magic', { intelligence: gate }), reqList, null, 1).open, 'slotUnlock: open at the gate');

// The report: days per candidate from the base rates; gain per user; folded cost 0; unlock line.
const singles = cands.map((x, i) => ({ id: x.id, gain: 1e6 * (i + 1), se: 1e5, lastStage: '4x50' }));
const fmt = (x) => (x == null ? '-' : String(Math.round(x)));
const rep = skillReport({ singles, cands, setups: party, players: ['P1'], baseCps: cps, names: ['P1', 'P2'], left: { P1: { magic: 1000 } }, reqList, items, styles, goal: 'profit', fmt });
const mg = rep.json.rows.find((x) => x.id === 'P1:magic+1'), sta = rep.json.rows.find((x) => x.id === 'P1:stamina+1'), def = rep.json.rows.find((x) => x.id === 'P1:defense+1');
check(near(mg.days, 1000 / 200 / 24) && mg.startSource === 'typed', 'report: magic +1 days from the typed left and the base rate');
check(sta.days === Infinity && /never/.test(rep.lines.join('\n')), 'report: a skill with no EXP is never reached, said so');
check(near(def.gainUser, def.gain / 2) && def.foldedCost === 0 && def.hoursAway === 0, 'report: gain per user = party / party size; folded cost 0 (no time away)');
check(near(rep.json.ratePerHourUser, 60e6 / 2 / 24), 'report: the labelled rate is base party profit per day / users / 24');
check(rep.json.rows[0].gain >= rep.json.rows.at(-1).gain, 'report: rows by gain');
check(rep.json.unlocks.length === 1 && !rep.json.unlocks[0].open && rep.lines.some((l) => l.includes('5th ability slot')), 'report: 5th slot line');
const repX = skillReport({ singles, cands, setups: party, players: ['P1'], baseCps: cps, names: ['P1', 'P2'], left: {}, reqList, items, styles, goal: 'exp', fmt });
check(repX.json.rows.every((x) => x.gainUser === null) && !repX.lines.join('\n').includes('per user/day'), 'report: an EXP goal has no per-user coin column');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
