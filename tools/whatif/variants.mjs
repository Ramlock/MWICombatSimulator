// Variants: a list of ops applied to clones of the party's setup JSON (docs/ground-truth/setups format),
// before the DTOs are built. Each op names its player. Ops:
//   { "op": "enhance", "player": "Ramlock", "slot": "ring", "delta": 1 }        slot = item location without prefix
//   { "op": "equip", "player": "Ramlock", "slot": "ring", "item": "/items/x", "level": 5 }
//   { "op": "food", "player": "Ramlock", "index": 0, "item": "/items/spaceberry_cake" }   item null empties the slot;
//       "replace": "/items/x" instead of "index" picks the slot holding that item
//   { "op": "drink", "player": "Ramlock", "index": 0, "item": "/items/x" }
//   { "op": "ability", "player": "Ramlock", "index": 3, "ability": "/abilities/life_drain", "level": 51 }
//       "replace": "/abilities/x" instead of "index" picks the slot holding it; no "level" keeps the slot's level
//   { "op": "abilityLevel", "player": "Ramlock", "index": 3, "delta": 1 }
//   { "op": "abilityOrder", "player": "<player>", "order": [0, 2, 1, 3, 4] }   new slot i holds old slot order[i]
//   { "op": "unequip", "player": "<player>", "slot": "off_hand" }                empties the slot (a two-hand swap)
//   { "op": "house", "player": "Ramlock", "room": "/house_rooms/dojo", "delta": 1 }
//   { "op": "trigger", "player": "Ramlock", "hrid": "/abilities/x", "triggers": [ ... ] }
// Triggers of a swapped-in item or ability come from the player's own triggerMap when it has them, else the
// game's defaults (setupDto.mjs drops none; the engine falls back on null).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './engine.mjs';

import { partyNames } from '../calibration/party.mjs';

export const PARTY = partyNames();

export function readParty(dir = path.join(root, 'docs', 'ground-truth', 'setups'), names = dir === path.join(root, 'docs', 'ground-truth', 'setups') ? PARTY : partyNames(dir)) {
    return names.map((n) => JSON.parse(readFileSync(path.join(dir, n + '.json'), 'utf8')));
}

function slotOf(setup, slot) {
    const it = setup.player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + slot);
    if (!it) throw new Error(`${setup.name} has nothing in slot ${slot}`);
    return it;
}

export function applyOps(setups, ops = []) {
    const out = structuredClone(setups);
    for (const o of ops) {
        const s = out.find((x) => x.name === o.player);
        if (!s) throw new Error('No player ' + o.player);
        switch (o.op) {
            case 'enhance': slotOf(s, o.slot).enhancementLevel += o.delta; break;
            case 'equip': {
                const it = s.player.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + o.slot);
                if (it) { it.itemHrid = o.item; it.enhancementLevel = o.level ?? 0; }
                else s.player.equipment.push({ itemLocationHrid: '/item_locations/' + o.slot, itemHrid: o.item, enhancementLevel: o.level ?? 0 });
                break;
            }
            case 'food':
            case 'drink': {
                const key = o.op === 'food' ? 'food' : 'drinks';
                const list = s[key]['/action_types/combat'];
                const i = o.replace ? list.findIndex((x) => x?.itemHrid === o.replace) : o.index;
                if (i < 0) throw new Error(`${s.name} has no ${o.replace}`);
                list[i] = o.item ? { itemHrid: o.item } : null;
                break;
            }
            case 'ability': {
                const i = o.replace ? s.abilities.findIndex((x) => x?.abilityHrid === o.replace) : o.index;
                if (i < 0) throw new Error(`${s.name} has no ${o.replace}`);
                s.abilities[i] = { abilityHrid: o.ability, level: o.level ?? s.abilities[i].level };
                break;
            }
            case 'abilityLevel': s.abilities[o.index].level = Number(s.abilities[o.index].level) + o.delta; break;
            case 'abilityOrder': { const old = s.abilities; s.abilities = o.order.map((j) => old[j]); break; }
            case 'unequip': s.player.equipment = s.player.equipment.filter((e) => e.itemLocationHrid !== '/item_locations/' + o.slot); break;
            case 'house': s.houseRooms[o.room] = (s.houseRooms[o.room] || 0) + o.delta; break;
            case 'trigger': s.triggerMap = { ...(s.triggerMap || {}), [o.hrid]: o.triggers }; break;
            default: throw new Error('Unknown op ' + o.op);
        }
    }
    return out;
}
