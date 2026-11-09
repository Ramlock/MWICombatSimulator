// Variants: a list of ops (src/whatif/applyOps.mjs) applied to clones of the party's setup JSON (docs/ground-truth/setups format),
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
//   { "op": "level", "player": "Ramlock", "skill": "magic", "delta": 1 }        a combat skill level (player.<skill>Level)
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

// applyOps lives in src/whatif/applyOps.mjs, shared with the page's What-if window; re-exported here for the tools.
export { applyOps } from '../../src/whatif/applyOps.mjs';
