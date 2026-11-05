// Gold cost of equipment changes, from the per-level market entries and the Philosopher's Mirror path, with 4%
// market tax on every sale (design docs/proposals/what-if.md 1.1, 2.3).
// - Buy +N: the cheaper of the +N ask and the Mirror path. The Mirror path makes +N from a +N-1 primary and a +N-2
//   copy, plus one mirror (item description of /items/philosophers_mirror: "the enhancing cost changes to a copy
//   of the base item at one enhancement level below the primary item"; success is guaranteed). A +N with no ask
//   and no Mirror path is "no seller", never priced from the bid.
// - Sell +M: the +M bid less 4% tax. No bid means "no buyer": the old item is kept and its value is not counted.
// - Upgrade own +M to +N: the cheaper of (market) buy +N and sell +M, and (own mirror) mirror the owned item up one
//   level at a time, each step costing a mirror plus a bought copy one level below the owned item.
// - A Mirror win below +10 is flagged: his words, "Below +10 the PMirror is rarely if ever worth the total cost".
import { readFileSync } from 'node:fs';
import { DEFAULT_PRICES, MARKET_TAX } from './engine.mjs';

export const MIRROR = '/items/philosophers_mirror';
export const TAX_LABEL = 'after 4% market tax';
const MIRROR_CHECK_BELOW = 10;

export function loadMarket(file = DEFAULT_PRICES) {
    return JSON.parse(readFileSync(file, 'utf8')).marketData;
}

export function makePricer(market) {
    const entry = (hrid, lvl) => market[hrid]?.[String(lvl)];
    const mirrorAsk = entry(MIRROR, 0)?.a > 0 ? entry(MIRROR, 0).a : Infinity;
    const memo = new Map();

    // { cost, path: 'market' | 'mirror', mirrors } ; cost Infinity = no seller.
    function buy(hrid, lvl) {
        const key = hrid + '+' + lvl;
        if (memo.has(key)) return memo.get(key);
        const ask = entry(hrid, lvl)?.a;
        let best = { cost: ask > 0 ? ask : Infinity, path: 'market', mirrors: 0 };
        if (lvl >= 2) {
            const p = buy(hrid, lvl - 1), c = buy(hrid, lvl - 2);
            const m = p.cost + c.cost + mirrorAsk;
            if (m < best.cost) best = { cost: m, path: 'mirror', mirrors: p.mirrors + c.mirrors + 1 };
        }
        memo.set(key, best);
        return best;
    }

    function sell(hrid, lvl) {
        const bid = entry(hrid, lvl)?.b;
        return bid > 0 ? { value: bid * (1 - MARKET_TAX), bid } : { value: 0, bid: -1, noBuyer: true };
    }

    // Own +from -> +to, to > from.
    function upgrade(hrid, from, to) {
        const b = buy(hrid, to), s = sell(hrid, from);
        const market = { cost: b.cost - s.value, path: b.path === 'mirror' ? 'buy via mirror, sell old' : 'buy, sell old', mirrors: b.mirrors, noBuyer: !!s.noBuyer };
        let own = { cost: 0, mirrors: 0 };
        for (let k = from + 1; k <= to; k++) {
            if (k < 2) { own = { cost: Infinity }; break; }
            const c = buy(hrid, k - 2);
            own = { cost: own.cost + mirrorAsk + c.cost, mirrors: own.mirrors + 1 + c.mirrors };
        }
        const best = own.cost < market.cost ? { cost: own.cost, path: 'mirror own item', mirrors: own.mirrors, noBuyer: false } : market;
        return finish(best, to);
    }

    // Own `fromHrid` +from -> buy `toHrid` +to, sell the old.
    function swap(fromHrid, from, toHrid, to) {
        const b = buy(toHrid, to), s = sell(fromHrid, from);
        return finish({ cost: b.cost - s.value, path: b.path === 'mirror' ? 'buy via mirror, sell old' : 'buy, sell old', mirrors: b.mirrors, noBuyer: !!s.noBuyer }, to);
    }

    function finish(r, to) {
        const out = { ...r, known: Number.isFinite(r.cost) };
        if (!out.known) out.note = 'no seller';
        else if (r.mirrors > 0 && to < MIRROR_CHECK_BELOW) out.note = 'Mirror win below +10: price to check';
        if (r.noBuyer) out.note = (out.note ? out.note + '; ' : '') + 'old item has no buyer, kept, not counted';
        return out;
    }

    return { buy, sell, upgrade, swap, mirrorAsk };
}
