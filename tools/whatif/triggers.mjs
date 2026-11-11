// Trigger sweet-spot search for the what-if optimizer (docs/proposals/what-if.md 3.5): the base-run counter of each
// numeric quantity a trigger could test, its deciles as the value grid, value candidates per numeric term,
// structure candidates from a short generated list, local candidates for the coordinate-wise rounds, and the
// user's own candidates. Every candidate is a `trigger` op (variants.mjs) that replaces one owner's whole list.
//
// How a trigger works (src/combatsimulator/trigger.js, ability.js:196-213, consumable.js:66-83): an owner (an
// ability, food or drink) is checked only when off cooldown; its terms are ANDed; an empty list always fires.
// The owner's triggers are the player's triggerMap entry, else the game's defaultCombatTriggers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = (f) => JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data', f), 'utf8'));
export const conditionMap = data('combatTriggerConditionDetailMap.json');
const dependencyMap = data('combatTriggerDependencyDetailMap.json');
const abilityDetailMap = data('abilityDetailMap.json');
const itemDetailMap = data('itemDetailMap.json');

const P = '/combat_trigger_';
export const GE = P + 'comparators/greater_than_equal', LE = P + 'comparators/less_than_equal';
export const isNumeric = (t) => t.comparatorHrid === GE || t.comparatorHrid === LE;
const short = (h) => h.split('/').pop();

// Every (dependency, condition) pair the game allows with a number: the quantities the counter records.
export const QUANTITIES = Object.values(dependencyMap).flatMap((d) => Object.values(conditionMap)
    .filter((c) => c.allowedComparatorHrids.includes(GE) && ((d.isSingleTarget && c.isSingleTarget) || (d.isMultiTarget && c.isMultiTarget)))
    .map((c) => ({ key: short(d.hrid) + '/' + short(c.hrid), dependencyHrid: d.hrid, conditionHrid: c.hrid })));
export const qKey = (t) => short(t.dependencyHrid) + '/' + short(t.conditionHrid);

// The owner's effective triggers, as setupDto.mjs and the engine build them.
export function effectiveTriggers(setup, hrid) {
    const own = setup.triggerMap?.[hrid];
    if (own !== undefined && own !== null && own.every((t) => conditionMap[t.conditionHrid])) return structuredClone(own);
    if (own === null) return [];
    const d = hrid.startsWith('/abilities/') ? abilityDetailMap[hrid]?.defaultCombatTriggers : itemDetailMap[hrid]?.consumableDetail?.defaultCombatTriggers;
    return structuredClone(d || []);
}

// The player's slotted owners (abilities, food, drinks), in slot order.
export function ownersOf(setup) {
    const out = [];
    (setup.abilities || []).forEach((a, i) => a?.abilityHrid && out.push({ hrid: a.abilityHrid, kind: 'ability', slot: i }));
    for (const [kind, key] of [['food', 'food'], ['drink', 'drinks']]) (setup[key]?.['/action_types/combat'] || []).forEach((x, i) => x?.itemHrid && out.push({ hrid: x.itemHrid, kind, slot: i }));
    return out;
}

// ---- The counter (a base-run probe; src/ is not changed) ----
// Puts one probe trigger in front of each owner's list of the named players. The engine evaluates an owner's terms
// only when it is off cooldown, so the probe sees exactly the moments the owner could fire. It records every
// QUANTITY there, computed by the engine's own Trigger code, and always passes (an empty list still always fires,
// so the probe changes no decision). It draws no Math.random: its reservoir has its own generator.
export function installProbe(players, names, only, TriggerClass, cap = 4000) {
    const store = {}; // player -> owner hrid -> qkey -> { n, s: [] }
    let x = 0x2545f491;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    players.forEach((pl, i) => {
        const name = names[i];
        if (!only.includes(name)) return;
        for (const owner of [...pl.abilities, ...pl.food, ...pl.drinks]) {
            if (!owner) continue;
            const rec = ((store[name] ||= {})[owner.hrid] ||= {});
            const subs = QUANTITIES.map((q) => {
                const t = new TriggerClass(q.dependencyHrid, q.conditionHrid, GE, 0);
                const r = (rec[q.key] = { n: 0, s: [] });
                t.compareValue = (v) => { r.n++; if (r.s.length < cap) r.s.push(v); else { const j = Math.floor(rnd() * r.n); if (j < cap) r.s[j] = v; } return true; };
                return t;
            });
            const probe = { isActive: (source, target, friendlies, enemies, now) => { for (const t of subs) t.isActive(source, target, friendlies, enemies, now); return true; } };
            owner.triggers = [probe, ...owner.triggers];
        }
    });
    return store;
}

