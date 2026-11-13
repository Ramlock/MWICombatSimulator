// Test: a swap is limited to the player's combat style and, for magic, the element (tools/whatif/stylefit.mjs), and both
// candidate builders (market swaps and owned items) use it. Real item data, invented setups. No private data.
// Usage: node tools/test/whatif-stylefit.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = await import(pathToFileURL(path.join(root, 'tools/whatif/stylefit.mjs')).href);
const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const byName = (n) => Object.values(items).find((i) => i.name === n);
const weapon = (style, damage) => Object.values(items).find((i) => /main_hand|two_hand/.test(i.equipmentDetail?.type || '') && i.equipmentDetail.combatStats?.combatStyleHrids?.[0]?.endsWith('/' + style) && (damage ? i.equipmentDetail.combatStats.damageType?.endsWith('/' + damage) : true));
const setupOf = (w) => ({ player: { equipment: w ? [{ itemLocationHrid: '/item_locations/' + (w.equipmentDetail.type.endsWith('two_hand') ? 'two_hand' : 'main_hand'), itemHrid: w.hrid, enhancementLevel: 0 }] : [] } });

const melee = playerOf(weapon('slash')), ranger = playerOf(weapon('ranged')), fire = playerOf(weapon('magic', 'fire')), water = playerOf(weapon('magic', 'water'));
function playerOf(w) { return S.playerFit(setupOf(w), items); }
check(melee.style === 'melee' && ranger.style === 'ranged' && fire.style === 'magic' && fire.element === 'fire' && water.element === 'water', 'the player: style from the weapon (stab, slash, smash are melee), element from a mage\'s weapon');
check(S.playerFit(setupOf(null), items).style === 'melee' && S.playerFit(setupOf(null), items).element === null && ranger.element === null, 'no weapon is melee; only a mage has an element');

const corsair = byName('Corsair Helmet'), hood = byName('Acrobatic Hood');
check(S.misfit(corsair, ranger) !== null, 'a melee helmet on a ranger is dropped (the owner\'s example: Corsair Helmet)');
check(S.misfit(hood, ranger) === null, 'a ranged hood on a ranger is kept');
check(S.misfit(corsair, melee) === null && S.misfit(hood, melee) !== null, 'the same two on a melee player: the other way round');
check(S.misfit(corsair, fire) !== null && S.misfit(hood, fire) !== null, 'both are dropped for a mage');
check(S.boundsOf(corsair).styles.join() === 'melee' && S.boundsOf(hood).styles.join() === 'ranged', 'the negative magicAccuracy of a melee or ranged piece binds nothing');

// Style-free pieces stay candidates, whatever their armour: no offensive stat, or only Evasion, Resistance, armor.
const neutral = Object.values(items).find((i) => i.equipmentDetail?.type?.endsWith('/head') && Object.entries(i.equipmentDetail.combatStats || {}).every(([k, v]) => !/^(stab|slash|smash|melee|ranged|magic|fire|water|nature)(Accuracy|Damage|Experience|Amplify|Penetration)$/.test(k) || !(v > 0)) && !i.equipmentDetail.combatStats.combatStyleHrids);
check(neutral && [melee, ranger, fire].every((f) => S.misfit(neutral, f) === null), 'a piece with no positive offensive stat is neutral and kept for every style (' + (neutral && neutral.name) + ')');
check(S.misfit({ equipmentDetail: { combatStats: { armor: 40, rangedEvasion: 0.3, fireResistance: 5 } } }, melee) === null, 'Evasion, Resistance and armor bind nothing');

// Elements: a mage takes his own element's gear and neutral gear, never another element\'s; others have no element.
const fireAmp = { equipmentDetail: { combatStats: { magicDamage: 0.1, fireAmplify: 0.2 } } }, waterAmp = { equipmentDetail: { combatStats: { magicDamage: 0.1, waterAmplify: 0.2 } } }, plainMagic = { equipmentDetail: { combatStats: { magicDamage: 0.1 } } };
check(S.misfit(fireAmp, fire) === null && S.misfit(fireAmp, water) !== null && S.misfit(waterAmp, water) === null && S.misfit(waterAmp, fire) !== null, 'a mage: his element\'s gear fits, another element\'s does not');
check(S.misfit(plainMagic, fire) === null && S.misfit(plainMagic, water) === null && S.misfit(fireAmp, ranger) !== null, 'magic gear with no element fits every mage; an element-bound piece fails a player with no element');
const fireOnly = { equipmentDetail: { combatStats: { firePenetration: 0.05 } } };
check(S.misfit(fireOnly, fire) === null && S.misfit(fireOnly, water) !== null && S.misfit(fireOnly, melee) !== null, 'Penetration binds like Amplify');

// Weapons: a swap to a weapon of another style, or another element for a mage, is dropped.
const wMelee = weapon('slash'), wRanged = weapon('ranged'), wFire = weapon('magic', 'fire'), wWater = weapon('magic', 'water');
check(S.misfit(wMelee, ranger) !== null && S.misfit(wRanged, ranger) === null && S.misfit(wRanged, melee) !== null, 'a melee weapon on a ranger is dropped, a ranged one kept');
check(S.misfit(wWater, fire) !== null && S.misfit(wFire, fire) === null && S.misfit(wFire, ranger) !== null, 'a water weapon on a fire mage is dropped, a fire one kept');
for (const style of ['stab', 'slash', 'smash']) { const w = weapon(style); check(!w || S.boundsOf(w).styles.join() === 'melee', style + ' weapons are melee'); }

// The optimizer: one filter at both call sites (market swaps, owned items), after the cheap checks, the list in result.json.
const core = readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
const market = core.slice(core.indexOf('function candidatesFor'), core.indexOf('// ---- Phase 2 levers'));
const owned = core.slice(core.indexOf('function ownedCands'), core.indexOf('function abilityCands'));
check((core.match(/misfit\(/g) || []).length === 1 && /styleDrop\(fit, item, \{ id, player: p, slot, desc, from: it \? \{ item: it\.itemHrid, level: it\.enhancementLevel \} : null, to: \{ item: item\.hrid, level: L \} \}\)\) continue;/.test(market) && /playerFit\(s, itemDetailMap\)/.test(market), 'optimizer: the market-swap loop drops by styleDrop');
check(/styleDrop\(fit, item, \{ id: `\$\{p\}:\$\{slot\}=own:/.test(owned) && /playerFit\(s, itemDetailMap\)/.test(owned), 'optimizer: the owned-items loop drops by the same styleDrop');
check(market.indexOf('styleDrop(') < market.indexOf('isDominatedSwap(') && market.indexOf('pricer.swap(') < market.indexOf('styleDrop('), 'optimizer: only swaps the market sells are listed as dropped, before the dominance check');
check(/otherStyle\.push\(\{ \.\.\.rec, bound, wants: fit \}\)/.test(core) && /dominated, otherStyle, skippedNoExport: \[\]/.test(core), 'result.json: the otherStyle group (bound styles and elements, what the player wants)');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
