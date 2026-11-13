// The imported group, kept in the browser's own storage so a reload shows it again (nothing leaves the browser; the code carries no names).
// What is kept: the page's player slots after an Import, `{ v: 1, slots: { "1": <slot JSON string>, ... } }`: each slot's name and every setup field
// the page holds per player (levels, gear, food, drinks, abilities, triggers, house rooms, achievements, guild buffs, labyrinth, zone, time).
// Not the pasted text, and not the page's selection (tick boxes, zone and tier of the group paste).
// A kept value that does not parse, is not of this shape, or holds a slot the page cannot load is ignored (null); storage that is full or
// disabled keeps nothing and throws nothing. The storage is passed in (the page's localStorage, or a stand-in in the tests).

export const KEPT_GROUP_KEY = 'importedGroup';
export const KEPT_GROUP_VERSION = 1;
const SLOT_IDS = ['1', '2', '3', '4', '5'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const combatList = (kind) => isObject(kind) && Array.isArray(kind['/action_types/combat']);

// A slot the page can load: JSON text of an object holding what updateNextPlayer reads (player with gear, food, drinks, abilities) and, when
// present, triggers, house rooms, achievements and a name of the right kind.
export function usableSlot(json) {
    if (typeof json !== 'string') return false;
    let slot;
    try { slot = JSON.parse(json); } catch { return false; }
    if (!isObject(slot) || !isObject(slot.player) || !Array.isArray(slot.player.equipment)) return false;
    if (!combatList(slot.food) || !combatList(slot.drinks) || !Array.isArray(slot.abilities)) return false;
    if (slot.triggerMap !== undefined && !isObject(slot.triggerMap)) return false;
    if (slot.houseRooms !== undefined && !isObject(slot.houseRooms)) return false;
    if (slot.achievements !== undefined && !isObject(slot.achievements)) return false;
    if (slot.name !== undefined && typeof slot.name !== 'string') return false;
    return true;
}

// The text to keep for a group (slot id -> JSON string), or null when no slot of it is usable.
export function encodeGroup(slots) {
    const kept = {};
    for (const id of SLOT_IDS) if (usableSlot(slots?.[id])) kept[id] = slots[id];
    return Object.keys(kept).length ? JSON.stringify({ v: KEPT_GROUP_VERSION, slots: kept }) : null;
}

// The group a kept text holds (slot id -> JSON string), or null when it is not usable: not JSON, another version, no slots, an unknown slot id,
// or any slot the page cannot load.
export function decodeGroup(text) {
    if (typeof text !== 'string' || !text) return null;
    let kept;
    try { kept = JSON.parse(text); } catch { return null; }
    if (!isObject(kept) || kept.v !== KEPT_GROUP_VERSION || !isObject(kept.slots)) return null;
    const ids = Object.keys(kept.slots);
    if (!ids.length || ids.some((id) => !SLOT_IDS.includes(id) || !usableSlot(kept.slots[id]))) return null;
    return { ...kept.slots };
}

// Keeps the group, replacing what was kept. True when it is kept; false when there is nothing to keep, no storage, or the storage refuses.
export function keepGroup(storage, slots) {
    try {
        const text = encodeGroup(slots);
        if (!storage || text === null) return false;
        storage.setItem(KEPT_GROUP_KEY, text);
        return true;
    } catch { return false; }
}

// The kept group, or null (nothing kept, not usable, or storage disabled).
export function loadKeptGroup(storage) {
    try { return storage ? decodeGroup(storage.getItem(KEPT_GROUP_KEY)) : null; } catch { return null; }
}
