// Charm what-if: which focus charm to wear for a while, and at which level of its skill to sell it and put the
// current charm back on. A charm changes only experience (the 70% focus share, src/combatsimulator/simResult.js
// addExperienceGain), so its value comes only through levelling. Design: the brief "MWI Charm What-If", version four.
// - One levelling run per candidate charm (the same tier and enhancement for every skill the player's combat style
//   trains), worn from day 0: experience per hour per skill from the simulator at the current level vector,
//   level-ups by the game's experience table (levelExperienceTable.json), progress inside a level carried per skill.
// - Baseline: the charm the player wears now, worn the whole time (the same kind of run).
// - A branch sells charm c at a level-up of c's skill and puts the current charm back on, keeping the levels.
//   Its gain per day = profit per day at the branch's levels minus the baseline's at the same elapsed time (per user,
//   party profit after tax / party size, paired seeds). Its cost = buy - sell-back after 4% tax, minus the profit
//   difference summed over the wear days (either sign). Payback = cost / gain per day, per user and per party.
// - Profit depends only on the level vector (the charm leaves profit unchanged; checked on every shared seed), so
//   runs are cached by level vector; experience per hour is read from the run of the charm being worn.
// - Pruning: a charm's run is extended while its branch gain rises and stops after --fall level-ups in a row below
//   its peak, or at --max-days. The best --look-best branches are followed --lookahead days with the current
//   charm back on, to report how far the gain moved.
// Usage: node tools/whatif/charm.mjs --out <dir> --setups <dir> [--player <name>] [--seeds 32] [--hours 150]
//   [--tier-name master] [--level 5] [--charms stamina,magic,...] [--max-days 120] [--fall 3] [--window 6]
//   [--lookahead 60] [--look-best 3] [--start-exp stamina=123,magic=456] [--jobs 24] [--max-minutes 50]
//   [--prices <marketplace.json>] [--comdrop 20] [--comexp 20] [--tier 4] [--zone /actions/combat/infernal_abyss] [--dry]
// Writes <out>/runs.jsonl (the run cache, batch.mjs format), <out>/result.json and <out>/result.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const XP = JSON.parse(readFileSync(path.join(here, 'levelExperienceTable.json'), 'utf8')).table;
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

