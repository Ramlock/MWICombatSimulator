// Test: damage-bonus attribution core (tools/attribution/attribution-core.mjs) on fake formulas, hand-computed hits and a
// generic one-player fixture built from the game data (no party data).
// Usage: node tools/test/bonus-attribution.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../attribution/engine-node.mjs';
import * as core from '../attribution/attribution-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engine = await loadEngine();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('FAIL', msg); } };
const near = (a, b, msg, tol = 1e-9) => ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ' got ' + a + ' want ' + b);

// 1. The core is bundleable: no Node-only or DOM imports.
const coreSrc = fs.readFileSync(path.join(root, 'tools/attribution/attribution-core.mjs'), 'utf8');
ok(!/^\s*import\s/m.test(coreSrc), 'core has no import statements');
ok(!/\brequire\(|\bprocess\.|\bdocument\.|\bwindow\.(?!players|buffEvents)/.test(coreSrc), 'core uses no require/process/DOM');

// 2. hitModel by hand: a fake ranged physical source against a fake target.
const P = (o) => ({ combatDetails: o });
const src = P({ rangedAccuracyRating: 400, rangedMaxDamage: 500, totalArmor: 50, combatStats: { combatStyleHrid: '/combat_styles/ranged', damageType: '/damage_types/physical', criticalRate: 0.1, criticalDamage: 0.5, physicalAmplify: 0.2, taskDamage: 0.1, autoAttackDamage: -0.5, abilityDamage: 0.25, armorPenetration: 0.5 } });
const tgt = P({ rangedEvasionRating: 300, totalArmor: 60, combatStats: { damageTaken: 0.1 } });
{
    const m = core.hitModel(src, tgt, null, true);
    const hc = 400 ** 1.4 / (400 ** 1.4 + 300 ** 1.4);
    near(m.hc, hc, 'hit chance');
    near(m.cc, 0.3 * hc + 0.1, 'ranged crit chance');
    const k = (100 / (100 + 60 / 1.5)) * 1.1 * 1.1 * 0.5; // taken ratio, task, damageTaken, auto attack -50%
    near(m.A, k * 1.2 * 1, 'auto attack min (A)');
    near(m.B, k * 1.2 * (500 - 1), 'auto attack range (B)');
    near(m.C, k * 1.2 * 500 * 1.5, 'auto attack crit (C)');
    const noTask = core.hitModel(src, tgt, null, false);
    near(noTask.C * 1.1, m.C, 'task damage applies only on a task monster');
    const eff = { combatStyleHrid: '/combat_styles/ranged', damageType: '/damage_types/physical', damageFlat: 20, damageRatio: 0.5, bonusAccuracyRatio: 0, armorDamageRatio: 0 };
    const a = core.hitModel(src, tgt, eff, true);
    const ka = (100 / (100 + 40)) * 1.1 * 1.1 * 1.25;
    near(a.A, ka * 1.2 * 21, 'ability min');
    near(a.A + a.B, ka * 1.2 * (0.5 * 500 + 20), 'ability max');
    const neg = core.hitModel(src, P({ rangedEvasionRating: 300, totalArmor: -20, combatStats: {} }), null, false);
    near(neg.C, 1.2 * 500 * 1.5 * 0.5 * 1.2, 'negative armor: (100 - res) / 100, no penetration');
}

// 3. keyValue: affine in u, so u-bar of a key equals the per-hit u's; conditional with s = f equals off.
{
    const f = { hc: 0.8, cc: 0.4, A: 10, B: 100, C: 300 }, s = { hc: 0.6, cc: 0.2, A: 8, B: 80, C: 200 };
    const us = [0.1, 0.7, 0.4];
    const perHit = us.reduce((t, u) => t + s.A + u * s.B + core.ROUND_UP, 0) + 2 * (s.C + core.ROUND_UP);
    const key = { nCrit: 2, nNorm: 3, sumU: us.reduce((a, b) => a + b, 0) };
    near(core.keyValue(key, s, f, 'off'), perHit, 'u-bar equals per-hit u');
    near(core.keyValue(key, f, f, 'conditional'), core.keyValue(key, f, f, 'off'), 'conditional = off at the full model');
    const q = 0.2 / 0.4, hit = 0.6 / 0.8;
    const want = hit * (2 * (q * 200 + (1 - q) * (8 + 0.5 * 80)) + 3 * 8 + key.sumU * 80 + core.ROUND_UP * 5);
    near(core.keyValue(key, s, f, 'conditional'), want, 'conditional: hit and crit kept with s/f odds');
}

// 4. attributeBonuses on a keyValue formula: base + shapley = full; leave-one-out by hand.
{
    const key = { nCrit: 1, nNorm: 2, sumU: 1 };
    const model = (on) => ({ hc: 1, cc: 0.5, A: 1 * (on[0] ? 1.5 : 1), B: 100 * (on[0] ? 1.5 : 1) * (on[1] ? 2 : 1), C: 300 * (on[0] ? 1.5 : 1) * (on[1] ? 2 : 1) });
    const full = model([true, true]);
    const f = (on) => core.keyValue(key, model(on), full, 'off');
    const r = engine.attributeBonuses(f, ['amp', 'max']);
    near(r.base + r.shapley[0] + r.shapley[1], r.full, 'shares sum to the full damage');
    near(r.leaveOneOut[1], f([true, true]) - f([true, false]), 'leave-one-out by hand');
    const rel = core.relevantUnits((names) => (on) => f([on[0], on[1]]) + (on[2] ? 0 : 0), ['amp', 'max', 'nothing']);
    ok(rel.length === 2 && !rel.includes('nothing'), 'relevantUnits drops a unit with no effect');
}

// 5. Data inference: task badge from taskDamage, shrine level from a guild buff value.
ok(core.inferTaskBadge(engine, 0.15)?.hrid === '/items/expert_task_badge', 'expert task badge from 0.15');
ok(core.inferTaskBadge(engine, 0) === null, 'no badge from 0');
{
    const lv = core.inferShrineLevels(engine, { '/buff_uniques/damage_guild_buff': { ratioBoost: 0.006, flatBoost: 0 } });
    ok(lv.force === 2, 'force shrine level 2 from damage ratio 0.006');
}

// 6. Generic one-player fixture: a crossbow, a coffee, one encounter; solve u-bar back from a constructed amount.
{
    const setup = { player: { staminaLevel: 100, intelligenceLevel: 100, attackLevel: 100, meleeLevel: 1, defenseLevel: 100, rangedLevel: 100, magicLevel: 1, equipment: [{ itemLocationHrid: '/item_locations/two_hand', itemHrid: '/items/cursed_bow', enhancementLevel: 0 }] }, abilities: [{ abilityHrid: '/abilities/rain_of_arrows', level: 10 }], drinks: { '/action_types/combat': [{ itemHrid: '/items/super_ranged_coffee' }] }, food: {}, houseRooms: { '/house_rooms/archery_range': 2 }, achievements: {} };
    const party = [{ key: 'A', setup, base: core.baseFromSetup(engine, setup) }];
    const units = core.playerUnits(engine, party, 0, {});
    ok(units.some((u) => u.id === 'gear:two_hand') && units.some((u) => u.id === 'drink:super_ranged_coffee') && units.some((u) => u.id === 'house:archery_range'), 'units: gear, drink, house');
    ok(units.every((u) => u.owner === 'A'), 'every unit owned by the player');
    ok(!units.some((u) => u.kind === 'level'), 'levels are part of the base by default');
    ok(core.playerUnits(engine, party, 0, { levelsAsUnits: true }).some((u) => u.id === 'level:ranged'), 'levels as units on request');
    const drinkBuff = engine.itemDetailMap['/items/super_ranged_coffee'].consumableDetail.buffs[0].uniqueHrid;
    const t0 = 1_000_000, t1 = t0 + 20_000;
    const window = { startedAt: t0, endedAt: t1, players: [{ slot: 0, stats: { abilities: [{ abilityHrid: '/abilities/rain_of_arrows', level: 10 }], buffs: { [drinkBuff]: { uniqueHrid: drinkBuff, duration: 300e9, startTime: new Date(t0 - 1000).toISOString() } } } }], buffEvents: [] };
    const ctx = { party, slotToParty: { 0: 0 }, tier: 0, tasks: new Set(), units };
    const ev = core.makeEvaluator(engine, ctx, 0);
    const p = ev(new Map(), ['drink:super_ranged_coffee']).player;
    const m = core.buildMonster(engine, '/monsters/fly', 0, []);
    const hm = core.hitModel(p, m, null, false);
    const u = 0.3, hits = 5, crits = 2;
    const amount = Math.round(crits * hm.C + (hits - crits) * (hm.A + u * hm.B) + core.ROUND_UP * hits);
    const enc = { battleId: 1, startedAt: t0, endedAt: t1, casts: [], players: [{ slot: 0, dealt: { total: amount, bySource: { auto: { amount, hits, crits } }, byMonster: { '/monsters/fly': amount } } }] };
    const { keys, perEnc } = core.buildKeys(engine, ctx, window, [enc], 0);
    near(perEnc[0].sources[0].u, u, 'u-bar solved back', 1e-3);
    ok(keys.length === 1 && keys[0].tags.includes('u:drink:super_ranged_coffee'), 'coffee active over the whole encounter');
    const names = units.map((x) => x.id);
    const f = core.makeFormula(engine, ctx, 0, keys, names, {});
    near(f(names.map(() => true)), amount, 'full formula reproduces the recorded amount', 1e-6);
    const r = engine.attributeBonuses(f, names);
    near(r.base + r.shapley.reduce((a, b) => a + b, 0), r.full, 'fixture: shares sum to full');
    const coffee = names.indexOf('drink:super_ranged_coffee');
    ok(r.leaveOneOut[coffee] > 0 && r.shapley[coffee] > 0, 'coffee adds damage');
    // Half-time coffee: two segments of equal weight.
    const w2 = { ...window, players: [{ ...window.players[0], stats: { ...window.players[0].stats, buffs: { [drinkBuff]: { uniqueHrid: drinkBuff, duration: 11e9, startTime: new Date(t0 - 1000).toISOString() } } } }] };
    const k2 = core.buildKeys(engine, ctx, w2, [enc], 0).keys;
    ok(k2.length === 2 && Math.abs(k2[0].nCrit - 1) < 1e-9, 'coffee half the encounter: two keys, hits split by time');
}

// 7. Ownership totals.
{
    const res = [{ targetKey: 'A', recorded: 100, units: [{ owner: 'A', leaveOneOut: 10, shapley: 8 }, { owner: 'B', leaveOneOut: 5, shapley: 4 }] }, { targetKey: 'B', recorded: 50, units: [{ owner: 'A', leaveOneOut: 3, shapley: 2 }] }];
    const o = core.ownershipTotals(res);
    ok(o.A.ownDamage === 100 && o.A.addedToOthers.shapley === 2 && o.A.addedByOthers.leaveOneOut === 5, 'ownership A');
    ok(o.B.addedToOthers.leaveOneOut === 5 && o.B.addedByOthers.shapley === 2, 'ownership B');
}

// 8. Slot matching by abilities, recorded ability levels win.
{
    const party = [{ key: 'X', base: { abilities: [{ hrid: '/abilities/a', level: 5 }] } }, { key: 'Y', base: { abilities: [{ hrid: '/abilities/b', level: 3 }] } }];
    const w = { players: [{ slot: 0, stats: { abilities: [{ abilityHrid: '/abilities/b', level: 2 }] } }, { slot: 1, stats: { abilities: [{ abilityHrid: '/abilities/a', level: 5 }] } }] };
    const map = core.matchSlots(w, party);
    ok(map[0] === 1 && map[1] === 0, 'slots matched by abilities');
    const ch = core.useRecordedAbilityLevels(w, party, map);
    ok(ch.length === 1 && party[1].base.abilities[0].level === 2, 'recorded ability level replaces the export level');
}

console.log(passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
