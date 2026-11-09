// Damage-bonus attribution from the fundamental data and the engine's own stat code (no simulation).
// Pure module: no Node imports, no DOM. Every engine class and data table comes in through `engine`
// (see engine-node.mjs for Node; a userscript bundle would pass the same names), so it can be bundled later.
//
// engine = { Player, Monster, Buff, Equipment, itemDetailMap, abilityDetailMap, enhancementTable,
//            scaleAbilityBuff, scaleConsumableBuff, attributeBonuses }
//
// The formula per recorded hit is CombatUtilities.processAttack (src/combatsimulator/combatUtilities.js):
//   min = amp*(1+flat+armorFlat), max = amp*(ratio*styleMax+flat+armorFlat); crit: min = max = max*(1+critDmg)
//   roll*(1+task)*(1+target damageTaken)*(1+autoAttackDamage | abilityDamage), then ceil(takenRatio*roll).
// A normal hit is A + u*B with u the roll's position in [min, max]; a crit is the constant C.
// The recorder stores per encounter and source only the summed damage, hits and crits (no per-hit amount), so u
// is solved per encounter and source (u-bar); since every subset's value is affine in u, holding u-bar fixed
// gives the same sums as holding each hit's u fixed (exact up to the per-hit ceil and overkill clipping).

const ZERO_DATE = '0001-01-01T00:00:00Z';
const CACHE_MAX = 4000; // engine units kept per evaluator (each holds a full stat block)
const SKILLS = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];

// ---------------- Player base from a group-export entry ----------------
// guildBuffLevels: the player's own shrine levels (export `guildCombatBuffLevels`, or `guildBuffs` keyed by hrid).
export function baseFromSetup(engine, setup, extra = {}) {
    const p = setup.player;
    const equipment = {};
    for (const e of p.equipment || []) {
        const det = engine.itemDetailMap[e.itemHrid]?.equipmentDetail;
        if (det) equipment[det.type] = { hrid: e.itemHrid, enhancementLevel: e.enhancementLevel };
    }
    for (const e of extra.equipment || []) equipment[engine.itemDetailMap[e.hrid].equipmentDetail.type] = e;
    const guildBuffs = {};
    for (const [name, lvl] of Object.entries(setup.guildCombatBuffLevels || extra.guildCombatBuffLevels || {})) {
        const hrid = '/guild_buffs/' + name + '_combat';
        if (engine.guildBuffDetailMap[hrid] && lvl > 0) guildBuffs[hrid] = Number(lvl);
    }
    Object.assign(guildBuffs, setup.guildBuffs || {});
    const levels = {};
    for (const s of SKILLS) levels[s] = s === 'melee' ? (p.meleeLevel ?? p.powerLevel) : p[s + 'Level'];
    return {
        levels, equipment, guildBuffs,
        houseRooms: { ...(setup.houseRooms || {}) },
        achievements: { ...(setup.achievements || {}) },
        abilities: (setup.abilities || []).filter((a) => a && a.abilityHrid).map((a) => ({ hrid: a.abilityHrid, level: Number(a.level) })),
        drinks: ((setup.drinks || {})['/action_types/combat'] || []).filter(Boolean).map((d) => d.itemHrid).filter(Boolean),
        food: ((setup.food || {})['/action_types/combat'] || []).filter(Boolean).map((d) => d.itemHrid).filter(Boolean),
    };
}

// A task badge (trinket) is not in the group export; infer item and enhancement from a recorded taskDamage value.
export function inferTaskBadge(engine, taskDamage) {
    if (!(taskDamage > 0)) return null;
    let best = null;
    for (const [hrid, it] of Object.entries(engine.itemDetailMap)) {
        const det = it.equipmentDetail;
        const base = det?.combatStats?.taskDamage;
        if (!base) continue;
        const bonus = det.combatEnhancementBonuses?.taskDamage || 0;
        for (let lvl = 0; lvl <= 20; lvl++) {
            const v = base + (engine.enhancementTable[lvl] ?? 0) * bonus;
            const d = Math.abs(v - taskDamage);
            if (!best || d < best.d - 1e-12) best = { hrid, enhancementLevel: lvl, d };
            if (!bonus) break;
        }
    }
    return best && best.d < 1e-6 ? { hrid: best.hrid, enhancementLevel: best.enhancementLevel } : null;
}

