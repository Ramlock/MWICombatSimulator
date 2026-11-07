// ==UserScript==
// @name         MWICS Exporter
// @namespace    https://github.com/Ramlock/MWICombatSimulator
// @version      0.2.0
// @description  Read-only export for the MWICS combat simulator: your character (setup JSON, learned abilities, inventory, Coin) and a combat recorder (loot, damage, healing, buffs per party slot). Sends nothing anywhere and presses nothing in the game.
// @author       Ramlock
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/Ramlock/MWICombatSimulator/main/userscript/mwics-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/Ramlock/MWICombatSimulator/main/userscript/mwics-exporter.user.js
// ==/UserScript==

// Attribution (CC-BY-NC-SA-4.0, shared alike):
// - Toolasha by Celasha (https://greasyfork.org/en/scripts/562662-toolasha), version 2.108.4: the shape of the sim export
//   (constructSelfPlayer) and the guild shrine levels (buildSelfGuildCombatBuffLevels), reworked here.
// - MWITools by bot7420, shykai and Stella (https://greasyfork.org/en/scripts/494467), version 26.4.23: the read-only
//   MessageEvent.prototype.data hook (hookWS) and the game socket hosts, reworked here.
// Field map: docs/codebase/game-data-fields.md in https://github.com/Ramlock/MWICombatSimulator.

