// Consumable candidates for the what-if optimizer (docs/proposals/what-if.md 1.3), with the game's one-per-type
// rule: a player cannot slot two foods of one type, nor two drinks of one type.
//
// The type is not a field of the game data; it is derived from it:
// - Food: what it restores (HP or MP) and how (at once, or over time: recoveryDuration > 0). The four types are the
//   game's donut (HP at once), cake (HP over time), gummy (MP at once) and yogurt (MP over time); in
//   src/combatsimulator/data/itemDetailMap.json every combat food falls in exactly one, and the item names agree.
// - Drink: the set of buff uniques it applies (e.g. attack_coffee, super_attack_coffee and ultra_attack_coffee all
//   apply /buff_uniques/attack_coffee). Two drinks of one type would overwrite each other's buff in the engine
//   (combatBuffs is keyed by uniqueHrid, src/combatsimulator/combatUnit.js:379-408), so a pair never helps.
// The food rule is the game's (stated by the player, "Can't have two of the same food type"); the drink rule is
// inferred from the data and the engine above.

const short = (h) => h.split('/').pop();

export function consumableType(item) {
    const c = item?.consumableDetail;
    if (!c) return null;
    if (item.categoryHrid === '/item_categories/food') {
        const what = (c.hitpointRestore > 0 ? 'hp' : '') + (c.manapointRestore > 0 ? 'mp' : '') || 'none';
        return `food:${what}:${c.recoveryDuration > 0 ? 'over_time' : 'instant'}`;
    }
    if (item.categoryHrid === '/item_categories/drink') return 'drink:' + (c.buffs || []).map((b) => b.uniqueHrid).sort().join('+');
    return null;
}

// True when slot i of `list` (hrids or null) may hold `hrid`: no other slot holds an item of the same type.
export function legalIn(list, i, hrid, typeOf) {
    const t = typeOf(hrid);
    return list.every((h, j) => j === i || !h || typeOf(h) !== t);
}

const FREE = (path) => ({ cost: 0, known: true, path, mirrors: 0, note: '' });

// Single-slot swaps: every item of `pool` legal in slot i, and emptying a filled slot. `kind` is 'food' or 'drink'.
export function swapCands(p, kind, list, nSlots, pool, typeOf) {
    const out = [];
    for (let i = 0; i < nSlots; i++) {
        const cur = list[i] || null, g = [`${p}:${kind}${i}`], from = cur ? short(cur) : 'empty';
        for (const h of pool) {
            if (h === cur || !legalIn(list, i, h, typeOf)) continue;
            out.push({ id: `${p}:${kind}${i}=${short(h)}`, kind, groups: g, player: p, monotone: false, desc: `${p} ${kind} ${i + 1} ${from} -> ${short(h)}`, ops: [{ op: kind, player: p, index: i, item: h }], cost: FREE('loadout tweak, used x buy price in expenses') });
        }
        if (cur) out.push({ id: `${p}:${kind}${i}=none`, kind, groups: g, player: p, monotone: false, desc: `${p} ${kind} ${i + 1} ${from} -> empty`, ops: [{ op: kind, player: p, index: i, item: null }], cost: FREE('loadout tweak') });
    }
    return out;
}

// Two slots changed together, each to another tier of its own type (so the pair stays legal): every combination
// of the two slots' other tiers. The case a single swap misses: lowering both MP foods at once.
export function tierPairCands(p, kind, list, nSlots, pool, typeOf) {
    const out = [];
    const tiers = (i) => (list[i] ? pool.filter((h) => h !== list[i] && typeOf(h) === typeOf(list[i])) : []);
    for (let i = 0; i < nSlots; i++) for (let j = i + 1; j < nSlots; j++) {
        for (const a of tiers(i)) for (const b of tiers(j)) {
            out.push({ id: `${p}:${kind}${i}+${kind}${j}=${short(a)}+${short(b)}`, kind: kind + '-pair', groups: [`${p}:${kind}${i}`, `${p}:${kind}${j}`], player: p, monotone: false, desc: `${p} ${kind} ${i + 1} ${short(list[i])} -> ${short(a)} and ${kind} ${j + 1} ${short(list[j])} -> ${short(b)}`, ops: [{ op: kind, player: p, index: i, item: a }, { op: kind, player: p, index: j, item: b }], cost: FREE('loadout tweak, used x buy price in expenses') });
        }
    }
    return out;
}