// Shrine levels from the recorded permanent guild buffs (value = base + (L-1)*levelBonus), for a player whose export lacks them.
export function inferShrineLevels(engine, recordedBuffs) {
    const out = {};
    for (const [hrid, gb] of Object.entries(engine.guildBuffDetailMap)) {
        if (!gb.isCombat) continue;
        const b = gb.buffs[0];
        const rec = recordedBuffs[b.uniqueHrid];
        if (!rec) continue;
        const useRatio = b.ratioBoostLevelBonus !== 0;
        const v = useRatio ? rec.ratioBoost : rec.flatBoost, base = useRatio ? b.ratioBoost : b.flatBoost, step = useRatio ? b.ratioBoostLevelBonus : b.flatBoostLevelBonus;
        const lvl = Math.round((v - base) / step) + 1;
        if (lvl > 0 && Math.abs(base + (lvl - 1) * step - v) < 1e-9) out[hrid.split('/')[2].replace('_combat', '')] = lvl;
    }
    return out;
}

// ---------------- Units ----------------
// Each unit: { id, kind, owner, label, ... }. Owner = party key of the player whose ability, drink, gear, house, shrine or
// level produces it (shrine buffs belong to the player: the guild only caps the shrine). Base skill levels are units
// (off = level 1) when opts.levelsAsUnits.
export function playerUnits(engine, party, target, opts = {}) {
    const me = party[target], key = me.key, units = [];
    for (const [type, eq] of Object.entries(me.base.equipment)) units.push({ id: 'gear:' + type.split('/')[2], kind: 'gear', type, owner: key, label: eq.hrid + ' +' + eq.enhancementLevel });
    for (const [hrid, lvl] of Object.entries(me.base.houseRooms)) if (lvl > 0) units.push({ id: 'house:' + hrid.split('/')[2], kind: 'house', hrid, owner: key, label: hrid + ' ' + lvl });
    units.push({ id: 'achievements', kind: 'achievements', owner: key, label: 'achievement tier buffs' });
    for (const [hrid, lvl] of Object.entries(me.base.guildBuffs)) if (lvl > 0) units.push({ id: 'shrine:' + hrid.split('/')[2], kind: 'shrine', hrid, owner: key, label: hrid + ' ' + lvl });
    for (const hrid of me.base.drinks) units.push({ id: 'drink:' + hrid.split('/')[2], kind: 'drink', hrid, owner: key, temp: true, buffs: buffUniques(engine.itemDetailMap[hrid]?.consumableDetail?.buffs) });
    if (opts.levelsAsUnits !== false) for (const s of SKILLS) units.push({ id: 'level:' + s, kind: 'level', skill: s, owner: key, label: s + ' ' + me.base.levels[s] });
    party.forEach((m, ci) => {
        for (const a of m.base.abilities) {
            const det = engine.abilityDetailMap[a.hrid];
            for (const eff of det.abilityEffects) {
                if (!eff.buffs || !eff.buffs.length) continue;
                const ally = eff.effectType === '/ability_effect_types/buff' && (eff.targetType === 'allAllies' || (eff.targetType === 'self' && ci === target));
                const enemy = eff.effectType === '/ability_effect_types/damage' && (eff.targetType === 'allEnemies' || eff.targetType === 'enemy');
                if (!ally && !enemy) continue;
                const id = (ally ? 'ability:' : 'debuff:') + a.hrid.split('/')[2] + (ci === target ? '' : '@' + m.key);
                if (units.some((u) => u.id === id)) continue;
                units.push({ id, kind: ally ? 'ability' : 'debuff', hrid: a.hrid, level: a.level, caster: ci, owner: m.key, temp: true, special: !!det.isSpecialAbility, buffs: buffUniques(eff.buffs), label: a.hrid + ' ' + a.level });
            }
        }
    });
    return units;
}
function buffUniques(list) { return (list || []).map((b) => b.uniqueHrid); }

