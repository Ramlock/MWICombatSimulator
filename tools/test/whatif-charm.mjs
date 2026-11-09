// Test: the charm what-if's arithmetic (tools/whatif/charm.mjs) and the level op (tools/whatif/variants.mjs).
// Synthetic setups, rates and profits only, no private data, no simulator run.
// Usage: node tools/test/whatif-charm.mjs        Exit code 0 on pass, 1 on fail.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XP, MAX_LEVEL, toNext, vecKey, parseKey, nextLevelUp, advance, trajectory, segAt, pairedDiff, wearSum, branches, payback, peakOf, candidates } from '../whatif/charm.mjs';
import { applyOps } from '../whatif/variants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const styles = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/combatStyleDetailMap.json'), 'utf8'));
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// The experience table: 200 levels, strictly rising, the game's figures at a few levels.
check(MAX_LEVEL === 200 && XP[0] === 0 && XP[1] === 33, 'table: 200 levels, level 1 at 0, level 2 at 33');
check(XP.every((x, i) => i === 0 || x > XP[i - 1]), 'table: strictly rising');
check(XP[99] === 1e7 && XP[124] === 1e8 && XP[145] === 950275074 && XP[149] === 1376277458 && XP[199] === 1e11, 'table: levels 100, 125, 146, 150, 200');
check(toNext(146) === 1043287971 - 950275074, 'toNext(146) is level 147 minus level 146');

// Keys.
const skills = ['a', 'b'];
check(vecKey({ a: 10, b: 20 }, skills) === 'a=10,b=20' && parseKey('a=10,b=20').b === 20, 'vecKey / parseKey round trip');

// Level-ups: the first skill to level, carry inside the level, several levels at once.
const s0 = { lv: { a: 10, b: 10 }, xp: { a: 0, b: 0 } };
const r = { a: toNext(10) / 5, b: toNext(10) / 8 };
const nx = nextLevelUp(s0, r);
check(nx.s === 'a' && near(nx.h, 5), 'nextLevelUp: a levels first, after 5 h');
const s1 = advance(s0, r, 6);
check(s1.lv.a === 11 && near(s1.xp.a, toNext(10) / 5) && s1.lv.b === 10 && near(s1.xp.b, 6 * toNext(10) / 8), 'advance: one level, the rest carries per skill');
const s2 = advance(s0, { a: 1e9 }, 1);
let lv = 10, left = 1e9; while (left >= toNext(lv)) { left -= toNext(lv); lv++; }
check(s2.lv.a === lv && near(s2.xp.a, left) && s2.lv.b === 10, 'advance: several level-ups in one step');
check(nextLevelUp({ lv: { a: 200 }, xp: { a: 0 } }, { a: 1 }) === null, 'nextLevelUp: none at the top level');

// Trajectory: constant rates, level-ups in time order, unknown vectors stop it (or are walked, provisional).
const rates = { a: toNext(10) / 24, b: 0 };
const tr = trajectory(s0, skills, () => rates, 24 * 3);
check(tr.segs[0].up === 'a' && near(tr.segs[0].t1, 24) && tr.segs[1].lv.a === 11 && !tr.need.length, 'trajectory: first level-up at 24 h, then level 11');
check(tr.segs.every((s, i) => i === 0 || near(s.t0, tr.segs[i - 1].t1)) && near(tr.segs.at(-1).t1, 72), 'trajectory: segments join and end at the horizon');
const known = new Set([vecKey(s0.lv, skills)]);
const tr0 = trajectory(s0, skills, (k) => (known.has(k) ? rates : null), 1000, 0);
check(tr0.segs.length === 1 && tr0.need.length === 1 && tr0.need[0] === 'a=11,b=10', 'trajectory: stops at the first unrun vector and names it');
const tr2 = trajectory(s0, skills, (k) => (known.has(k) ? rates : null), 1000, 2);
check(tr2.need.length === 3 && tr2.segs.length === 3 && tr2.segs[1].provisional && !tr2.segs[0].provisional, 'trajectory: walks 2 unrun vectors on the last rates, marked provisional');
check(segAt(tr.segs, 0) === tr.segs[0] && segAt(tr.segs, 24) === tr.segs[1] && segAt(tr.segs, 72) === tr.segs.at(-1), 'segAt: half-open segments, the end maps to the last');

