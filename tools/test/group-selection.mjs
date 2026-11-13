// Test: the group import's selection (src/groupSelection.mjs): a pasted group object may carry `selected` (slot numbers to tick) and `fight`
// ({ zone, tier, kind }) next to the slots. Generic fixtures, a fake page; the real page is covered by tools/test/group-selection-page.mjs.
// Usage: node tools/test/group-selection.mjs   Exit code 0 on pass, 1 on fail.
import { splitGroupImport, applyGroupSelection } from '../../src/groupSelection.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fakePage() {
    const sel = (vals) => ({ value: vals[0], options: vals.map((v) => ({ value: v, disabled: false })) });
    const els = { selectZone: sel(['/actions/combat/zone_a', '/actions/combat/zone_b']), selectDungeon: sel(['/actions/combat/dun_a']), selectDifficulty: sel(['0', '1', '2', '3', '4']) };
    for (let i = 1; i <= 5; i++) els['player' + i] = { checked: false };
    // The page's own change handler: ticks everyone and disables tiers 3 and up while the dungeon toggle is on.
    els.simDungeonToggle = { checked: false, events: 0, dispatchEvent() { this.events++; for (let i = 1; i <= 5; i++) els['player' + i].checked = this.checked; els.selectDifficulty.options.forEach((o, i) => { o.disabled = this.checked && i >= 3; }); } };
    return { getElementById: (id) => els[id] || null, els };
}
const ticks = (p) => [1, 2, 3, 4, 5].filter((i) => p.els['player' + i].checked);
const slot = { player: { attackLevel: 1 } };

// splitGroupImport
const both = splitGroupImport({ 1: slot, 2: slot, 3: slot, selected: [1, 2, 3], fight: { zone: '/actions/combat/zone_a', tier: 2, kind: 'combat' } });
check('split: the slot map holds the slots only', same(Object.keys(both.slots), ['1', '2', '3']));
check('split: selected and fight are taken out', same(both.selected, [1, 2, 3]) && both.fight.tier === 2);
const none = splitGroupImport({ 1: slot });
check('split: an older paste has neither', none.selected === null && none.fight === null && same(Object.keys(none.slots), ['1']));
const odd = splitGroupImport({ 1: slot, selected: [1, 1, 7, 'x', '2'], fight: [1] });
check('split: duplicates, out-of-range and junk are dropped; a non-object fight is ignored', same(odd.selected, [1, 2]) && odd.fight === null);
check('split: selected that is not a list is ignored', splitGroupImport({ selected: 'all' }).selected === null);

// The own character's export fields (userscript 0.9.3's snapshot) come out of the slot and into `exports`
const ownSlot = { name: 'Ayla', player: { attackLevel: 1 }, inventory: [{ itemHrid: '/items/x', enhancementLevel: 0, count: 2 }], learnedAbilities: [{ abilityHrid: '/abilities/y', level: 1, experience: 0 }] };
const own = splitGroupImport({ 1: ownSlot, 2: slot, selected: [1, 2] });
check('split: the export fields leave the slot (the rest of it untouched, in order) and come out per slot id with the name', same(own.slots['1'], { name: 'Ayla', player: { attackLevel: 1 } }) && same(Object.keys(own.exports), ['1']) && same(own.exports['1'], { name: 'Ayla', inventory: ownSlot.inventory, learnedAbilities: ownSlot.learnedAbilities }));
check('split: a slot without them is the same value and has no export', own.slots['2'] === slot && !('2' in own.exports) && same(own.selected, [1, 2]));
check('split: an older paste has no exports', same(none.exports, {}));
const ownText = splitGroupImport({ 1: JSON.stringify(ownSlot), 2: JSON.stringify(slot) });
check('split: a slot given as text is cut the same way; one without the fields stays the very same text', ownText.slots['1'] === JSON.stringify({ name: 'Ayla', player: { attackLevel: 1 } }) && ownText.slots['2'] === JSON.stringify(slot) && same(Object.keys(ownText.exports), ['1']));
const onlyAbil = splitGroupImport({ 1: { name: 'Ayla', learnedAbilities: [], inventory: 'junk' } });
check('split: one list is enough; a field that is not a list is dropped from the slot and kept nowhere', same(onlyAbil.exports['1'], { name: 'Ayla', learnedAbilities: [] }) && !('inventory' in onlyAbil.slots['1']));
check('split: a slot that is not an object passes through', splitGroupImport({ 1: 'not json' }).slots['1'] === 'not json' && same(splitGroupImport({ 1: null }).exports, {}));