// ---------------- Stats from the engine ----------------
export function buildPlayer(engine, base, on) {
    // on(kind, idOrKey) -> boolean
    const dto = { hrid: 'player', food: [], drinks: [], abilities: [], labyrinthUpgrades: {}, equipment: {}, houseRooms: {}, guildBuffs: {} };
    for (const s of SKILLS) dto[s + 'Level'] = on('level', s) ? base.levels[s] : 1;
    for (const [type, eq] of Object.entries(base.equipment)) dto.equipment[type] = on('gear', type) ? eq : null;
    for (const [h, l] of Object.entries(base.houseRooms)) if (on('house', h)) dto.houseRooms[h] = l;
    for (const [h, l] of Object.entries(base.guildBuffs)) if (on('shrine', h)) dto.guildBuffs[h] = l;
    dto.achievements = on('achievements') ? base.achievements : {};
    const p = engine.Player.createFromDTO(dto);
    p.zoneBuffs = []; // the engine's defaults are {} (worker.js sets arrays); no zone or extra buffs outside the labyrinth
    p.extraBuffs = [];
    p.generatePermanentBuffs();
    p.combatBuffs = structuredClone(p.permanentBuffs);
    p.updateCombatDetails();
    return p;
}

// Temporary buffs a unit puts on the target (drinks scaled by the target's drink concentration, auras by the caster's level).
export function unitBuffs(engine, unit, target, casterUnit) {
    if (unit.kind === 'drink') {
        const item = engine.itemDetailMap[unit.hrid];
        const dc = target.combatDetails.combatStats.drinkConcentration;
        return (item.consumableDetail.buffs || []).map((b) => engine.scaleConsumableBuff(new engine.Buff(b), { catagoryHrid: item.categoryHrid }, dc));
    }
    const det = engine.abilityDetailMap[unit.hrid];
    const out = [];
    for (const eff of det.abilityEffects) for (const b of eff.buffs || []) {
        if (!unit.buffs.includes(b.uniqueHrid)) continue;
        out.push(engine.scaleAbilityBuff(new engine.Buff(b, unit.level), { isSpecialAbility: det.isSpecialAbility }, casterUnit));
    }
    return out;
}

export function buildMonster(engine, hrid, tier, buffs) {
    const m = new engine.Monster(hrid, tier);
    m.updateCombatDetails();
    if (buffs && buffs.length) m.addBuffs(buffs.map((b) => ({ ...b })), 0);
    return m;
}

const STYLE = { '/combat_styles/stab': 'stab', '/combat_styles/slash': 'slash', '/combat_styles/smash': 'smash', '/combat_styles/ranged': 'ranged', '/combat_styles/magic': 'magic' };
const DTYPE = {
    '/damage_types/physical': ['physicalAmplify', 'totalArmor', 'armorPenetration'],
    '/damage_types/water': ['waterAmplify', 'totalWaterResistance', 'waterPenetration'],
    '/damage_types/nature': ['natureAmplify', 'totalNatureResistance', 'naturePenetration'],
    '/damage_types/fire': ['fireAmplify', 'totalFireResistance', 'firePenetration'],
};

// The source's damage effect: null for an auto attack.
export function damageEffect(engine, abilityHrid, level) {
    if (!abilityHrid || abilityHrid === 'auto') return null;
    const det = engine.abilityDetailMap[abilityHrid];
    const e = det?.abilityEffects.find((x) => x.effectType === '/ability_effect_types/damage');
    if (!e) return undefined;
    const L = level - 1;
    return { combatStyleHrid: e.combatStyleHrid, damageType: e.damageType, damageFlat: e.baseDamageFlat + L * e.baseDamageFlatLevelBonus, damageRatio: e.baseDamageRatio + L * e.baseDamageRatioLevelBonus, bonusAccuracyRatio: e.bonusAccuracyRatio + L * e.bonusAccuracyRatioLevelBonus, armorDamageRatio: e.armorDamageRatio + L * e.armorDamageRatioLevelBonus };
}

