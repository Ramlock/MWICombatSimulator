// Node test for the sim's party import (mergePlayerImport / setPlayerData / doGroupImport / updateNextPlayer in src/main.js, extracted
// from the source text and run against a stub page) on made-up characters run through the exporter. No real player's data.
// Run: node userscript/test/party-import.test.cjs
// Checks: a kind missing from a player's JSON keeps THAT player's own prior value (never another player's, never the screen's) and
// every other kind imports; both party paths (one box per player, the all-in-one box); a slot holding nothing for a kind gets the
// empty player's default; each single skill level missing keeps its prior value.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'userscript', 'mwics-exporter.user.js'), 'utf8'), { module: mod, console });
const buildExport = (...a) => JSON.parse(JSON.stringify(mod.exports.buildExport(...a)));

const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => {
    const a = mainSrc.indexOf(from);
    const b = mainSrc.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `${from} .. ${to} not found in src/main.js`);
    return mainSrc.slice(a, b);
};
const emptyDecl = cut('const EMPTY_PLAYER_DATA', '\n') + '\n';
const importSrc = cut('function mergePlayerImport', 'function doSoloImport()');
const updateSrc = cut('function updateNextPlayer', '\nfunction showErrorModal');
const EMPTY = JSON.parse(vm.runInNewContext(emptyDecl + 'EMPTY_PLAYER_DATA'));

