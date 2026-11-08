// Node test for the combat tracker colours in userscript/mwics-exporter.user.js, on made-up messages and fake DOM nodes.
// Run: node userscript/test/tracker.test.cjs
// Covers: the recorder hands each monster damage event to onHit (dealer slot, or null when ambiguous); a splat takes the queued hit
// with its value (teammate colour), a merged splat (sum of queued hits) takes their shared dealer or the fallback; stale and
// previous-battle hits are dropped; picked colours by character id override the slot palette; the palette stays off red; a reused
// splat slot is recoloured, cleared when it empties, and a re-render of the same splat is not taken twice; misses are consumed and
// never coloured; React props are read for the unit side and index.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'mwics-exporter.user.js'), 'utf8'), { module: mod, console });
const { createRecorder, createTint, tintSlot, unitInfo, TINT, defaultColors } = mod.exports;

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

const unit = (o) => ({ currentHitpoints: 1000, maxHitpoints: 1000, currentManapoints: 100, attackAttemptCounter: 0, damageSplatCounter: 0, criticalDamageSplatCounter: 0, preparingAbilityHrid: '', isPreparingAutoAttack: true, combatAbilities: [], combatConsumables: [], combatBuffMap: {}, totalLootMap: {}, totalSkillExperienceMap: {}, totalAbilityExperienceMap: {}, deathCount: 0, ...o });
const NB = (battleId, players, monsters) => ({ type: 'new_battle', battleId, combatStartTime: '2026-01-01T00:00:00Z', wave: 0, players, monsters });
const ent = (cHP, atk, dmg, crit) => ({ cHP, mHP: 1000, cMP: 100, mMP: 100, isActive: true, atkCounter: atk, dmgCounter: dmg, critCounter: crit });
const BU = (battleId, pMap, mMap) => ({ type: 'battle_updated', battleId, pMap, mMap });

function tintAt(colors, clock) { const c = colors || defaultColors(); return createTint({ colors: () => c, now: () => clock.t }); }

test('recorder onHit: attributed hit carries the dealer slot, a multi-event update carries null', () => {
    const hits = [];
    const r = createRecorder({ clientData: () => null, onHit: (h) => hits.push(h) });
    r.handle(NB(7, [unit(), unit()], [unit({ hrid: '/monsters/a' }), unit({ hrid: '/monsters/b' })]), 1000);
    r.handle(BU(7, { 0: ent(1000, 0, 0, 0), 1: ent(1000, 1, 0, 0) }, { 1: ent(880, 0, 1, 0) }), 1100);
    r.handle(BU(7, { 0: ent(1000, 1, 0, 0) }, { 0: ent(900, 0, 2, 0) }), 1200);
    assert.deepEqual(hits.map((h) => [h.battleId, h.idx, h.value, h.dealer]), [[7, 1, 120, 1], [7, 0, 100, null]]);
});

test('a splat takes the queued hit with its value and its dealer colour', () => {
    const clock = { t: 0 }, t = tintAt(null, clock);
    t.setParty(5, [11, 22, 33]);
    t.noteHit({ battleId: 5, idx: 0, value: 489, dealer: 2 });
    t.noteHit({ battleId: 5, idx: 0, value: 257, dealer: 0 });
    assert.equal(t.splatColor(0, 489), TINT.PALETTE[2]);
    assert.equal(t.splatColor(0, 257), TINT.PALETTE[0]);
    assert.equal(t.splatColor(0, 257), null, 'nothing queued: keep the game colour');
});

test('ambiguous hit and unmatched value: fallback colour, or the game colour when none is picked', () => {
    const clock = { t: 0 }, colors = defaultColors(), t = tintAt(colors, clock);
    t.setParty(5, [11]);
    t.noteHit({ battleId: 5, idx: 1, value: 50, dealer: null });
    assert.equal(t.splatColor(1, 50), null);
    colors.fallback = '#AABBCC';
    t.noteHit({ battleId: 5, idx: 1, value: 50, dealer: null });
    assert.equal(t.splatColor(1, 50), '#aabbcc');
    assert.equal(t.splatColor(1, 999), '#aabbcc');
});

test('a merged splat takes the shared dealer, mixed dealers take the fallback', () => {
    const clock = { t: 0 }, t = tintAt(null, clock);
    t.setParty(5, [11, 22]);
    t.noteHit({ battleId: 5, idx: 0, value: 100, dealer: 1 });
    t.noteHit({ battleId: 5, idx: 0, value: 60, dealer: 1 });
    assert.equal(t.splatColor(0, 160), TINT.PALETTE[1]);
    t.noteHit({ battleId: 5, idx: 0, value: 100, dealer: 1 });
    t.noteHit({ battleId: 5, idx: 0, value: 60, dealer: 0 });
    assert.equal(t.splatColor(0, 160), null);
});

