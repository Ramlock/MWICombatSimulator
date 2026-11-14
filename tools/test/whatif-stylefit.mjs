// Test: a change is limited to the player's combat style and, for magic, the element (tools/whatif/stylefit.mjs): gear
// (misfit: bounds, rules P and F) and abilities (abilityMisfit: rules D and B), and every candidate builder uses them (market
// swaps, owned items, enhance steps, ability swaps; books and ability levels in whatif-houses.mjs). Real game data, invented
// setups. No private data.
// Usage: node tools/test/whatif-stylefit.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = await import(pathToFileURL(path.join(root, 'tools/whatif/stylefit.mjs')).href);
const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
const abilities = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/abilityDetailMap.json'), 'utf8'));

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
const neutral = Object.values(items).find((i) => i.equipmentDetail?.type?.endsWith('/head') && Object.entries(i.equipmentDetail.combatStats || {}).every(([k, v]) => !/^(stab|slash|smash|melee|ranged|magic|fire|water|nature)(Accuracy|Damage|Experience|Amplify|Penetration)$/.test(k) || v === 0) && !i.equipmentDetail.combatStats.combatStyleHrids);
check(neutral && [melee, ranger, fire].every((f) => S.misfit(neutral, f) === null), 'a piece with no positive offensive stat is neutral and kept for every style (' + (neutral && neutral.name) + ')');
check(S.misfit({ equipmentDetail: { combatStats: { armor: 40, rangedEvasion: 0.3, fireResistance: 5 } } }, melee) === null, 'Evasion, Resistance and armor bind nothing');

// Elements: a mage takes his own element's gear and neutral gear, never another element\'s; others have no element.
const fireAmp = { equipmentDetail: { combatStats: { magicDamage: 0.1, fireAmplify: 0.2 } } }, waterAmp = { equipmentDetail: { combatStats: { magicDamage: 0.1, waterAmplify: 0.2 } } }, plainMagic = { equipmentDetail: { combatStats: { magicDamage: 0.1 } } };
check(S.misfit(fireAmp, fire) === null && S.misfit(fireAmp, water) !== null && S.misfit(waterAmp, water) === null && S.misfit(waterAmp, fire) !== null, 'a mage: his element\'s gear fits, another element\'s does not');
check(S.misfit(plainMagic, fire) === null && S.misfit(plainMagic, water) === null && S.misfit(fireAmp, ranger) !== null, 'magic gear with no element fits every mage; magic gear with an element still fails a ranger by its style');
const fireOnly = { equipmentDetail: { combatStats: { firePenetration: 0.05 } } };
check(S.misfit(fireOnly, fire) === null && S.misfit(fireOnly, water) !== null && S.misfit(fireOnly, melee) === null && S.misfit(fireOnly, ranger) === null, 'Penetration binds like Amplify; a player with no element is never failed by an element binding');
// A player with no element is failed by a piece's style only (the old rule dropped these for him).
const marine = items['/items/marine_tunic'], marineLegs = items['/items/marine_chaps'], tome = items['/items/tome_of_healing'];
check(S.misfit(marine, ranger) === null && S.misfit(marineLegs, ranger) === null && S.misfit(marine, melee) !== null && S.misfit(marine, fire) !== null, 'Marine Tunic and Marine Chaps (ranged, water amplify) fit a ranger, not a melee player or a mage');
const nature = playerOf(weapon('magic', 'nature'));
check(S.misfit(tome, melee) === null && S.misfit(tome, ranger) === null && S.misfit(tome, nature) === null && S.misfit(tome, fire) !== null && S.misfit(tome, water) !== null, 'Tome of Healing (nature amplify, no style) fits melee, ranged and nature mages, not fire or water mages');

// Weapons: a swap to a weapon of another style, or another element for a mage, is dropped.
const wMelee = weapon('slash'), wRanged = weapon('ranged'), wFire = weapon('magic', 'fire'), wWater = weapon('magic', 'water');
check(S.misfit(wMelee, ranger) !== null && S.misfit(wRanged, ranger) === null && S.misfit(wRanged, melee) !== null, 'a melee weapon on a ranger is dropped, a ranged one kept');
check(S.misfit(wWater, fire) !== null && S.misfit(wFire, fire) === null && S.misfit(wFire, ranger) !== null, 'a water weapon on a fire mage is dropped, a fire one kept');
for (const style of ['stab', 'slash', 'smash']) { const w = weapon(style); check(!w || S.boundsOf(w).styles.join() === 'melee', style + ' weapons are melee'); }