// The userscript's Copy group output goes back through the page's paste
import { createRequire } from 'node:module';
const { groupWithSelection } = createRequire(import.meta.url)('../../userscript/mwics-exporter.user.js');
const copy = JSON.parse(JSON.stringify(groupWithSelection({ group: { 1: slot, 2: slot, 4: slot }, slots: [{ slot: 1 }, { slot: 2 }, { slot: 4 }] }, { zone: '/actions/combat/zone_a', tier: 1, kind: 'combat' })));
const back = splitGroupImport(copy);
check('the userscript copy pastes back: the slots stay slots, selected and fight come out', same(Object.keys(back.slots), ['1', '2', '4']) && same(back.selected, [1, 2, 4]) && back.fight.tier === 1);
const copyNoFight = splitGroupImport(JSON.parse(JSON.stringify(groupWithSelection({ group: { 1: slot }, slots: [{ slot: 1 }] }, null))));
check('a copy without a fight pastes back with selected only', same(copyNoFight.selected, [1]) && copyNoFight.fight === null);

// applyGroupSelection
let p = fakePage(); p.els.player5.checked = true;
let r = applyGroupSelection(p, both);
check('a three-player group ticks three boxes (others unticked)', same(ticks(p), [1, 2, 3]) && same(r.ticked, [1, 2, 3]));
check('zone and tier are set from the data', p.els.selectZone.value === '/actions/combat/zone_a' && p.els.selectDifficulty.value === '2' && r.zone && r.tier === 2);
check('the dungeon toggle is not touched when it already matches', p.els.simDungeonToggle.events === 0);

p = fakePage();
r = applyGroupSelection(p, { selected: [1, 2], fight: { zone: '/actions/combat/dun_a', tier: 1, kind: 'dungeon' } });
check('a dungeon: toggle first, then the ticks win over its tick-all, dungeon list, tier', p.els.simDungeonToggle.checked && same(ticks(p), [1, 2]) && p.els.selectDungeon.value === '/actions/combat/dun_a' && r.tier === 1);
p = fakePage();
applyGroupSelection(p, { fight: { zone: '/actions/combat/dun_a', tier: 4, kind: 'dungeon' } });
check('a tier the dungeon mode does not offer is left as it is', p.els.selectDifficulty.value === '0');

p = fakePage();
applyGroupSelection(p, { selected: [4] });
check('only selected: ticks change, zone and tier stay', same(ticks(p), [4]) && p.els.selectDifficulty.value === '0' && p.els.selectZone.value === '/actions/combat/zone_a');
p = fakePage();
applyGroupSelection(p, { fight: { zone: '/actions/combat/zone_b', tier: 3, kind: 'combat' } });
check('only fight: zone and tier change, the ticks stay', same(ticks(p), []) && p.els.selectZone.value === '/actions/combat/zone_b' && p.els.selectDifficulty.value === '3');
p = fakePage();
r = applyGroupSelection(p, {});
check('neither: nothing changes', same(ticks(p), []) && r.ticked === null && r.zone === null && p.els.simDungeonToggle.events === 0);

p = fakePage();
r = applyGroupSelection(p, { selected: [1], fight: { zone: '/actions/combat/new_zone', tier: 9, kind: 'combat' } });
check('a zone or tier the page lacks is left as it is and listed, the rest still applies', same(r.skipped, ['zone /actions/combat/new_zone', 'tier 9']) && same(ticks(p), [1]) && p.els.selectZone.value === '/actions/combat/zone_a' && p.els.selectDifficulty.value === '0');
p = fakePage();
applyGroupSelection(p, { selected: [1], fight: { zone: null, tier: null, kind: 'idle' } });
check('idle or Labyrinth (no zone, no tier): zone and tier stay', p.els.selectZone.value === '/actions/combat/zone_a' && p.els.selectDifficulty.value === '0' && same(ticks(p), [1]));
p = fakePage();
applyGroupSelection(p, { fight: { zone: '/actions/combat/dun_a', tier: 0 } });
check('no kind: a dungeon is told by the page\'s own lists, and tier 0 counts', p.els.simDungeonToggle.checked && p.els.selectDungeon.value === '/actions/combat/dun_a');

console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
