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
    wearableItemMap: { a: { itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/blade', enhancementLevel: 4 }, b: { itemLocationHrid: '/item_locations/woodcutting_tool', itemHrid: '/items/axe', enhancementLevel: 1 }, c: { itemLocationHrid: '/item_locations/trinket', itemHrid: '/items/badge_one', enhancementLevel: 0 } },
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

test('the character export (and so your own group slot) keeps the trinket slot', () => {
    const me = { ...self, characterItems: [...self.characterItems, { itemLocationHrid: '/item_locations/trinket', itemHrid: '/items/badge_one', enhancementLevel: 3 }] };
    const o = buildGroupExport(ctx({ characterObj: me })).group['2'];
    assert.ok(o.player.equipment.some((e) => e.itemLocationHrid === '/item_locations/trinket' && e.itemHrid === '/items/badge_one' && e.enhancementLevel === 3));
});

test('a drink without item data is told by its name; food is the rest', () => {
    const o = buildGroupExport(ctx()).group['3'];
    assert.deepEqual(o.drinks[COMBAT][0], { itemHrid: '/items/zeta_coffee' });
    assert.deepEqual(o.food[COMBAT].map((x) => x.itemHrid), ['', '', '']);
});

test('a shared profile fills levels, gear, triggers, house rooms and achievements (combat parts only)', () => {
    const p = trimProfile(profileMsg(11, 'Bravo'));
    assert.deepEqual(p.skills, { attack: 70, magic: 12 });
    assert.deepEqual(p.equipment, [{ itemLocationHrid: '/item_locations/main_hand', itemHrid: '/items/blade', enhancementLevel: 4 }, { itemLocationHrid: '/item_locations/trinket', itemHrid: '/items/badge_one', enhancementLevel: 0 }], 'the trinket slot (task badge) is kept, the skilling tool is not');
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

// ---- the fight (zone, tier) and who to tick ----
const { currentFight, applyActionsUpdate, checkGroupSnapshot, applySelectionDom } = require('../mwics-exporter.user.js');
const cdm = { actionDetailMap: { '/actions/combat/zone_a': { category: '/action_categories/combat/zones' }, '/actions/combat/dun_a': { category: '/action_categories/combat/dungeons' } } };
const act = (o) => ({ id: 1, partyID: 0, ordinal: 0, isDone: false, ...o });
const J = (x) => JSON.parse(JSON.stringify(x));

test('currentFight: a battling party names the fight; otherwise the first action; idle and the Labyrinth have no zone or tier', () => {
    const party = { status: 'battling', actionHrid: '/actions/combat/zone_a', difficultyTier: 3 };
    assert.deepEqual(J(currentFight({ actions: [act({ actionHrid: '/actions/combat/dun_a', difficultyTier: 1 })], partyInfo: { party }, clientObj: cdm, now: 5 })), { zone: '/actions/combat/zone_a', tier: 3, kind: 'combat', status: 'battling', source: 'party', t: 5 });
    assert.deepEqual(J(currentFight({ actions: [act({ actionHrid: '/actions/combat/dun_a', difficultyTier: 1 })], partyInfo: null, clientObj: cdm, now: 5 })), { zone: '/actions/combat/dun_a', tier: 1, kind: 'dungeon', status: null, source: 'action', t: 5 });
    assert.equal(currentFight({ actions: [], partyInfo: { party: { status: 'recruiting', actionHrid: '/actions/combat/zone_a' } }, clientObj: cdm, now: 5 }).kind, 'idle');
    assert.deepEqual(J(currentFight({ actions: [act({ actionHrid: '/actions/labyrinth/explore' })], now: 5 })), { zone: null, tier: null, kind: 'labyrinth', status: null, source: 'action', t: 5 });
    assert.equal(currentFight({ now: 5 }), null, 'nothing known: no fight');
    assert.equal(currentFight({ actions: [act({ actionHrid: '/actions/combat/zone_a' })], now: 5 }).tier, null, 'a missing tier stays unknown');
});

test('applyActionsUpdate follows the game: done leaves, a known id is replaced, a new one is added, party actions sort first', () => {
    const a = [act({ id: 1, actionHrid: 'x', ordinal: 1 })];
    const b = applyActionsUpdate(a, [act({ id: 2, actionHrid: 'y', partyID: 9, ordinal: 2 })]);
    assert.deepEqual(b.map((x) => x.id), [2, 1]);
    assert.deepEqual(applyActionsUpdate(b, [act({ id: 2, isDone: true })]).map((x) => x.id), [1]);
    assert.equal(applyActionsUpdate(null, [act({ id: 3 })]).length, 1);
    assert.equal(a.length, 1, 'the input list is not changed');
});

test('checkGroupSnapshot passes selected and fight when present and valid; an older snapshot gives neither', () => {
    const base = { t: 1000, group: { 1: {} }, slots: [] };
    const old = checkGroupSnapshot(JSON.stringify(base), 1000);
    assert.ok(old.ok && !('selected' in old) && !('fight' in old));
    const neu = checkGroupSnapshot(JSON.stringify({ ...base, selected: [1, 3, 9, 'x'], fight: { zone: 'z', tier: 2, kind: 'combat' } }), 1000);
    assert.deepEqual(J(neu.selected), [1, 3]);
    assert.equal(neu.fight.zone, 'z');
    const bad = checkGroupSnapshot(JSON.stringify({ ...base, selected: 'all', fight: [1] }), 1000);
    assert.ok(bad.ok && !('selected' in bad) && !('fight' in bad));
});

// A fake page: selects with options, checkboxes, the dungeon toggle (its change handler ticks all and limits the tiers, like the page's).
function fakePage() {
    const sel = (vals, extra) => ({ value: vals[0], options: vals.map((v, i) => ({ value: v, disabled: !!(extra && extra.disabled && extra.disabled.includes(v)) })) });
    const els = { selectZone: sel(['/actions/combat/zone_a', '/actions/combat/zone_b']), selectDungeon: sel(['/actions/combat/dun_a']), selectDifficulty: sel(['0', '1', '2', '3', '4']) };
    for (let i = 1; i <= 5; i++) els['player' + i] = { checked: false };
    els.simDungeonToggle = { checked: false, events: 0, dispatchEvent() { this.events++; for (let i = 1; i <= 5; i++) els['player' + i].checked = this.checked; els.selectDifficulty.options.forEach((o, i) => { o.disabled = this.checked && i >= 3; }); } };
    return { getElementById: (id) => els[id] || null, els };
}
const ticks = (p) => [1, 2, 3, 4, 5].filter((i) => p.els['player' + i].checked);

test('applySelectionDom: a three-player group ticks three boxes, sets zone and tier; the others are unticked', () => {
    const p = fakePage();
    p.els.player5.checked = true;
    const r = applySelectionDom(p, { selected: [1, 2, 3], fight: { zone: '/actions/combat/zone_b', tier: 2, kind: 'combat' } });
    assert.deepEqual(ticks(p), [1, 2, 3]);
    assert.equal(p.els.selectZone.value, '/actions/combat/zone_b');
    assert.equal(p.els.selectDifficulty.value, '2');
    assert.deepEqual(J(r), { ticked: [1, 2, 3], dungeon: false, zone: '/actions/combat/zone_b', tier: 2, skipped: [] });
    assert.equal(p.els.simDungeonToggle.events, 0, 'the toggle is left alone when it already matches');
});

test('applySelectionDom: a dungeon turns the toggle on first, then ticks, zone from the dungeon list, tier', () => {
    const p = fakePage();
    const r = applySelectionDom(p, { selected: [1, 2], fight: { zone: '/actions/combat/dun_a', tier: 1, kind: 'dungeon' } });
    assert.equal(p.els.simDungeonToggle.checked, true);
    assert.deepEqual(ticks(p), [1, 2], 'the toggle ticked all five, then the selection unticked the rest');
    assert.equal(p.els.selectDungeon.value, '/actions/combat/dun_a');
    assert.equal(r.tier, 1);
    const q = fakePage();
    applySelectionDom(q, { fight: { zone: '/actions/combat/dun_a', tier: 4, kind: 'dungeon' } });
    assert.equal(q.els.selectDifficulty.value, '0', 'a tier the dungeon mode does not offer is left as it is');
});

test('applySelectionDom: only one key, neither key, or a zone the page lacks', () => {
    const p = fakePage();
    assert.deepEqual(J(applySelectionDom(p, { selected: [4] })).ticked, [4]);
    assert.equal(p.els.selectZone.value, '/actions/combat/zone_a');
    const q = fakePage();
    applySelectionDom(q, { fight: { zone: '/actions/combat/zone_b', tier: 3, kind: 'combat' } });
    assert.deepEqual(ticks(q), [], 'no selected: the ticks are not touched');
    assert.equal(q.els.selectDifficulty.value, '3');
    const n0 = fakePage();
    assert.deepEqual(J(applySelectionDom(n0, {})), { ticked: null, dungeon: null, zone: null, tier: null, skipped: [] });
    const lack = fakePage();
    const r = applySelectionDom(lack, { selected: [1], fight: { zone: '/actions/combat/new_zone', tier: 9, kind: 'combat' } });
    assert.deepEqual(r.skipped, ['zone /actions/combat/new_zone', 'tier 9']);
    assert.deepEqual(ticks(lack), [1], 'the rest of the import still applies');
    assert.equal(lack.els.selectZone.value, '/actions/combat/zone_a');
    const idle = fakePage();
    applySelectionDom(idle, { selected: [1], fight: { zone: null, tier: null, kind: 'idle' } });
    assert.equal(idle.els.selectDifficulty.value, '0');
});

test('groupWithSelection: the slots plus selected and fight beside them, never inside a slot; no fight, no key', () => {
    const { groupWithSelection } = require('../mwics-exporter.user.js');
    const r = { group: { 1: { name: 'A' }, 3: { name: 'C' } }, slots: [{ slot: 1 }, { slot: 3 }] };
    const fight = { zone: '/actions/combat/zone_a', tier: 2, kind: 'combat', status: 'battling', source: 'party', t: 1 };
    const w = J(groupWithSelection(r, fight));
    assert.deepEqual(Object.keys(w), ['1', '3', 'selected', 'fight']);
    assert.deepEqual(w.selected, [1, 3]);
    assert.deepEqual(Object.keys(w['1']), ['name'], 'a slot is untouched');
    assert.deepEqual(Object.keys(J(groupWithSelection(r, null))), ['1', '3', 'selected']);
    assert.equal(groupWithSelection(null, fight), null);
    assert.deepEqual(Object.keys(r.group), ['1', '3'], 'the input group is not changed');
});

console.log(n + ' tests passed');
