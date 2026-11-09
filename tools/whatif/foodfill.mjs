// Food filling for the what-if search: instead of swapping one food at a time, every food slot is refilled at once.
// A filling is one food of each of as many different food types as there are open food slots (the game allows one
// food per type), and it qualifies when the foods can regenerate the HP and MP the party actually uses per hour
// (the need, measured on the base party by engine.mjs measureNeed) with a margin. Foods that are worse than another
// food of the same type are dropped, and only the cheapest few of each type are kept, so the search tries a handful
// of fillings instead of every combination. Pure functions: no page, no optimizer globals, no side effects.
import { consumableType } from './consumables.mjs';
import { rankEst } from './buyer.mjs';

export const MARGIN = 0.25; // a filling must regenerate need x (1 + MARGIN) per hour, both resources
export const KEEP_PER_TYPE = 3; // the cheapest foods kept per type (the player's current foods stay in addition)
const USES_PER_HOUR = 60; // every food has a 60 second cooldown
const short = (h) => h.split('/').pop();
const FREE = (path) => ({ cost: 0, known: true, path, mirrors: 0, note: '' });
const askOf = (market, h) => market?.[h]?.['0']?.a;

// A food's type and resource from the item data, whether or not it has an ask. null when it is not a food that restores HP or MP.
export function foodInfo(items, hrid) {
    const t = consumableType(items[hrid]);
    const m = /^food:(hp|mp):/.exec(t || '');
    return m ? { type: t, resource: m[1] } : null;
}

// Every combat food with an ask: { hrid, type, resource, restore, capacity (points per hour), ask, ppp (price per point) }.
export function foodTable(items, market) {
    const rows = [];
    for (const it of Object.values(items)) {
        if (it.categoryHrid !== '/item_categories/food' || !it.consumableDetail?.usableInActionTypeMap?.['/action_types/combat']) continue;
        const ask = askOf(market, it.hrid), info = foodInfo(items, it.hrid);
        const restore = info?.resource === 'hp' ? it.consumableDetail.hitpointRestore : it.consumableDetail.manapointRestore;
        if (!(ask > 0) || !info || !(restore > 0)) continue;
        rows.push({ hrid: it.hrid, type: info.type, resource: info.resource, restore, capacity: restore * USES_PER_HOUR, ask, ppp: ask / restore });
    }
    return rows;
}

// The foods another food of the same type beats: g has capacity >= f's and price per point <= f's, one of the two
// strictly. `exempt` foods (the player's current ones) are never dropped. Prices compare by cross-multiplication, exact.
export function dominatedFoods(table, exempt = new Set()) {
    const out = new Set();
    for (const f of table) {
        if (exempt.has(f.hrid)) continue;
        for (const g of table) {
            if (g === f || g.type !== f.type || g.capacity < f.capacity || g.ask * f.restore > f.ask * g.restore) continue;
            if (g.capacity > f.capacity || g.ask * f.restore < f.ask * g.restore) { out.add(f.hrid); break; }
        }
    }
    return out;
}

function choose(a, k) {
    if (k === 0) return [[]];
    if (a.length < k) return [];
    return [...choose(a.slice(1), k - 1).map((r) => [a[0], ...r]), ...choose(a.slice(1), k)];
}
const product = (lists) => lists.reduce((acc, l) => acc.flatMap((r) => l.map((x) => [...r, x])), [[]]);
const byPrice = (a, b) => (a.ppp - b.ppp) || (a.ask - b.ask) || (a.hrid < b.hrid ? -1 : a.hrid > b.hrid ? 1 : 0);

