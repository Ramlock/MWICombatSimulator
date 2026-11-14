// Test: the phase 3 upgrade levers of the what-if optimizer (tools/whatif/levers/houses.mjs): house room costs and
// candidates, ability-level and book costs and candidates, the upper-bound mark and the optimizer's row copying it.
// No simulator run. Generic setups and prices only, no private data.
// Usage: node tools/test/whatif-houses.mjs        Exit code 0 on pass, 1 on fail.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = (p) => import(pathToFileURL(path.join(root, p)).href);
const { applyOps } = await mod('tools/whatif/variants.mjs');
const H = await mod('tools/whatif/levers/houses.mjs');
const data = (f) => JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data', f), 'utf8'));
const rooms = data('houseRoomDetailMap.json'), items = data('itemDetailMap.json'), abilities = data('abilityDetailMap.json');

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- House rooms ----
check(H.COMBAT_ROOMS.length === 7 && ['dojo', 'armory', 'gym', 'archery_range', 'mystical_study', 'dining_room', 'library'].every((r) => H.COMBAT_ROOMS.includes('/house_rooms/' + r)), 'combat rooms: the 7 rooms usable in combat');
check(H.roomsFor('all').length === 17 && H.roomsFor('dojo,gym').join() === '/house_rooms/dojo,/house_rooms/gym', 'roomsFor: all, a name list');
let threw = false; try { H.roomsFor('nope'); } catch { threw = true; }
check(threw, 'roomsFor: an unknown room throws');
check(H.roomMaxLevel('/house_rooms/dojo') === 8, 'dojo tops out at level 8');
// Cost: coin at face value, each item at its ask, summed over the levels crossed.
const flat = () => 10;
const byHand = (room, from, to) => { let c = 0; for (let L = from + 1; L <= to; L++) for (const x of rooms[room].upgradeCostsMap[L]) c += x.itemHrid === '/items/coin' ? x.count : 10 * x.count; return c; };
const c01 = H.roomUpgradeCost('/house_rooms/dojo', 0, 1, flat), c35 = H.roomUpgradeCost('/house_rooms/dojo', 3, 5, flat);
check(c01.known && c01.cost === byHand('/house_rooms/dojo', 0, 1), 'room cost 0 -> 1 = coin + items at ask');
check(c35.known && c35.cost === byHand('/house_rooms/dojo', 3, 4) + byHand('/house_rooms/dojo', 4, 5), 'room cost 3 -> 5 = level 4 + level 5');
check(rooms['/house_rooms/dojo'].upgradeCostsMap[1].some((x) => x.itemHrid === '/items/coin' && x.count === 500000) && c01.cost >= 500000, 'level 1 coin part counted at face value');
const firstItem = rooms['/house_rooms/dojo'].upgradeCostsMap[1].find((x) => x.itemHrid !== '/items/coin').itemHrid;
const noSeller = H.roomUpgradeCost('/house_rooms/dojo', 0, 1, (h) => (h === firstItem ? Infinity : 10));
check(!noSeller.known && noSeller.note.includes(firstItem.split('/').pop()), 'an item with no seller makes the cost unknown and is named');

