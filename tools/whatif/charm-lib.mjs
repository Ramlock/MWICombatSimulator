// The pure part of the charm what-if (charm.mjs): the experience table, level timing, branches and candidate charms. No file access,
// so the what-if search core (core.mjs, through levers/skills.mjs) can use it in any shell. charm.mjs re-exports all of it.
import levelTable from './levelExperienceTable.json' with { type: 'json' };

export const XP = levelTable.table;
export const MAX_LEVEL = XP.length;
export const toNext = (lv) => XP[lv] - XP[lv - 1]; // experience from the start of level lv to lv + 1

export const vecKey = (lv, skills) => skills.map((s) => s + '=' + lv[s]).join(',');
export const parseKey = (key) => Object.fromEntries(key.split(',').map((p) => { const [s, v] = p.split('='); return [s, Number(v)]; }));

// The next level-up under these rates: { s, h } or null.
export function nextLevelUp(state, rates) {
    let best = null;
    for (const s of Object.keys(state.lv)) {
        const r = rates[s] || 0;
        if (!(r > 0) || state.lv[s] >= MAX_LEVEL) continue;
        const h = Math.max(0, toNext(state.lv[s]) - state.xp[s]) / r;
        if (!best || h < best.h) best = { s, h };
    }
    return best;
}

// The state after h hours at these rates; several level-ups in a row are applied, the rest carries.
export function advance(state, rates, h) {
    const out = { lv: { ...state.lv }, xp: { ...state.xp } };
    for (const s of Object.keys(out.lv)) {
        out.xp[s] += (rates[s] || 0) * h;
        while (out.lv[s] < MAX_LEVEL && out.xp[s] >= toNext(out.lv[s]) * (1 - 1e-12)) { out.xp[s] = Math.max(0, out.xp[s] - toNext(out.lv[s])); out.lv[s]++; }
    }
    return out;
}

// Piecewise-constant level vectors under one charm. rateOf(key) gives the rates of that vector, or null when it has
// not been run; up to maxUnknown unrun vectors are walked on the last known rates (marked provisional) so that one
// batch can run several of them. Segments: { t0, t1, key, lv, state, up (skill levelled at t1) | null, provisional }.
export function trajectory(start, skills, rateOf, maxHours, maxUnknown = 0) {
    let st = { lv: { ...start.lv }, xp: { ...start.xp } }, t = 0, last = null;
    const segs = [], need = [];
    while (t < maxHours - 1e-9) {
        const key = vecKey(st.lv, skills);
        let r = rateOf(key);
        const provisional = !r;
        if (!r) { need.push(key); if (need.length > maxUnknown || !last) break; r = last; }
        last = r;
        const nx = nextLevelUp(st, r);
        const h = nx && nx.h < maxHours - t ? nx.h : maxHours - t;
        segs.push({ t0: t, t1: t + h, key, lv: { ...st.lv }, state: st, up: nx && nx.h < maxHours - t ? nx.s : null, provisional });
        st = advance(st, r, h); t += h;
    }
    return { segs, need, end: { t, state: st } };
}

export const segAt = (segs, t) => segs.find((s) => t >= s.t0 - 1e-9 && t < s.t1 - 1e-9) ?? (t >= segs.at(-1)?.t1 - 1e-9 ? segs.at(-1) : null);

// Paired difference of two level vectors' per-user profit per day: { mean, se, n } or null.
export function pairedDiff(f, keyA, keyB) {
    const a = f(keyA), b = f(keyB);
    if (!a || !b) return null;
    const d = [...a.seeds.keys()].filter((s) => b.seeds.has(s)).map((s) => a.seeds.get(s) - b.seeds.get(s));
    if (d.length < 2) return null;
    const m = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1));
    return { mean: m, se: sd / Math.sqrt(d.length), n: d.length };
}