// The fillings for `nSlots` open slots. `current` is the player's food hrids (no nulls). Returns the qualifying fillings
// before and after the best-per-type cut (each an array of hrids in type order), and the sets behind the counts.
// keepCurrent false is the same search with no exemption for the current foods (only to count what it would change).
export function planFillings({ table, nSlots, current, need, keepCurrent = true, keep = KEEP_PER_TYPE }) {
    const byHrid = new Map(table.map((f) => [f.hrid, f]));
    const cur = new Set(current.filter((h) => byHrid.has(h)));
    const dom = dominatedFoods(table, keepCurrent ? cur : new Set());
    const pool = table.filter((f) => !dom.has(f.hrid));
    const types = [...new Set(pool.map((f) => f.type))].sort();
    const needHp = need.hp * (1 + MARGIN), needMp = need.mp * (1 + MARGIN);
    const qualifies = (fill) => {
        const cap = (r) => fill.reduce((a, h) => a + (byHrid.get(h).resource === r ? byHrid.get(h).capacity : 0), 0);
        return cap('hp') >= needHp && cap('mp') >= needMp;
    };
    const isBase = (fill) => fill.length === current.length && fill.every((h) => current.includes(h));
    const all = [];
    for (const combo of choose(types, nSlots)) for (const fill of product(combo.map((t) => pool.filter((f) => f.type === t).map((f) => f.hrid)))) if (qualifies(fill)) all.push(fill);
    const baseQualifies = all.some(isBase);
    const qualifying = all.filter((f) => !isBase(f));
    // Best per type among the foods that appear in a qualifying filling; the current foods do not take a place.
    const appears = new Set(all.flat());
    const top = new Set();
    for (const t of types) pool.filter((f) => f.type === t && appears.has(f.hrid) && !(keepCurrent && cur.has(f.hrid))).sort(byPrice).slice(0, keep).forEach((f) => top.add(f.hrid));
    const kept = new Set([...top, ...(keepCurrent ? [...cur].filter((h) => !dom.has(h)) : [])]);
    const left = qualifying.filter((fill) => fill.every((h) => kept.has(h)));
    return { table, dominated: dom, pool, qualifying, baseQualifies, appears, kept, left, current: [...cur] };
}

// Where each food of a filling goes: a food of the type of a baseline food takes that food's slot; the rest take a free
// slot whose baseline food restores the same resource (slot order), then any free slot (slot order). `info(hrid)` gives { type, resource }.
export function placeFilling(filling, baseline, info) {
    const slots = Array(baseline.length).fill(null), rest = [];
    for (const f of [...filling].sort((a, b) => (info(a).type < info(b).type ? -1 : 1))) {
        const i = baseline.findIndex((b, j) => b && slots[j] === null && info(b).type === info(f).type);
        if (i >= 0) slots[i] = f; else rest.push(f);
    }
    const left = [];
    for (const f of rest) {
        const i = baseline.findIndex((b, j) => b && slots[j] === null && info(b).resource === info(f).resource);
        if (i >= 0) slots[i] = f; else left.push(f);
    }
    for (const f of left) slots[slots.findIndex((s) => s === null)] = f;
    return slots;
}

// The trigger op of each food that is new in its slot: the donor is the baseline food of the same type, else the unused
// baseline food (not the donor of another new food) that restores the same resource, in slot order. Returns
// [{ slot, donor, op }] for the donors that have an entry in the player's triggerMap (an explicit null becomes []).
export function inheritTriggers(p, slots, baseline, info, triggerMap) {
    const fresh = slots.map((s, i) => (s && s !== baseline[i] ? i : -1)).filter((i) => i >= 0);
    const donor = new Map(), used = new Set();
    for (const i of fresh) {
        const d = baseline.find((b) => b && info(b).type === info(slots[i]).type);
        if (d) { donor.set(i, d); used.add(d); }
    }
    for (const i of fresh) {
        if (donor.has(i)) continue;
        const d = baseline.find((b) => b && !used.has(b) && info(b).resource === info(slots[i]).resource);
        if (d) { donor.set(i, d); used.add(d); }
    }
    const out = [];
    for (const i of fresh) {
        const d = donor.get(i);
        if (!d || !triggerMap || triggerMap[d] === undefined) continue;
        out.push({ slot: i, donor: d, op: { op: 'trigger', player: p, hrid: slots[i], triggers: triggerMap[d] === null ? [] : structuredClone(triggerMap[d]) } });
    }
    return out;
}