// A store cut down to percentiles 0..100 per quantity (what grid() needs), small enough to keep with the results.
export function summarize(store) {
    const out = {};
    for (const [p, owners] of Object.entries(store)) for (const [h, qs] of Object.entries(owners)) for (const [k, r] of Object.entries(qs)) {
        if (!r.n) continue;
        const s = r.s.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        ((out[p] ||= {})[h] ||= {})[k] = { n: r.n, s: Array.from({ length: 101 }, (_, q) => s[Math.min(s.length - 1, Math.floor(q / 100 * s.length))]) };
    }
    return out;
}

// Deciles (10%..90%) of the recorded values, rounded to the quantity's step and de-duplicated: the coarse grid.
export function grid(samples, conditionHrid) {
    const s = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!s.length) return [];
    const step = /number_of|percentage/.test(conditionHrid) ? 1 : roundStep(s[Math.floor(s.length / 2)]);
    const out = new Set();
    for (let q = 1; q <= 9; q++) out.add(Math.round(s[Math.min(s.length - 1, Math.floor(q / 10 * s.length))] / step) * step);
    return [...out].sort((a, b) => a - b);
}
const roundStep = (m) => (m >= 10000 ? 500 : m >= 1000 ? 50 : m >= 100 ? 10 : 1);

// ---- Candidates ----
const TRIG = (p, hrid, kind, id, desc, triggers, extra = {}) => ({ id: `${p}:trig:${short(hrid)}:${id}`, kind: 'trigger', owner: hrid, groups: [`${p}:trigger:${hrid}`], player: p, monotone: false, desc: `${p} ${short(hrid)} trigger: ${desc}`, ops: [{ op: 'trigger', player: p, hrid, triggers }], cost: { cost: 0, known: true, path: 'loadout tweak', mirrors: 0, note: '' }, ...extra });
export const termText = (t) => `${short(t.dependencyHrid)} ${short(t.conditionHrid)} ${t.comparatorHrid === GE ? '>=' : t.comparatorHrid === LE ? '<=' : short(t.comparatorHrid)}${isNumeric(t) ? ' ' + t.value : ''}`;
const listText = (ts) => (ts.length ? ts.map(termText).join(' AND ') : 'always');
// A trigger list as the report words it ("self current_hp <= 60 AND ..."); null when the list is empty (it always fires).
export const triggerText = (ts) => (ts.length ? listText(ts) : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// probe: store[player][owner] from installProbe (merged over seeds). opts.owners limits the owners searched;
// opts.fixed skips owners (his option: a fixed trigger); opts.user maps owner -> [trigger lists] he gave, which
// replace the generated candidates for that owner (3.5 item 5).
export function triggerCands(setup, p, probe, opts = {}) {
    const out = [];
    for (const o of ownersOf(setup)) {
        if (o.kind === 'drink') continue; // Owner: drinks have 100% uptime, editing their triggers makes no sense
        const named = (xs) => xs?.some((x) => x === o.hrid || x === short(o.hrid)); // a full hrid or its last part
        if (opts.owners && !named(opts.owners)) continue;
        if (named(opts.fixed)) continue;
        const cur = effectiveTriggers(setup, o.hrid);
        if (opts.user?.[o.hrid]) { opts.user[o.hrid].forEach((ts, k) => !same(ts, cur) && out.push(TRIG(p, o.hrid, o.kind, 'user' + k, listText(ts), ts))); continue; }
        const rec = probe?.[p]?.[o.hrid] || {};
        const g = (t) => grid(rec[qKey(t)]?.s || [], t.conditionHrid);
        const push = (id, desc, ts) => { if (!same(ts, cur) && !out.some((c) => c.owner === o.hrid && same(c.ops[0].triggers, ts))) out.push(TRIG(p, o.hrid, o.kind, id, desc, ts)); };
        // Sweet spot of each numeric term: its value over the grid (3.5 item 2).
        cur.forEach((t, i) => {
            if (!isNumeric(t)) return;
            for (const v of g(t)) push(`${i}=${v}`, `${termText(t)} -> ${v}`, cur.map((x, j) => (j === i ? { ...x, value: v } : x)));
        });
        // Structure (3.5 item 4): drop a term, flip a comparator (at the grid's median), the game's default, and
        // added terms from a short list by what the owner does.
        cur.forEach((t, i) => {
            push(`drop${i}`, `drop ${termText(t)}`, cur.filter((_, j) => j !== i));
            if (isNumeric(t)) { const gv = g(t); const v = gv.length ? gv[Math.floor(gv.length / 2)] : t.value; push(`flip${i}`, `${termText(t)} -> ${t.comparatorHrid === GE ? '<=' : '>='} ${v}`, cur.map((x, j) => (j === i ? { ...x, comparatorHrid: x.comparatorHrid === GE ? LE : GE, value: v } : x))); }
        });
        const def = o.kind === 'ability' ? abilityDetailMap[o.hrid]?.defaultCombatTriggers : itemDetailMap[o.hrid]?.consumableDetail?.defaultCombatTriggers;
        if (def) push('default', `game default (${listText(def)})`, structuredClone(def));
        for (const add of addedTerms(o, rec)) push(add.id, `add ${termText(add.t)}`, [...cur.filter((x) => !(x.dependencyHrid === add.t.dependencyHrid && x.conditionHrid === add.t.conditionHrid)), add.t]);
    }
    return out;
}

// Short generated list of added terms (3.5 item 4).
function addedTerms(o, rec) {
    const out = [];
    const q = (k) => rec[k]?.s || [];
    if (o.kind === 'ability') {
        const a = abilityDetailMap[o.hrid];
        // A costly ability: my current MP >= cost + x, at the quartiles of my MP seen when it could fire.
        if (a?.manaCost > 0) {
            const g = grid(q('self/current_mp'), P + 'conditions/current_mp');
            for (const v of [g[1], g[4], g[7]].filter((v) => v !== undefined && v > a.manaCost)) out.push({ id: `addmp=${v}`, t: { dependencyHrid: P + 'dependencies/self', conditionHrid: P + 'conditions/current_mp', comparatorHrid: GE, value: v } });
        }
        // An area ability: number of active enemies >= n, for each n seen above 1.
        if (a?.abilityEffects?.some((e) => e.targetType === 'allEnemies')) {
            for (const n of grid(q('all_enemies/number_of_active_units'), P + 'conditions/number_of_active_units').filter((n) => n >= 2)) out.push({ id: `addn=${n}`, t: { dependencyHrid: P + 'dependencies/all_enemies', conditionHrid: P + 'conditions/number_of_active_units', comparatorHrid: GE, value: n } });
        }
        // A debuff ability: its own debuff is inactive on the targeted enemy (a condition named for the debuff).
        const debuffs = (a?.abilityEffects || []).filter((e) => /nem/i.test(e.targetType)).flatMap((e) => (e.buffs || []).map((b) => short(b.uniqueHrid)));
        const cond = Object.values(conditionMap).find((c) => c.isSingleTarget && c.allowedComparatorHrids.includes(P + 'comparators/is_inactive') && debuffs.some((d) => d.startsWith(short(c.hrid))));
        if (cond) out.push({ id: 'adddebuff', t: { dependencyHrid: P + 'dependencies/targeted_enemy', conditionHrid: cond.hrid, comparatorHrid: P + 'comparators/is_inactive', value: 0 } });
    }
    return out;
}

// Local candidates for the coordinate-wise rounds (3.5 items 2-3): after a step changes an owner, each numeric term
// of its new list is tried one grid point down and up and halfway to each (a refinement around the accepted point).
export function localCands(setup, p, probe, hrid) {
    const cur = effectiveTriggers(setup, hrid), out = [], rec = probe?.[p]?.[hrid] || {};
    const o = ownersOf(setup).find((x) => x.hrid === hrid);
    if (!o) return out;
    cur.forEach((t, i) => {
        if (!isNumeric(t)) return;
        const g = grid(rec[qKey(t)]?.s || [], t.conditionHrid);
        const lo = [...g].reverse().find((v) => v < t.value), hi = g.find((v) => v > t.value);
        const step = /number_of|percentage/.test(t.conditionHrid) ? 1 : roundStep(Math.abs(t.value) || 1);
        const mid = (a) => Math.round((a + t.value) / 2 / step) * step;
        for (const v of new Set([lo, hi, lo !== undefined ? mid(lo) : undefined, hi !== undefined ? mid(hi) : undefined])) {
            if (v === undefined || v === t.value) continue;
            const ts = cur.map((x, j) => (j === i ? { ...x, value: v } : x));
            out.push(TRIG(p, hrid, o.kind, `${i}=${v}`, `${termText(t)} -> ${v}`, ts));
        }
    });
    return out;
}

// Merges probe stores of several seeds (reservoirs concatenated, counts summed).
export function mergeProbes(stores) {
    const out = {};
    for (const s of stores) for (const [p, owners] of Object.entries(s)) for (const [h, qs] of Object.entries(owners)) for (const [k, r] of Object.entries(qs)) {
        const t = (((out[p] ||= {})[h] ||= {})[k] ||= { n: 0, s: [] });
        t.n += r.n; t.s.push(...r.s);
    }
    return out;
}

// The text of a merged trigger step: "A trigger: term 200 -> 4600" then "A trigger: term 4600 -> 3000" read "A trigger: term 200 -> 3000".
export const joinTriggerDesc = (a, b) => {
    const split = (d) => { const m = /^(.*? trigger: )(.*) -> (.+)$/.exec(d); return m && { head: m[1], from: m[2], to: m[3] }; };
    const A = split(a), B = split(b);
    if (A && B && A.head === B.head) {
        const fa = /^(.*) (\S+)$/.exec(A.from), fb = /^(.*) (\S+)$/.exec(B.from);
        if ((fa && fb && fa[1] === fb[1] && fb[2] === A.to) || B.from === A.to) return `${A.head}${A.from} -> ${B.to}`;
    }
    return `${a}; then ${b}`;
};
