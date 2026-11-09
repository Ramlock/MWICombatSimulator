// Skill-level levers for the what-if optimizer (design 1.5, 4.3 item 1): "+1, +2 ... levels" of each combat skill the
// player's combat style trains. The gain comes from the optimizer's own runs (the `level` op, variants.mjs). The cost
// is time: the experience still to gain divided by that skill's simulated experience per hour in the base runs.
// Levelling by combat takes no time away from combat, so a skill level is shown with its days to reach and is never
// bought: the optimizer screens these candidates but never stacks them (`timeOnly`). Time folds into gold only for
// time spent away from the primary income: hours away x base profit per hour; for levelling by combat that is 0 hours.
// Also reported: the days to reach the Intelligence level that opens the 5th ability slot, for a player below it.
// The level timing and the experience table are charm.mjs's (levelExperienceTable.json).
import { XP, MAX_LEVEL, toNext, candidates as charmCandidates } from '../charm.mjs';

// Experience left to the next level, typed per player: "P1:stamina=300.5K,magic=7.25M;P2:attack=1.2M".
// Suffixes K, M, B (x1e3, 1e6, 1e9). Returns { player: { skill: experience left } }.
export function parseSkillLeft(text) {
    const out = {};
    if (!text || text === true) return out;
    const mult = { K: 1e3, M: 1e6, B: 1e9 };
    for (const part of String(text).split(';').map((s) => s.trim()).filter(Boolean)) {
        const i = part.indexOf(':');
        if (i < 1) throw new Error(`--skill-left: "${part}" is not <player>:<skill>=<left>,...`);
        const p = part.slice(0, i), m = (out[p] ||= {});
        for (const kv of part.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean)) {
            const r = /^([a-z]+)=([0-9.]+)([KMB]?)$/i.exec(kv);
            if (!r) throw new Error(`--skill-left: "${kv}" is not <skill>=<number>[K|M|B]`);
            m[r[1].toLowerCase()] = Number(r[2]) * (mult[r[3].toUpperCase()] || 1);
        }
    }
    return out;
}

// The skills a setup's combat style trains (the style's skill map, as charm.mjs reads it).
export const trainedSkills = (setup, items, styles) => charmCandidates(setup, items, styles, 'master').skills;

// Where a player stands in each skill: level from the setup; experience inside the level = the level's span minus
// the typed experience left (the table's experience at level + 1 minus the figure), else 0 (the level's start).
export function startOf(setup, skills, left = {}) {
    const out = {};
    for (const s of skills) {
        const lv = Number(setup.player[s + 'Level']), l = left[s];
        if (l !== undefined && !(l >= 0 && l <= toNext(lv))) throw new Error(`${setup.name} ${s}: experience left ${l} is outside level ${lv}'s span ${toNext(lv)}`);
        out[s] = { lv, xpIn: l === undefined ? 0 : toNext(lv) - l, source: l === undefined ? 'level start (not known)' : 'typed' };
    }
    return out;
}

// Experience from (level lv, xpIn into it) to the start of level lv + d; null past the table's top.
export function expToReach(lv, xpIn, d) {
    if (lv + d > MAX_LEVEL) return null;
    return XP[lv + d - 1] - XP[lv - 1] - xpIn;
}
// Hours at a constant rate; Infinity with no experience in that skill.
export const hoursAt = (exp, rate) => (exp === null ? null : exp <= 0 ? 0 : rate > 0 ? exp / rate : Infinity);

// Time folded into gold (design 3.1, 4.1 answer 2): hours not at the primary income x profit per hour there.
export const foldTime = (hoursAway, profitPerHour) => hoursAway * profitPerHour;

// Candidates for one player: each trained skill +1..+maxUp, below the table's top.
export function skillCands(setups, p, { maxUp = 2, items, styles }) {
    const s = setups.find((x) => x.name === p), out = [];
    for (const skill of trainedSkills(s, items, styles)) {
        const lv = Number(s.player[skill + 'Level']);
        for (let d = 1; d <= maxUp && lv + d <= MAX_LEVEL; d++) {
            out.push({
                id: `${p}:${skill}+${d}`, kind: 'skill', timeOnly: true, groups: [`${p}:skill:${skill}`], player: p, skill, delta: d,
                monotone: false, // a higher level can widen the party's level gap (debuffOnLevelGap), so not monotone
                desc: `${p} ${skill} ${lv} -> ${lv + d}`, ops: [{ op: 'level', player: p, skill, delta: d }],
                cost: { cost: 0, known: true, path: 'time (levelled by combat; days in the skill-level table)', mirrors: 0, note: '' },
            });
        }
    }
    return out;
}

// Mean experience per hour per skill of one player over base checkpoints (batch.mjs format).
export function ratesOf(cps, p) {
    const o = {};
    for (const cp of cps) for (const [s, v] of Object.entries(cp.players[p]?.expPerHourBySkill || {})) o[s] = (o[s] || 0) + v / cps.length;
    return o;
}