// A made-up character; every value depends on the seed, so no two seeds share a value in any kind.
const SKILLS = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];
const trig = (n) => [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/missing_hp', comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: n }];
function character(n) {
    return {
        type: 'init_character_data',
        character: { name: 'Cow' + n },
        characterSkills: SKILLS.map((s, i) => ({ skillHrid: '/skills/' + s, level: 20 + n * 7 + i, experience: 1 })),
        characterItems: [
            { itemLocationHrid: '/item_locations/head', itemHrid: '/items/hood' + n, enhancementLevel: n, count: 1 },
            { itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/sword' + n, enhancementLevel: n + 1, count: 1 },
        ],
        actionTypeFoodSlotsMap: { '/action_types/combat': [{ itemHrid: '/items/food' + n }, null, null] },
        actionTypeDrinkSlotsMap: { '/action_types/combat': [{ itemHrid: '/items/drink' + n }, null, null] },
        combatUnit: { combatAbilities: [{ abilityHrid: '/abilities/mystic_aura', level: 10 + n }, { abilityHrid: '/abilities/ab' + n, level: 20 + n }] },
        abilityCombatTriggersMap: { ['/abilities/ab' + n]: trig(n) },
        consumableCombatTriggersMap: { ['/items/food' + n]: trig(100 + n) },
        characterHouseRoomMap: { a: { houseRoomHrid: '/house_rooms/dojo', level: 1 + n }, b: { houseRoomHrid: '/house_rooms/gym', level: 2 + n } },
        characterAchievements: [{ achievementHrid: '/achievements/a' + n, isCompleted: true }],
        characterGuildBuffMap: { '/guild_buffs/force_combat': { level: 1 + n } },
        guildBuildingLevelMap: { '/guild_shrines/force': 9 },
    };
}
const exportOf = (n, off) => buildExport(character(n), null, off ? { [off]: false } : {});

// The kinds, as the import sees them: how to read each from a player JSON, and what the stub page shows once it is loaded.
const prefixed = (j, p) => Object.fromEntries(Object.entries(j.triggerMap ?? {}).filter(([k]) => k.startsWith(p)));
const KIND = {
    ...Object.fromEntries(SKILLS.map((s) => [s + 'Level', { get: (j) => j.player?.[s + 'Level'], screen: (n) => [['inputLevel_' + s, 20 + n * 7 + SKILLS.indexOf(s)]] }])),
    gear: { get: (j) => j.player?.equipment, screen: (n) => [['selectEquipment_head', '/items/hood' + n], ['inputEquipmentEnhancementLevel_head', n], ['selectEquipment_weapon', '/items/sword' + n]] },
    food: { get: (j) => j.food, screen: (n) => [['selectFood_0', '/items/food' + n]] },
    drinks: { get: (j) => j.drinks, screen: (n) => [['selectDrink_0', '/items/drink' + n]] },
    abilities: { get: (j) => j.abilities, screen: (n) => [['selectAbility_0', '/abilities/mystic_aura'], ['selectAbility_1', '/abilities/ab' + n], ['inputAbilityLevel_1', String(20 + n)]] },
    abilityTriggers: { get: (j) => prefixed(j, '/abilities/'), triggers: '/abilities/' },
    itemTriggers: { get: (j) => prefixed(j, '/items/'), triggers: '/items/' },
    houseRooms: { get: (j) => j.houseRooms, screen: (n) => [['[data-house-hrid="/house_rooms/dojo"]', 1 + n], ['[data-house-hrid="/house_rooms/gym"]', 2 + n]] },
    achievements: { get: (j) => j.achievements, screen: (n) => [['[data-achievement-hrid="/achievements/a' + n + '"]', true, 'checked']] },
    guildBuffs: { get: (j) => j.guildCombatBuffLevels ?? j.guildBuffs, guild: true },
};
// The exporter's toggle -> the kinds it drops.
const OWNED = {
    skillLevels: SKILLS.map((s) => s + 'Level'), gear: ['gear'], consumables: ['food', 'drinks', 'itemTriggers'],
    equippedAbilities: ['abilities', 'abilityTriggers'], houseRooms: ['houseRooms'], achievements: ['achievements'], guildBuffs: ['guildBuffs'],
};
const guildLevel = (n) => ({ force: 1 + n, tempo: 0, spirit: 0, rarity: 0, scholar: 0 });

// Sanity: seeds 1..5 never share a value in any kind, so "kept the wrong player's value" cannot hide.
for (const [name, k] of Object.entries(KIND)) {
    for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) {
        assert.notDeepEqual(k.get(exportOf(a)), k.get(exportOf(b)), `${name}: seeds ${a} and ${b} share a value`);
    }
    assert.notDeepEqual(k.get(exportOf(1)), k.get(EMPTY), `${name}: seed 1 equals the empty default`);
}

// The stub page: loads the sim's party-import code from src/main.js.
const PRIOR = 'PRIOR';
function makePage(map, { screenSave } = {}) {
    const els = {};
    const el = (id) => (els[id] ||= { id, value: id.startsWith('inputSetGroup') ? '' : PRIOR, checked: PRIOR });
    const ctx = {
        document: { getElementById: (id) => el(id), querySelector: (sel) => el(sel) },
        player: { houseRooms: {}, achievements: {} },
        houseRoomDetailMap: { a: { hrid: '/house_rooms/dojo' }, b: { hrid: '/house_rooms/gym' } },
        achievementDetailMap: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, { hrid: '/achievements/a' + n }])),
        triggerMap: {}, playerDataMap: { ...map }, currentPlayerTabId: '1', saved: [], guildSeen: undefined,
        fixTriggerMap: () => {}, applyLabyrinthUpgradesToState: () => {}, refreshAchievementStatics: () => {}, applyGuildBuffsToState: () => {},
        JSON, Object, Array, String, Boolean, console,
        // src/groupSelection.mjs is covered by tools/test/group-selection.mjs; here the pasted object has slots only.
        splitGroupImport: (m) => ({ slots: m, selected: null, fight: null }), applyGroupSelection: () => ({ skipped: [] }),
    };
    ctx.getImportedGuildBuffs = (s) => { ctx.guildSeen = s.guildCombatBuffLevels ?? s.guildBuffs; return {}; };
    ctx.savePreviousPlayer = (id) => { ctx.saved.push(id); if (screenSave) ctx.playerDataMap[id] = screenSave; };
    vm.createContext(ctx);
    vm.runInContext(emptyDecl + importSrc + updateSrc, ctx);
    return { els, ctx, el };
}
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Path "boxes": one JSON per player box. Path "all": the all-in-one box ({ slot: JSON string }).
function runParty(path_, map, imports, opts) {
    const page = makePage(map, opts);
    if (path_ === 'boxes') for (const [slot, json] of Object.entries(imports)) page.el('inputSetGroupCombatplayer' + slot).value = JSON.stringify(json);
    else page.el('inputSetGroupCombatAll').value = JSON.stringify(Object.fromEntries(Object.entries(imports).map(([s, j]) => [s, JSON.stringify(j)])));
    vm.runInContext('doGroupImport()', page.ctx);
    return page;
}
// What slot `slot` holds, and what the screen shows once updateNextPlayer loads it.
const slotJson = (page, slot) => JSON.parse(page.ctx.playerDataMap[slot]);
function loadScreen(page, slot) {
    vm.runInContext(`updateNextPlayer(${JSON.stringify(slot)})`, page.ctx);
    return { value: (id, prop = 'value') => page.els[id]?.[prop], triggerMap: plain(page.ctx.triggerMap), guild: plain(page.ctx.guildSeen) };
}
// Expect slot's JSON and screen to hold, per kind, the value of seed `from[kind]`.
function expectSlot(page, slot, ownerSeed, droppedKinds, newSeed, label) {
    const j = slotJson(page, slot);
    const screen = loadScreen(page, slot);
    for (const [name, k] of Object.entries(KIND)) {
        const seed = droppedKinds.includes(name) ? ownerSeed : newSeed;
        assert.deepEqual(plain(k.get(j)), plain(k.get(exportOf(seed))), `${label}: slot ${slot} ${name} (JSON) should be seed ${seed}'s`);
        for (const [id, want, prop] of k.screen?.(seed) ?? []) assert.equal(screen.value(id, prop), want, `${label}: slot ${slot} ${name} (screen ${id}) should be seed ${seed}'s`);
        if (k.triggers) assert.deepEqual(prefixed({ triggerMap: screen.triggerMap }, k.triggers), prefixed(exportOf(seed), k.triggers), `${label}: slot ${slot} ${name} (screen triggers)`);
        if (k.guild) assert.deepEqual(screen.guild, exportOf(seed).guildCombatBuffLevels, `${label}: slot ${slot} guild buffs (screen)`);
    }
    return j;
}