// Profits: per seed, per user; f(key) = level a x 100 + seed noise shared by every key (paired).
const seedsN = [1, 2, 3, 4];
const fOf = (key) => { const v = parseKey(key); return { mean: v.a * 100, seeds: new Map(seedsN.map((s) => [s, v.a * 100 + v.b * 10 + s * 1000])) }; };
const d = pairedDiff(fOf, 'a=12,b=10', 'a=10,b=10');
check(near(d.mean, 200) && near(d.se, 0) && d.n === 4, 'pairedDiff: shared seed noise cancels');
check(pairedDiff(() => null, 'x', 'y') === null, 'pairedDiff: unrun vector gives null');
check(payback(100, 10) === 10 && payback(-5, 10) === 0 && payback(100, 0) === Infinity && payback(100, -1) === Infinity, 'payback: cost / gain; a gain makes a negative cost 0 days; no gain never pays');

// Wear sum and branches: charm run levels a every 24 h; the baseline levels b every 48 h.
const cSegs = trajectory(s0, skills, (k) => ({ a: toNext(parseKey(k).a) / 24 }), 24 * 4).segs;
const bRate = (k) => ({ b: toNext(parseKey(k).b) / 48 });
const baseSegs = trajectory(s0, skills, bRate, 24 * 10).segs;
// Over [0, 24): same vector, 0. [24, 48): a=11,b=10 vs a=10,b=10: +100/day. [48, 72): a=12,b=10 vs a=10,b=11: +200 - 10.
const w = wearSum(fOf, cSegs, baseSegs, 72);
check(near(w, 0 + 100 + 190, 1e-4), 'wearSum: per-day differences times days, over the merged segments');
const br = branches({ skill: 'a', segs: cSegs, baseSegs, f: fOf, costRound: 1000, nUsers: 3 });
check(br.length >= 3 && br[0].level === 11 && near(br[0].days, 1, 1e-4), 'branches: one per level-up of the charm skill, the level after it');
check(near(br[1].gainUser, 200 - 10, 1e-4) && near(br[1].wearUser, 100, 1e-4) && near(br[1].costUser, 1000 - 100, 1e-4) && near(br[1].costParty, 1000 - 300, 1e-4), 'branches: gain vs baseline at the same time; wear profit lowers the cost (per user and x party)');
check(near(br[1].paybackUserDays, 900 / 190, 1e-4) && near(br[1].paybackPartyDays, 700 / 570, 1e-4), 'branches: payback per user and per party');

// Peak and the fall rule.
const rows = [1, 3, 5, 4, 4.5, 2, 6].map((g, i) => ({ gainUser: g, hours: i }));
const pk = peakOf(rows, 3);
check(pk.past && pk.peak.gainUser === 5 && pk.stopHours === 5, 'peakOf: past after 3 level-ups in a row below the peak');
const pk2 = peakOf(rows.slice(0, 5), 3);
check(!pk2.past && pk2.peak.gainUser === 5, 'peakOf: not past after 2');

// Candidates: a magic-style setup trains five skills; a skill below the charm's requirement is left out; the worn charm is the baseline.
const setup = { name: 'P', player: { staminaLevel: 120, intelligenceLevel: 125, attackLevel: 150, defenseLevel: 99, magicLevel: 146, meleeLevel: 50, rangedLevel: 50,
    equipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/rippling_trident', enhancementLevel: 0 }, { itemLocationHrid: '/item_locations/charm', itemHrid: '/items/master_attack_charm', enhancementLevel: 5 }] } };
const c = candidates(setup, items, styles, 'master');
check(c.style === '/combat_styles/magic' && c.skills.sort().join() === 'attack,defense,intelligence,magic,stamina', 'candidates: the magic style trains stamina, intelligence, attack, defense, magic');
check(c.charms.map((x) => x.skill).sort().join() === 'attack,intelligence,magic,stamina', 'candidates: defense 99 is below the master charm requirement');
check(c.base.skill === 'attack' && c.base.level === 5, 'candidates: the worn charm is the baseline');

// The level op.
const party = [{ name: 'P', player: { magicLevel: 146 } }];
check(applyOps(party, [{ op: 'level', player: 'P', skill: 'magic', delta: 2 }])[0].player.magicLevel === 148 && party[0].player.magicLevel === 146, 'level op: raises the skill on a copy');
let threw = false; try { applyOps(party, [{ op: 'level', player: 'P', skill: 'cooking', delta: 1 }]); } catch { threw = true; }
check(threw, 'level op: an unknown skill throws');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
