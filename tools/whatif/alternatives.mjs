// One row per setting. Two rows of a search's result that change the same setting (a trigger's value 4550 and its value 6400; two
// ability orders of one player) are alternatives: only one can be taken, so the report shows one and the others get a hidden flag
// (they stay in the result file). The row kept is the first in the search's own order (rankAcceptedFirst: accepted rows first, then
// rankEst). One function does it for every kind of row; the foods (foodfill.mjs hideFoodRows) are one case of it, keyed by player.
import { rankAcceptedFirst } from './buyer.mjs';

// The one switch for the paid changes. false: a paid row (cost above 0) is never grouped (equipment +5 and +6 of one slot, a house room +1
// and +2 stay separate rows). true: paid alternatives of one setting are grouped like the free ones.
export const GROUP_PAID = false;

// What one op changes (the setting it names, with its player). The slot ops (enhance, equip, unequip) share one kind: they all set what
// sits in that slot. The others keep their own kind.
export function opTarget(op) {
    const p = op.player;
    switch (op.op) {
        case 'enhance': case 'equip': case 'unequip': return `${p}|slot|${op.slot}`;
        case 'trigger': return `${p}|trigger|${op.hrid}`;
        case 'house': return `${p}|house|${op.room}`;
        case 'ability': return `${p}|ability|${op.replace ?? op.index}`;
        case 'abilityLevel': return `${p}|abilityLevel|${op.replace ?? op.index}`;
        case 'abilityOrder': return `${p}|abilityOrder`;
        case 'level': return `${p}|level|${op.skill}`;
        case 'food': return `${p}|food|${op.replace ?? op.index}`;
        case 'drink': return `${p}|drink|${op.replace ?? op.index}`;
        default: return `${p}|${op.op}|${JSON.stringify(Object.fromEntries(Object.entries(op).filter(([k]) => !['op', 'player', 'delta', 'level', 'item', 'ability', 'order', 'triggers'].includes(k))))}`;
    }
}

// The setting of a candidate: all its ops' targets together (sorted, joined); null for a candidate with no ops.
export const settingKey = (ops) => (ops?.length ? [...new Set(ops.map(opTarget))].sort().join(' + ') : null);

const rowEst = (r) => ({ score: r.score, net: r.buyerNet, gain: r.gain });

// Marks the rows that lose to another row with the same key: `keyOf(row)` is the group (null = not grouped), `estOf(row)` the row's
// { score, net, gain } for the order (default: the row's own figures), `flag` the field set to true on a hidden row. Mutates the rows.
export function hideAlternatives(rows, { keyOf, estOf = rowEst, flag = 'hiddenAlt' }) {
    const groups = new Map();
    for (const r of rows) {
        const k = keyOf(r);
        if (k == null) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    for (const mine of groups.values()) {
        if (mine.length < 2) continue;
        const best = [...mine].sort((a, b) => rankAcceptedFirst({ ...estOf(a), accepted: a.accepted }, { ...estOf(b), accepted: b.accepted }))[0];
        for (const r of mine) if (r !== best) r[flag] = true;
    }
}

// The rows of Each change alone: one per setting (free rows; paid ones too when GROUP_PAID).
export const hideSettingAlternatives = (rows, estOf) => hideAlternatives(rows, { keyOf: (r) => (r.hiddenFood || (r.cost > 0 && !GROUP_PAID) ? null : settingKey(r.ops)), estOf });