// processAttack in closed form: hit chance, crit chance, normal hit = A + u*B, crit = C.
export function hitModel(p, m, effect, taskOn) {
    const cs = p.combatDetails.combatStats, cd = p.combatDetails, mcd = m.combatDetails;
    const styleHrid = effect ? effect.combatStyleHrid : cs.combatStyleHrid, dtypeHrid = effect ? effect.damageType : cs.damageType;
    const st = STYLE[styleHrid], dt = DTYPE[dtypeHrid];
    if (!st || !dt) throw new Error('Unknown style or damage type: ' + styleHrid + ' ' + dtypeHrid);
    let acc = cd[st + 'AccuracyRating'];
    const styleMax = cd[st + 'MaxDamage'], eva = mcd[st + 'EvasionRating'];
    if (effect) acc *= 1 + effect.bonusAccuracyRatio;
    const hc = Math.pow(acc, 1.4) / (Math.pow(acc, 1.4) + Math.pow(eva, 1.4));
    const cc = (st === 'ranged' ? 0.3 * hc : 0) + cs.criticalRate;
    const amp = 1 + cs[dt[0]];
    const flat = effect ? effect.damageFlat : 0, ratio = effect ? effect.damageRatio : 1;
    const armorFlat = effect ? effect.armorDamageRatio * cd.totalArmor : 0;
    const minD = amp * (1 + flat + armorFlat), maxD = amp * (ratio * styleMax + flat + armorFlat);
    const post = (1 + (taskOn ? cs.taskDamage : 0)) * (1 + (mcd.combatStats.damageTaken || 0)) * (effect ? 1 + cs.abilityDamage : 1 + cs.autoAttackDamage);
    const res = mcd[dt[1]], pen = cs[dt[2]];
    const pres = pen > 0 && res > 0 ? res / (1 + pen) : res;
    const taken = pres < 0 ? (100 - pres) / 100 : 100 / (100 + pres);
    const k = taken * post;
    return { hc, cc, A: k * minD, B: k * (maxD - minD), C: k * maxD * (1 + cs.criticalDamage) };
}

// Expected damage of one key's recorded hits under a subset's model `s`, relative to the full model `f`.
// chance = 'off': the damage formula only (hit/crit outcomes as recorded). chance = 'conditional': each recorded hit and crit is
// kept with the probability that it would still have happened (the hit/crit roll held fixed, as u is): P(hit | hit under full) =
// min(1, hc_s/hc_f), P(crit | crit under full) = min(1, cc_s/cc_f); a crit lost becomes a normal hit at the mean roll.
export const ROUND_UP = 0.5; // expected ceil() per hit
export function keyValue(k, s, f, chance) {
    if (chance !== 'conditional') return k.nCrit * s.C + k.nNorm * s.A + k.sumU * s.B + ROUND_UP * (k.nCrit + k.nNorm);
    const hit = Math.min(1, s.hc / f.hc);
    const q = f.cc > 0 ? Math.min(1, Math.max(0, s.cc) / f.cc) : 1;
    const r = f.cc < 1 && s.cc > f.cc ? (s.cc - f.cc) / (1 - f.cc) : 0;
    const critPart = k.nCrit * (q * s.C + (1 - q) * (s.A + 0.5 * s.B));
    const normPart = k.nNorm * (r * s.C + (1 - r) * s.A) + (1 - r) * k.sumU * s.B;
    return hit * (critPart + normPart + ROUND_UP * (k.nCrit + k.nNorm));
}

// ---------------- Recorded window -> keys ----------------
const ms = (iso) => (iso && iso !== ZERO_DATE ? Date.parse(iso) : null);

// Temporary buff intervals per slot from the window's start snapshot and its buffEvents (each start time seen once).
export function buffIntervals(window, slot) {
    const seen = new Map();
    const add = (b) => {
        if (!b.duration) return;
        const s = ms(b.startTime);
        if (s == null) return;
        const k = b.uniqueHrid + '@' + s;
        if (!seen.has(k)) seen.set(k, { uniqueHrid: b.uniqueHrid, start: s, end: s + b.duration / 1e6 });
    };
    const pl = window.players.find((p) => p.slot === slot);
    for (const b of Object.values(pl?.stats?.buffs || {})) add(b);
    for (const e of window.buffEvents || []) if (e.slot === slot && e.change !== 'removed') add(e);
    return [...seen.values()];
}