// What a filling costs per hour for a need: each resource's points from its foods, cheapest food per point first, up to each food's capacity.
export function fillingCostPerHour(fill, table, need) {
    const byHrid = new Map(table.map((f) => [f.hrid, f]));
    let cost = 0;
    for (const r of ['hp', 'mp']) {
        let left = need[r];
        for (const f of fill.map((h) => byHrid.get(h)).filter((f) => f.resource === r).sort(byPrice)) { const use = Math.min(left, f.capacity); cost += use * f.ppp; left -= use; }
    }
    return cost;
}

// The food-fill candidates of one player, in the shape consumables.mjs swapCands makes, cheapest filling first (only for the log).
// baseline: the player's food hrids per open slot (null = empty); triggerMap: the player's own; need: { hp, mp } per hour.
export function foodFillCands(p, { items, market, baseline, triggerMap, need, keepCurrent = true }) {
    const table = foodTable(items, market), info = (h) => foodInfo(items, h), current = baseline.filter(Boolean);
    const plan = planFillings({ table, nSlots: baseline.length, current, need, keepCurrent });
    const cands = plan.left.map((fill) => {
        const slots = placeFilling(fill, baseline, info), changed = slots.map((s, i) => (s !== baseline[i] ? i : -1)).filter((i) => i >= 0);
        const trig = inheritTriggers(p, slots, baseline, info, triggerMap);
        const part = (i) => { const t = trig.find((x) => x.slot === i); return `${baseline[i] ? short(baseline[i]) : 'empty'} -> ${short(slots[i])}${t ? ` (trigger of ${short(t.donor)} kept)` : ''}`; };
        return {
            id: `${p}:foodfill=${slots.map((s) => (s ? short(s) : 'none')).join('+')}`, kind: 'food-fill', groups: changed.map((i) => `${p}:food${i}`), player: p, monotone: false,
            desc: `${p} food: ${changed.map(part).join(', ')}`,
            ops: [...changed.map((i) => ({ op: 'food', player: p, index: i, item: slots[i] })), ...trig.map((t) => t.op)],
            cost: FREE('loadout tweak, used x buy price in expenses'), perHour: fillingCostPerHour(fill, table, need),
        };
    }).sort((a, b) => (a.perHour - b.perHour) || (a.id < b.id ? -1 : 1));
    for (const c of cands) delete c.perHour;
    // Which of the player's own foods a rule would cut without the exemption, for the log.
    const bare = planFillings({ table, nSlots: baseline.length, current, need, keepCurrent: false });
    const currentCut = plan.current.filter((h) => !bare.kept.has(h)).map((h) => ({ hrid: h, rule: bare.dominated.has(h) ? 'dominated' : !bare.appears.has(h) ? 'in no qualifying filling' : 'outside the cheapest ' + KEEP_PER_TYPE }));
    const stats = { need, nSlots: baseline.length, foods: table.length, dominated: plan.dominated.size, qualify: plan.qualifying.length + (plan.baseQualifies ? 1 : 0), baseQualifies: plan.baseQualifies, left: plan.left.length, leftWithoutCurrent: bare.left.length, qualifyWithoutCurrent: bare.qualifying.length + (bare.baseQualifies ? 1 : 0), dominatedWithoutCurrent: bare.dominated.size, currentCut };
    return { cands, stats };
}

// One food row per player in the report. `rows` are the search's result rows (result.singles); `isFood(row)` says which are
// food fillings. One row per player stays: the best accepted food row in rankEst order (the greedy's order), and every other
// food row of that player is hidden, the "helps the party" ones included. Only when the player has no accepted food row does
// the helps-the-party row with the largest gainPerUser stay (at most one row). Hidden rows get hiddenFood: true (they stay in
// the file). Mutates the rows.
export function hideFoodRows(rows, isFood) {
    const est = (r) => ({ score: r.score, net: r.buyerNet, gain: r.gain });
    const players = [...new Set(rows.filter(isFood).map((r) => r.player))];
    for (const p of players) {
        const mine = rows.filter((r) => isFood(r) && r.player === p);
        const best = mine.filter((r) => r.accepted).sort((a, b) => rankEst(est(a), est(b)))[0];
        const help = mine.filter((r) => r.helpsParty).sort((a, b) => b.gainPerUser - a.gainPerUser)[0];
        for (const r of mine) if (r !== best && !(r === help && !best)) r.hiddenFood = true;
    }
}
