// Phase 3 upgrade levers of the what-if optimizer (docs/proposals/what-if.md 1.2, 1.4; 3.6 item 3): house rooms,
// ability levels and ability books (personal seals are out of scope for now). Each builder returns candidates in the optimizer's shape
// ({ id, kind, groups, player, monotone, desc, ops, cost: { cost, known, path, note } }); the optimizer's own runs
// measure every gain. Costs are buy-side only (buying pays no market tax).
//
// - houses: each room +1..+N (--house-up 2), up to the game's top level. Cost = the sum of the game's upgradeCostsMap
//   for each level crossed (houseRoomDetailMap.json): coin at face value, every item at its +0 ask. Rooms:
//   --house-rooms combat (default: rooms whose usableInActionTypeMap holds combat), all, or a comma list of room
//   names (dojo,gym). Every room also carries global wisdom and rare find, which apply in combat.
// - abilitylevels: each equipped ability +d for d in --ability-steps (default 1,3,5), up to level 200. Books needed =
//   ceil((XP at the target level - XP now) / the book's experienceGain), XP from the game's experience table
//   (levelExperienceTable.json; the same table holds for abilities, design 1.2). XP now is the exporter's
//   learnedAbilities[].experience when the export is this player's; else the XP at the start of the level, so the
//   cost is an upper bound: the cost carries costBound: 'upper' (the optimizer's rows copy it) and its note says so.
// - books: an ability not learned (needs the exporter's learnedAbilities) learned into each open slot (slot 0 takes
//   special abilities only) at each level in --book-levels (default 1): the first book learns it at level 1, XP 0
//   (Combat.md:11; learned abilities at level 1 show experience 0 in the export), duplicates add their XP.
import { readFileSync } from 'node:fs';

// The game's experience table, as charm.mjs reads it (read here, not imported: engine.mjs imports this file).
export const XP = JSON.parse(readFileSync(new URL('../levelExperienceTable.json', import.meta.url), 'utf8')).table;
export const MAX_LEVEL = XP.length;

const data = (f) => JSON.parse(readFileSync(new URL('../../../src/combatsimulator/data/' + f, import.meta.url), 'utf8'));
const houseRoomDetailMap = data('houseRoomDetailMap.json');
const itemDetailMap = data('itemDetailMap.json');
const abilityDetailMap = data('abilityDetailMap.json');
const abilitySlotsLevelRequirementList = data('abilitySlotsLevelRequirementList.json');

const short = (h) => h.split('/').pop();
const COIN = '/items/coin';
export const LEVER_NAMES = ['houses', 'abilitylevels', 'books'];

// ---- House rooms ----
export const COMBAT_ROOMS = Object.values(houseRoomDetailMap).filter((r) => r.usableInActionTypeMap?.['/action_types/combat']).map((r) => r.hrid);
export const roomMaxLevel = (room) => Math.max(...Object.keys(houseRoomDetailMap[room].upgradeCostsMap).map(Number));

// buy(itemHrid) -> ask per unit, Infinity when no seller.
export function roomUpgradeCost(room, from, to, buy) {
    let cost = 0;
    const missing = new Set();
    for (let L = from + 1; L <= to; L++) {
        for (const { itemHrid, count } of houseRoomDetailMap[room].upgradeCostsMap[String(L)] || []) {
            const unit = itemHrid === COIN ? 1 : buy(itemHrid);
            if (!Number.isFinite(unit)) missing.add(short(itemHrid));
            else cost += unit * count;
        }
    }
    if (missing.size) return { cost: Infinity, known: false, path: 'house upgrade', note: 'no seller: ' + [...missing].join(', ') };
    return { cost, known: true, path: 'house upgrade', mirrors: 0, note: '' };
}

export function roomsFor(spec) {
    if (!spec || spec === 'combat') return COMBAT_ROOMS;
    if (spec === 'all') return Object.keys(houseRoomDetailMap);
    return String(spec).split(',').map((x) => (x.startsWith('/') ? x : '/house_rooms/' + x.trim())).map((h) => { if (!houseRoomDetailMap[h]) throw new Error('unknown house room ' + h); return h; });
}

export function houseCands(setup, p, { rooms = COMBAT_ROOMS, maxUp = 2, buy }) {
    const out = [];
    for (const room of rooms) {
        const from = Number(setup.houseRooms?.[room] || 0), top = roomMaxLevel(room);
        for (let d = 1; d <= maxUp && from + d <= top; d++) {
            out.push({ id: `${p}:house:${short(room)}+${d}`, kind: 'house', groups: [`${p}:house:${short(room)}`], player: p, monotone: true, desc: `${p} ${houseRoomDetailMap[room].name} ${from} -> ${from + d}`, ops: [{ op: 'house', player: p, room, delta: d }], cost: roomUpgradeCost(room, from, from + d, buy) });
        }
    }
    return out;
}

// ---- Ability levels and books ----
export const BOOK_OF = Object.fromEntries(Object.values(itemDetailMap).filter((it) => it.abilityBookDetail).map((it) => [it.abilityBookDetail.abilityHrid, it]));
export const xpAt = (level) => XP[level - 1];

// Books to go from xpNow to the start of level `to` (first = true: learning it first takes one book, at level 1, XP 0).
export function booksNeeded(xpNow, to, bookXp, first = false) {
    return (first ? 1 : 0) + Math.max(0, Math.ceil((xpAt(to) - (first ? 0 : xpNow)) / bookXp - 1e-9));
}

