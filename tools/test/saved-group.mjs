// Test: the imported group kept in the browser's storage (src/savedGroup.mjs): what is kept, what is ignored on load, storage that is
// full or disabled, and that a new keep replaces the old one. Pure module, a stand-in storage. Generic made-up data.
// Usage: node tools/test/saved-group.mjs   Exit code 0 on pass, 1 on fail.
import { KEPT_GROUP_KEY, KEPT_GROUP_VERSION, usableSlot, encodeGroup, decodeGroup, keepGroup, loadKeptGroup } from '../../src/savedGroup.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const combat = (list) => ({ '/action_types/combat': list });
const slot = (extra = {}) => JSON.stringify({
    player: { attackLevel: 5, magicLevel: 1, meleeLevel: 1, rangedLevel: 1, defenseLevel: 1, staminaLevel: 1, intelligenceLevel: 1, equipment: [] },
    food: combat([{ itemHrid: '' }]), drinks: combat([{ itemHrid: '' }]), abilities: [{ abilityHrid: '', level: '1' }], triggerMap: {}, houseRooms: {}, achievements: {},
    ...extra,
});
const store = (initial = {}) => { const m = new Map(Object.entries(initial)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const group = { 1: slot({ name: 'Aaa' }), 2: slot({ name: 'Bbb' }), 3: slot() };

// A slot the page can load.
check('a full slot is usable', usableSlot(slot({ name: 'Aaa' })));
check('a slot with no name is usable', usableSlot(slot()));
check('a slot needs a string of JSON', !usableSlot({ player: {} }) && !usableSlot(null) && !usableSlot(undefined) && !usableSlot(5));
check('a slot that is not JSON is not usable', !usableSlot('{nope'));
check('a slot that is JSON of a non-object is not usable', !usableSlot('[]') && !usableSlot('null') && !usableSlot('"x"'));
check('a slot with no player is not usable', !usableSlot(JSON.stringify({ food: combat([]), drinks: combat([]), abilities: [] })));
check('a slot whose gear is not a list is not usable', !usableSlot(slot({ player: { equipment: {} } })));
check('a slot with no combat food is not usable', !usableSlot(slot({ food: {} })));
check('a slot with no combat drinks is not usable', !usableSlot(slot({ drinks: [] })));
check('a slot whose abilities are not a list is not usable', !usableSlot(slot({ abilities: {} })));
check('a slot whose triggers are not an object is not usable', !usableSlot(slot({ triggerMap: [] })));
check('a slot whose house rooms are not an object is not usable', !usableSlot(slot({ houseRooms: 3 })));
check('a slot whose name is not text is not usable', !usableSlot(slot({ name: 7 })));

// Encode, decode.
const text = encodeGroup(group);
check('a group encodes to text', typeof text === 'string' && JSON.parse(text).v === KEPT_GROUP_VERSION);
check('the text holds the slots as they were', same(decodeGroup(text), group));
check('only the five slot ids are kept; an unusable slot is left out', same(Object.keys(JSON.parse(encodeGroup({ ...group, 6: slot(), 4: '{bad' })).slots), ['1', '2', '3']));
check('nothing usable encodes to null', encodeGroup({ 1: '{bad' }) === null && encodeGroup({}) === null && encodeGroup(null) === null && encodeGroup(undefined) === null);

// Decode refuses what the page does not write.
check('not JSON decodes to null', decodeGroup('{nope') === null);
check('empty, absent and non-text decode to null', decodeGroup('') === null && decodeGroup(null) === null && decodeGroup(undefined) === null && decodeGroup(5) === null);
check('JSON of another shape decodes to null', decodeGroup('[]') === null && decodeGroup('"x"') === null && decodeGroup('null') === null && decodeGroup('{}') === null);
check('an older or newer version decodes to null', decodeGroup(JSON.stringify({ v: 0, slots: group })) === null && decodeGroup(JSON.stringify({ v: 2, slots: group })) === null);
check('a group with no version decodes to null (the shape before this one)', decodeGroup(JSON.stringify(group)) === null);
check('no slots decodes to null', decodeGroup(JSON.stringify({ v: 1, slots: {} })) === null && decodeGroup(JSON.stringify({ v: 1 })) === null);
check('an unknown slot id decodes to null', decodeGroup(JSON.stringify({ v: 1, slots: { ...group, 9: slot() } })) === null);
check('one bad slot decodes the whole value to null', decodeGroup(JSON.stringify({ v: 1, slots: { ...group, 2: '{bad' } })) === null);

// Keep and load through a storage.
const s = store();
check('nothing kept loads null', loadKeptGroup(s) === null);
check('keeping a group reports true', keepGroup(s, group) === true);
check('the group sits under one key', same([...s.m.keys()], [KEPT_GROUP_KEY]));
check('the kept group loads as it was', same(loadKeptGroup(s), group));
const newer = { 1: slot({ name: 'Zzz' }) };
keepGroup(s, newer);
check('a new keep replaces the group kept before', same(loadKeptGroup(s), newer));
check('a keep with nothing usable changes nothing and reports false', keepGroup(s, { 1: '{bad' }) === false && same(loadKeptGroup(s), newer));

// A bad kept value is ignored.
check('a kept value that is not JSON loads null', loadKeptGroup(store({ [KEPT_GROUP_KEY]: '{nope' })) === null);
check('a kept value of an older shape loads null', loadKeptGroup(store({ [KEPT_GROUP_KEY]: JSON.stringify(group) })) === null);

// Storage that is full, disabled or absent.
const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
check('storage that is full: keep reports false, throws nothing', keepGroup(full, group) === false);
const off = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
check('storage that refuses: keep reports false, load gives null, nothing thrown', keepGroup(off, group) === false && loadKeptGroup(off) === null);
check('no storage at all: keep reports false, load gives null', keepGroup(null, group) === false && loadKeptGroup(null) === null && keepGroup(undefined, group) === false && loadKeptGroup(undefined) === null);

console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
