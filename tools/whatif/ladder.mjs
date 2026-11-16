// The measuring loop of an ability's (or later a skill's) gain per level (design docs/proposals/break-even-payback.md in the project's
// records, section 2 steps 1 to 4 and section 9.1; docs/codebase/payback.md). One loop for books, switches and skills: it knows
// nothing of what a level is worth or costs; the caller gives it `measure` (runs a state) and `stopAt` (the stopping level at a gain
// per level, through payback()).
//
// - First states: +10 and +20 above the start (fewer when the top is nearer), every state on the same seeds as the start, so the
//   evenness check (payback.mjs evenness) takes their difference paired.
// - The gain per level carries its range (± margin errors over the step's levels). stopAt runs at the centre and both ends: levels up to
//   the low end's stop are settled in, past the high end's stop settled out, between them unsettled.
// - A failed pair is the knee (9.1 point 8): halve between the last even step and the failed one (a state at the middle, checked by the
//   same evenness walk) until the gap is narrower than the noise can tell apart (margin errors of the last even step over its gain per
//   level, and never under 2 levels); the recommendation reaches at most the last even step; stopAt counts a level's gain only below it.
// - Not flagged, and the centre's stop past the largest step, or unsettled levels: the next state at double the largest step, up to the
//   top (it may lie past the stopping level, only to learn the gain per level; never recommended past a measured level).
// - Unsettled at the top, or after a knee: more seeds on the last even step, a block at a time up to the ceiling (the pick check's flow,
//   sure.mjs SURE_BLOCK up to SURE_MAX). At the ceiling the row recommends the settled-in levels and shows the rest as a range.
// - No unsettled level: no more runs, however noisy the gain.
import { evenness, stoppingLevel } from '../../src/whatif/payback.mjs';
import { SURE_BLOCK, SURE_MAX } from './sure.mjs';

// ---- The changes, as payback() takes them (design section 3) ----
// Books on an ability held now, at level `from` with XP `xpNow` and `perDay` XP a day from casting: changeAt(level) is the change of
// having `level` instead of today: the books' cost, no day-one gain of its own, one lead (the levels bought, shrinking as casting
// brings today's ability up). costAt(level) and xpAfter(level): the books to reach it and the XP they leave. knee: a level or undefined.
export const booksChangeAt = ({ xpNow, perDay, costAt, xpAfter, perLevel, knee }) => (level) => ({
    cost: costAt(level), gain: 0,
    leads: [{ gainPerLevel: perLevel, knee, with: { xp: xpAfter(level), perDay }, without: { xp: xpNow, perDay } }],
});
// A switch to a new ability (one book teaches it at level 1, XP 0; more books raise it): changeAt(level >= 1). dayOne: the gain per
// day of the new ability at level 1 against today (measured; it holds the old ability's loss at its level today, likely negative).
// Two leads: the new ability's levels as they come (from the bought level, `newPerDay` XP a day) against level 1, and the old ability's
// levels given up (frozen where it is today, against where casting would have taken it: a lead below 0). The losing days are counted.
export const switchChangeAt = ({ dayOne, costAt, xpAfter, newPerDay, newPerLevel, newKnee, oldXp, oldPerDay, oldPerLevel, oldKnee }) => (level) => ({
    cost: costAt(level), gain: dayOne,
    leads: [
        { gainPerLevel: newPerLevel, knee: newKnee, with: { xp: xpAfter(level), perDay: newPerDay }, without: { xp: 0, perDay: 0 } },
        { gainPerLevel: oldPerLevel, knee: oldKnee, with: { xp: oldXp, perDay: 0 }, without: { xp: oldXp, perDay: oldPerDay } },
    ],
});
// The stopping level of a change (payback.mjs stoppingLevel, levels one at a time while the next one alone pays back within `limit`):
// `from` today's level (0 for a switch: not held), changeAt(level), the experience table. The whole level and its stoppingLevel record.
export const stopOf = ({ from, changeAt, limit, table }) => stoppingLevel({ from, changeAt, limit, measuredTo: Infinity, table });

export const FIRST_STEPS = [10, 20];
export const MAX_STATES = 24; // a guard only: doublings to 200, a knee's halvings and the precisions stay under it

// The first states for `room` levels above the start: +10 and +20, or the top and half of it when the top is nearer.
export function firstSteps(room) {
    const second = Math.min(FIRST_STEPS[1], room), first = Math.min(FIRST_STEPS[0], Math.floor(second / 2));
    return [...new Set([first, second])].filter((x) => x > 0);
}

// The precisions a row's states are measured at, cheapest first (the Manager's reply 2 on the first block): `block` seeds at
// `firstHours`, the hours doubled up to `fullHours` (the pick check's), then `block` seeds more at a time up to `max` (sure.mjs). A row
// moves to the next precision only while it has unsettled levels and no bigger step is left (9.1 points 2 and 3).
export function precisions({ firstHours, fullHours, block = SURE_BLOCK, max = SURE_MAX }) {
    const out = [];
    for (let h = Math.min(firstHours, fullHours); ; h = Math.min(fullHours, 2 * h)) { out.push({ k: block, h }); if (h >= fullHours) break; }
    for (let k = 2 * block; k <= max; k += block) out.push({ k, h: fullHours });
    return out;
}