const setup = { name: 'P', player: { intelligenceLevel: 60, magicLevel: 50, staminaLevel: 50, attackLevel: 50, meleeLevel: 50, defenseLevel: 50, rangedLevel: 50, equipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/wooden_nature_staff', enhancementLevel: 0 }] }, houseRooms: { '/house_rooms/dojo': 7, '/house_rooms/gym': 2 }, abilities: [null, { abilityHrid: '/abilities/entangle', level: 10 }, { abilityHrid: '/abilities/toxic_pollen', level: 199 }, null, null] };
const hc = H.houseCands(setup, 'P', { rooms: ['/house_rooms/dojo', '/house_rooms/gym'], maxUp: 2, buy: flat });
check(hc.map((c) => c.id).join() === 'P:house:dojo+1,P:house:gym+1,P:house:gym+2', 'house candidates: +1, +2, never past the top level');
check(hc.every((c) => c.monotone && c.kind === 'house') && hc[2].cost.cost === byHand('/house_rooms/gym', 2, 4), 'house candidates are monotone and costed from their own level');
check(applyOps([setup], hc[2].ops)[0].houseRooms['/house_rooms/gym'] === 4 && applyOps([setup], hc[0].ops)[0].houseRooms['/house_rooms/dojo'] === 8, 'house op raises the room');

// ---- Ability levels and books ----
const XP = H.XP;
check(H.xpAt(1) === 0 && H.xpAt(2) === 33 && H.MAX_LEVEL === 200, 'XP table: level 1 at 0, level 2 at 33, 200 levels');
check(H.booksNeeded(0, 2, 500) === 1 && H.booksNeeded(XP[9], 11, 50) === Math.ceil((XP[10] - XP[9]) / 50), 'books to level up: ceil of the XP gap over the book XP');
check(H.booksNeeded(H.xpAt(5), 5, 100) === 0, 'no books when already there');
check(H.booksNeeded(0, 1, 500, true) === 1 && H.booksNeeded(0, 10, 500, true) === 1 + Math.ceil(XP[9] / 500), 'learning: one book to level 1, duplicates for the rest');
const entBook = H.BOOK_OF['/abilities/entangle'];
check(entBook && entBook.abilityBookDetail.experienceGain > 0, 'every ability with a book is mapped (entangle)');
const al = H.abilityLevelCands(setup, 'P', { steps: [1, 3], buy: flat });
check(al.map((c) => c.id).join() === 'P:ability1+1,P:ability1+3,P:ability2+1', 'ability level candidates: each step, never past level 200');
const gain = entBook.abilityBookDetail.experienceGain;
check(al[0].cost.cost === 10 * Math.ceil((XP[10] - XP[9]) / gain) && /upper bound/.test(al[0].cost.note), 'no export: XP at the start of the level, cost an upper bound and labelled');
const learnedXp = XP[9] + 0.9 * (XP[10] - XP[9]);
const ale = H.abilityLevelCands(setup, 'P', { steps: [1], buy: flat, learned: [{ abilityHrid: '/abilities/entangle', level: 10, experience: learnedXp }] });
check(ale[0].cost.cost === 10 * Math.ceil((XP[10] - learnedXp) / gain) && !/upper bound/.test(ale[0].cost.note), 'with the export: exact XP, no upper-bound label');
check(al.every((c) => c.cost.costBound === 'upper') && !('costBound' in ale[0].cost), 'costBound: "upper" on the upper-bound costs only');
const aleOther = H.abilityLevelCands(setup, 'P', { steps: [1], buy: flat, learned: [{ abilityHrid: '/abilities/entangle', level: 9, experience: learnedXp }] });
check(aleOther[0].cost.costBound === 'upper', 'an export at another level is not used: upper bound');
check(hc.every((c) => !('costBound' in c.cost)), 'house costs are exact: no costBound');
// The optimizer's rows copy the mark (row() in optimize.mjs, read as text: the module runs a search on import).
const opt = readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
check(/costBound: c\.cost\.costBound/.test(opt) && (opt.match(/costBound === 'upper' \? '≤ '/g) || []).length === 3, 'optimizer: row copies costBound, both tables and the over-budget list print ≤');
check(applyOps([setup], al[1].ops)[0].abilities[1].level === 13, 'ability level op raises the slot');
const noBook = H.abilityLevelCands(setup, 'P', { steps: [1], buy: () => Infinity });
check(noBook.every((c) => !c.cost.known && /no seller/.test(c.cost.note)), 'a book with no seller: unknown cost');

check(H.bookCands(setup, 'P', { buy: flat, learned: null }).length === 0, 'books need the learned list');
const learned = [{ abilityHrid: '/abilities/entangle', level: 10, experience: 0 }, { abilityHrid: '/abilities/fireball', level: 3, experience: 0 }];
const bc = H.bookCands(setup, 'P', { buy: flat, learned, levels: [1, 5] });
check(bc.length > 0 && bc.every((c) => !c.id.includes('fireball') && !c.id.includes('entangle') && !c.id.includes('toxic_pollen')), 'books: never a learned or equipped ability');
check(bc.every((c) => { const i = Number(c.id.match(/ability(\d)/)[1]); return !!abilities[c.ops[0].ability].isSpecialAbility === (i === 0); }), 'books: slot 0 takes special abilities only, the others never');
check(bc.every((c) => { const i = Number(c.id.match(/ability(\d)/)[1]); return H.slotOpen(setup, i); }), 'books: closed slots skipped');
const reqOk = bc.every((c) => (H.BOOK_OF[c.ops[0].ability].abilityBookDetail.levelRequirements || []).every((r) => (setup.player[r.skillHrid.split('/').pop() + 'Level'] ?? 0) >= r.level));
check(reqOk, 'books: level requirements met');
const one = bc.find((c) => c.id.endsWith('@5'));
check(one && one.cost.cost === 10 * (1 + Math.ceil(XP[4] / H.BOOK_OF[one.ops[0].ability].abilityBookDetail.experienceGain)), 'book cost at level 5: one to learn plus duplicates');
check(applyOps([setup], one.ops)[0].abilities[Number(one.id.match(/ability(\d)/)[1])].level === 5, 'book op learns it at the level');

// ---- Style and element (stylefit.mjs abilityMisfit): books and level steps follow the player ----
const dropsB = [], bAll = H.bookCands(setup, 'P', { buy: flat, learned, levels: [1], onDrop: (e) => dropsB.push(e) });
check(bAll.length > 0 && !bAll.some((c) => /book:(cleave|poke|water_strike|fireball|berserk|frenzy|aqua_arrow)@/.test(c.id)), 'books: a nature mage is never offered another style\'s or element\'s ability, nor a physical self buff');
check(bAll.some((c) => /book:(heal|minor_heal)@/.test(c.id)) && bAll.some((c) => /book:(fierce_aura|mystic_aura|speed_aura)@/.test(c.id)), 'books: heals and auras stay');
check(dropsB.length > 0 && dropsB.some((e) => /learn cleave 1$/.test(e.desc) && e.bound.styles.includes('slash') && e.wants.element === 'nature') && dropsB.every((e) => e.player === 'P' && e.to.ability && e.id.includes('=book:')), 'books: every dropped book goes to onDrop with why (bound) and what the player wants');
const meleeSetup = { ...setup, player: { ...setup.player, equipment: [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/cheese_sword', enhancementLevel: 0 }] } };
const dropsL = [], alMelee = H.abilityLevelCands(meleeSetup, 'P', { steps: [1], buy: flat, onDrop: (e) => dropsL.push(e) });
check(alMelee.length === 0 && dropsL.map((e) => e.id).join() === 'P:ability1+1,P:ability2+1' && dropsL[0].desc === 'P entangle 10 -> 11', 'ability levels: a melee player is never offered levelling a held nature ability; each step goes to onDrop');
check(H.abilityLevelCands(meleeSetup, 'P', { steps: [1], buy: flat }).length === 0, 'ability levels: no onDrop still drops');
const mageRooms = H.houseCands(setup, 'P', { rooms: H.COMBAT_ROOMS, maxUp: 1, buy: flat }).map((c) => c.id), meleeRooms = H.houseCands(meleeSetup, 'P', { rooms: H.COMBAT_ROOMS, maxUp: 1, buy: flat }).map((c) => c.id);
check(['gym', 'archery_range', 'mystical_study'].every((r) => mageRooms.includes(`P:house:${r}+1`) && meleeRooms.includes(`P:house:${r}+1`)), 'house rooms are unchanged: every combat room stays offered to every style');

// The optimizer entry reads its flags.
const fakeArg = (n, d) => ({ 'house-rooms': 'gym', 'house-up': '1', 'ability-steps': '2' }[n] ?? d);
const all = H.upgradeCands(setup, 'P', new Set(['houses', 'abilitylevels', 'books']), { arg: fakeArg, pricer: { buy: () => ({ cost: 10 }) }, ex: { learnedAbilities: learned } });
check(all.filter((c) => c.kind === 'house').map((c) => c.id).join() === 'P:house:gym+1' && all.filter((c) => c.kind === 'abilityLevel').every((c) => c.id.endsWith('+2')) && all.some((c) => c.kind === 'book') && !all.some((c) => c.kind === 'seal'), 'upgradeCands: every lever, its flags read, no seals');
check(H.LEVER_NAMES.join() === 'houses,abilitylevels,books', 'registered lever names');
check(H.upgradeCands(setup, 'P', new Set(['equip']), { arg: fakeArg, pricer: { buy: () => ({ cost: 10 }) }, ex: null }).length === 0, 'upgradeCands: nothing when none of its levers is open');

// Warnings: books with no learned list, ability levels on upper bounds; once per player and lever.
const said = [], warn = (l) => said.push(l), pr = { buy: () => ({ cost: 10 }) };
H.upgradeCands({ ...setup, name: 'W' }, 'W', new Set(['books', 'abilitylevels']), { arg: () => null, pricer: pr, ex: null, warn });
H.upgradeCands({ ...setup, name: 'W' }, 'W', new Set(['books', 'abilitylevels']), { arg: () => null, pricer: pr, ex: null, warn });
check(said.length === 2 && said.some((l) => /W: no book candidates generated; books need the exporter's learned-ability list for W/.test(l)) && said.some((l) => /W: 4 of 4 ability-level rows cost an upper bound/.test(l)), 'warnings: books without the learned list, the count of upper-bound rows, each once');
const quiet = [];
H.upgradeCands({ ...setup, name: 'Q' }, 'Q', new Set(['books', 'abilitylevels']), { arg: () => '1', pricer: pr, ex: { learnedAbilities: [{ abilityHrid: '/abilities/entangle', level: 10, experience: 0 }, { abilityHrid: '/abilities/toxic_pollen', level: 199, experience: 0 }] }, warn: (l) => quiet.push(l) });
check(quiet.length === 0, 'no warning when the export covers every equipped ability at its level');
const part = [];
H.upgradeCands({ ...setup, name: 'R' }, 'R', new Set(['abilitylevels']), { arg: () => '1', pricer: pr, ex: { learnedAbilities: [{ abilityHrid: '/abilities/entangle', level: 10, experience: 0 }] }, warn: (l) => part.push(l) });
check(part.length === 1 && /R: 1 of 2 ability-level rows/.test(part[0]), 'warning counts only the bounded rows');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
