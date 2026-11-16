// The buyer's payback, in one place: the report window (src/whatif/panel.mjs) and the search (tools/whatif/core.mjs, optimize.mjs,
// sure.mjs, rounds.mjs) read it from here, so the figure shown and the figure the limit is checked on are the same.
// The rule (docs/proposals/break-even-payback.md in the project's records, sections 1 and 2; docs/codebase/payback.md):
// - Today is the base: levels, uses per day and XP per hour are today's; nothing else is bought; prices stay today's.
// - The level clock: an ability's level moves by its uses per day (0.1 XP per use), a combat skill's by its XP per hour, against
//   the game's experience table; whole levels only, up to the game's top level (200).
// - A change is a cost, a gain on day one (per day, may be negative) and, for each ability or skill it touches, a lead: whole levels
//   ahead (or behind) on each later day against not making the change, worth a gain per whole level per day.
// - The payback is the first point at which the summed difference (day-one gain plus gain per level times the lead, day by day,
//   losing days counted) covers the cost. One function, payback(); paybackDays and overPaybackLimit are its no-lead case.

// XP one cast of an ability gives that ability.
export const ABILITY_XP_PER_USE = 0.1;

// ---- The level clock ----
// table: the game's experience table (tools/whatif/levelExperienceTable.json `table`): table[i - 1] is the total XP to reach level i,
// so its length is the top level. Passed in, not imported, so this file stays plain for the page's bundle.

// The whole level for a total XP: the highest level whose total the XP reaches (1 at XP 0), never past the table's top.
export function levelAt(xp, table) {
    let lo = 0, hi = table.length - 1; // the last index whose total is reached
    if (!(xp >= table[0])) return 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (table[mid] <= xp) lo = mid; else hi = mid - 1; }
    return lo + 1;
}

// A clock: XP now and XP gained per day. The two ways the game gives XP to what the payback follows.
export const abilityClock = (xp, usesPerDay) => ({ xp, perDay: usesPerDay * ABILITY_XP_PER_USE });
export const skillClock = (xp, xpPerHour) => ({ xp, perDay: xpPerHour * 24 });

// The whole level of a clock `day` days from now (a day may be fractional).
export const levelOn = (clock, day, table) => levelAt(clock.xp + clock.perDay * day, table);
export const abilityLevelOn = (xp, usesPerDay, day, table) => levelOn(abilityClock(xp, usesPerDay), day, table);
export const skillLevelOn = (xp, xpPerHour, day, table) => levelOn(skillClock(xp, xpPerHour), day, table);

// The first whole day index after `day` on which the clock's level, read at the middle of that day, differs from its level at the
// middle of `day`; Infinity when it never moves again (no XP coming in, or the top level reached).
function nextMove(clock, day, table) {
    const lv = levelOn(clock, day + 0.5, table);
    if (!(clock.perDay > 0) || lv >= table.length) return Infinity;
    let d = Math.max(day + 1, Math.ceil((table[lv] - clock.xp) / clock.perDay - 0.5));
    while (d - 1 > day && levelOn(clock, d - 0.5, table) > lv) d--; // floating safety: the analytic day, checked against the clock itself
    while (levelOn(clock, d + 0.5, table) === lv) d++;
    return d;
}

// ---- The one function ----
// change: { cost, gain, leads: [{ gainPerLevel, with: clock, without: clock }] }
//   cost: what the change costs, once. gain: the gain per day on day one, before any lead (may be negative; 0 for books alone).
//   leads: one per ability or skill the change touches; its lead on a day is levelOn(with) - levelOn(without), read at the middle
//   of the day (whole levels), worth gainPerLevel per whole level per day.
// opts: { table (needed when there are leads), maxDays (the most days looked at; default no end) }.
// Returns the payback in days, or null: null for no cost, a gain that is not a number, or a summed difference that never covers
// the cost within maxDays. Each day's difference accrues evenly through that day, so the figure is the exact crossing point:
// for a change with no lead it is cost / gain (today's figure), and with a lead its ceiling is the first whole day whose summed
// difference covers the cost (the books report's break-even day). The design's "payback day" is the ceiling of what this returns;
// the limit is checked on the figure itself.
export function payback(change, { table, maxDays = Infinity } = {}) {
    const { cost, gain } = change;
    const leads = change.leads || [];
    if (!(Number.isFinite(cost) && cost > 0) || !Number.isFinite(gain)) return null;
    if (leads.length && !table) throw new Error('payback: a change with a lead needs the experience table');
    if (leads.some((l) => !Number.isFinite(l.gainPerLevel))) return null;
    const clocks = leads.flatMap((l) => [l.with, l.without]);
    let day = 0, sum = 0;
    while (day < maxDays) {
        const mid = day + 0.5;
        const perDay = leads.reduce((a, l) => a + l.gainPerLevel * (levelOn(l.with, mid, table) - levelOn(l.without, mid, table)), gain);
        const end = Math.min(maxDays, ...clocks.map((c) => nextMove(c, day, table))); // the difference holds from `day` up to `end`
        if (perDay > 0 && sum + perDay * (end - day) >= cost) return day + (cost - sum) / perDay;
        if (end === Infinity) return null;
        sum += perDay * (end - day);
        day = end;
    }
    return null;
}