// room: the levels above the start that exist (top - start). measure(levels, k, h): a Promise of the state `levels` above the start on k
// seeds of h hours (h undefined: the caller's own): { levels, gain, se, samples } (gain per day against the start, samples { seed: gain }), or null when a stop ended the runs.
// stopAt(perLevel, knee, end): the levels the recommendation reaches above the start at that gain per level (knee: the levels above the
// start past which the gain is zero, or null; end: 'low' | 'centre' | 'high', the end of the range asked, for a caller whose change has
// another measured figure with its own range, a switch's day-one gain; perLevel may be 0 or below: the caller's change then pays nothing
// per level). Returns null on a stop, else:
// { steps, seeds, perLevel, perLevelLow, perLevelHigh, mark, knee, stops: { low, centre, high }, levels, upTo, measuredTo, runs }:
// levels = the settled-in levels (the recommendation), upTo = the high end's stop (levels > levels: a range); both never past measuredTo,
// the largest measured step (the last even one after a knee); mark 'even' | 'notEven' | 'assumed' (payback.mjs evenness); knee
// { from, to } in levels above the start, or null; runs = the states measured, in order ({ levels, seeds, hours }).
// schedule: the precisions in order (precisions() above); default: `block` seeds up to `max`, at the caller's hours.
export async function measureLadder({ room, measure, stopAt, margin = 2, block = SURE_BLOCK, max = SURE_MAX, schedule = null }) {
    const plan = schedule ?? Array.from({ length: Math.floor(max / block) }, (_, i) => ({ k: (i + 1) * block, h: undefined }));
    const empty = { steps: [], seeds: 0, hours: null, perLevel: null, perLevelLow: null, perLevelHigh: null, mark: null, knee: null, stops: { low: 0, centre: 0, high: 0 }, levels: 0, upTo: 0, measuredTo: 0, runs: [] };
    if (!(room >= 1)) return empty;
    const at = new Map(), runs = [];
    let prec = 0, fence = Infinity, failed = null; // fence: the lowest step a pair ever failed at; a knee once found is kept (below)
    const run = async (levels) => { const { k, h } = plan[prec], s = await measure(levels, k, h); if (s === null) return false; at.set(levels, s); runs.push({ levels, seeds: k, hours: h ?? null }); return true; };
    // The walk over the steps below the fence; a failed pair lowers the fence to its failed step. The fence never rises: a halving state
    // or more seeds on the last even step re-judge only the steps below it, so a later noisy pass between the halves cannot carry the
    // walk past a knee once found.
    const judge = () => {
        for (;;) {
            const steps = [...at.values()].filter((s) => s.levels < fence).sort((a, b) => a.levels - b.levels), ev = evenness(steps, { margin });
            if (!ev.flagged) return { steps, ev };
            fence = ev.knee.to; failed = ev.pairs.at(-1);
        }
    };
    for (const l of firstSteps(room)) if (!await run(l)) return null;
    for (let guard = 0; ; guard++) {
        const { steps, ev } = judge(), flagged = fence < Infinity;
        const last = ev.lastEven, largest = steps.at(-1).levels, knee = flagged ? { from: last.levels, to: fence } : null;
        const tell = Math.max(2, ev.perLevel > 0 ? margin * last.se / ev.perLevel : Infinity);
        // The knee's place matters only when a stop could pass the last even step: at the range's favourable end with the gain going on up to the
        // failed step. Otherwise no halving (no unsettled level, no more runs).
        const kneeMatters = flagged && stopAt(ev.perLevel + margin * ev.perLevelSe, knee.to, 'high') > knee.from;
        if (guard < MAX_STATES && kneeMatters && knee.to - knee.from > tell) {
            if (!await run(Math.round((knee.from + knee.to) / 2))) return null;
            continue;
        }
        const measuredTo = largest; // the last even step after a knee
        const ends = { low: ev.perLevel - margin * ev.perLevelSe, centre: ev.perLevel, high: ev.perLevel + margin * ev.perLevelSe };
        const stops = Object.fromEntries(Object.entries(ends).map(([key, p]) => [key, stopAt(p, flagged ? knee.from : null, key)]));
        const unsettled = stops.low < stops.high;
        if (guard < MAX_STATES && !flagged && largest < room && (stops.centre > largest || unsettled)) {
            if (!await run(Math.min(2 * largest, room))) return null;
            continue;
        }
        if (guard < MAX_STATES && unsettled && prec < plan.length - 1) {
            prec++;
            if (!await run(last.levels)) return null;
            continue;
        }
        const levels = Math.min(stops.low, measuredTo), upTo = Math.max(levels, Math.min(stops.high, measuredTo));
        const mark = flagged ? 'notEven' : ev.mark, pairs = flagged ? [...ev.pairs, failed] : ev.pairs;
        return { steps: steps.map((s) => ({ levels: s.levels, gain: s.gain, se: s.se, seeds: s.samples ? Object.keys(s.samples).length : null })), seeds: plan[prec].k, hours: plan[prec].h ?? null, perLevel: ev.perLevel, perLevelLow: ends.low, perLevelHigh: ends.high, mark, knee, pairs, stops, levels, upTo, measuredTo, runs };
    }
}