// Debuffs on enemies (from the party's casts) and monsters' own buffs (from their casts), as intervals.
export function castIntervals(engine, encounter, party, slotToParty) {
    const out = [];
    for (const c of encounter.casts || []) {
        const det = engine.abilityDetailMap[c.ability];
        if (!det) continue;
        for (const eff of det.abilityEffects) for (const b of eff.buffs || []) {
            if (c.side === 'p' && eff.effectType === '/ability_effect_types/damage') {
                const ci = slotToParty[c.idx];
                const level = party[ci]?.base.abilities.find((a) => a.hrid === c.ability)?.level ?? 1;
                out.push({ side: 'enemy', ability: c.ability, caster: ci, uniqueHrid: b.uniqueHrid, buff: new engine.Buff(b, level), start: c.t, end: c.t + b.duration / 1e6 });
            } else if (c.side === 'm' && eff.targetType === 'self') {
                out.push({ side: 'monster', monster: c.hrid, ability: c.ability, uniqueHrid: b.uniqueHrid, start: c.t, end: c.t + b.duration / 1e6, abilityLevel: null, buffData: b });
            }
        }
    }
    return out;
}

// Accumulate the recorded encounters of one target slot into keys. Each key = one (source, monster, active temporary units,
// active monster buffs, task) state, holding the crit count, normal-hit count and normal hits' summed u, weighted by the
// share of the encounter's time in that state (hits are assumed spread evenly in time: the recorder stores no hit times).
export function buildKeys(engine, ctx, window, encounters, slot) {
    const { party, units, slotToParty, tier, tasks } = ctx;
    const target = slotToParty[slot];
    const me = party[target];
    const uniqueToUnit = new Map();
    for (const u of units) if (u.temp && u.kind !== 'debuff') for (const h of u.buffs) uniqueToUnit.set(h, u.id);
    const intervals = buffIntervals(window, slot).filter((i) => uniqueToUnit.has(i.uniqueHrid)).map((i) => ({ ...i, unit: uniqueToUnit.get(i.uniqueHrid) }));
    const unmapped = new Set(buffIntervals(window, slot).filter((i) => !uniqueToUnit.has(i.uniqueHrid)).map((i) => i.uniqueHrid));
    const keys = new Map(), perEnc = [], skipped = { sources: {}, encounters: 0 };
    const stats = makeEvaluator(engine, ctx, target), full = new Map();
    const fullModel = (pt) => {
        const unitTags = pt.tags.filter((t) => t.startsWith('u:')).map((t) => t.slice(2));
        const { player, monsterFor } = stats(full, unitTags);
        const enemyIds = unitTags.filter((id) => units.find((u) => u.id === id)?.kind === 'debuff').sort();
        return hitModel(player, monsterFor(pt.mon, enemyIds, pt.tags.filter((t) => t.startsWith('m:'))), pt.effect, pt.taskOn);
    };
    for (const enc of encounters) {
        const pl = enc.players.find((p) => p.slot === slot);
        if (!pl || !pl.dealt || !pl.dealt.total) continue;
        const t0 = enc.startedAt, t1 = enc.endedAt;
        const casts = castIntervals(engine, enc, party, slotToParty);
        const debuffUnitOf = (c) => units.find((u) => u.kind === 'debuff' && u.hrid === c.ability && u.caster === c.caster)?.id;
        const evts = [...intervals.map((i) => ({ ...i, tag: 'u:' + i.unit })), ...casts.map((c) => ({ ...c, tag: c.side === 'enemy' ? 'u:' + (debuffUnitOf(c) || '?') : 'm:' + c.monster + '|' + c.ability }))]
            .filter((i) => i.end > t0 && i.start < t1);
        const cuts = [...new Set([t0, t1, ...evts.flatMap((i) => [Math.max(t0, i.start), Math.min(t1, i.end)])])].sort((a, b) => a - b);
        const segs = [];
        for (let i = 0; i + 1 < cuts.length; i++) {
            const a = cuts[i], b = cuts[i + 1];
            if (b <= a) continue;
            const mid = (a + b) / 2;
            const tags = [...new Set(evts.filter((e) => e.start <= mid && e.end > mid).map((e) => e.tag))].sort();
            segs.push({ w: (b - a) / (t1 - t0), tags });
        }
        const byMon = Object.entries(pl.dealt.byMonster || {});
        const monTot = byMon.reduce((s, [, v]) => s + v, 0);
        const encRec = { battleId: enc.battleId, sources: [] };
        for (const [src, agg] of Object.entries(pl.dealt.bySource)) {
            const ability = src === 'auto' ? null : src;
            const level = ability ? me.base.abilities.find((a) => a.hrid === ability)?.level : null;
            const effect = damageEffect(engine, ability, level);
            if (effect === undefined || (ability && level == null)) { skipped.sources[src] = (skipped.sources[src] || 0) + agg.amount; continue; }
            if (!agg.hits) continue;
            const parts = [];
            for (const [mon, dmg] of byMon) for (const sg of segs) {
                const w = sg.w * (monTot > 0 ? dmg / monTot : 1 / byMon.length);
                if (w <= 0) continue;
                parts.push({ k: JSON.stringify([src, mon, sg.tags, tasks.has(mon)]), src, ability, level, effect, mon, tags: sg.tags, taskOn: tasks.has(mon), w });
            }
            // Solve u-bar under the full model.
            let cSum = 0, aSum = 0, bSum = 0;
            for (const pt of parts) { const f = fullModel(pt); cSum += pt.w * f.C; aSum += pt.w * f.A; bSum += pt.w * f.B; }
            const nN = agg.hits - agg.crits;
            const predCrit = agg.crits * cSum;
            let u = null;
            if (nN > 0 && bSum > 0) u = (agg.amount - ROUND_UP * agg.hits - predCrit - nN * aSum) / (nN * bSum);
            const predMid = predCrit + nN * (aSum + 0.5 * bSum) + ROUND_UP * agg.hits;
            encRec.sources.push({ src, hits: agg.hits, crits: agg.crits, recorded: agg.amount, predictedMeanRoll: predMid, u, critOnly: nN === 0 ? { predicted: predCrit + ROUND_UP * agg.hits, recorded: agg.amount } : null });
            for (const pt of parts) {
                let k = keys.get(pt.k);
                if (!k) keys.set(pt.k, k = { src: pt.src, ability: pt.ability, level: pt.level, effect: pt.effect, mon: pt.mon, tags: pt.tags, taskOn: pt.taskOn, nCrit: 0, nNorm: 0, sumU: 0, sumMid: 0 });
                k.nCrit += pt.w * agg.crits;
                k.nNorm += pt.w * nN;
                k.sumU += pt.w * nN * (u ?? 0.5);
                k.sumMid += pt.w * nN * 0.5;
            }
        }
        perEnc.push(encRec);
    }
    return { keys: [...keys.values()], perEnc, skipped, unmapped: [...unmapped] };
}

