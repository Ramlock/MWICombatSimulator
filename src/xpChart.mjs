// The XP-vs-profit chart of the all-zones result: which dot each map gets, and which dots are on the frontier.
// Pure functions over the display rows `manipulateSimResultsDataForDisplay` builds (one row per zone, tier and player);
// nothing here reads the table or any other displayed text.

export const PARTY = 'Party';
// The XP choices, in selector order. The first is the default; each is a key of the display rows.
export const XP_KEYS = ['TotalExperience', 'Stamina', 'Intelligence', 'Attack', 'Melee', 'Defense', 'Ranged', 'Magic'];
export const PROFIT_KEY = 'ProfitPerDay';

// Profit of a run scaled to one day, per player. The run length is the Duration input, so the raw total is only a per-day figure at 24 h.
export function profitPerDay(noRngProfit, hoursSimulated) {
    return hoursSimulated > 0 ? (noRngProfit * 24) / hoursSimulated : 0;
}

// One map is one zone at one tier. The key is for lookups only; it is also written to the table rows as a data attribute.
export function mapKey(zoneName, difficultyTier) {
    return zoneName + '|' + difficultyTier;
}

// Distinct players of the rows, in first-seen order.
export function playersOf(rows) {
    return [...new Set(rows.map((r) => r.Player))];
}

const mean = (list, key) => list.reduce((sum, r) => sum + r[key], 0) / list.length;

// The dots for a selection: { xKey, player }. One dot per map; first-seen order of the maps.
// player = PARTY: the average over the players that have a row for the map (X, Y and deaths). Any other value: that player's row.
// A dot: { key, zone, tier, x, y, deaths, players } where players lists the players the dot is made of.
export function pointsFor(rows, { xKey = XP_KEYS[0], player = PARTY } = {}) {
    const byMap = new Map();
    for (const r of rows) {
        if (player !== PARTY && r.Player !== player) continue;
        const key = mapKey(r.ZoneName, r.DifficultyTier);
        if (!byMap.has(key)) byMap.set(key, []);
        byMap.get(key).push(r);
    }
    return [...byMap.entries()].map(([key, list]) => ({
        key,
        zone: list[0].ZoneName,
        tier: list[0].DifficultyTier,
        x: mean(list, xKey),
        y: mean(list, PROFIT_KEY),
        deaths: mean(list, 'Deaths'),
        players: list.map((r) => r.Player),
    }));
}

// The frontier: a dot is on it when no other dot has X at least as high and Y at least as high with one of them strictly higher.
// Returns the dots on it in increasing X (ties: lower Y first); dots equal on both axes are all on it.
export function frontier(points) {
    const on = points.filter((p) => !points.some((q) => q !== p && q.x >= p.x && q.y >= p.y && (q.x > p.x || q.y > p.y)));
    return on.sort((a, b) => a.x - b.x || a.y - b.y);
}