let checks = 0;
const toggles = Object.keys(OWNED);
const priors = () => ({ 1: JSON.stringify(exportOf(1)), 2: JSON.stringify(exportOf(2)), 3: EMPTY_JSON, 4: EMPTY_JSON, 5: EMPTY_JSON });
const EMPTY_JSON = vm.runInNewContext(emptyDecl + 'EMPTY_PLAYER_DATA');

// 1. Two players, each switching off one kind (a different one each), by both paths: each keeps its own prior value for the kind
// it switched off, neither gets the other's, and both import every other kind. Player A (slot 1, prior seed 1, new seed 3);
// player B (slot 2, prior seed 2, new seed 4).
for (const path_ of ['boxes', 'all']) {
    for (let i = 0; i < toggles.length; i++) {
        const offA = toggles[i];
        const offB = toggles[(i + 1) % toggles.length];
        const page = runParty(path_, priors(), { 1: exportOf(3, offA), 2: exportOf(4, offB) });
        expectSlot(page, '1', 1, OWNED[offA], 3, `${path_} A off ${offA}`);
        expectSlot(page, '2', 2, OWNED[offB], 4, `${path_} B off ${offB}`);
        // Slots 3-5 were not imported: they stay as they were.
        for (const s of ['3', '4', '5']) assert.equal(page.ctx.playerDataMap[s], EMPTY_JSON, `${path_}: slot ${s} changed`);
        checks++;
    }
}

// 2. Every kind switched off by both players at once (a single kind each time, the same kind): same rule.
for (const path_ of ['boxes', 'all']) {
    for (const off of toggles) {
        const page = runParty(path_, priors(), { 1: exportOf(3, off), 2: exportOf(4, off) });
        expectSlot(page, '1', 1, OWNED[off], 3, `${path_} both off ${off}`);
        expectSlot(page, '2', 2, OWNED[off], 4, `${path_} both off ${off}`);
        checks++;
    }
}

// 3. Each single skill level missing from a JSON (not the whole kind) keeps that slot's own prior level.
for (const path_ of ['boxes', 'all']) {
    for (const s of SKILLS) {
        const a = exportOf(3); delete a.player[s + 'Level'];
        const b = exportOf(4); delete b.player[s + 'Level'];
        const page = runParty(path_, priors(), { 1: a, 2: b });
        expectSlot(page, '1', 1, [s + 'Level'], 3, `${path_} A lacks ${s}Level`);
        expectSlot(page, '2', 2, [s + 'Level'], 4, `${path_} B lacks ${s}Level`);
        checks++;
    }
}

// 4. A slot that holds nothing for a kind (no entry, or an empty one) gets the empty player's default for it; the other kinds import.
for (const path_ of ['boxes', 'all']) {
    for (const holds of [undefined, '{}']) {
        for (const off of toggles) {
            const map = { ...priors() };
            if (holds === undefined) delete map[1]; else map[1] = holds;
            const page = runParty(path_, map, { 1: exportOf(3, off) });
            const j = slotJson(page, '1');
            for (const [name, k] of Object.entries(KIND)) {
                const want = OWNED[off].includes(name) ? k.get(EMPTY) : k.get(exportOf(3));
                assert.deepEqual(plain(k.get(j)), plain(want), `${path_} empty slot (${holds}) off ${off}: ${name}`);
            }
            checks++;
        }
    }
}

// 5. A legacy powerLevel with no meleeLevel becomes the melee level, over the slot's prior melee level.
for (const path_ of ['boxes', 'all']) {
    const a = exportOf(3); a.player.powerLevel = 77; delete a.player.meleeLevel;
    const page = runParty(path_, priors(), { 1: a });
    assert.equal(slotJson(page, '1').player.meleeLevel, 77, `${path_}: powerLevel`);
    checks++;
}

// 6. The current tab's slot is saved from the screen first, so the screen's edits count as the slot's prior value. Here the screen
// edit is seed 5's; a kind missing from slot 1's import keeps seed 5's value, and the other slot is untouched by the screen.
for (const path_ of ['boxes', 'all']) {
    const page = runParty(path_, priors(), { 1: exportOf(3, 'gear'), 2: exportOf(4, 'gear') }, { screenSave: JSON.stringify(exportOf(5)) });
    assert.deepEqual(page.ctx.saved, ['1'], `${path_}: current tab saved first`);
    assert.deepEqual(plain(slotJson(page, '1').player.equipment), plain(exportOf(5).player.equipment), `${path_}: screen edit lost`);
    assert.deepEqual(plain(slotJson(page, '2').player.equipment), plain(exportOf(2).player.equipment), `${path_}: slot 2 got another player's gear`);
    checks++;
}

// 7. The all-in-one box with a slot absent keeps that slot (it used to be dropped).
{
    const page = runParty('all', priors(), { 1: exportOf(3) });
    assert.equal(page.ctx.playerDataMap['2'], priors()[2], 'all: absent slot 2 not kept');
    checks++;
}

console.log(`PASS: ${checks} checks (party import src/main.js mergePlayerImport/doGroupImport/updateNextPlayer: ${toggles.length} kinds off, both paths; single skill levels; empty slot; powerLevel; screen save; absent slot)`);