// The 5th ability slot (index 4) opens at reqList[5] Intelligence (main.js, abilitySlotsLevelRequirementList).
export function slotUnlock(setup, reqList, start, rate) {
    const gate = reqList[5], lv = Number(setup.player.intelligenceLevel);
    if (lv >= gate) return { player: setup.name, level: lv, gate, open: true };
    const exp = expToReach(lv, start?.xpIn ?? 0, gate - lv), h = hoursAt(exp, rate);
    return { player: setup.name, level: lv, gate, open: false, exp, rate, days: h === null ? null : h / 24, source: start?.source ?? 'level start (not known)' };
}

// The skill section of the optimizer's report. singles: result.singles; cands: the skill candidates screened;
// baseCps: base checkpoints at the finalist stage; names: the party, in order; goal: 'profit' | 'exp'.
export function skillReport({ singles, cands, setups, players, baseCps, names, left, reqList, items, styles, goal, fmt }) {
    const nUsers = names.length;
    const baseParty = baseCps.reduce((a, cp) => a + cp.party.profitAfterTaxPerDay, 0) / baseCps.length;
    const ratePerHourUser = baseParty / nUsers / 24;
    const byId = new Map(singles.map((r) => [r.id, r]));
    const rows = [], unlocks = [];
    for (const p of players) {
        const s = setups.find((x) => x.name === p), skills = trainedSkills(s, items, styles);
        const st = startOf(s, [...new Set([...skills, 'intelligence'])], left[p]), rates = ratesOf(baseCps, p);
        for (const c of cands.filter((x) => x.player === p)) {
            const r = byId.get(c.id), a = st[c.skill], exp = expToReach(a.lv, a.xpIn, c.delta), h = hoursAt(exp, rates[c.skill]);
            const hoursAway = 0; // levelled by combat: no time away from combat (design 4.3 item 1)
            rows.push({
                id: c.id, player: p, skill: c.skill, from: a.lv, to: a.lv + c.delta, stage: r?.lastStage ?? null, gain: r?.gain ?? null, se: r?.se ?? null,
                gainUser: goal === 'profit' && r ? r.gain / nUsers : null, expPerHour: rates[c.skill] ?? 0, exp, days: h === null ? null : h / 24,
                startSource: a.source, hoursAway, foldedCost: foldTime(hoursAway, ratePerHourUser),
            });
        }
        unlocks.push(slotUnlock(s, reqList, st.intelligence, rates.intelligence));
    }
    rows.sort((x, y) => (y.gain ?? -Infinity) - (x.gain ?? -Infinity));
    const D = (d) => (d === null ? '-' : d === Infinity ? 'never with the charm worn now (no EXP in this skill: combat EXP goes 30% to the primary skill, 70% to the charm\'s focus skill or split over the style\'s skills without one; a charm swap is charm.mjs)' : d.toFixed(1));
    const gUnit = goal === 'exp' ? 'party EXP/h' : 'party coin/day';
    const L = ['', '## Skill levels (time, levelled by combat; never bought, never stacked)', '',
        `Days to reach: experience still to gain / the skill's EXP per hour in the base runs (${baseCps.length} runs), held at today's rate. Start: the typed experience left to the next level, else the level's start (stated per row). Folded gold cost = hours away from combat x base profit per hour per user (${fmt(ratePerHourUser)} coin/h after tax, from the base runs); levelling by combat takes 0 hours away, so it is 0.`, '',
        `| Change | Stage | Gain (${gUnit}) | ± se |${goal === 'profit' ? ' Gain per user/day |' : ''} EXP/h | EXP to gain | Days to reach | Start | Folded gold cost |`,
        `|---|---|---|---|${goal === 'profit' ? '---|' : ''}---|---|---|---|---|`];
    for (const r of rows) L.push(`| ${r.player} ${r.skill} ${r.from} -> ${r.to} | ${r.stage ?? '-'} | ${fmt(r.gain)} | ${fmt(r.se)} |${goal === 'profit' ? ` ${fmt(r.gainUser)} |` : ''} ${fmt(r.expPerHour)} | ${fmt(r.exp)} | ${D(r.days)} | ${r.startSource} | ${fmt(r.foldedCost)} |`);
    L.push('', `### 5th ability slot (Intelligence ${reqList[5]})`, '');
    for (const u of unlocks) L.push(u.open ? `- ${u.player}: open (Intelligence ${u.level}).` : `- ${u.player}: Intelligence ${u.level} -> ${u.gate}, ${fmt(u.exp)} EXP at ${fmt(u.rate)} EXP/h: ${D(u.days)} days (start: ${u.source}). Its gain once filled is the abilities lever's.`);
    return { lines: L, json: { ratePerHourUser, rateLabel: 'base party profit per day after tax / party size / 24', rows, unlocks } };
}
