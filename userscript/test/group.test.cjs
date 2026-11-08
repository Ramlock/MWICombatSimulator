// Node test for the group export of userscript/mwics-exporter.user.js (buildGroupExport, trimBattle, trimProfile), synthetic data only.
// Run: node userscript/test/group.test.cjs
const assert = require('node:assert/strict');
const { buildGroupExport, trimBattle, trimProfile, buildExport, groupNotice } = require('../mwics-exporter.user.js');

const COMBAT = '/action_types/combat';
const client = {
    abilityDetailMap: { '/abilities/aura_a': { isSpecialAbility: true }, '/abilities/x': {}, '/abilities/y': {}, '/abilities/z': {} },
    itemDetailMap: { '/items/tonic_one': { categoryHrid: '/item_categories/drink' }, '/items/snack_one': { categoryHrid: '/item_categories/food' } },
};
const self = {
    type: 'init_character_data', character: { id: 10, name: 'SelfName' },
    characterSkills: [{ skillHrid: '/skills/attack', level: 50 }, { skillHrid: '/skills/stamina', level: 60 }],
    characterItems: [{ itemLocationHrid: '/item_locations/head', itemHrid: '/items/hat', enhancementLevel: 2 }, { itemLocationHrid: '/item_locations/inventory', itemHrid: '/items/junk', count: 5 }],
    actionTypeFoodSlotsMap: { [COMBAT]: [{ itemHrid: '/items/snack_one' }] }, actionTypeDrinkSlotsMap: { [COMBAT]: [{ itemHrid: '/items/tonic_one' }] },
    combatUnit: { combatAbilities: [{ abilityHrid: '/abilities/x', level: 5 }, { abilityHrid: '/abilities/aura_a', level: 7 }] },
    abilityCombatTriggersMap: { '/abilities/x': [{ t: 1 }] }, consumableCombatTriggersMap: { '/items/snack_one': [{ t: 2 }] },
    characterHouseRoomMap: { a: { houseRoomHrid: '/house_rooms/dojo', level: 3 } },
    characterAchievements: [{ achievementHrid: '/achievements/one', isCompleted: true }],
    characterAbilities: [{ abilityHrid: '/abilities/x', level: 5, experience: 9 }],
};
const unitOf = (id, name, abilities, consumables) => ({ isPlayer: true, character: { id, name }, name, combatAbilities: abilities.map((a) => ({ abilityHrid: a[0], level: a[1] })), combatConsumables: consumables.map((h) => ({ itemHrid: h, count: 3 })) });
const battle = { type: 'new_battle', players: [
    unitOf(11, 'Bravo', [['/abilities/y', 40], ['/abilities/aura_a', 30]], ['/items/snack_one', '/items/tonic_one']),
    unitOf(10, 'SelfName', [['/abilities/x', 5]], ['/items/snack_one']),
    unitOf(12, 'Charlie', [['/abilities/z', 20]], ['/items/zeta_coffee']),
] };
const profileMsg = (id, name) => ({ type: 'profile_shared', profile: {
    sharableCharacter: { id, name },
    characterSkills: [{ characterID: id, skillHrid: '/skills/attack', level: 70 }, { characterID: id, skillHrid: '/skills/magic', level: 12 }, { characterID: id, skillHrid: '/skills/woodcutting', level: 99 }],
    wearableItemMap: { a: { itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/blade', enhancementLevel: 4 }, b: { itemLocationHrid: '/item_locations/woodcutting_tool', itemHrid: '/items/axe', enhancementLevel: 1 } },
    equippedAbilities: [{ abilityHrid: '/abilities/y', level: 41 }],
    abilityCombatTriggersMap: { '/abilities/y': [{ t: 3 }] }, consumableCombatTriggersMap: { '/items/tonic_one': [{ t: 4 }] },
    characterHouseRoomMap: { a: { houseRoomHrid: '/house_rooms/gym', level: 6 } },
    characterAchievements: [{ achievementHrid: '/achievements/two', isCompleted: false }],
} });

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }
const ctx = (extra) => ({ characterObj: self, clientObj: client, toggles: {}, members: trimBattle(battle), profiles: [], ...extra });

test('slots follow the battle order, self is built like the character export without inventory, coin and learned abilities', () => {
    const r = buildGroupExport(ctx());
    assert.deepEqual(r.slots.map((s) => [s.slot, s.name, s.self]), [[1, 'Bravo', false], [2, 'SelfName', true], [3, 'Charlie', false]]);
    assert.deepEqual(Object.keys(r.group), ['1', '2', '3']);
    const own = r.group['2'], ref = buildExport(self, client, { learnedAbilities: false, inventory: false, coin: false });
    assert.deepEqual(own, ref);
    assert.ok(!('inventory' in own) && !('coin' in own) && !('learnedAbilities' in own));
    assert.deepEqual(r.slots[1].missing, []);
});

test('another player: abilities, food and drinks from the battle; nothing else is invented', () => {
    const r = buildGroupExport(ctx());
    const o = r.group['1'];
    assert.deepEqual(o.abilities.map((a) => a.abilityHrid), ['/abilities/aura_a', '/abilities/y', '', '', '']);
    assert.equal(o.abilities[1].level, 40);
    assert.deepEqual(o.food[COMBAT], [{ itemHrid: '/items/snack_one' }, { itemHrid: '' }, { itemHrid: '' }]);
    assert.deepEqual(o.drinks[COMBAT], [{ itemHrid: '/items/tonic_one' }, { itemHrid: '' }, { itemHrid: '' }]);
    for (const k of ['player', 'triggerMap', 'houseRooms', 'achievements', 'guildCombatBuffLevels']) assert.ok(!(k in o), k + ' must stay unknown');
    assert.deepEqual(r.slots[0].have, ['equippedAbilities', 'consumables']);
    assert.deepEqual(r.slots[0].missing, ['skillLevels', 'gear', 'triggers', 'houseRooms', 'achievements', 'guildBuffs']);
});

test('a drink without item data is told by its name; food is the rest', () => {
    const o = buildGroupExport(ctx()).group['3'];
    assert.deepEqual(o.drinks[COMBAT][0], { itemHrid: '/items/zeta_coffee' });
    assert.deepEqual(o.food[COMBAT].map((x) => x.itemHrid), ['', '', '']);
});

test('a shared profile fills levels, gear, triggers, house rooms and achievements (combat parts only)', () => {
    const p = trimProfile(profileMsg(11, 'Bravo'));
    assert.deepEqual(p.skills, { attack: 70, magic: 12 });
    assert.deepEqual(p.equipment, [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/blade', enhancementLevel: 4 }]);
    const r = buildGroupExport(ctx({ profiles: [p] }));
    const o = r.group['1'];
    assert.deepEqual(o.player, { attackLevel: 70, magicLevel: 12, equipment: p.equipment });
    assert.deepEqual(o.triggerMap, { '/abilities/y': [{ t: 3 }], '/items/tonic_one': [{ t: 4 }] });
    assert.deepEqual(o.houseRooms, { '/house_rooms/gym': 6 });
    assert.deepEqual(o.achievements, { '/achievements/two': false });
    assert.deepEqual(r.slots[0].missing, ['guildBuffs']);
    assert.ok(!('guildCombatBuffLevels' in o));
    assert.deepEqual(r.slots[2].missing.includes('gear'), true, 'a member without a profile still misses gear');
});

test('a profile is matched by id, or by name when ids differ', () => {
    const byName = { ...trimProfile(profileMsg(99, 'Bravo')) };
    assert.equal(buildGroupExport(ctx({ profiles: [byName] })).group['1'].player.attackLevel, 70);
    const other = trimProfile(profileMsg(77, 'Nobody'));
    assert.ok(!('player' in buildGroupExport(ctx({ profiles: [other] })).group['1']));
});

test('switched-off kinds are neither built nor reported missing', () => {
    const r = buildGroupExport(ctx({ profiles: [trimProfile(profileMsg(11, 'Bravo'))], toggles: { gear: false, houseRooms: false, achievements: false, guildBuffs: false, consumables: false } }));
    const o = r.group['1'];
    assert.deepEqual(o.player, { attackLevel: 70, magicLevel: 12 });
    assert.ok(!('houseRooms' in o) && !('food' in o) && !('achievements' in o));
    assert.deepEqual(r.slots[0].missing, []);
    assert.ok(!('equipment' in r.group['2'].player));
});

test('solo play (no battle yet) gives the player alone in slot 1; no data at all gives nothing', () => {
    const r = buildGroupExport(ctx({ members: [] }));
    assert.deepEqual(Object.keys(r.group), ['1']);
    assert.equal(r.slots[0].self, true);
    assert.equal(buildGroupExport({ characterObj: null, clientObj: client, members: [], profiles: [] }), null);
    assert.equal(buildGroupExport({ characterObj: null, clientObj: client, members: trimBattle({ players: [] }), profiles: [] }), null);
});

test('the party list of the character data is the fallback for slot order', () => {
    const co = { ...self, partyInfo: { partySlotMap: { 1: { characterID: 12 }, 2: { characterID: 10 } } } };
    const r = buildGroupExport(ctx({ characterObj: co, members: [] }));
    assert.deepEqual(r.slots.map((s) => [s.slot, s.self]), [[2, true]], 'a member nothing is known about is left out, never emptied');
});

test('self missing from a stale battle is added in the first free slot', () => {
    const stale = { players: [battle.players[0], battle.players[2]] };
    const r = buildGroupExport(ctx({ members: trimBattle(stale) }));
    assert.deepEqual(r.slots.map((s) => [s.slot, s.self]), [[1, false], [2, false], [3, true]]);
});

test('trimProfile and trimBattle drop everything the import does not read', () => {
    assert.equal(trimProfile({ type: 'profile_shared' }), null);
    assert.equal(trimProfile({ profile: { characterSkills: [] } }), null);
    const t = trimBattle({ players: [{ ...battle.players[0], totalLootMap: { a: 1 }, combatDetails: { x: 1 } }] });
    assert.deepEqual(Object.keys(t[0]), ['id', 'name', 'abilities', 'consumables']);
});

test("guild buffs: the teammate's own levels from an opened profile; nothing without one", () => {
    const pm = profileMsg(11, 'Bravo'); pm.profile.guildId = 7; pm.profile.guildBuffLevelMap = { '/guild_buffs/force_combat': 2 };
    const tp = trimProfile(pm);
    assert.equal(tp.guildId, 7); assert.deepEqual(tp.guildBuffLevelMap, { '/guild_buffs/force_combat': 2 });
    const r = buildGroupExport(ctx({ profiles: [tp] }));
    assert.equal(r.group['1'].guildCombatBuffLevels.force, 2); assert.equal(r.group['1'].guildCombatBuffLevels.tempo, 0);
    assert.equal(r.slots[0].guild, 'profile'); assert.ok(!r.slots[0].missing.includes('guildBuffs'));
    assert.ok(!('guildCombatBuffLevels' in r.group['3'])); assert.ok(r.slots[2].missing.includes('guildBuffs')); assert.equal(r.slots[2].guild, undefined);
    const old = trimProfile(profileMsg(11, 'Bravo'));
    assert.ok(buildGroupExport(ctx({ profiles: [old] })).slots[0].missing.includes('guildBuffs'), 'a profile without the map (cached before 0.7.0) still misses guild buffs');
});

test('the notice names the teammates whose guild buffs came from their profile, and sends the rest to the profile', () => {
    const what = 'party imported from the game tab (0 min old)', again = ', then press this button again';
    const g = groupNotice(what, [{ slot: 1, self: false, missing: [], guild: 'profile' }, { slot: 2, self: true, missing: [] }, { slot: 3, self: false, missing: ['skillLevels', 'gear', 'triggers', 'houseRooms', 'achievements', 'guildBuffs'] }], again);
    assert.equal(g.text, "MWI Combat Tracker: party imported from the game tab (0 min old) (3 players). slot 1: complete (guild buffs from their profile); slot 2 (you): complete; slot 3: missing levels, gear, triggers, house rooms, achievements, guild buffs. Open each member's profile in the game for levels, gear, triggers, house rooms, achievements and guild buffs, then press this button again. What is missing keeps its value in the simulator.");
    const m = groupNotice(what, [{ slot: 1, self: false, missing: ['guildBuffs'] }, { slot: 2, self: true, missing: [] }], again);
    assert.equal(m.text, "MWI Combat Tracker: party imported from the game tab (0 min old) (2 players). slot 1: missing guild buffs; slot 2 (you): complete. Open each member's profile in the game for guild buffs, then press this button again. What is missing keeps its value in the simulator.");
    assert.equal(groupNotice('group copied', [{ slot: 1, self: true, missing: [] }], ', then copy again').text, 'MWI Combat Tracker: group copied (1 players). slot 1 (you): complete.');
});

console.log(n + ' tests passed');
