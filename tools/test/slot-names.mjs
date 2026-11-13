// Test: the character name a player slot carries (src/slotNames.mjs): reading it, setting it, and the one rule for showing it.
// Usage: node tools/test/slot-names.mjs   Exit code 0 on pass, 1 on fail.
import { slotNameOf, withSlotName, uniqueSlotNames, shownNames } from '../../src/slotNames.mjs';

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const slot = (name, extra = {}) => JSON.stringify({ player: { attackLevel: 5 }, ...(name === undefined ? {} : { name }), ...extra });

// slotNameOf
check('reads the name', slotNameOf(slot('Aaa')) === 'Aaa');
check('trims the name', slotNameOf(slot('  Aaa ')) === 'Aaa');
check('no name key: empty', slotNameOf(slot(undefined)) === '');
check('a blank name: empty', slotNameOf(slot('   ')) === '');
check('a name that is not a string: empty', slotNameOf(slot(42)) === '' && slotNameOf(slot(null)) === '' && slotNameOf(slot(['A'])) === '');
check('no data, null, bad JSON: empty', slotNameOf(undefined) === '' && slotNameOf('') === '' && slotNameOf('null') === '' && slotNameOf('{not json') === '');

// withSlotName
check('sets the name and keeps the rest of the slot', JSON.stringify(JSON.parse(withSlotName(slot(undefined), 'Aaa'))) === JSON.stringify({ player: { attackLevel: 5 }, name: 'Aaa' }));
check('replaces an earlier name', slotNameOf(withSlotName(slot('Old'), 'New')) === 'New');
check('trims what it sets', slotNameOf(withSlotName(slot(undefined), '  Aaa ')) === 'Aaa');
check('a blank name changes nothing (the slot keeps its own)', withSlotName(slot('Keep'), '   ') === slot('Keep') && withSlotName(slot('Keep'), '') === slot('Keep'));
check('a missing or non-string name changes nothing', withSlotName(slot('Keep'), undefined) === slot('Keep') && withSlotName(slot('Keep'), 7) === slot('Keep') && withSlotName(slot('Keep'), null) === slot('Keep'));
check('a slot with no data starts from an empty one', JSON.parse(withSlotName(undefined, 'Aaa')).name === 'Aaa' && JSON.parse(withSlotName('', 'Aaa')).name === 'Aaa');
check('a slot with bad JSON starts from an empty one', JSON.parse(withSlotName('{nope', 'Aaa')).name === 'Aaa');

// uniqueSlotNames
check('distinct names are all unique', JSON.stringify(uniqueSlotNames([slot('A'), slot('B'), slot('C')])) === '["A","B","C"]');
check('a name two slots share is unique for neither', JSON.stringify(uniqueSlotNames([slot('A'), slot('B'), slot('A')])) === '["","B",""]');
check('a slot with no name is empty, the others still count', JSON.stringify(uniqueSlotNames([slot(undefined), slot('B'), undefined])) === '["","B",""]');
check('names compare after trimming', JSON.stringify(uniqueSlotNames([slot(' A'), slot('A ')])) === '["",""]');
check('names compare exactly (case counts)', JSON.stringify(uniqueSlotNames([slot('a'), slot('A')])) === '["a","A"]');

// shownNames
const tabs = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
check('a slot with a unique name is shown by it; the others by their tab', JSON.stringify(shownNames([slot('Aaa'), slot(undefined), slot('Ccc')], tabs)) === '["Aaa","Player 2","Ccc","Player 4","Player 5"]');
check('a shared name falls back to the tab text', JSON.stringify(shownNames([slot('Aaa'), slot('Aaa'), slot('Ccc')], tabs)) === '["Player 1","Player 2","Ccc","Player 4","Player 5"]');
check('the tab text is trimmed', shownNames([], ['  Tank '])[0] === 'Tank');
check('no slots: all tab text', JSON.stringify(shownNames([], tabs)) === JSON.stringify(tabs));

console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