// ---------------------------------------------------------------------------------------------------------------
async function main() {
    const arg = (name, def) => { const i = process.argv.indexOf('--' + name); if (i < 0) return def; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
    const OUT = arg('out'); if (!OUT) throw new Error('--out required');
    mkdirSync(OUT, { recursive: true });
    const setupsDir = arg('setups', path.join(root, 'docs', 'ground-truth', 'setups'));
    const { readParty } = await import('./variants.mjs');
    const { makePricer, loadMarket } = await import('./prices.mjs');
    const { DEFAULT_PRICES } = await import('./engine.mjs');
    const party = readParty(setupsDir);
    const names = party.map((s) => s.name);
    const player = arg('player', names[0]);
    const setup = party.find((s) => s.name === player); if (!setup) throw new Error('no player ' + player);
    const items = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/itemDetailMap.json'), 'utf8'));
    const styles = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/combatStyleDetailMap.json'), 'utf8'));
    const enh = Number(arg('level', 5));
    const cand = candidates(setup, items, styles, arg('tier-name', 'master'));
    if (!cand.base?.skill) throw new Error(player + ' wears no focus charm: the baseline is the charm worn now');
    const only = arg('charms', null);
    const charms = cand.charms.filter((c) => c.skill !== cand.base.skill && (!only || only.split(',').includes(c.skill)));
    const skills = cand.skills;
    const seeds = Array.from({ length: Number(arg('seeds', 32)) }, (_, i) => i + 1);
    const hours = Number(arg('hours', 150));
    const maxH = Number(arg('max-days', 120)) * 24, lookH = Number(arg('lookahead', 60)) * 24;
    const fall = Number(arg('fall', 3)), win = Number(arg('window', 6)), lookBest = Number(arg('look-best', 3));
    const pricesFile = arg('prices', DEFAULT_PRICES);
    const options = { comdrop: Number(arg('comdrop', 20)), comexp: Number(arg('comexp', 20)), tier: Number(arg('tier', 4)), zone: arg('zone', '/actions/combat/infernal_abyss'), prices: pricesFile, streams: true };
    const startLv = Object.fromEntries(skills.map((s) => [s, Number(setup.player[s + 'Level'])]));
    const startXp = Object.fromEntries(skills.map((s) => [s, 0]));
    if (arg('start-exp', null)) for (const p of String(arg('start-exp')).split(',')) { const [s, v] = p.split('='); if (!(s in startXp)) throw new Error('--start-exp: unknown skill ' + s); startXp[s] = Number(v); }
    const start = { lv: startLv, xp: startXp };
    const pricer = makePricer(loadMarket(pricesFile));
    const CACHE = path.join(OUT, 'runs.jsonl');
    const t0 = Date.now(), maxMin = Number(arg('max-minutes', Infinity));
    const runner = { base: cand.base, ...Object.fromEntries(charms.map((c) => [c.skill, { ...c, level: enh }])) };
    const opsFor = (charm, key) => {
        const lv = parseKey(key), c = charm === 'base' ? cand.base : runner[charm];
        return [{ op: 'equip', player, slot: 'charm', item: c.hrid, level: c.level }, ...skills.filter((s) => lv[s] !== startLv[s]).map((s) => ({ op: 'level', player, skill: s, delta: lv[s] - startLv[s] }))];
    };

    let state;
    for (let round = 0; ; round++) {
        // Indexes from the cache.
        const rows = existsSync(CACHE) ? readFileSync(CACHE, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
        const prof = new Map(), xp = new Map(), done = new Set();
        let charmProfitMismatch = 0;
        for (const r of rows) {
            done.add(r.variant + '#' + r.seed);
            if (!seeds.includes(r.seed)) continue;
            const [charm, key] = r.variant.split('|');
            const cp = r.checkpoints.at(-1);
            const u = cp.party.profitAfterTaxPerDay / names.length;
            if (!prof.has(key)) prof.set(key, new Map());
            const pm = prof.get(key);
            if (pm.has(r.seed)) charmProfitMismatch = Math.max(charmProfitMismatch, Math.abs(pm.get(r.seed) - u)); else pm.set(r.seed, u);
            const xk = charm + '|' + key;
            if (!xp.has(xk)) xp.set(xk, []);
            xp.get(xk).push(cp.players[player].expPerHourBySkill);
        }
        const f = (key) => { const m = prof.get(key); if (!m || m.size < seeds.length) return null; const v = [...m.values()]; return { mean: v.reduce((a, b) => a + b, 0) / v.length, seeds: m }; };
        const rateOf = (charm) => (key) => { const a = xp.get(charm + '|' + key); if (!a || a.length < seeds.length) return null; const o = {}; for (const e of a) for (const [s, v] of Object.entries(e)) o[s] = (o[s] || 0) + v / a.length; return o; };

        const need = new Set();
        const base = trajectory(start, skills, rateOf('base'), maxH + lookH, win);
        for (const k of base.need) need.add('base|' + k);
        const res = {};
        for (const c of charms) {
            const costRound = pricer.buy(c.hrid, enh).cost - pricer.sell(c.hrid, enh).value;
            let tr = trajectory(start, skills, rateOf(c.skill), maxH, win);
            let br = branches({ skill: c.skill, segs: tr.segs, baseSegs: base.segs, f, costRound, nUsers: names.length });
            const pk = peakOf(br, fall);
            if (pk.past) { tr = trajectory(start, skills, rateOf(c.skill), pk.stopHours + 1e-6, win); br = br.filter((b) => b.hours <= pk.stopHours + 1e-6); }
            for (const k of tr.need) need.add(c.skill + '|' + k);
            res[c.skill] = { charm: c, costRound, segs: tr.segs, branches: br, peak: pk.peak, past: pk.past };
        }
        // Lookahead, once the charm runs need nothing: the best branches followed with the current charm back on.
        const look = [];
        if (![...need].some((n) => !n.startsWith('base|'))) {
            const all = Object.values(res).flatMap((r) => (r.peak ? [{ skill: r.charm.skill, row: r.peak }] : [])).sort((a, b) => b.row.gainUser - a.row.gainUser).slice(0, lookBest);
            for (const { skill, row } of all) {
                const tr = trajectory(row.state, skills, rateOf('base'), lookH, win);
                for (const k of tr.need) need.add('base|' + k);
                const end = row.hours + lookH, bEnd = segAt(base.segs, end), aEnd = tr.segs.at(-1);
                const g = aEnd && bEnd && !tr.need.length ? pairedDiff(f, aEnd.key, bEnd.key) : null;
                look.push({ skill, level: row.level, atSwap: { mean: row.gainUser, se: row.se }, after: g, days: lookH / 24, endKey: aEnd?.key, baseEndKey: bEnd?.key });
            }
        }
        state = { res, base, look, charmProfitMismatch, rowsCount: rows.length };
        const todo = [...need].flatMap((n) => seeds.filter((s) => !done.has(n + '#' + s)).length ? [n] : []);
        console.log(`[round ${round}] ${rows.length} runs cached, ${todo.length} level vectors to run`);
        if (!todo.length || arg('dry', false) === true) break;
        if ((Date.now() - t0) / 60000 > maxMin) { console.log('stopped at --max-minutes; rerun to resume from the cache'); break; }
        const spec = { checkpoints: [hours], seeds, options, setupsDir, variants: todo.map((n) => { const [charm, key] = n.split('|'); return { name: n, ops: opsFor(charm, key) }; }) };
        const specFile = path.join(OUT, 'round-spec.json');
        writeFileSync(specFile, JSON.stringify(spec));
        const r = spawnSync(process.execPath, [path.join(here, 'batch.mjs'), '--spec', specFile, '--out', CACHE, '--jobs', String(arg('jobs', 24))], { stdio: 'inherit' });
        if (r.status !== 0) throw new Error('batch exited ' + r.status);
    }
    report(OUT, state, { player, names, skills, start, cand, enh, seeds, hours, maxH, lookH, fall, pricesFile, options });
}

const M = (x) => (x === undefined || x === null ? '-' : Math.abs(x) >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : (x / 1e3).toFixed(1) + 'K');
const D = (x) => (x === undefined ? '-' : x === Infinity ? 'never' : x.toFixed(1));

function report(OUT, st, ctx) {
    const strip = (b) => { const { state, ...r } = b; return r; };
    const charms = Object.values(st.res).map((r) => ({ skill: r.charm.skill, hrid: r.charm.hrid, costRound: r.costRound, past: r.past, peak: r.peak ? strip(r.peak) : null, branches: r.branches.map(strip), levels: r.segs.map((s) => ({ t0: s.t0, t1: s.t1, lv: s.lv, up: s.up })) }));
    charms.sort((a, b) => (b.peak?.gainUser ?? -Infinity) - (a.peak?.gainUser ?? -Infinity));
    const result = {
        player: ctx.player, partySize: ctx.names.length, skills: ctx.skills, start: ctx.start, baselineCharm: ctx.cand.base, enhancement: ctx.enh,
        seeds: ctx.seeds.length, simHours: ctx.hours, maxDays: ctx.maxH / 24, lookaheadDays: ctx.lookH / 24, fall: ctx.fall, prices: path.basename(ctx.pricesFile), options: ctx.options,
        charmProfitMismatch: st.charmProfitMismatch, runs: st.rowsCount,
        baseline: st.base.segs.map((s) => ({ t0: s.t0, t1: s.t1, lv: s.lv, up: s.up })), charms, lookahead: st.look,
    };
    writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
    const best = charms[0]?.peak;
    const tie = (p) => best && p && p !== best && Math.abs(best.gainUser - p.gainUser) < 2 * Math.hypot(best.se, p.se);
    const L = [];
    L.push(`# Charm what-if: ${ctx.player}`, '');
    L.push(`Per user = party profit per day after 4% market tax / ${ctx.names.length}. Each ± is one standard error over ${ctx.seeds.length} paired seeds x ${ctx.hours} sim h. Prices: ${path.basename(ctx.pricesFile)}, held fixed. Baseline: ${ctx.cand.base.hrid.split('/')[2]} +${ctx.cand.base.level} worn the whole time. Candidates: ${ctx.cand.style.split('/')[2]} style trains ${ctx.skills.join(', ')}; each candidate is the ${ctx.enh > 0 ? '+' + ctx.enh : ''} charm of that skill.`, '');
    L.push('| Charm | Sell at skill level | Day | Gain per day (per user) | ± se | Charm round trip | Wear-day profit (per user) | Cost per user | Payback days (per user) | Payback days (party) | Note |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of charms) {
        const p = c.peak;
        if (!p) { L.push(`| ${c.skill} | - | - | - | - | ${M(c.costRound)} | - | - | - | - | no level-up measured |`); continue; }
        const note = [p === best ? 'best' : tie(p) ? 'tie with the best (inside 2 se)' : '', c.past ? '' : `no peak by day ${ctx.maxH / 24}: still rising`, p.provisional ? 'provisional' : ''].filter(Boolean).join('; ');
        L.push(`| ${c.skill} | ${p.level} | ${p.days.toFixed(1)} | ${M(p.gainUser)} | ${M(p.se)} | ${M(p.costRound)} | ${M(p.wearUser)} | ${M(p.costUser)} | ${D(p.paybackUserDays)} | ${D(p.paybackPartyDays)} | ${note} |`);
    }
    L.push('', '## Every branch', '');
    for (const c of charms) {
        L.push(`### ${c.skill}`, '', '| Skill level | Day | Gain per day (per user) | ± se | Cost per user | Payback days (per user) |', '|---|---|---|---|---|---|');
        for (const b of c.branches) L.push(`| ${b.level} | ${b.days.toFixed(1)} | ${M(b.gainUser)} | ${M(b.se)} | ${M(b.costUser)} | ${D(b.paybackUserDays)} |`);
        L.push('');
    }
    L.push('## Look-ahead', '', `The best branches followed ${ctx.lookH / 24} days with the baseline charm back on, against the baseline at the same time.`, '');
    for (const l of st.look) L.push(`- ${l.skill} sold at ${l.level}: gain per day at the swap ${M(l.atSwap.mean)} ± ${M(l.atSwap.se)}, ${l.days} days later ${l.after ? M(l.after.mean) + ' ± ' + M(l.after.se) : 'not measured'}.`);
    L.push('', `Check: profit is the same whichever charm is worn, on every seed run with two charms at one level vector (largest difference ${M(st.charmProfitMismatch)}).`);
    writeFileSync(path.join(OUT, 'result.md'), L.join('\n') + '\n');
    console.log(L.slice(0, 6 + charms.length).join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