(function () {
    'use strict';

    // One toggle row per data kind, in the design's order (docs/proposals/what-if.md, 4.4 item 2). All on by default.
    const KINDS = [
        { key: 'gear', label: 'Equipped gear and enhancement levels' },
        { key: 'equippedAbilities', label: 'Equipped abilities and their triggers' },
        { key: 'consumables', label: 'Food, drinks and their triggers' },
        { key: 'houseRooms', label: 'House rooms' },
        { key: 'achievements', label: 'Achievements' },
        { key: 'guildBuffs', label: 'Guild buffs' },
        { key: 'skillLevels', label: 'Skill levels' },
        { key: 'learnedAbilities', label: 'Learned abilities with XP' },
        { key: 'inventory', label: 'Inventory' },
        { key: 'coin', label: 'Liquid Coin' },
    ];
    // The slots the sim imports (the skilling tool slots, /item_locations/*_tool, stay out).
    const COMBAT_SLOTS = ['head', 'body', 'legs', 'feet', 'hands', 'off_hand', 'pouch', 'neck', 'earrings', 'ring', 'back', 'charm', 'main_hand', 'two_hand'].map((s) => '/item_locations/' + s);
    const COMBAT_SKILLS = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];
    const COMBAT_SHRINES = ['force', 'tempo', 'spirit', 'rarity', 'scholar'];
    // Used only when the game's own ability data (init client data) cannot be read.
    const FALLBACK_SPECIAL_ABILITIES = ['/abilities/critical_aura', '/abilities/fierce_aura', '/abilities/guardian_aura', '/abilities/insanity', '/abilities/invincible', '/abilities/mystic_aura', '/abilities/promote', '/abilities/revive', '/abilities/speed_aura'];
    const GAME_SOCKET_HOSTS = ['api.milkywayidle.com/ws', 'api-test.milkywayidle.com/ws'];
    const INVENTORY = '/item_locations/inventory';
    const COIN = '/items/coin';
    const COMBAT = '/action_types/combat';

    function defaultToggles() {
        const t = {};
        for (const k of KINDS) t[k.key] = true;
        return t;
    }

    function isSpecial(abilityHrid, clientObj) {
        const detail = clientObj?.abilityDetailMap?.[abilityHrid];
        if (detail) return !!detail.isSpecialAbility;
        return FALLBACK_SPECIAL_ABILITIES.includes(abilityHrid);
    }

    function guildCombatBuffLevels(characterObj, clientObj) {
        const buffMap = characterObj.characterGuildBuffMap || {};
        const unlocked = characterObj.guildBuildingLevelMap || {};
        const levels = {};
        for (const name of COMBAT_SHRINES) {
            const shrineHrid = '/guild_shrines/' + name;
            let buffHrid = '/guild_buffs/' + name + '_combat';
            for (const [hrid, buff] of Object.entries(clientObj?.guildBuffDetailMap || {})) {
                if (buff.shrineHrid === shrineHrid && buff.isCombat) { buffHrid = hrid; break; }
            }
            levels[name] = Math.min(buffMap[buffHrid]?.level || 0, unlocked[shrineHrid] || 0);
        }
        return levels;
    }

    // Pure: builds the export from the game's init_character_data payload. A kind switched off is left out (unknown, never empty).
    function buildExport(characterObj, clientObj, toggles) {
        const on = { ...defaultToggles(), ...(toggles || {}) };
        const out = {};

        if (on.skillLevels || on.gear) out.player = {};
        if (on.skillLevels) {
            for (const s of COMBAT_SKILLS) out.player[s + 'Level'] = 1;
            for (const skill of characterObj.characterSkills || []) {
                const name = String(skill.skillHrid || '').split('/').pop();
                if (COMBAT_SKILLS.includes(name)) out.player[name + 'Level'] = skill.level;
            }
        }
        if (on.gear) {
            out.player.equipment = [];
            for (const item of characterObj.characterItems || []) {
                if (COMBAT_SLOTS.includes(item.itemLocationHrid)) {
                    out.player.equipment.push({ itemLocationHrid: item.itemLocationHrid, itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel || 0 });
                }
            }
        }

        if (on.consumables) {
            const slots = (map) => {
                const list = [];
                const src = map?.[COMBAT] || [];
                for (let i = 0; i < 3; i++) list.push({ itemHrid: src[i]?.itemHrid || '' });
                return { [COMBAT]: list };
            };
            out.food = slots(characterObj.actionTypeFoodSlotsMap);
            out.drinks = slots(characterObj.actionTypeDrinkSlotsMap);
        }

        if (on.equippedAbilities) {
            out.abilities = [];
            for (let i = 0; i < 5; i++) out.abilities.push({ abilityHrid: '', level: 1 });
            let next = 1;
            for (const a of characterObj.combatUnit?.combatAbilities || []) {
                if (!a?.abilityHrid) continue;
                if (isSpecial(a.abilityHrid, clientObj)) out.abilities[0] = { abilityHrid: a.abilityHrid, level: a.level || 1 };
                else if (next < 5) out.abilities[next++] = { abilityHrid: a.abilityHrid, level: a.level || 1 };
            }
        }

        if (on.equippedAbilities || on.consumables) {
            out.triggerMap = {
                ...(on.equippedAbilities ? characterObj.abilityCombatTriggersMap || {} : {}),
                ...(on.consumables ? characterObj.consumableCombatTriggersMap || {} : {}),
            };
        }

        if (on.houseRooms) {
            out.houseRooms = {};
            for (const room of Object.values(characterObj.characterHouseRoomMap || {})) out.houseRooms[room.houseRoomHrid] = room.level;
        }

        if (on.achievements) {
            out.achievements = {};
            for (const a of characterObj.characterAchievements || []) {
                if (a?.achievementHrid) out.achievements[a.achievementHrid] = !!a.isCompleted;
            }
        }

        if (on.guildBuffs) out.guildCombatBuffLevels = guildCombatBuffLevels(characterObj, clientObj);

        const name = characterObj.character?.name;
        if (name) out.name = name;

        // New keys, not read by today's import (docs/codebase/game-data-fields.md, "The export").
        if (on.learnedAbilities) {
            out.learnedAbilities = (characterObj.characterAbilities || []).filter((a) => a?.abilityHrid).map((a) => ({ abilityHrid: a.abilityHrid, level: a.level || 0, experience: a.experience || 0 }));
        }
        if (on.inventory) {
            out.inventory = (characterObj.characterItems || []).filter((i) => i.itemLocationHrid === INVENTORY && i.itemHrid !== COIN).map((i) => ({ itemHrid: i.itemHrid, enhancementLevel: i.enhancementLevel || 0, count: i.count || 0 }));
        }
        if (on.coin) {
            const coin = (characterObj.characterItems || []).find((i) => i.itemLocationHrid === INVENTORY && i.itemHrid === COIN);
            out.coin = coin?.count || 0;
        }
        return out;
    }

    // ================= Combat recorder (read-only) =================
    // Spec: docs/codebase/toolasha-loot-tracker.md ("Recorder spec"). Pure state machine: handle(message, nowMs) per game message,
    // exportData(selfOnly) for the file, no DOM and no network. The likelihood split, shares and closed-form checks are NOT here.
    const REC = { MAX_ENCOUNTERS: 800, MAX_WINDOWS: 200, GAP_MS: 60000, DOT_TICK_MS: 3000, HOT_TICK_MS: 5000, MAX_AMBIGUOUS: 100, MAX_CASTS: 200, MAX_QUESTLOG: 300, MAX_PENDING_AGE: 2 };
    const REC_TYPES = ['new_battle', 'battle_updated', 'action_completed', 'quests_updated', 'init_character_data'];
    const DOT_FALLBACK = { '/abilities/firestorm': { ratio: 1, ms: 6000 }, '/abilities/maim': { ratio: 1, ms: 9000 } };
    const HEAL_FALLBACK = ['/abilities/quick_aid'];
    const LEVEL_KEYS = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].map((s) => s + 'Level');
    const bump = (o, k, v) => { o[k] = (o[k] || 0) + v; };
    const nz = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    const isoMs = (s) => { const v = Date.parse(s); return isFinite(v) ? v : null; };

    function addInto(t, s) {
        for (const [k, v] of Object.entries(s || {})) {
            if (typeof v === 'number') t[k] = (t[k] || 0) + v;
            else if (v && typeof v === 'object' && !Array.isArray(v)) addInto(t[k] || (t[k] = {}), v);
        }
    }

    // What the game's own data says about abilities (damage over time, heals, buffs) and items (food restore).
    function gameData(c) {
        const dot = { ...DOT_FALLBACK };
        const heal = new Set(HEAL_FALLBACK);
        const buffAb = new Set();
        for (const [h, a] of Object.entries((c && c.abilityDetailMap) || {})) {
            for (const e of a.abilityEffects || []) {
                if (e.damageOverTimeRatio > 0) dot[h] = { ratio: e.damageOverTimeRatio, ms: e.damageOverTimeDuration / 1e6 };
                if (String(e.effectType || '').endsWith('/heal')) heal.add(h);
                if (e.buffs && e.buffs.length) buffAb.add(h);
            }
            if (a.buffs && a.buffs.length) buffAb.add(h);
        }
        return { dot, heal, buffAb, items: (c && c.itemDetailMap) || {} };
    }

    function newPlayerRec(slot, self) {
        return {
            slot, self: !!self,
            dealt: { total: 0, bySource: {}, byMonster: {} },
            taken: { total: 0, bySource: {} },
            healed: { total: 0, regen: 0, bySource: {}, heuristic: 0, unresolved: 0 },
            mana: { spent: 0, regained: 0 },
            attempts: 0, casts: {},
            events: { dealt: { events: 0, hits: 0, misses: 0, crits: 0 }, received: { events: 0, hits: 0, misses: 0, crits: 0 } },
            status: { stunnedMs: 0, blindedMs: 0, silencedMs: 0 },
            loot: {}, xp: {}, abilityXp: {}, consumablesUsed: {}, trades: {}, deaths: 0,
        };
    }

    function unitFrom(e, gd) {
        const cs = (e.combatDetails && e.combatDetails.combatStats) || {};
        return {
            hp: nz(e.currentHitpoints, 0), maxHp: nz(e.maxHitpoints, 0), mp: nz(e.currentManapoints, 0),
            atk: nz(e.attackAttemptCounter, 0), dmg: nz(e.damageSplatCounter, 0), crit: nz(e.criticalDamageSplatCounter, 0),
            ab: e.preparingAbilityHrid || '', auto: !!e.isPreparingAutoAttack,
            stun: !!e.isStunned, blind: !!e.isBlinded, sil: !!e.isSilenced, since: {},
            regenRate: nz(cs.hpRegenPer10, 0), bloom: nz(cs.bloom, 0),
            canHeal: (e.combatAbilities || []).some((a) => a && gd.heal.has(a.abilityHrid)), dead: false,
        };
    }

    function snapOf(players) {
        return players.map((p) => {
            const loot = {};
            for (const v of Object.values(p.totalLootMap || {})) if (v && v.itemHrid) bump(loot, v.itemHrid, nz(v.count, 0));
            const cons = {};
            for (const c of p.combatConsumables || []) if (c && c.itemHrid) cons[c.itemHrid] = { count: nz(c.count, 0), avail: c.availableTime || '' };
            const buffs = {};
            for (const [k, b] of Object.entries(p.combatBuffMap || {})) buffs[k] = { uniqueHrid: b.uniqueHrid || k, typeHrid: b.typeHrid, ratioBoost: b.ratioBoost, ratioBoostLevelBonus: b.ratioBoostLevelBonus, flatBoost: b.flatBoost, flatBoostLevelBonus: b.flatBoostLevelBonus, startTime: b.startTime, duration: b.duration };
            return { loot, xp: { ...(p.totalSkillExperienceMap || {}) }, abilityXp: { ...(p.totalAbilityExperienceMap || {}) }, deaths: nz(p.deathCount, 0), cons, buffs };
        });
    }

    function createRecorder(opts) {
        opts = opts || {};
        const getClient = opts.clientData || (() => null);
        const S = {
            selfId: null, zone: null, cur: null, prev: null, win: null, windows: [], encounters: [], quests: [], lastT: 0,
            dot: [], series: [], carry: [], idx: 0, stats: { skippedUpdates: 0, lateUpdates: 0, closed: 0, negativeDiffs: 0 },
        };
        let gd = gameData(getClient());

        // ---- messages ----
        function handle(msg, t) {
            if (!msg || typeof msg !== 'object') return;
            switch (msg.type) {
                case 'init_character_data': if (msg.character && msg.character.id != null) S.selfId = msg.character.id; setQuests(msg.characterQuests, t); break;
                case 'quests_updated': setQuests(msg.endCharacterQuests, t); break;
                case 'action_completed': onAction(msg.endCharacterAction); break;
                case 'new_battle': gd = gameData(getClient()); onNewBattle(msg, t); break;
                case 'battle_updated': onUpdate(msg, t); break;
                default: return;
            }
            S.lastT = t;
        }

        function setQuests(list, t) {
            if (!Array.isArray(list)) return;
            const tasks = list.filter((q) => q && q.status === '/quest_status/in_progress').map((q) => ({ category: q.category, monsterHrid: q.monsterHrid || null, actionHrid: q.actionHrid || null, goalCount: q.goalCount, currentCount: q.currentCount }));
            const last = S.quests[S.quests.length - 1];
            if (last && JSON.stringify(last.tasks) === JSON.stringify(tasks)) return;
            S.quests.push({ t, tasks });
            if (S.quests.length > REC.MAX_QUESTLOG) S.quests.shift();
        }

        function onAction(a) { if (a && a.actionHrid && String(a.actionHrid).startsWith('/actions/combat/')) { S.zone = a.actionHrid; if (S.win && !S.win.zone) S.win.zone = S.zone; } }

        // ---- encounter start: close the previous one, pick the window, take the baseline ----
        function onNewBattle(msg, t) {
            const players = msg.players || [], monsters = msg.monsters || [];
            const snap = snapOf(players);
            const gap = S.cur && S.lastT && t - S.lastT > REC.GAP_MS;
            if (S.cur) closeEncounter(S.cur, snap, msg, t);
            ensureWindow(msg, players, monsters, snap, t, gap);
            const enc = {
                index: ++S.idx, battleId: msg.battleId, combatStartTime: msg.combatStartTime, startedAt: t, endedAt: null,
                monsters: monsters.map((m) => ({ hrid: m.hrid, isBoss: !!m.isBoss, tier: m.difficultyTier, maxHP: nz(m.maxHitpoints, 0), killMs: null })),
                players: players.map((p, i) => newPlayerRec(i, S.selfId != null && p.character && p.character.id === S.selfId)),
                pU: {}, mU: {}, pending: [], ambiguous: [], casts: [], unattributed: { dealt: 0, taken: 0 },
            };
            players.forEach((p, i) => { enc.pU[i] = unitFrom(p, gd); });
            monsters.forEach((m, i) => { enc.mU[i] = unitFrom(m, gd); });
            S.cur = enc;
            S.prev = snap;
        }

        function winKey(msg, players, monsters) {
            return JSON.stringify([msg.combatStartTime, players.length, (monsters[0] && monsters[0].difficultyTier) || 0, players.map((p) => {
                const d = p.combatDetails || {}, cs = d.combatStats || {};
                return [cs.combatDropRate, cs.combatDropQuantity, cs.combatRareFind, LEVEL_KEYS.map((k) => Math.round(nz(d[k], 0) * 1000) / 1000)];
            })]);
        }

        function ensureWindow(msg, players, monsters, snap, t, gap) {
            const key = winKey(msg, players, monsters);
            const w = S.win;
            const zoneChanged = w && w.zone && S.zone && w.zone !== S.zone;
            if (w && w.key === key && !zoneChanged) {
                if (gap) { w.fragments[w.fragments.length - 1].endedAt = S.lastT; w.fragments.push({ startedAt: t, endedAt: t, encounters: 0 }); }
                monstersSeen(w, monsters);
                diffBuffs(w, snap, t, msg.battleId);
                return;
            }
            if (w) { w.endedAt = S.lastT || t; delete w.open; }
            const nw = {
                open: true, key, zone: S.zone, difficultyTier: (monsters[0] && monsters[0].difficultyTier) || 0, combatStartTime: msg.combatStartTime,
                numberOfPlayers: players.length, startedAt: t, endedAt: t, battles: 0, kills: {}, fragments: [{ startedAt: t, endedAt: t, encounters: 0 }],
                players: players.map((p, i) => ({ slot: i, self: S.selfId != null && p.character && p.character.id === S.selfId, stats: { combatDetails: p.combatDetails || null, abilities: p.combatAbilities || [], buffs: snap[i].buffs }, totals: {} })),
                buffEvents: [], monsterStats: {}, tasksAtStart: S.quests.length ? S.quests[S.quests.length - 1].tasks : null,
            };
            monstersSeen(nw, monsters);
            S.windows.push(nw);
            if (S.windows.length > REC.MAX_WINDOWS) S.windows.shift();
            S.win = nw;
        }

        function monstersSeen(w, monsters) {
            for (const m of monsters) if (m.hrid && !w.monsterStats[m.hrid]) w.monsterStats[m.hrid] = { isBoss: !!m.isBoss, combatDetails: m.combatDetails || null, abilities: m.combatAbilities || [], buffs: m.combatBuffMap || {} };
        }

        function diffBuffs(w, snap, t, battleId) {
            if (!S.prev || S.prev.length !== snap.length) return;
            snap.forEach((s, slot) => {
                const before = S.prev[slot].buffs;
                for (const [k, b] of Object.entries(s.buffs)) {
                    if (!before[k]) w.buffEvents.push({ t, battleId, slot, change: 'added', ...b });
                    else if (before[k].startTime !== b.startTime || before[k].ratioBoost !== b.ratioBoost || before[k].flatBoost !== b.flatBoost) w.buffEvents.push({ t, battleId, slot, change: 'refreshed', ...b });
                }
                for (const [k, b] of Object.entries(before)) if (!s.buffs[k]) w.buffEvents.push({ t, battleId, slot, change: 'removed', ...b });
            });
            if (w.buffEvents.length > 2000) w.buffEvents.splice(0, w.buffEvents.length - 2000);
        }

        // ---- encounter close: snapshot differences, food, window sums ----
        function foodSpec(item) {
            const d = gd.items[item] && gd.items[item].consumableDetail;
            if (!d) return null;
            const ms = nz(d.recoveryDuration, 0) / 1e6;
            return { hp: nz(d.hitpointRestore, 0), mp: nz(d.manapointRestore, 0), n: ms > 0 ? Math.max(1, Math.round(ms / REC.HOT_TICK_MS)) : 1, cdMs: nz(d.cooldownDuration, 0) / 1e6, drink: !!(d.buffs && d.buffs.length) };
        }
        const fits = (r, full, s) => (s.n === 1 ? (r === s.expected || (full && r <= s.expected)) : (Math.abs(r - s.per) <= 1.0001 || (full && r < s.per + 1)));

        function closeEncounter(enc, snap, msg, t) {
            enc.endedAt = t;
            const ok = S.prev && S.prev.length === snap.length && enc.combatStartTime === msg.combatStartTime && snap.length === enc.players.length;
            const consumes = [];
            if (ok) {
                snap.forEach((s, slot) => {
                    const p = S.prev[slot], pr = enc.players[slot];
                    for (const [k, v] of Object.entries(s.loot)) { const d = v - nz(p.loot[k], 0); if (d < 0) { S.stats.negativeDiffs++; enc.negativeDiff = true; } else if (d > 0) pr.loot[k] = d; }
                    for (const [k, v] of Object.entries(s.xp)) { const d = v - nz(p.xp[k], 0); if (d > 0) pr.xp[k] = d; else if (d < 0) { S.stats.negativeDiffs++; enc.negativeDiff = true; } }
                    for (const [k, v] of Object.entries(s.abilityXp)) { const d = v - nz(p.abilityXp[k], 0); if (d > 0) pr.abilityXp[k] = d; }
                    pr.deaths = Math.max(0, s.deaths - p.deaths);
                    for (const [item, c] of Object.entries(s.cons)) {
                        const b = p.cons[item];
                        if (!b) continue;
                        const dc = c.count - b.count;
                        const used = c.avail && b.avail && c.avail !== b.avail ? 1 : 0;
                        if (used) {
                            const sp = foodSpec(item);
                            const rec = { item, consumedAtServer: sp && isoMs(c.avail) != null ? new Date(isoMs(c.avail) - sp.cdMs).toISOString() : null, expected: sp ? sp.hp : null, credited: 0, healMismatch: false, checked: !!(sp && sp.hp > 0 && !sp.drink) };
                            pr.consumes = pr.consumes || [];
                            pr.consumes.push(rec);
                            bump(pr.consumablesUsed, item, 1);
                            consumes.push({ slot, item, rec, sp });
                        }
                        const trade = dc + used;
                        if (trade !== 0) bump(pr.trades, item, trade);
                    }
                });
            } else enc.diffSkipped = true;
            resolveHeals(enc, consumes);
            finalizeSeries(t, false);
            for (const [k, u] of Object.entries(enc.pU)) {
                for (const [f, key] of [['stun', 'stunnedMs'], ['blind', 'blindedMs'], ['sil', 'silencedMs']]) if (u[f] && u.since[f] != null) enc.players[k].status[key] += t - u.since[f];
            }
            for (const m of enc.monsters) if (m.killMs != null && S.win) bump(S.win.kills, m.hrid, 1);
            if (S.win) {
                S.win.battles++;
                S.win.endedAt = t;
                const fr = S.win.fragments[S.win.fragments.length - 1];
                fr.endedAt = t; fr.encounters++;
                enc.players.forEach((pr, i) => { const wp = S.win.players[i]; if (wp) { const { slot, self, consumes: _c, ...rest } = pr; addInto(wp.totals, rest); } });
            }
            delete enc.pU; delete enc.mU; delete enc.pending; delete enc.index;
            S.encounters.push(enc);
            if (S.encounters.length > REC.MAX_ENCOUNTERS) S.encounters.shift();
            S.stats.closed++;
            S.dirty = (S.dirty || 0) + 1;
        }

        function resolveHeals(enc, consumes) {
            const all = S.carry.concat(enc.pending);
            S.carry = [];
            for (const c of consumes) {
                if (!c.sp || c.sp.hp <= 0 || c.sp.drink) continue;
                const s = { slot: c.slot, item: c.item, rec: c.rec, expected: c.sp.hp, n: c.sp.n, per: c.sp.hp / c.sp.n, left: c.sp.n, ageEnc: 0, endAt: null };
                for (const p of all) if (!p.done && p.slot === c.slot && s.left > 0 && fits(p.r, p.full, s)) { p.done = true; s.left--; s.rec.credited += p.r; addHeal(enc.players[c.slot], 'food:' + c.item, p.r); }
                S.series.push(s);
            }
            for (const p of all) {
                if (p.done) continue;
                if (S.idx - p.idx >= REC.MAX_PENDING_AGE) { enc.players[p.slot] && (enc.players[p.slot].healed.unresolved += p.r); enc.players[p.slot] && (enc.players[p.slot].healed.total += p.r); } else S.carry.push(p);
            }
        }

        function finalizeSeries(t, force) {
            S.series = S.series.filter((s) => {
                s.ageEnc++;
                if (s.left > 0 && s.ageEnc < 4 && !force) return true;
                s.rec.healMismatch = s.rec.checked && (s.rec.credited === 0 || s.rec.credited > s.expected + 2);
                return false;
            });
        }

        function addHeal(pr, src, r, heuristic) { pr.healed.total += r; pr.healed.bySource[src] = (pr.healed.bySource[src] || 0) + r; if (heuristic) pr.healed.heuristic += r; }

        // ---- battle_updated ----
        function step(u, e) {
            const p = { hp: u.hp, mp: u.mp, atk: u.atk, dmg: u.dmg, crit: u.crit, ab: u.ab, auto: u.auto, maxHp: u.maxHp };
            u.hp = nz(e.cHP, u.hp); u.maxHp = nz(e.mHP, u.maxHp); u.mp = nz(e.cMP, u.mp);
            u.atk = nz(e.atkCounter, u.atk); u.dmg = nz(e.dmgCounter, u.dmg); u.crit = nz(e.critCounter, u.crit);
            // A record carries either the prepared ability (abilityHrid) or isAutoAtk: true; the other field is then absent.
            if (e.isAutoAtk === true) u.auto = true;
            else if (e.abilityHrid) { u.ab = e.abilityHrid; u.auto = false; }
            else if (e.isAutoAtk === false) u.auto = false;
            return { u, p, e, dAtk: u.atk - p.atk, exec: p.auto || !p.ab ? 'auto' : p.ab, dDmg: u.dmg - p.dmg, drop: Math.max(0, p.hp - u.hp), rise: Math.max(0, u.hp - p.hp), crit: u.crit !== p.crit, dMp: u.mp - p.mp };
        }

        function onUpdate(msg, t) {
            const enc = S.cur;
            if (!enc) { S.stats.skippedUpdates++; return; }
            if (msg.battleId !== enc.battleId) { S.stats.lateUpdates++; return; }
            const pe = [], me = [];
            for (const [k, e] of Object.entries(msg.pMap || {})) if (enc.pU[k]) { const x = step(enc.pU[k], e); x.side = 'p'; x.idx = +k; pe.push(x); }
            for (const [k, e] of Object.entries(msg.mMap || {})) if (enc.mU[k]) { const x = step(enc.mU[k], e); x.side = 'm'; x.idx = +k; me.push(x); }
            const pa = pe.filter((x) => x.dAtk > 0), ma = me.filter((x) => x.dAtk > 0);
            for (const x of pa) { const pr = enc.players[x.idx]; pr.attempts += x.dAtk; bump(pr.casts, x.exec, 1); if (x.dAtk > 1) bump(pr.casts, 'unknown', x.dAtk - 1); logCast(enc, t, x, 'p'); }
            for (const x of ma) logCast(enc, t, x, 'm');
            for (const x of me) if (x.dDmg > 0) damageEvent(enc, t, x, pa, 'm');
            for (const x of pe) if (x.dDmg > 0) damageEvent(enc, t, x, ma, 'p');
            for (const x of pe) {
                const pr = enc.players[x.idx];
                if (x.rise > 0) healEvent(enc, t, x, pa, pr);
                if (x.dMp < 0) pr.mana.spent += -x.dMp; else if (x.dMp > 0) pr.mana.regained += x.dMp;
                statusStep(x, t);
            }
            for (const x of me) {
                const mon = enc.monsters[x.idx];
                if (mon && mon.killMs == null && !x.u.dead && x.p.hp > 0 && (x.u.hp === 0 || x.e.isActive === false)) { x.u.dead = true; mon.killMs = t - enc.startedAt; }
            }
        }

        function statusStep(x, t) {
            for (const [f, k] of [['stun', 'isStunned'], ['blind', 'isBlinded'], ['sil', 'isSilenced']]) {
                if (x.e[k] === undefined) continue;
                const now = !!x.e[k], u = x.u;
                if (now && !u[f]) u.since[f] = t;
                if (!now && u[f] && u.since[f] != null) { S.cur.players[x.idx].status[f === 'stun' ? 'stunnedMs' : f === 'blind' ? 'blindedMs' : 'silencedMs'] += t - u.since[f]; u.since[f] = null; }
                u[f] = now;
            }
        }

        function logCast(enc, t, x, side) {
            if (!gd.buffAb.has(x.exec) || enc.casts.length >= REC.MAX_CASTS) return;
            enc.casts.push({ t, side, idx: x.idx, hrid: side === 'm' ? (enc.monsters[x.idx] || {}).hrid : null, ability: x.exec });
        }

        const tKey = (enc, side, idx) => (side === 'm' ? 'm:' + enc.battleId + ':' + idx : 'p:' + idx);

        function actorOf(enc, a) { return { side: a.side, idx: a.idx, hrid: a.side === 'm' ? (enc.monsters[a.idx] || {}).hrid : null, ability: a.exec, atkDelta: a.dAtk }; }

        function ambiguous(enc, t, x, side, actors, reason) {
            if (enc.ambiguous.length < REC.MAX_AMBIGUOUS) enc.ambiguous.push({ kind: side === 'm' ? 'dealt' : 'taken', reason, battleId: enc.battleId, t, target: { side, idx: x.idx, hrid: side === 'm' ? (enc.monsters[x.idx] || {}).hrid : null }, dmgDelta: x.dDmg, hpChange: x.drop, crit: x.crit, actors: actors.map((a) => actorOf(enc, a)) });
            enc.unattributed[side === 'm' ? 'dealt' : 'taken'] += x.drop;
        }

        function damageEvent(enc, t, x, actors, side) {
            const d = x.dDmg, dmg = x.drop;
            if (d !== 1) { ambiguous(enc, t, x, side, actors, 'multi-event'); return; }
            let src = null, casterSide, casterIdx, ab, dotTick = false;
            if (actors.length === 1) { src = actors[0]; ab = src.exec; }
            else if (actors.length === 0) {
                const m = matchDot(tKey(enc, side, x.idx), t, dmg);
                if (m === 'many' || !m) { ambiguous(enc, t, x, side, actors, m === 'many' ? 'dot-overlap' : 'no-actor'); return; }
                src = { side: m.casterSide, idx: m.casterIdx, exec: m.ability, hrid: m.casterHrid }; ab = m.ability + ':dot'; dotTick = true;
            } else { ambiguous(enc, t, x, side, actors, 'multi-actor'); return; }
            const hit = dmg > 0;
            const tally = (c) => { c.events++; if (hit) c.hits++; else c.misses++; if (x.crit) c.crits++; };
            if (side === 'm') {
                const pr = enc.players[src.idx];
                if (!pr) { ambiguous(enc, t, x, side, actors, 'no-actor'); return; }
                const hrid = (enc.monsters[x.idx] || {}).hrid || '?';
                pr.dealt.total += dmg; bump(pr.dealt.byMonster, hrid, dmg);
                const b = pr.dealt.bySource[ab] || (pr.dealt.bySource[ab] = { amount: 0, events: 0, hits: 0, misses: 0, crits: 0 });
                b.amount += dmg; tally(b); tally(pr.events.dealt);
            } else {
                const pr = enc.players[x.idx];
                const hrid = src.hrid || (enc.monsters[src.idx] || {}).hrid || '?';
                pr.taken.total += dmg;
                const key = hrid + '::' + ab;
                const b = pr.taken.bySource[key] || (pr.taken.bySource[key] = { amount: 0, events: 0, hits: 0, misses: 0, crits: 0 });
                b.amount += dmg; tally(b); tally(pr.events.received);
            }
            const dd = gd.dot[ab];
            if (!dotTick && hit && dd) {
                S.dot.push({ target: tKey(enc, side, x.idx), casterSide: side === 'm' ? 'p' : 'm', casterIdx: src.idx, casterHrid: side === 'm' ? null : (enc.monsters[src.idx] || {}).hrid, ability: ab, t, dmg });
                if (S.dot.length > 400) S.dot.splice(0, 200);
            }
        }

        function matchDot(target, t, dmg) {
            S.dot = S.dot.filter((e) => t - e.t < 15000);
            const hits = [];
            for (const e of S.dot) {
                if (e.target !== target) continue;
                const dd = gd.dot[e.ability];
                if (!dd) continue;
                const ticks = dd.ms / REC.DOT_TICK_MS, exp = (e.dmg * dd.ratio) / ticks;
                for (let k = 1; k <= ticks; k++) if (Math.abs(t - e.t - k * REC.DOT_TICK_MS) <= 250 && Math.abs(dmg - exp) <= 1.0001) { hits.push(e); break; }
            }
            return hits.length === 1 ? hits[0] : hits.length > 1 ? 'many' : null;
        }

        function healEvent(enc, t, x, pa, pr) {
            const r = x.rise, full = x.u.hp >= x.u.maxHp;
            const regen = Math.floor(x.p.maxHp * x.u.regenRate);
            if (regen > 0 && (r === regen || (full && r < regen))) { pr.healed.total += r; pr.healed.regen += r; return; }
            for (const s of S.series) if (s.slot === x.idx && s.left > 0 && fits(r, full, s)) { s.left--; s.rec.credited += r; addHeal(pr, 'food:' + s.item, r); return; }
            const healers = pa.filter((a) => gd.heal.has(a.exec));
            if (healers.length === 1) { addHeal(pr, healers[0].exec, r); return; }
            if (healers.length > 1) { healAmbiguous(enc, t, x, pa, 'multi-healer'); pr.healed.unresolved += r; pr.healed.total += r; return; }
            if (pa.some((a) => a.dAtk >= 2 && a.u.canHeal)) { healAmbiguous(enc, t, x, pa, 'hidden-action'); pr.healed.unresolved += r; pr.healed.total += r; return; }
            if (pa.some((a) => a.u.bloom > 0)) { addHeal(pr, 'bloom', r, true); return; }
            enc.pending.push({ slot: x.idx, r, t, full, idx: S.idx, done: false });
        }

        function healAmbiguous(enc, t, x, pa, reason) {
            if (enc.ambiguous.length < REC.MAX_AMBIGUOUS) enc.ambiguous.push({ kind: 'heal', reason, battleId: enc.battleId, t, target: { side: 'p', idx: x.idx }, amount: x.rise, actors: pa.map((a) => actorOf(enc, a)) });
        }

        // ---- export ----
        function exportData(selfOnly, nowMs) {
            const wins = S.windows.map((w) => ({ ...w, key: undefined }));
            let encs = S.encounters;
            let sel = wins;
            if (selfOnly) {
                const hasSelf = wins.some((w) => w.players.some((p) => p.self)) || encs.some((e) => e.players.some((p) => p.self));
                if (!hasSelf) throw new Error('selfOnly is on but the recorder cannot tell which player is you (reload the game page once with the exporter on, then fight).');
                sel = wins.map((w) => ({ ...w, players: w.players.filter((p) => p.self) }));
                encs = encs.map((e) => ({ ...e, players: e.players.filter((p) => p.self), ambiguous: e.ambiguous.filter((a) => (a.target.side === 'p' && e.players.some((p) => p.self && p.slot === a.target.idx)) || a.target.side === 'm') }));
            }
            return { format: 'mwics-loot', version: 1, exportedAt: new Date(nowMs || Date.now()).toISOString(), selfOnly: !!selfOnly, attribution: 'counter (exact) unless a field says heuristic; ambiguous ticks are raw, flagged, and split afterwards', windows: sel, encounters: encs, tasks: S.quests, lootLog: [], notes: { ...S.stats, openEncounterNotExported: !!S.cur } };
        }

        function persistable() { return { windows: S.windows, encounters: S.encounters, quests: S.quests, stats: S.stats }; }
        function restore(d) { if (!d) return; S.windows = d.windows || []; S.encounters = d.encounters || []; S.quests = d.quests || []; Object.assign(S.stats, d.stats || {}); if (S.windows.length) { S.win = null; for (const w of S.windows) delete w.open; } }
        function clear() { S.windows = []; S.encounters = []; S.quests = []; S.win = null; S.cur = null; S.prev = null; S.dot = []; S.series = []; S.carry = []; S.stats = { skippedUpdates: 0, lateUpdates: 0, closed: 0, negativeDiffs: 0 }; }

        return { handle, exportData, persistable, restore, clear, state: S };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildExport, KINDS, defaultToggles, createRecorder, gameData, REC, REC_TYPES };
        return;
    }

    // ---- Browser side ----
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const TOGGLES_KEY = 'mwicsExporterToggles';
    let latest = null; // { characterObj, receivedAt }
    const seen = new WeakSet();
    const RECORDER_KEY = 'mwicsRecorderToggles', REC_WIN_KEY = 'mwicsRecorderWindows', REC_ENC_KEY = 'mwicsRecorderEncounters';
    const TYPE_RE = /"type"\s*:\s*"([a-z_]+)"/;
    function loadRecToggles() {
        try { return { recorder: true, selfOnly: false, ...(JSON.parse(GM_getValue(RECORDER_KEY, '{}')) || {}) }; } catch { return { recorder: true, selfOnly: false }; }
    }
    let recToggles = loadRecToggles();
    const recorder = createRecorder({ clientData: () => clientData() });
    function loadRecorded() {
        try {
            const w = JSON.parse(GM_getValue(REC_WIN_KEY, 'null')), e = JSON.parse(GM_getValue(REC_ENC_KEY, 'null'));
            if (w) recorder.restore({ ...w, encounters: e || [] });
        } catch (err) { console.error('[MWICS Exporter] could not load the recorded data', err); }
    }
    function saveRecorded() {
        try {
            const d = recorder.persistable();
            GM_setValue(REC_ENC_KEY, JSON.stringify(d.encounters));
            GM_setValue(REC_WIN_KEY, JSON.stringify({ windows: d.windows, quests: d.quests, stats: d.stats }));
            recorder.state.dirty = 0;
        } catch (err) { console.error('[MWICS Exporter] could not save the recorded data', err); }
    }
    function recordedSize() { try { return (GM_getValue(REC_ENC_KEY, '').length + GM_getValue(REC_WIN_KEY, '').length) / 1048576; } catch { return 0; } }

    function loadToggles() {
        try { return { ...defaultToggles(), ...(JSON.parse(GM_getValue(TOGGLES_KEY, '{}')) || {}) }; } catch { return defaultToggles(); }
    }
    function saveToggles(t) { GM_setValue(TOGGLES_KEY, JSON.stringify(t)); }

    // Read-only hook, chained onto whatever getter is already there (Toolasha and MWITools hook the same getter and chain
    // the same way, so load order does not matter). It reads the message the page already received; it never sends.
    function hook() {
        const proto = page.MessageEvent.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'data');
        const previousGet = desc.get;
        desc.get = function mwicsExporterGet() {
            const message = previousGet.call(this);
            try {
                const socket = this.currentTarget;
                if (!seen.has(this) && typeof message === 'string' && socket && GAME_SOCKET_HOSTS.some((h) => String(socket.url || '').includes(h))) {
                    seen.add(this);
                    const m = TYPE_RE.exec(message.slice(0, 120));
                    const type = m ? m[1] : null;
                    if (type === 'init_character_data' || message.includes('"init_character_data"')) {
                        const obj = JSON.parse(message);
                        if (obj.type === 'init_character_data') { latest = { characterObj: obj, receivedAt: new Date() }; if (recToggles.recorder) recorder.handle(obj, Date.now()); }
                    } else if (recToggles.recorder && type && REC_TYPES.includes(type)) {
                        recorder.handle(JSON.parse(message), Date.now());
                        if (recorder.state.dirty >= 20) saveRecorded();
                    }
                }
            } catch (e) {
                console.error('[MWICS Exporter] read failed', e);
            }
            return message;
        };
        Object.defineProperty(proto, 'data', desc);
    }

    function clientData() {
        try { return page.localStorageUtil?.getInitClientData?.() || null; } catch { return null; }
    }

    function toast(text) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1e1f24;color:#e6e6e6;border:1px solid #444;border-radius:6px;padding:10px 16px;font:14px sans-serif;box-shadow:0 4px 16px #0008';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }

    function copyExport() {
        if (!latest) { toast('MWICS Exporter: no character data yet. Reload the game page with the exporter on, then try again.'); return; }
        const json = JSON.stringify(buildExport(latest.characterObj, clientData(), loadToggles()));
        GM_setClipboard(json, 'text');
        toast('MWICS Exporter: copied (character data from ' + latest.receivedAt.toLocaleTimeString() + ').');
    }

    function copyLootExport() {
        if (!recorder.state.encounters.length) { toast('MWICS Exporter: nothing recorded yet. Fight for a few encounters first (the recorder needs a battle that starts after the page loaded).'); return; }
        try {
            const json = JSON.stringify(recorder.exportData(!!recToggles.selfOnly));
            GM_setClipboard(json, 'text');
            toast('MWICS Exporter: loot export copied (' + recorder.state.encounters.length + ' encounters, ' + (json.length / 1048576).toFixed(2) + ' MB).');
        } catch (e) { toast('MWICS Exporter: ' + e.message); }
    }
    function clearLoot() {
        recorder.clear();
        saveRecorded();
        toast('MWICS Exporter: recorded loot cleared.');
    }

    function openSettings() {
        document.getElementById('mwics-exporter-settings')?.remove();
        const toggles = loadToggles();
        const wrap = document.createElement('div');
        wrap.id = 'mwics-exporter-settings';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000a;display:flex;align-items:center;justify-content:center';
        const box = document.createElement('div');
        box.style.cssText = 'background:#1e1f24;color:#e6e6e6;border:1px solid #444;border-radius:8px;padding:16px 20px;min-width:320px;font:14px sans-serif;color-scheme:dark';
        const title = document.createElement('div');
        title.textContent = 'MWICS Exporter: what to export';
        title.style.cssText = 'font-weight:bold;margin-bottom:10px';
        box.appendChild(title);
        for (const k of KINDS) {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!toggles[k.key];
            cb.addEventListener('change', () => { toggles[k.key] = cb.checked; saveToggles(toggles); });
            row.appendChild(cb);
            row.appendChild(document.createTextNode(k.label));
            box.appendChild(row);
        }
        const sep = document.createElement('div');
        sep.textContent = 'Combat recorder (loot, damage, healing, buffs; stays in this browser)';
        sep.style.cssText = 'font-weight:bold;margin:12px 0 4px';
        box.appendChild(sep);
        for (const [key, label] of [['recorder', 'Combat recorder'], ['selfOnly', 'Only my own data (leave the other party members out of the loot export)']]) {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!recToggles[key];
            cb.addEventListener('change', () => { recToggles[key] = cb.checked; GM_setValue(RECORDER_KEY, JSON.stringify(recToggles)); });
            row.appendChild(cb);
            row.appendChild(document.createTextNode(label));
            box.appendChild(row);
        }
        const size = document.createElement('div');
        size.textContent = 'Recorded so far: ' + recorder.state.encounters.length + ' encounters, ' + recordedSize().toFixed(2) + ' MB saved.';
        size.style.cssText = 'opacity:.7;padding:4px 0';
        box.appendChild(size);
        const close = document.createElement('button');
        close.textContent = 'Close';
        close.style.cssText = 'margin-top:12px;background:#2d2f36;color:#e6e6e6;border:1px solid #555;border-radius:4px;padding:6px 14px;cursor:pointer';
        close.addEventListener('click', () => wrap.remove());
        box.appendChild(close);
        wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
        wrap.appendChild(box);
        document.body.appendChild(wrap);
    }

    loadRecorded();
    hook();
    page.addEventListener('pagehide', saveRecorded);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRecorded(); });
    GM_registerMenuCommand('Copy export', copyExport);
    GM_registerMenuCommand('Copy loot export', copyLootExport);
    GM_registerMenuCommand('Clear recorded loot', clearLoot);
    GM_registerMenuCommand('Settings', openSettings);
})();
