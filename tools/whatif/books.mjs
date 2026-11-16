// The books stage of the what-if search: ability books on the abilities held now, and switches to a not-learned ability, each judged
// alone against one start (the baseline after foods and drinks) by the measuring loop (ladder.mjs) and the break-even rule (payback.mjs);
// no pick check, no "too small to matter" rule (the loop is the one judge of these rows). Design: docs/proposals/break-even-payback.md
// in the project's records, sections 2, 3 and 9.1; docs/codebase/payback.md.
//
// One player at a time; the held abilities first (a switch gives up the held ability of its slot, whose gain per level it needs), then
// the switches. Every state runs on the pick check's seeds (one block at a time up to the ceiling), so the loop's differences are paired.
// The rows carry no figure of their own: the payback is payback() of the change at the recommended level, at the centre gain per level.
import { payback, abilityClock, HORIZON_DAYS } from '../../src/whatif/payback.mjs';
import { measureLadder, booksChangeAt, switchChangeAt, stopOf, precisions } from './ladder.mjs';
import { BOOK_OF, XP, MAX_LEVEL, xpAt, booksNeeded, slotOpen } from './levers/houses.mjs';
import abilityDetailMap from '../../src/combatsimulator/data/abilityDetailMap.json' with { type: 'json' };
import itemDetailMap from '../../src/combatsimulator/data/itemDetailMap.json' with { type: 'json' };
import { playerFit, abilityMisfit } from './stylefit.mjs';

// The first block's hours per seed (--books-first-hours), a quarter of the pick check's: on the measured noise by run length it cut the stage's core-hours by more than half against 300 h, with the same recommendations; shorter blocks saved little more for more states per row.
export const BOOKS_FIRST_HOURS = 75;

const short = (h) => String(h).split('/').pop();
const meetsReq = (setup, req = []) => req.every((r) => (setup.player[short(r.skillHrid) + 'Level'] ?? 0) >= r.level);

// The XP a day of an ability from its casts a day, or null when the casts are not known (a run recorded before the count existed): an
// unknown count is never read as zero (casting would then never raise the ability, and every lead would look longer than it is).
const perDayOf = (uses, hrid) => (uses && Number.isFinite(uses[hrid]) ? abilityClock(0, uses[hrid]).perDay : null);