// ---------------- Formula over units ----------------
// ctx: { engine, party, target, units (all candidate units), tier, tasks:Set, slotToParty }
export function makeEvaluator(engine, ctx, target) {
    const party = ctx.party, me = party[target], units = ctx.units;
    const casterCache = new Map();
    const casterFull = (ci) => {
        // A teammate casts with all its own bonuses and its drinks on (an aura scales with the caster's effective level).
        if (!casterCache.has(ci)) {
            const c = buildPlayer(engine, party[ci].base, () => true);
            const drinks = party[ci].base.drinks.flatMap((hrid) => unitBuffs(engine, { kind: 'drink', hrid }, c));
            if (drinks.length) c.addBuffs(drinks, 0);
            casterCache.set(ci, c);
        }
        return casterCache.get(ci);
    };
    const permCache = new Map(), statCache = new Map(), monCache = new Map();
    const monsterFor = (mon, enemyUnitIds, monTags) => {
        const key = mon + '|' + enemyUnitIds.join(',') + '|' + monTags.join(',');
        let m = monCache.get(key);
        if (!m) {
            const buffs = [];
            for (const id of enemyUnitIds) {
                const u = units.find((x) => x.id === id);
                const det = engine.abilityDetailMap[u.hrid];
                for (const eff of det.abilityEffects) for (const b of eff.buffs || []) buffs.push(new engine.Buff(b, u.level));
            }
            for (const t of monTags) {
                const [mh, ab] = t.slice(2).split('|');
                if (mh !== mon) continue;
                const lvl = engine.combatMonsterDetailMap[mon]?.abilities.find((a) => a.abilityHrid === ab)?.level ?? 1;
                for (const eff of engine.abilityDetailMap[ab].abilityEffects) for (const b of eff.buffs || []) buffs.push(new engine.Buff(b, lvl));
            }
            m = buildMonster(engine, mon, ctx.tier, buffs);
            monCache.set(key, m);
        }
        return m;
    };
    // mask: Map unitId -> boolean (units absent from the map count as on).
    return function stats(mask, tempOn) {
        const isOn = (id) => mask.get(id) !== false;
        const permKey = units.filter((u) => !u.temp).map((u) => (isOn(u.id) ? 1 : 0)).join('');
        let p = permCache.get(permKey);
        if (!p) {
            p = buildPlayer(engine, me.base, (kind, k) => {
                if (kind === 'gear') return isOn('gear:' + k.split('/')[2]);
                if (kind === 'house') return isOn('house:' + k.split('/')[2]);
                if (kind === 'shrine') return isOn('shrine:' + k.split('/')[2]);
                if (kind === 'level') return isOn('level:' + k);
                if (kind === 'achievements') return isOn('achievements');
                return true;
            });
            if (permCache.size >= CACHE_MAX) { permCache.clear(); statCache.clear(); }
            permCache.set(permKey, p);
        }
        const temps = tempOn.filter(isOn).filter((id) => { const k = units.find((u) => u.id === id)?.kind; return k && k !== 'debuff'; }).sort();
        const sk = permKey + '|' + temps.join(',');
        let q = statCache.get(sk);
        if (!q) {
            if (temps.length) {
                q = Object.create(Object.getPrototypeOf(p));
                Object.assign(q, p);
                q.combatDetails = structuredClone(p.combatDetails);
                q.combatBuffs = structuredClone(p.combatBuffs);
                q.equipmentStatsCache = p.equipmentStatsCache;
                // Drinks first (scaled by the target's drink concentration), then ability buffs: the target's own aura scales
                // with its level after its drinks, as in the engine where the caster's current stats are read at the cast.
                const tu = temps.map((id) => units.find((x) => x.id === id));
                const drinks = tu.filter((u) => u.kind === 'drink').flatMap((u) => unitBuffs(engine, u, q));
                if (drinks.length) q.addBuffs(drinks, 0);
                const abil = tu.filter((u) => u.kind !== 'drink').flatMap((u) => unitBuffs(engine, u, q, u.caster === target ? q : casterFull(u.caster)));
                if (abil.length) q.addBuffs(abil, 0);
            } else q = p;
            if (statCache.size >= CACHE_MAX) statCache.clear();
            statCache.set(sk, q);
        }
        return { player: q, monsterFor };
    };
}