// Rule P: a negative of the player's own style's accuracy or damage (a mage: also his element's amplify or penetration).
const plate = items['/items/rainbow_plate_body'], buckler = items['/items/cheese_buckler'];
check(S.misfit(plate, fire)?.penalty?.includes('magicAccuracy') && S.misfit(plate, water) !== null && S.misfit(plate, nature) !== null, 'a mage is not offered Rainbow Plate Body (its magic accuracy penalty)');
check(S.misfit(buckler, fire) !== null && S.misfit(plate, melee) === null && S.misfit(buckler, melee) === null, 'bucklers are dropped for a mage too; plate and bucklers stay for a melee player');
const negFire = { equipmentDetail: { combatStats: { armor: 10, fireAmplify: -0.05 } } }, negStab = { equipmentDetail: { combatStats: { armor: 10, stabAccuracy: -0.05 } } };
check(S.misfit(negFire, fire)?.penalty?.join() === 'fireAmplify' && S.misfit(negFire, water) === null, "a mage: a penalty to his own element drops the piece, another element's does not");
check(S.misfit(negStab, melee)?.penalty?.join() === 'stabAccuracy' && S.misfit(negStab, ranger) === null, 'stab, slash and smash penalties are melee penalties');
// P drops no piece bound to the player's own style, anywhere in the game data (the audit: that set is empty).
const COMBAT = /\/(head|body|legs|feet|hands|main_hand|two_hand|off_hand|pouch|back|neck|earrings|ring|trinket|charm)$/;
const combatPieces = Object.values(items).filter((i) => COMBAT.test(i.equipmentDetail?.type || ''));
check([melee, ranger, fire, water, nature].every((f) => combatPieces.every((i) => !S.boundsOf(i).styles.includes(f.style) || !S.misfit(i, f)?.penalty)), "rule P never drops a piece bound to the player's own style");

// Rule F: for a ranger, a Defense-only piece with a magic penalty and nothing ranged (the plate family).
check(S.misfit(plate, ranger)?.defenseOnly === true && S.misfit(buckler, ranger)?.defenseOnly === true, 'a ranger is not offered Rainbow Plate Body or a buckler');
check(['vision_helmet', 'vision_shield', 'magnetic_gloves', 'fluffy_red_hat'].every((n) => S.misfit(items['/items/' + n], ranger) === null), 'a ranger keeps Vision Helmet and Vision Shield (positive ranged accuracy), Magnetic Gloves and Fluffy Red Hat (no penalty)');
const plateFamily = combatPieces.filter((i) => S.misfit(i, ranger)?.defenseOnly);
check(plateFamily.length === 46, 'rule F drops the 39 plate pieces and 7 bucklers for a ranger (' + plateFamily.length + ')');
check(combatPieces.filter((i) => S.misfit(i, fire)?.penalty && !S.boundsOf(i).styles.length).length === 46, 'rule P drops the same 46 for a mage');

