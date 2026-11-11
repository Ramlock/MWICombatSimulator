// Test: dominated market swaps (tools/whatif/dominated.mjs) and how the optimizer uses them (tools/whatif/optimize.mjs).
// Generic test items are added to the engine's own item map (same module instance), so the engine's
// Equipment.getCombatStat judges them with its enhancement bonus. No private data.
// Usage: node tools/test/whatif-dominated.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href); // registers the loader hooks dominated.mjs needs
const D = await import(pathToFileURL(path.join(root, 'tools/whatif/dominated.mjs')).href);
const { default: items } = await import(new URL('file:///' + path.join(root, 'src/combatsimulator/data/itemDetailMap.json').replace(/\\/g, '/')).href);
const table = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json'), 'utf8'));

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

const add = (name, combatStats, extra = {}) => {
    const hrid = '/items/test_dom_' + name;
    items[hrid] = { hrid, name, equipmentDetail: { type: extra.type || '/equipment_types/feet', levelRequirements: extra.req || [], combatStats, noncombatStats: extra.noncombat || {}, combatEnhancementBonuses: extra.bonus || {}, noncombatEnhancementBonuses: {} } };
    return items[hrid];
};
const dom = (w, wl, x, xl) => D.isDominatedSwap(w, wl, x, xl);

// Armor pieces.
const W = add('worn', { armor: 10, stabEvasion: 0.1 }, { bonus: { armor: 1, stabEvasion: 0.01 } });
const lower = add('lower', { armor: 8 }, { bonus: { armor: 1 }, req: [{ skillHrid: '/skills/defense', level: 1 }] });
check(dom(W, 0, lower, 0), 'a swap lower on every stat is dominated (different level requirements are not compared)');
check(dom(W, 0, add('equal', { armor: 10, stabEvasion: 0.1 }), 0), 'equal on every stat is dominated (no better on any stat)');
check(!dom(W, 0, add('better1', { armor: 12 }), 0), 'better on one stat: offered');
check(!dom(W, 0, add('newkey', { armor: 5, magicDamage: 0.01 }), 0), 'a stat key the worn item lacks: offered');
check(!dom(W, 0, add('neg', { armor: 5, stabEvasion: -0.01 }), 0), 'a negative stat on the candidate: offered');
check(!dom(add('wneg', { armor: 10, stabEvasion: -0.05 }), 0, lower, 0), 'a negative stat on the worn item: offered');
check(!dom(W, 0, add('noncombat', { armor: 5 }, { noncombat: { gatheringSpeed: 0.01 } }), 0), 'a noncombat stat on the candidate: offered');
check(!dom(add('wnoncombat', { armor: 10 }, { noncombat: { gatheringSpeed: 0.01 } }), 0, lower, 0), 'a noncombat stat on the worn item: offered');

// Enhancement, judged at each item's own level through the engine.
const base12 = add('base12', { armor: 12 });
check(table[10] * 1 + 10 > 12, 'fixture: the worn item at +10 beats 12 armor');
check(!dom(W, 0, base12, 0) && dom(add('w10', { armor: 10 }, { bonus: { armor: 1 } }), 10, base12, 0), 'an enhanced worn item against a better base item at +0: offered at +0, dominated at +10');
check(!dom(W, 0, lower, 5) && dom(W, 5, lower, 5), 'the candidate is judged at the level the swap gives it (8 + bonus at +5 against 10 at +0 / +5)');
check(Math.abs(D.combatStatsAt(W, 3).armor - (10 + table[3])) < 1e-9, 'combatStatsAt: base + the engine\'s enhancement bonus');

// Weapons: non-stat fields must be equal.
const wep = (name, s, extra) => add(name, { combatStyleHrids: ['/combat_styles/stab'], damageType: '/damage_types/physical', attackInterval: 3e9, primaryTraining: '/skills/melee', ...s }, { type: '/equipment_types/main_hand', ...extra });
const WW = wep('wworn', { stabDamage: 0.5, stabAccuracy: 0.3 });
check(dom(WW, 0, wep('wlower', { stabDamage: 0.4 }), 0), 'a weapon lower on every stat with the same style, damage type, interval, training: dominated');
check(D.combatStatsAt(WW, 0).attackInterval === undefined && D.combatStatsAt(WW, 0).stabDamage === 0.5, 'non-stat fields are not read as stats');
check(!dom(WW, 0, wep('wint', { stabDamage: 0.4, attackInterval: 2.5e9 }), 0), 'a different attack interval: offered');
check(!dom(WW, 0, wep('wstyle', { stabDamage: 0.4, combatStyleHrids: ['/combat_styles/slash'] }), 0), 'a different combat style: offered');
check(!dom(WW, 0, wep('wdmg', { stabDamage: 0.4, damageType: '/damage_types/fire' }), 0), 'a different damage type: offered');
check(!dom(WW, 0, wep('wtrain', { stabDamage: 0.4, primaryTraining: '/skills/attack' }), 0), 'a different primary training: offered');
check(!dom(WW, 0, wep('wfocus', { stabDamage: 0.4, focusTraining: '/skills/melee' }), 0), 'a focus training on one only: offered');
{
    const odd = wep('wodd', { stabDamage: 0.4 });
    odd.equipmentDetail.someNewField = 1;
    check(!dom(WW, 0, odd, 0), 'any other differing equipmentDetail field: offered');
}

// The optimizer: market swaps only, recorded in result.json `dominated`, never offered.
const opt = readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
const loop = opt.slice(opt.indexOf('function candidatesFor'), opt.indexOf('// ---- Phase 2 levers'));
check((opt.match(/isDominatedSwap\(/g) || []).length === 1 && /isDominatedSwap\(itemDetailMap\[it\.itemHrid\], it\.enhancementLevel, item, L\)/.test(loop), 'optimizer: only the market-swap loop checks dominance (not owned items, pairs or enhance)');
check(/dominated\.push\(\{ id, player: p, slot, desc, from: \{ item: it\.itemHrid, level: it\.enhancementLevel \}, to: \{ item: item\.hrid, level: L \} \}\)/.test(loop) && /continue;/.test(loop.slice(loop.indexOf('dominated.push'))), 'optimizer: a dominated swap is listed (id, player, slot, desc, item pair) and skipped');
check(/overBudget: \[\], overPayback: \[\], dominated, skippedNoExport: \[\], notConfirmed: \[\],/.test(opt), 'result.json: the dominated group');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