// The formula f(on[]) for attributeBonuses: total damage of the keys with exactly the units in `names` that are on.
export function makeFormula(engine, ctx, target, keys, names, opts = {}) {
    const stats = makeEvaluator(engine, ctx, target);
    const chance = opts.chance || 'off';
    const fullMask = new Map();
    const pre = keys.map((k) => {
        const unitTags = k.tags.filter((t) => t.startsWith('u:')).map((t) => t.slice(2));
        const monTags = k.tags.filter((t) => t.startsWith('m:'));
        return { k, unitTags, monTags };
    });
    const model = (mask, pk) => {
        const { player, monsterFor } = stats(mask, pk.unitTags);
        const enemyIds = pk.unitTags.filter((id) => mask.get(id) !== false && ctx.units.find((u) => u.id === id)?.kind === 'debuff').sort();
        return hitModel(player, monsterFor(pk.k.mon, enemyIds, pk.monTags), pk.k.effect, pk.k.taskOn);
    };
    const fullModels = pre.map((pk) => model(fullMask, pk));
    const useMid = opts.meanRoll === true;
    return function formula(on) {
        const mask = new Map();
        names.forEach((n, i) => mask.set(n, !!on[i]));
        let total = 0;
        for (let i = 0; i < pre.length; i++) {
            const k = pre[i].k;
            const kk = useMid ? { ...k, sumU: k.sumMid } : k;
            total += keyValue(kk, model(mask, pre[i]), fullModels[i], chance);
        }
        return total;
    };
}