// ---- Abilities (rules D and B) ----
const A = (n) => '/abilities/' + n;
const sword = S.playerFit(setupOf(items['/items/cheese_sword']), items), spear = S.playerFit(setupOf(items['/items/cheese_spear']), items), bare = S.playerFit(setupOf(null), items);
check(sword.kind === 'slash' && spear.kind === 'stab' && bare.kind === 'smash' && ranger.kind === 'ranged' && fire.kind === 'magic', "the player's kind is his weapon's own style (no weapon: smash)");
check(S.abilityMisfit(A('fireball'), melee) !== null && S.abilityMisfit(A('fireball'), ranger) !== null && S.abilityMisfit(A('fireball'), fire) === null, 'a melee or ranged player is not offered Fireball; a fire mage is');
check(S.abilityMisfit(A('cleave'), fire) !== null && S.abilityMisfit(A('water_strike'), fire)?.elements?.join() === 'water' && S.abilityMisfit(A('water_strike'), water) === null, 'a fire mage is not offered Cleave or Water Strike; a water mage is offered Water Strike');
check(S.abilityMisfit(A('cleave'), ranger) !== null && S.abilityMisfit(A('aqua_arrow'), ranger) === null && S.abilityMisfit(A('flame_arrow'), ranger) === null && S.abilityMisfit(A('aqua_arrow'), water) !== null, 'a ranger keeps the elemental arrows (ranged style) and loses Cleave; a mage loses the arrows');
check(S.abilityMisfit(A('poke'), sword)?.styles?.join() === 'stab' && S.abilityMisfit(A('smack'), sword) !== null && S.abilityMisfit(A('cleave'), sword) === null, 'a sword user is not offered a stab or smash ability; slash stays');
check(S.abilityMisfit(A('poke'), spear) === null && S.abilityMisfit(A('cleave'), spear) !== null && S.abilityMisfit(A('smack'), bare) === null && S.abilityMisfit(A('cleave'), bare) !== null, 'every melee kind: a spear keeps stab, no weapon keeps smash');
check(S.abilityMisfit(A('mana_spring'), water) === null && S.abilityMisfit(A('mana_spring'), fire) !== null && S.abilityMisfit(A('mana_spring'), nature) !== null, 'Mana Spring (water damage plus a party buff) stays for a water mage only');
check(S.abilityMisfit(A('berserk'), fire)?.buffs?.join() === 'physical_amplify' && S.abilityMisfit(A('frenzy'), water)?.buffs?.join() === 'attack_speed', 'a mage is not offered Berserk or Frenzy');
check(S.abilityMisfit(A('berserk'), melee) === null && S.abilityMisfit(A('frenzy'), ranger) === null, 'Berserk and Frenzy stay for melee and ranged');
check(S.abilityMisfit(A('elemental_affinity'), melee) !== null && S.abilityMisfit(A('elemental_affinity'), ranger) === null && S.abilityMisfit(A('elemental_affinity'), fire) === null, 'Elemental Affinity: dropped for a melee player, kept for a ranger and a mage');
const everyone = [melee, sword, spear, bare, ranger, fire, water, nature];
const neutralAbilities = ['minor_heal', 'heal', 'quick_aid', 'rejuvenate', 'revive', 'taunt', 'provoke', 'toughness', 'elusiveness', 'precision', 'spike_shell', 'retribution', 'vampirism', 'insanity', 'invincible', 'fierce_aura', 'mystic_aura', 'speed_aura', 'guardian_aura', 'critical_aura'].filter((n) => abilities[A(n)]);
check(neutralAbilities.length >= 18 && neutralAbilities.every((n) => everyone.every((f) => S.abilityMisfit(A(n), f) === null)), 'heals, auras and buffs with no damage stay for everyone (' + neutralAbilities.length + ')');

// The optimizer: one filter at both call sites (market swaps, owned items), after the cheap checks, the list in result.json.
const core = readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
const market = core.slice(core.indexOf('function candidatesFor'), core.indexOf('// ---- Phase 2 levers'));
const owned = core.slice(core.indexOf('function ownedCands'), core.indexOf('function abilityCands'));
check((core.match(/[^y]misfit\(/g) || []).length === 1 && (core.match(/abilityMisfit\(/g) || []).length === 1 && /styleDrop\(fit, item, \{ id, player: p, slot, desc, from: \{ item: it\.itemHrid, level: it\.enhancementLevel \}, to: \{ item: item\.hrid, level: L \} \}\)\) continue;/.test(market) && /playerFit\(s, itemDetailMap\)/.test(market), 'optimizer: the market-swap loop drops by styleDrop');
check(/styleDrop\(fit, item, \{ id: `\$\{p\}:\$\{slot\}=own:/.test(owned) && /playerFit\(s, itemDetailMap\)/.test(owned), 'optimizer: the owned-items loop drops by the same styleDrop');
const swapLoop = market.slice(market.indexOf('if (!swapsOn) continue;'));
check(swapLoop.indexOf('styleDrop(') < swapLoop.indexOf('isDominatedSwap(') && swapLoop.indexOf('pricer.swap(') < swapLoop.indexOf('styleDrop('), 'optimizer: only swaps the market sells are listed as dropped, before the dominance check');
const enhance = market.slice(market.indexOf('for (let d = 1; d <= maxUp; d++)'), market.indexOf('if (!swapsOn) continue;'));
check(/if \(styleDrop\(fit, itemDetailMap\[it\.itemHrid\], \{ id, player: p, slot, desc,/.test(enhance) && enhance.indexOf('styleDrop(') < enhance.indexOf('out.push('), 'optimizer: a held piece that does not fit gets no enhance step (listed as left out)');
const abil = core.slice(core.indexOf('function abilityCands'), core.indexOf('function allCandidates'));
check(/if \(abilityDrop\(fit, l\.abilityHrid, \{ id, player: p, slot: `ability\$\{i\}`, desc,/.test(abil) && /fit = playerFit\(s, itemDetailMap\)/.test(abil), 'optimizer: an ability swap that does not fit is never offered (listed as left out)');
check(/onDrop: leaveOut/.test(core) && /leaveOut\(\{ \.\.\.rec, bound, wants: fit \}\)/.test(core) && /dominated, otherStyle, skippedNoExport: \[\]/.test(core), 'result.json: the otherStyle group gets every left-out change (bound, what the player wants), books and ability levels included');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