// Profit difference charm-run minus baseline summed over [0, T] hours, in per-user coin; null when a vector is unrun.
export function wearSum(f, segs, baseSegs, T) {
    const cuts = [...new Set([0, T, ...segs.map((s) => s.t1), ...baseSegs.map((s) => s.t1)].filter((x) => x >= 0 && x <= T))].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
        const mid = (cuts[i] + cuts[i + 1]) / 2, a = segAt(segs, mid), b = segAt(baseSegs, mid);
        if (!a || !b) return null;
        if (a.key === b.key) continue;
        const d = pairedDiff(f, a.key, b.key);
        if (!d) return null;
        sum += d.mean * (cuts[i + 1] - cuts[i]) / 24;
    }
    return sum;
}

// Every branch of one charm: a level-up of its skill at t sells it. costRound in coin; nUsers the party size.
export function branches({ skill, segs, baseSegs, f, costRound, nUsers }) {
    const out = [];
    for (let i = 0; i + 1 < segs.length; i++) {
        if (segs[i].up !== skill) continue;
        const b = segs[i + 1], t = segs[i].t1, base = segAt(baseSegs, t);
        const g = base ? pairedDiff(f, b.key, base.key) : null;
        const wear = wearSum(f, segs, baseSegs, t);
        const row = { level: b.lv[skill], hours: t, days: t / 24, key: b.key, baseKey: base?.key ?? null, state: b.state, provisional: !!(b.provisional || segs.slice(0, i + 1).some((s) => s.provisional)) };
        if (g && wear !== null) {
            const costUser = costRound - wear, costParty = costRound - wear * nUsers;
            Object.assign(row, {
                gainUser: g.mean, se: g.se, n: g.n, gainParty: g.mean * nUsers, wearUser: wear, costRound, costUser, costParty,
                paybackUserDays: payback(costUser, g.mean), paybackPartyDays: payback(costParty, g.mean * nUsers),
            });
        }
        out.push(row);
    }
    return out;
}
export const payback = (cost, gainPerDay) => (cost <= 0 ? 0 : gainPerDay > 0 ? cost / gainPerDay : Infinity);

// The peak branch and whether the run is past it: fallen `fall` level-ups in a row below the peak.
export function peakOf(rows, fall) {
    let peak = null, below = 0;
    for (const r of rows) {
        if (r.gainUser === undefined) break;
        if (!peak || r.gainUser > peak.gainUser) { peak = r; below = 0; } else below++;
        if (below >= fall) return { peak, past: true, stopHours: r.hours };
    }
    return { peak, past: false };
}

// Candidate charms: the skills the player's combat style trains (its skill map), the given tier, the player meets
// its level requirement. items = itemDetailMap, styles = combatStyleDetailMap.
export function candidates(setup, items, styles, tierName) {
    const eq = setup.player.equipment;
    const weapon = eq.find((e) => /\/(main_hand|two_hand)$/.test(e.itemLocationHrid));
    const style = items[weapon?.itemHrid]?.equipmentDetail?.combatStats?.combatStyleHrids?.[0];
    if (!style || !styles[style]?.skillExpMap) throw new Error('no combat style with a skill map for ' + setup.name);
    const skills = Object.keys(styles[style].skillExpMap).map((h) => h.split('/')[2]);
    const charmEq = eq.find((e) => e.itemLocationHrid === '/item_locations/charm');
    const baseSkill = charmEq ? items[charmEq.itemHrid]?.equipmentDetail?.combatStats?.focusTraining?.split('/')[2] : null;
    const charms = skills.map((s) => {
        const hrid = `/items/${tierName}_${s}_charm`, it = items[hrid];
        const ok = it && (it.equipmentDetail.levelRequirements || []).every((r) => (setup.player[r.skillHrid.split('/')[2] + 'Level'] ?? 0) >= r.level);
        return ok ? { skill: s, hrid } : null;
    }).filter(Boolean);
    return { style, skills, charms, base: charmEq ? { skill: baseSkill, hrid: charmEq.itemHrid, level: charmEq.enhancementLevel } : null };
}