test('stale and previous-battle hits are dropped', () => {
    const clock = { t: 0 }, t = tintAt(null, clock);
    t.setParty(5, [11]);
    t.noteHit({ battleId: 5, idx: 0, value: 70, dealer: 0 });
    clock.t = TINT.MAX_AGE_MS + 1;
    assert.equal(t.splatColor(0, 70), null);
    t.noteHit({ battleId: 4, idx: 0, value: 70, dealer: 0 });
    assert.equal(t.splatColor(0, 70), null);
    t.noteHit({ battleId: 5, idx: 0, value: 70, dealer: 0 });
    t.setParty(6, [11]);
    assert.equal(t.splatColor(0, 70), null);
});

test('picked colours by character id override the palette and follow the player across slots; palette is off red', () => {
    const clock = { t: 0 }, colors = defaultColors(), t = tintAt(colors, clock);
    colors.byId = { 22: '#123456', 33: 'not a colour' };
    t.setParty(5, [11, 22, 33]);
    assert.equal(t.colorOfSlot(1), '#123456');
    assert.equal(t.colorOfSlot(2), TINT.PALETTE[2]);
    t.setParty(6, [22, 11]);
    assert.equal(t.colorOfSlot(0), '#123456');
    assert.equal(TINT.PALETTE.length, 5);
    for (const c of TINT.PALETTE) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
        assert.ok(!(r > 150 && g < 90 && b < 90), c + ' is red');
    }
});

function slot() { return { className: '', textContent: '', style: { backgroundColor: '' }, dataset: {} }; }

test('a reused slot is recoloured, cleared when empty, and a re-render of the same splat is not taken twice', () => {
    const clock = { t: 0 }, t = tintAt(null, clock);
    t.setParty(5, [11, 22]);
    const s = slot();
    t.noteHit({ battleId: 5, idx: 0, value: 489, dealer: 1 });
    t.noteHit({ battleId: 5, idx: 0, value: 489, dealer: 0 });
    Object.assign(s, { className: 'CombatUnit_splat__1 CombatUnit_damage__2', textContent: '489' });
    tintSlot(s, 0, t);
    assert.equal(s.style.backgroundColor, TINT.PALETTE[1]);
    tintSlot(s, 0, t);
    assert.equal(s.style.backgroundColor, TINT.PALETTE[1], 'same splat, second hit still queued');
    Object.assign(s, { className: '', textContent: '' });
    tintSlot(s, 0, t);
    assert.equal(s.style.backgroundColor, '');
    Object.assign(s, { className: 'CombatUnit_splat__1 CombatUnit_criticalDamage__3', textContent: '489' });
    tintSlot(s, 0, t);
    assert.equal(s.style.backgroundColor, TINT.PALETTE[0]);
});

test('a miss consumes its queued hit and is never coloured; heal splats are left alone', () => {
    const clock = { t: 0 }, t = tintAt(null, clock);
    t.setParty(5, [11, 22]);
    t.noteHit({ battleId: 5, idx: 0, value: 0, dealer: 0 });
    t.noteHit({ battleId: 5, idx: 0, value: 0, dealer: 1 });
    const s = slot();
    Object.assign(s, { className: 'CombatUnit_splat__1 CombatUnit_miss__4', textContent: '0' });
    tintSlot(s, 0, t);
    assert.equal(s.style.backgroundColor, '');
    const h = slot();
    Object.assign(h, { className: 'CombatUnit_splat__1 CombatUnit_heal__5', textContent: '30' });
    tintSlot(h, 0, t);
    assert.equal(h.style.backgroundColor, '');
    assert.equal(t.splatColor(0, 0), TINT.PALETTE[1], 'the first miss took only its own entry');
});

test('unit side and index come from the React props', () => {
    const comp = { memoizedProps: { combatUnit: { isPlayer: false }, index: 2 }, return: null };
    const el = { ['__reactFiber$abc']: { memoizedProps: { className: 'x' }, return: { memoizedProps: {}, return: comp } } };
    assert.equal(JSON.stringify(unitInfo(el)), JSON.stringify({ isPlayer: false, index: 2 }));
    assert.equal(unitInfo({}), null);
});

console.log(n + ' tests passed');