// The payback in days for a change with no lead: the cost over the buyer's gain per day. null unless both are above 0 (a free change
// has nothing to pay back, a change with no positive buyer's gain never does).
export const paybackDays = (cost, buyerNet) => payback({ cost, gain: buyerNet });

// Whether a change pays back too slowly for the limit (days; 0, null or undefined = no limit). A free change (cost 0) always passes;
// a change with a cost and no positive buyer's gain has no payback and is over the limit.
export function overPaybackLimit(cost, buyerNet, limit) {
    if (!(limit > 0) || !(cost > 0)) return false;
    const days = paybackDays(cost, buyerNet);
    return days === null || days > limit;
}

// ---- The evenness check (section 2) ----
// steps: the measured steps of one ability or skill, by level step ascending: [{ levels, gain, se }] (e.g. +10, +20, +40 ...;
// gain per day against today, se its standard error). Each step is checked against the one before it: the earlier gain against
// the later gain scaled to the earlier step's levels (the +10 gain against half the +20 gain), within `margin` (2) times the standard
// error of their difference (the two errors taken as independent: when the two steps share seeds, this is more lenient than a paired check). The first step that fails ends the check: nothing past it is used.
// Returns { perLevel, lastEven, flagged, pairs }: perLevel = the last even step's gain over its levels; lastEven = that step;
// flagged = a step failed (the gain is not even: "for us to rethink our strategy"); pairs = each check made
// ({ from, to, diff, seDiff, even }). With no steps: perLevel null.
export function evenness(steps, { margin = 2 } = {}) {
    for (let i = 1; i < steps.length; i++) if (!(steps[i].levels > steps[i - 1].levels)) throw new Error('evenness: steps must rise in levels');
    if (steps.some((s) => !(s.levels > 0) || !Number.isFinite(s.gain) || !(s.se >= 0))) throw new Error('evenness: each step needs levels > 0, a gain and an error');
    if (!steps.length) return { perLevel: null, lastEven: null, flagged: false, pairs: [] };
    const pairs = [];
    let last = steps[0], flagged = false;
    for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1], b = steps[i], k = a.levels / b.levels;
        const diff = a.gain - b.gain * k, seDiff = Math.sqrt(a.se * a.se + (b.se * k) ** 2);
        const even = Math.abs(diff) <= margin * seDiff;
        pairs.push({ from: a.levels, to: b.levels, diff, seDiff, even });
        if (!even) { flagged = true; break; }
        last = b;
    }
    return { perLevel: last.gain / last.levels, lastEven: last, flagged, pairs };
}

// ---- The stopping level (section 2, "What is recommended") ----
// Levels one at a time while the next level alone still pays back within the limit; the top level is the only other end.
// opts: { from (the level today), changeAt(level) -> the change of having `level` instead of today (a change as payback() takes,
//   its leads in the same order and with the same `without` clocks at every level), limit (days: the Payback limit, or the horizon
//   when there is none), measuredTo (the highest level measured: today's level plus the largest step), table, top (default the
//   table's top level) }.
// The next level alone is the change from level n to n + 1: the cost and day-one gain between them, each lead's `with` at n + 1
// against its `with` at n. Returns { level, levels, cost, payback, pastMeasured }: level = where the recommendation stops (from when
// not even one level pays back); levels = level - from; cost and payback = the whole change to that level (payback null with no
// level); pastMeasured = the level lies past measuredTo (the search measures further, part 2).
export function stoppingLevel({ from, changeAt, limit, measuredTo, table, top = table.length }) {
    const alone = (a, b) => ({ cost: b.cost - a.cost, gain: b.gain - a.gain, leads: (b.leads || []).map((l, i) => ({ gainPerLevel: l.gainPerLevel, with: l.with, without: a.leads[i].with })) });
    const today = { cost: 0, gain: 0, leads: (changeAt(from + 1).leads || []).map((l) => ({ ...l, with: l.without })) };
    let level = from, at = today;
    while (level < top) {
        const next = changeAt(level + 1);
        if (payback(alone(at, next), { table, maxDays: limit }) === null) break;
        level++; at = next;
    }
    return { level, levels: level - from, cost: at.cost, payback: level > from ? payback(at, { table }) : null, pastMeasured: level > measuredTo };
}