// Drop units that change nothing: same value with the unit removed from all-on and added to all-off.
export function relevantUnits(formulaFor, names, eps = 1e-9) {
    const f = formulaFor(names);
    const n = names.length, all = names.map(() => true), none = names.map(() => false);
    const fa = f(all), fn = f(none);
    const keep = [];
    for (let i = 0; i < n; i++) {
        const a = all.slice(); a[i] = false;
        const b = none.slice(); b[i] = true;
        if (Math.abs(f(a) - fa) > eps || Math.abs(f(b) - fn) > eps) keep.push(names[i]);
    }
    return keep;
}

// Per-player ownership totals from per-target attributions: own damage, added by own units to others, added by others' units to them.
export function ownershipTotals(results) {
    const out = {};
    const row = (k) => (out[k] = out[k] || { ownDamage: 0, addedToOthers: { leaveOneOut: 0, shapley: 0 }, addedByOthers: { leaveOneOut: 0, shapley: 0 } });
    for (const r of results) {
        row(r.targetKey).ownDamage += r.recorded;
        r.units.forEach((u) => {
            if (u.owner === r.targetKey) return;
            row(u.owner).addedToOthers.leaveOneOut += u.leaveOneOut;
            row(u.owner).addedToOthers.shapley += u.shapley;
            row(r.targetKey).addedByOthers.leaveOneOut += u.leaveOneOut;
            row(r.targetKey).addedByOthers.shapley += u.shapley;
        });
    }
    return out;
}

// Map recorded slots to party entries by their equipped abilities (the levels may have risen since the recording).
export function matchSlots(window, party) {
    const map = {};
    for (const pl of window.players) {
        const sig = (pl.stats?.abilities || []).map((a) => a.abilityHrid).sort().join(',');
        const hits = party.map((m, i) => i).filter((i) => party[i].base.abilities.map((a) => a.hrid).sort().join(',') === sig);
        if (hits.length === 1) map[pl.slot] = hits[0];
    }
    return map;
}

// The recorded ability levels are the window's truth (the export may be newer): returns the changes made.
export function useRecordedAbilityLevels(window, party, slotToParty) {
    const changes = [];
    for (const [slot, pi] of Object.entries(slotToParty)) {
        const pl = window.players.find((p) => p.slot === Number(slot));
        for (const a of party[pi].base.abilities) {
            const rec = pl.stats.abilities.find((x) => x.abilityHrid === a.hrid);
            if (rec && rec.level !== a.level) { changes.push({ party: party[pi].key, ability: a.hrid, export: a.level, recorded: rec.level }); a.level = rec.level; }
        }
    }
    return changes;
}

// Temporary units whose buffs were on at the window start (for the stats cross-check).
export function unitsOnAtStart(units, window, slot) {
    const pl = window.players.find((p) => p.slot === slot);
    const live = new Set(Object.values(pl?.stats?.buffs || {}).filter((b) => b.duration > 0).map((b) => b.uniqueHrid));
    return units.filter((u) => u.temp && u.kind !== 'debuff' && u.buffs.some((h) => live.has(h))).map((u) => u.id);
}

// Built stats vs the recorded window-start stats (the recorder's values are partly pre-buffed: a difference is a flag, not a verdict).
export const CHECK_FIELDS = ['rangedMaxDamage', 'magicMaxDamage', 'smashMaxDamage', 'rangedAccuracyRating', 'magicAccuracyRating', 'attackLevel', 'rangedLevel', 'magicLevel', 'meleeLevel', 'totalArmor'];
export const CHECK_STATS = ['physicalAmplify', 'natureAmplify', 'waterAmplify', 'fireAmplify', 'criticalRate', 'criticalDamage', 'taskDamage', 'autoAttackDamage', 'abilityDamage', 'rangedDamage', 'magicDamage', 'armorPenetration', 'naturePenetration', 'attackSpeed', 'drinkConcentration'];
export function compareStats(built, recorded) {
    const rows = [];
    for (const f of CHECK_FIELDS) if (recorded[f] != null) rows.push({ field: f, built: built.combatDetails[f], recorded: recorded[f] });
    for (const f of CHECK_STATS) if (recorded.combatStats?.[f] != null || built.combatDetails.combatStats[f]) rows.push({ field: f, built: built.combatDetails.combatStats[f] ?? 0, recorded: recorded.combatStats?.[f] ?? 0 });
    return rows.map((r) => ({ ...r, diff: r.built - r.recorded }));
}
