// ==UserScript==
// @name         MWICS Exporter
// @namespace    https://github.com/Ramlock/MWICombatSimulator
// @version      0.1.0
// @description  Read-only export of your character for the MWICS combat simulator: the sim's setup JSON plus learned abilities, inventory and Coin. Sends nothing to the server and presses nothing in the game.
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
                if (item.itemLocationHrid && item.itemLocationHrid !== INVENTORY) {
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

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildExport, KINDS, defaultToggles };
        return;
    }

    // ---- Browser side ----
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const TOGGLES_KEY = 'mwicsExporterToggles';
    let latest = null; // { characterObj, receivedAt }
    const seen = new WeakSet();

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
                    if (message.includes('"init_character_data"')) {
                        const obj = JSON.parse(message);
                        if (obj.type === 'init_character_data') latest = { characterObj: obj, receivedAt: new Date() };
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
        const close = document.createElement('button');
        close.textContent = 'Close';
        close.style.cssText = 'margin-top:12px;background:#2d2f36;color:#e6e6e6;border:1px solid #555;border-radius:4px;padding:6px 14px;cursor:pointer';
        close.addEventListener('click', () => wrap.remove());
        box.appendChild(close);
        wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
        wrap.appendChild(box);
        document.body.appendChild(wrap);
    }

    hook();
    GM_registerMenuCommand('Copy export', copyExport);
    GM_registerMenuCommand('Settings', openSettings);
})();