function bookCost(ability, books, buy, upper) {
    const book = BOOK_OF[ability];
    if (!book) return { cost: Infinity, known: false, path: 'books', note: 'no ability book' };
    const unit = buy(book.hrid);
    if (!Number.isFinite(unit)) return { cost: Infinity, known: false, path: 'books', note: `no seller: ${short(book.hrid)} (${books} books)` };
    return { cost: unit * books, known: true, path: 'books', mirrors: 0, ...(upper ? { costBound: 'upper' } : {}), note: `${books} x ${short(book.hrid)}${upper ? '; upper bound (XP inside the level unknown)' : ''}` };
}

// learned: the exporter's learnedAbilities for this player, or null.
export function abilityLevelCands(setup, p, { steps = [1, 3, 5], buy, learned = null }) {
    const out = [];
    (setup.abilities || []).forEach((a, i) => {
        if (!a?.abilityHrid) return;
        const level = Number(a.level), book = BOOK_OF[a.abilityHrid];
        const ex = learned?.find((l) => l.abilityHrid === a.abilityHrid && Number(l.level) === level);
        const xpNow = ex ? Number(ex.experience) : xpAt(level);
        for (const d of steps) {
            if (level + d > MAX_LEVEL) continue;
            const books = book ? booksNeeded(xpNow, level + d, book.abilityBookDetail.experienceGain) : 0;
            out.push({ id: `${p}:ability${i}+${d}`, kind: 'abilityLevel', groups: [`${p}:ability${i}`], player: p, monotone: true, desc: `${p} ${short(a.abilityHrid)} ${level} -> ${level + d}`, ops: [{ op: 'abilityLevel', player: p, index: i, delta: d }], cost: bookCost(a.abilityHrid, books, buy, !ex) });
        }
    });
    return out;
}

const meetsReq = (setup, req = []) => req.every((r) => (setup.player[short(r.skillHrid) + 'Level'] ?? 0) >= r.level);
export const slotOpen = (setup, i) => (setup.player.intelligenceLevel ?? 0) >= abilitySlotsLevelRequirementList[i + 1];

export function bookCands(setup, p, { levels = [1], buy, learned }) {
    if (!learned) return [];
    const known = new Set(learned.filter((l) => Number(l.level) > 0).map((l) => l.abilityHrid));
    const held = new Set((setup.abilities || []).map((a) => a?.abilityHrid).filter(Boolean));
    const out = [];
    for (const [ability, book] of Object.entries(BOOK_OF)) {
        const det = abilityDetailMap[ability];
        if (!det || known.has(ability) || held.has(ability) || !meetsReq(setup, book.abilityBookDetail.levelRequirements)) continue;
        for (let i = 0; i < 5; i++) {
            if (!slotOpen(setup, i) || !!det.isSpecialAbility !== (i === 0)) continue;
            const was = setup.abilities?.[i]?.abilityHrid ? `${short(setup.abilities[i].abilityHrid)} ${setup.abilities[i].level}` : 'empty';
            for (const L of levels) {
                const books = booksNeeded(0, L, book.abilityBookDetail.experienceGain, true);
                out.push({ id: `${p}:ability${i}=book:${short(ability)}@${L}`, kind: 'book', groups: [`${p}:ability${i}`], player: p, monotone: false, desc: `${p} ability ${i + 1} ${was} -> learn ${short(ability)} ${L}`, ops: [{ op: 'ability', player: p, index: i, ability, level: L }], cost: bookCost(ability, books, buy, false) });
            }
        }
    }
    return out;
}

// The optimizer's entry: every open lever of this file for one player. arg(name, def) reads a command-line flag;
// ex is the exporter JSON when it is this player's, else null. warn(line) prints a warning, once per player and
// lever for the run (the optimizer rebuilds candidates after each greedy step).
const warned = new Set();
export function upgradeCands(setup, p, levers, { arg, pricer, ex, warn = (l) => console.log(l) }) {
    const buy = (h) => pricer.buy(h, 0).cost;
    const nums = (v, d) => (v && v !== true ? String(v).split(',').map(Number) : d);
    const learned = ex?.learnedAbilities || null;
    const once = (key, line) => { if (!warned.has(key)) { warned.add(key); warn(line); } };
    const levels = levers.has('abilitylevels') ? abilityLevelCands(setup, p, { steps: nums(arg('ability-steps', null), [1, 3, 5]), buy, learned }) : [];
    const bounds = levels.filter((c) => c.cost.costBound === 'upper').length;
    if (bounds) once(p + ':abilitylevels', `warning: ${p}: ${bounds} of ${levels.length} ability-level rows cost an upper bound (no exporter experience for ${p} at that level; pass --export with ${p}'s export)`);
    if (levers.has('books') && !learned) once(p + ':books', `warning: ${p}: no book candidates generated; books need the exporter's learned-ability list for ${p} (--export with ${p}'s export)`);
    return [
        ...(levers.has('houses') ? houseCands(setup, p, { rooms: roomsFor(arg('house-rooms', 'combat')), maxUp: Number(arg('house-up', 2)), buy }) : []),
        ...levels,
        ...(levers.has('books') ? bookCands(setup, p, { levels: nums(arg('book-levels', null), [1]), buy, learned }) : []),
    ];
}
