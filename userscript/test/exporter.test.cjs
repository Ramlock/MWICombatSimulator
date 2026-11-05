// Node test for userscript/mwics-exporter.user.js on a made-up init_character_data fixture (no real player's data).
// Run: node userscript/test/exporter.test.cjs
// Checks: all toggles on gives all ten kinds; each toggle off drops only its kind; the setup part goes through the sim's own
// solo import (doSoloImport in src/main.js, extracted from the source text and run against a stub document) unchanged.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'userscript', 'mwics-exporter.user.js'), 'utf8'), { module: mod, console });
const { KINDS } = mod.exports;
// The script runs in its own realm; a JSON round trip gives plain objects of this realm for deepEqual.
const buildExport = (...a) => JSON.parse(JSON.stringify(mod.exports.buildExport(...a)));

const fixture = {
    type: 'init_character_data',
    character: { name: 'TestCow' },
    characterSkills: [
        { skillHrid: '/skills/stamina', level: 90, experience: 1000 },
        { skillHrid: '/skills/intelligence', level: 91, experience: 1000 },
        { skillHrid: '/skills/attack', level: 92, experience: 1000 },
        { skillHrid: '/skills/melee', level: 93, experience: 1000 },
        { skillHrid: '/skills/defense', level: 94, experience: 1000 },
        { skillHrid: '/skills/ranged', level: 95, experience: 1000 },
        { skillHrid: '/skills/magic', level: 96, experience: 1000 },
        { skillHrid: '/skills/milking', level: 50, experience: 1000 },
    ],
    characterItems: [
        { itemLocationHrid: '/item_locations/head', itemHrid: '/items/acrobatic_hood', enhancementLevel: 7, count: 1, hash: 'a' },
        { itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/cheese_sword', enhancementLevel: 3, count: 1, hash: 'b' },
        { itemLocationHrid: '/item_locations/inventory', itemHrid: '/items/coin', enhancementLevel: 0, count: 123456789, hash: 'c' },
        { itemLocationHrid: '/item_locations/inventory', itemHrid: '/items/spaceberry_cake', enhancementLevel: 0, count: 500, hash: 'd' },
        { itemLocationHrid: '/item_locations/inventory', itemHrid: '/items/acrobatic_hood', enhancementLevel: 5, count: 1, hash: 'e' },
    ],
    actionTypeFoodSlotsMap: { '/action_types/combat': [{ itemHrid: '/items/spaceberry_cake' }, null, null] },
    actionTypeDrinkSlotsMap: { '/action_types/combat': [{ itemHrid: '/items/lucky_coffee' }, null, null] },
    combatUnit: { combatAbilities: [{ abilityHrid: '/abilities/mystic_aura', level: 16 }, { abilityHrid: '/abilities/entangle', level: 20 }] },
    characterAbilities: [
        { abilityHrid: '/abilities/mystic_aura', level: 16, experience: 4000 },
        { abilityHrid: '/abilities/entangle', level: 20, experience: 9000 },
        { abilityHrid: '/abilities/poke', level: 5, experience: 100 },
    ],
    abilityCombatTriggersMap: { '/abilities/entangle': [{ dependencyHrid: '/combat_trigger_dependencies/targeted_enemy', conditionHrid: '/combat_trigger_conditions/stun_status', comparatorHrid: '/combat_trigger_comparators/is_inactive', value: 0 }] },
    consumableCombatTriggersMap: { '/items/spaceberry_cake': [{ dependencyHrid: '/combat_trigger_dependencies/self', conditionHrid: '/combat_trigger_conditions/missing_hp', comparatorHrid: '/combat_trigger_comparators/greater_than_equal', value: 500 }] },
    characterHouseRoomMap: { '/house_rooms/dojo': { houseRoomHrid: '/house_rooms/dojo', level: 4 } },
    characterAchievements: [{ achievementHrid: '/achievements/defeat_shoebill', isCompleted: true }, { achievementHrid: '/achievements/total_level_250', isCompleted: false }],
    characterGuildBuffMap: { '/guild_buffs/force_combat': { level: 3 }, '/guild_buffs/tempo_combat': { level: 5 } },
    guildBuildingLevelMap: { '/guild_shrines/force': 4, '/guild_shrines/tempo': 2 },
};

// Which top-level keys (and player sub-keys) each kind owns.
const OWNS = {
    gear: ['player.equipment'],
    equippedAbilities: ['abilities', 'triggerMap./abilities/entangle'],
    consumables: ['food', 'drinks', 'triggerMap./items/spaceberry_cake'],
    houseRooms: ['houseRooms'],
    achievements: ['achievements'],
    guildBuffs: ['guildCombatBuffLevels'],
    skillLevels: ['player.attackLevel'],
    learnedAbilities: ['learnedAbilities'],
    inventory: ['inventory'],
    coin: ['coin'],
};
const has = (obj, p) => { let o = obj; for (const k of p.split('.')) { if (o == null || !(k in o)) return false; o = o[k]; } return true; };

// 1. All on: every kind present, values right.
const all = buildExport(fixture, null, {});
for (const k of KINDS) for (const p of OWNS[k.key]) assert.ok(has(all, p), `all on: ${p} missing`);
assert.equal(all.coin, 123456789);
assert.deepEqual(all.inventory.map((i) => i.itemHrid), ['/items/spaceberry_cake', '/items/acrobatic_hood'], 'coin stays out of inventory');
assert.deepEqual(all.learnedAbilities[2], { abilityHrid: '/abilities/poke', level: 5, experience: 100 });
assert.deepEqual(all.guildCombatBuffLevels, { force: 3, tempo: 2, spirit: 0, rarity: 0, scholar: 0 });
assert.equal(all.abilities[0].abilityHrid, '/abilities/mystic_aura');
assert.equal(all.abilities[1].abilityHrid, '/abilities/entangle');
assert.equal(all.player.equipment.length, 2);
assert.equal(all.player.magicLevel, 96);
let checks = 1;

// 2. Each one off: only its kind goes.
for (const k of KINDS) {
    const out = buildExport(fixture, null, { [k.key]: false });
    for (const p of OWNS[k.key]) assert.ok(!has(out, p), `${k.key} off: ${p} still there`);
    for (const other of KINDS) if (other.key !== k.key) for (const p of OWNS[other.key]) assert.ok(has(out, p), `${k.key} off: ${p} (of ${other.key}) dropped`);
    checks++;
}

// 3. The setup part through the sim's own solo import (doSoloImport, extracted from src/main.js and run on a stub page).
// The stub page starts with PRIOR values everywhere, as if another character was loaded before.
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const start = mainSrc.indexOf('function doSoloImport()');
const end = mainSrc.indexOf('\nfunction savePreviousPlayer');
assert.ok(start > 0 && end > start, 'doSoloImport not found in src/main.js');
const PRIOR = 'PRIOR';
function runImport(exportObj) {
    const els = {};
    const el = (id) => (els[id] ||= { id, value: PRIOR, checked: PRIOR });
    const priorHouseRooms = { '/house_rooms/dojo': 9 };
    const ctx = {
        document: { getElementById: (id) => el(id), querySelector: (sel) => el(sel) },
        player: { houseRooms: priorHouseRooms, achievements: {} },
        houseRoomDetailMap: {}, achievementDetailMap: {},
        triggerMap: { '/abilities/prior_ability': ['prior'], '/items/prior_item': ['prior'] },
        fixTriggerMap: () => {}, applyLabyrinthUpgradesToState: () => {}, refreshAchievementStatics: () => {},
        guildSeen: undefined, guildApplied: 0,
    };
    ctx.getImportedGuildBuffs = (s) => { ctx.guildSeen = s.guildCombatBuffLevels; return {}; };
    ctx.applyGuildBuffsToState = () => { ctx.guildApplied++; };
    el('inputSetSolo').value = JSON.stringify(exportObj);
    vm.runInNewContext(mainSrc.slice(start, end) + '\ndoSoloImport();', ctx);
    return { els, ctx, priorHouseRooms };
}
// What each kind writes on the page, as [element id, imported value from the fixture]; a kind off must leave PRIOR there.
const WRITES = {
    skillLevels: [['inputLevel_magic', 96], ['inputLevel_stamina', 90]],
    gear: [['selectEquipment_head', '/items/acrobatic_hood'], ['inputEquipmentEnhancementLevel_head', 7], ['selectEquipment_weapon', '/items/cheese_sword']],
    consumables: [['selectFood_0', '/items/spaceberry_cake'], ['selectDrink_0', '/items/lucky_coffee'], ['selectFood_1', '']],
    equippedAbilities: [['selectAbility_0', '/abilities/mystic_aura'], ['inputAbilityLevel_1', '20']],
    houseRooms: [['[data-house-hrid="/house_rooms/dojo"]', 4]],
    achievements: [['[data-achievement-hrid="/achievements/defeat_shoebill"]', true, 'checked'], ['[data-achievement-hrid="/achievements/total_level_250"]', false, 'checked']],
    guildBuffs: [], learnedAbilities: [], inventory: [], coin: [],
};
const checkKind = (r, key, imported) => {
    for (const [id, value, prop = 'value'] of WRITES[key]) assert.equal(r.els[id]?.[prop] ?? PRIOR, imported ? value : PRIOR, `${key} ${imported ? 'on' : 'off'}: ${id}.${prop}`);
    const tm = r.ctx.triggerMap;
    if (key === 'equippedAbilities') {
        assert.equal(!!tm['/abilities/entangle'], imported, `${key}: imported ability trigger`);
        assert.equal(!!tm['/abilities/prior_ability'], !imported, `${key}: prior ability trigger`);
    }
    if (key === 'consumables') {
        assert.equal(!!tm['/items/spaceberry_cake'], imported, `${key}: imported consumable trigger`);
        assert.equal(!!tm['/items/prior_item'], !imported, `${key}: prior consumable trigger`);
    }
    if (key === 'houseRooms') assert.equal(r.ctx.player.houseRooms === r.priorHouseRooms, !imported, `${key}: player.houseRooms`);
    if (key === 'guildBuffs') {
        assert.equal(r.ctx.guildApplied, imported ? 1 : 0, `${key}: guild buffs applied`);
        if (imported) assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.guildSeen)), all.guildCombatBuffLevels);
    }
};
// All on: every kind imports as today.
{
    const r = runImport(all);
    for (const k of KINDS) checkKind(r, k.key, true);
    checks++;
}
// Each kind off: the import succeeds, that kind keeps its prior value, every other kind imports.
for (const k of KINDS) {
    const r = runImport(buildExport(fixture, null, { [k.key]: false }));
    for (const other of KINDS) checkKind(r, other.key, other.key !== k.key);
    checks++;
}
// A Toolasha-style export (no new keys, abilities with 5 slots) still imports whole.
{
    const { learnedAbilities, inventory, coin, ...toolashaShape } = all;
    const r = runImport(toolashaShape);
    for (const k of KINDS) checkKind(r, k.key, true);
    checks++;
}

console.log(`PASS: ${checks} checks (export: all on, ${KINDS.length} single toggles off; sim solo import src/main.js doSoloImport: all on, ${KINDS.length} single kinds missing, Toolasha shape)`);
