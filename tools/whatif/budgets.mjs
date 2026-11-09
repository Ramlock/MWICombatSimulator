// Per-player budgets for the what-if optimizer (delivery design section 6 item 1): each change is paid from its own
// player's coin, and each greedy step records every player's running spend. Pure functions; tools/test/whatif-runner.mjs
// covers them.

// "--budgets A=1.5M,B=200000" -> { A: 1500000, B: 200000 }. Suffixes K, M, B (thousand, million, billion).
export function parseBudgetList(text) {
    const out = {};
    if (!text) return out;
    for (const part of String(text).split(',').map((s) => s.trim()).filter(Boolean)) {
        const eq = part.lastIndexOf('=');
        if (eq <= 0) throw new Error(`--budgets: "${part}" is not Name=coin`);
        const name = part.slice(0, eq).trim(), v = parseCoin(part.slice(eq + 1));
        if (!(v >= 0)) throw new Error(`--budgets: "${part}" has no coin amount`);
        out[name] = v;
    }
    return out;
}
export function parseCoin(text) {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*([kmb]?)\s*$/i.exec(String(text));
    if (!m) return NaN;
    return Number(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()]);
}

// Every open player's budget: --budgets per name; --budget (or the exporter's coin) for anyone --budgets leaves out.
// A player with neither is an error, never a silent zero.
export function resolveBudgets(players, list, fallback) {
    const out = {};
    for (const p of players) {
        const v = p in list ? list[p] : fallback;
        if (!(v >= 0)) throw new Error(`no budget for ${p}: give --budgets ${p}=<coin> or --budget <coin>`);
        out[p] = v;
    }
    for (const p of Object.keys(list)) if (!players.includes(p)) throw new Error(`--budgets names ${p}, who is not in --players`);
    return out;
}

export const zeroSpend = (budgets) => Object.fromEntries(Object.keys(budgets).map((p) => [p, 0]));

// A candidate is affordable when its cost fits what its own player has left. A change that frees gold or costs
// nothing is always affordable; a candidate with no player is refused (no payer).
export function affordable(c, budgets, spent) {
    const p = c.player, cost = c.cost.cost;
    if (!(p in budgets)) return false;
    return cost <= 0 || cost <= budgets[p] - (spent?.[p] ?? 0);
}

// The spend after paying for c (a sale's negative cost never refunds a budget, as the single pool did).
export function pay(spent, c) {
    return { ...spent, [c.player]: (spent[c.player] ?? 0) + Math.max(c.cost.cost, 0) };
}