// opts:
// - player, setup (the player's setup at the start), learned (the exporter's learnedAbilities, or null: switches need it; a held ability
//   without it takes the start of its level as its XP, and its cost is an upper bound)
// - buy(itemHrid): the unit price, or a non-finite number when nothing sells it
// - limit: the Payback limit in days (0 or none: the horizon, HORIZON_DAYS)
// - measure(ops, k, h): a Promise of { samples: { seed: gain per day }, uses } for the state "start + ops" on the first k pick-check seeds
//   of h hours
//   (samples: the buyer's net of the state against the start, per seed; uses: the player's casts a day per ability hrid in that state,
//   null when a run lacks them), or null when a stop ended the runs. ops: [] reads the start itself (samples all 0).
// - firstHours, fullHours: the hours of the first block and of the pick check (ladder.mjs precisions)
// - switches: build the switch rows too (false: the books on held abilities only)
// Returns null on a stop, else { rows, apart }: rows (each judged by the loop) and apart (not judged, with the reason).
export async function booksForPlayer({ player, setup, learned, buy, limit, measure, firstHours, fullHours, switches = true }) {
    const schedule = precisions({ firstHours, fullHours });
    const lim = limit > 0 ? limit : HORIZON_DAYS, rows = [], apart = [], held = {};
    const start = await measure([], schedule[0].k, schedule[0].h);
    if (start === null) return null;
    const usesNow = start.uses;
    const toLadder = (samplesOf) => async (levels, k, h) => {
        const s = await samplesOf(levels, k, h);
        if (s === null) return null;
        const v = Object.values(s.samples), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
        return { levels, gain: m, se: sd / Math.sqrt(v.length), samples: s.samples, uses: s.uses };
    };
    const rowOf = (base, r, from, changeAtCentre) => {
        const to = from + r.levels, at = r.levels > 0 || base.kind === 'switch' && r.levels >= 0 ? changeAtCentre(to) : null;
        return {
            ...base, from, to, upTo: from + r.upTo, measuredTo: from + r.measuredTo,
            cost: at ? at.cost : 0, payback: at ? payback(at, { table: XP }) : null,
            perLevel: r.perLevel, perLevelLow: r.perLevelLow, perLevelHigh: r.perLevelHigh, mark: r.mark,
            knee: r.knee ? { from: from + r.knee.from, to: from + r.knee.to } : null, seeds: r.seeds, states: r.runs.length,
        };
    };

    // ---- The abilities held now ----
    for (const [i, a] of (setup.abilities || []).entries()) {
        if (!a?.abilityHrid) continue;
        const ability = a.abilityHrid, L0 = Number(a.level), book = BOOK_OF[ability], base = { kind: 'abilityLevel', player, slot: i, ability };
        if (!(L0 < MAX_LEVEL)) continue;
        if (!book) { apart.push({ ...base, from: L0, note: 'no ability book' }); continue; }
        const unit = buy(book.hrid);
        if (!Number.isFinite(unit)) { apart.push({ ...base, from: L0, note: `no seller: ${short(book.hrid)}` }); continue; }
        const perDay = perDayOf(usesNow, ability);
        if (perDay === null) { apart.push({ ...base, from: L0, note: 'casts a day unknown (runs recorded before the count existed): start a new search' }); continue; }
        const ex = learned?.find((l) => l.abilityHrid === ability && Number(l.level) === L0), xpNow = ex ? Number(ex.experience) : xpAt(L0);
        const bookXp = book.abilityBookDetail.experienceGain, nBooks = (L) => (L > L0 ? booksNeeded(xpNow, L, bookXp) : 0);
        const shape = { xpNow, perDay, costAt: (L) => unit * nBooks(L), xpAfter: (L) => xpNow + nBooks(L) * bookXp };
        const changeAt = (p, knee) => booksChangeAt({ ...shape, perLevel: p, knee: knee == null ? undefined : L0 + knee });
        const stopAt = (p, knee) => stopOf({ from: L0, changeAt: changeAt(p, knee), limit: lim, table: XP }).level - L0;
        const ops = (levels) => [{ op: 'abilityLevel', player, index: i, delta: levels }];
        const r = await measureLadder({ room: MAX_LEVEL - L0, measure: toLadder((levels, k, h) => measure(ops(levels), k, h)), stopAt, schedule });
        if (r === null) return null;
        held[i] = { ability, xp: xpNow, perDay, perLevel: r.perLevel, knee: r.knee ? L0 + r.knee.from : undefined };
        rows.push({ ...rowOf(base, r, L0, (to) => changeAt(r.perLevel, r.knee?.from)(to)), books: nBooks(L0 + r.levels), ...(ex ? {} : { costBound: 'upper' }) });
    }
    if (!switches || !learned) return { rows, apart };

    // ---- Switches: one row per open slot and not-learned ability that fits it ----
    const known = new Set(learned.filter((l) => Number(l.level) > 0).map((l) => l.abilityHrid));
    const fit = playerFit(setup, itemDetailMap); // the style's own abilities only (houses.mjs bookCands: a misfit is never a candidate)
    const holding = new Set((setup.abilities || []).map((a) => a?.abilityHrid).filter(Boolean));
    for (const [ability, book] of Object.entries(BOOK_OF)) {
        const det = abilityDetailMap[ability];
        if (!det || known.has(ability) || holding.has(ability) || !meetsReq(setup, book.abilityBookDetail.levelRequirements) || abilityMisfit(ability, fit)) continue;
        for (let i = 0; i < 5; i++) {
            if (!slotOpen(setup, i) || !!det.isSpecialAbility !== (i === 0)) continue;
            const was = setup.abilities?.[i]?.abilityHrid ? { ability: setup.abilities[i].abilityHrid, level: Number(setup.abilities[i].level) } : null;
            const base = { kind: 'switch', player, slot: i, ability, was };
            const unit = buy(book.hrid);
            if (!Number.isFinite(unit)) { apart.push({ ...base, note: `no seller: ${short(book.hrid)}` }); continue; }
            const old = was ? held[i] : null;
            if (was && !old) { apart.push({ ...base, note: `the replaced ability's gain per level is not known (${apart.find((x) => x.kind === 'abilityLevel' && x.slot === i)?.note ?? 'not measured'})` }); continue; }
            // The day-one state (the new ability at level 1 in the slot) is the ladder's start: each state's gain against it is its gain
            // against the search's start minus the day-one state's, seed by seed. The day-one gain and the new ability's casts a day are read
            // from the day-one state at the loop's current seeds.
            const bookXp = book.abilityBookDetail.experienceGain, nBooks = (L) => booksNeeded(0, L, bookXp, true);
            const ops = (L) => [{ op: 'ability', player, index: i, ability, level: L }];
            let dayOne = null;
            const samplesOf = async (levels, k, h) => {
                const one = await measure(ops(1), k, h), at = one && await measure(ops(1 + levels), k, h);
                if (!at) return null;
                const v = Object.values(one.samples), m = v.reduce((a, x) => a + x, 0) / v.length;
                dayOne = { gain: m, se: Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, v.length - 1) / v.length), uses: one.uses };
                return { samples: Object.fromEntries(Object.entries(at.samples).map(([s, g]) => [s, g - one.samples[s]])), uses: at.uses };
            };
            const changeAt = (p, knee, gain = dayOne.gain) => switchChangeAt({
                dayOne: gain, costAt: (L) => unit * nBooks(L), xpAfter: (L) => (nBooks(L) - 1) * bookXp,
                newPerDay: perDayOf(dayOne.uses, ability) ?? 0, newPerLevel: p, newKnee: knee == null ? undefined : 1 + knee,
                oldXp: old?.xp ?? 0, oldPerDay: old?.perDay ?? 0, oldPerLevel: old?.perLevel ?? 0, oldKnee: old?.knee,
            });
            // The ends of the range carry the day-one gain's range too (its own ± margin errors, the same side): a switch whose favourable
            // end does not pay back is settled out after the first block and gets no more runs (9.1 points 1 and 2).
            const stopAt = (p, knee, end = 'centre') => {
                const gain = dayOne.gain + { low: -2, centre: 0, high: 2 }[end] * dayOne.se;
                return stopOf({ from: 0, changeAt: changeAt(p, knee, gain), limit: lim, table: XP }).level - 1;
            };
            const r = await measureLadder({ room: MAX_LEVEL - 1, measure: toLadder(samplesOf), stopAt, schedule });
            if (r === null) return null;
            if (perDayOf(dayOne.uses, ability) === null) { apart.push({ ...base, note: 'casts a day unknown (runs recorded before the count existed): start a new search' }); continue; }
            const row = rowOf(base, r, 1, (to) => changeAt(r.perLevel, r.knee?.from)(to));
            // levels -1: no switch (not even the first book pays back); the row keeps its figures, with no level bought.
            rows.push(r.levels < 0 ? { ...row, to: 0, cost: 0, payback: null, books: 0, dayOne: dayOne.gain, dayOneSe: dayOne.se } : { ...row, books: nBooks(row.to), dayOne: dayOne.gain, dayOneSe: dayOne.se });
        }
    }
    return { rows, apart };
}
