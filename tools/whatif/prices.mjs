// Gold cost of equipment changes, from the per-level market entries, with 4% market tax on every sale (design
// docs/proposals/what-if.md 1.1, 2.3).
// - Buy +N: the +N ask. A +N with no ask is "no seller", never priced from the bid.
// - Sell +M: the +M bid less 4% tax. No bid means "no buyer": the old item is kept and its value is not counted.
// - Upgrade own +M to +N: buy +N and sell +M.
// - The Philosopher's Mirror is not priced, for now: his words, 2026-11-14, "drop philo mirrors entirely _for now_" and "we include
//   philo-mirrors if/when we include self-enhancing". A level nobody sells has no price, so it is never offered.

export const MARKET_TAX = 0.04; // the engine's number too: engine.mjs re-exports it
export const TAX_LABEL = 'after 4% market tax';
// The game's highest enhancement level: src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json has +0 to +20.
export const MAX_ENHANCEMENT = 20;

// loadMarket (the file read) is in node-shell.mjs: this file has no file access, so the search core can use it in any shell.

export function makePricer(market) {
    const entry = (hrid, lvl) => market[hrid]?.[String(lvl)];

    // { cost, path: 'market' }; cost Infinity = no seller.
    function buy(hrid, lvl) {
        const ask = entry(hrid, lvl)?.a;
        return { cost: ask > 0 ? ask : Infinity, path: 'market' };
    }

    function sell(hrid, lvl) {
        const bid = entry(hrid, lvl)?.b;
        return bid > 0 ? { value: bid * (1 - MARKET_TAX), bid } : { value: 0, bid: -1, noBuyer: true };
    }

    // Own +from -> +to, to > from.
    function upgrade(hrid, from, to) {
        const b = buy(hrid, to), s = sell(hrid, from);
        return finish({ cost: b.cost - s.value, path: 'buy, sell old', noBuyer: !!s.noBuyer }, to);
    }

    // Own `fromHrid` +from -> buy `toHrid` +to, sell the old. fromHrid null: an empty slot, nothing to sell (cost = the buy price).
    function swap(fromHrid, from, toHrid, to) {
        const b = buy(toHrid, to), s = fromHrid ? sell(fromHrid, from) : { value: 0 };
        return finish({ cost: b.cost - s.value, path: fromHrid ? 'buy, sell old' : 'buy', noBuyer: !!s.noBuyer }, to);
    }

    function finish(r, to) {
        const out = { ...r, to, known: Number.isFinite(r.cost) };
        if (!out.known) out.note = 'no seller';
        if (r.noBuyer) out.note = (out.note ? out.note + '; ' : '') + 'old item has no buyer, kept, not counted';
        return out;
    }

    // The levels 0 to MAX_ENHANCEMENT of an item that the market lists with a seller (an ask), lowest first: the levels that have a price.
    function listedLevels(hrid) {
        const out = [];
        for (let l = 0; l <= MAX_ENHANCEMENT; l++) if (entry(hrid, l)?.a > 0) out.push(l);
        return out;
    }

    return { buy, sell, upgrade, swap, listedLevels };
}

// His words, 2026-11-14: "I think this limitation needs to go away, try every level. Most will fail fast on cost anyway." With no
// --max-up and no --swap-levels, the levels offered are the levels the market sells.

// The levels an owned +from is offered at as an upgrade: +from+1 to +from+maxUp (one with no ask has no price and is listed apart as
// "no seller", as before), then, when allListed (no --max-up given), every higher level the market sells.
export function upgradeLevels(pricer, hrid, from, maxUp, allListed) {
    const out = [];
    for (let d = 1; d <= maxUp && from + d <= MAX_ENHANCEMENT; d++) out.push(from + d);
    if (allListed) for (const l of pricer.listedLevels(hrid)) if (l > from + maxUp) out.push(l);
    return out;
}

// The levels a swapped-in item is offered at. allListed false (--swap-levels given): the given ones ('same' = the worn item's
// level; an empty slot has none, so 0), as before. allListed true: every level of the new item the market sells.
export function swapLevelsOf(pricer, hrid, worn, levels, allListed) {
    if (allListed) return pricer.listedLevels(hrid);
    return [...new Set(worn == null ? [0] : levels.map((x) => (x === 'same' ? worn : Number(x))))];
}
