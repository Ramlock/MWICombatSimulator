// Test: the payback as a break-even day (src/whatif/payback.mjs): the level clock, the one payback function and its no-lead case,
// the evenness check, the stopping level; and the use counter (combatSimulator.js tryUseAbility -> simResult -> the what-if run
// record). Made-up players and numbers only; one short seeded simulation.
// Usage: node tools/test/run-tests.mjs whatif-payback.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import levelTable from '../whatif/levelExperienceTable.json' with { type: 'json' };
import { ABILITY_XP_PER_USE, levelAt, abilityClock, skillClock, levelOn, abilityLevelOn, skillLevelOn, payback, paybackDays, overPaybackLimit, evenness, stoppingLevel } from '../../src/whatif/payback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const XP = levelTable.table, TOP = XP.length;
let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.log('FAIL', what, detail); } else console.log('ok  ', what); };
const throws = (f) => { try { f(); return false; } catch { return true; } };
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// ---- The level clock ----
check(TOP === 200 && levelAt(0, XP) === 1 && levelAt(XP[1] - 1e-9, XP) === 1 && levelAt(XP[1], XP) === 2 && levelAt(XP[99], XP) === 100 && levelAt(XP[99] + (XP[100] - XP[99]) / 2, XP) === 100, 'clock: whole levels from the table (table[i-1] reaches level i; half way through a level is still that level)');
check(levelAt(XP[199], XP) === 200 && levelAt(XP[199] * 10, XP) === 200 && levelAt(-5, XP) === 1, 'clock: level 200 is the top, whatever the XP; below 0 is level 1');
check(abilityClock(500, 30).perDay === 30 * ABILITY_XP_PER_USE && ABILITY_XP_PER_USE === 0.1 && skillClock(500, 1000).perDay === 24000, 'clock: an ability gains 0.1 XP a use, a skill its XP per hour times 24');
{
    const xp = XP[49], need = XP[50] - XP[49]; // level 50 at its start
    const uses = need / ABILITY_XP_PER_USE / 10; // level 51 after 10 days of casting
    check(abilityLevelOn(xp, uses, 9.999, XP) === 50 && abilityLevelOn(xp, uses, 10, XP) === 51, 'clock: an ability moves a level when its uses have paid the level\'s XP, not before');
    const xph = need / 24 / 4; // level 51 after 4 days of a skill
    check(skillLevelOn(xp, xph, 3.99, XP) === 50 && skillLevelOn(xp, xph, 4, XP) === 51, 'clock: a combat skill moves by its XP per hour');
    check(skillLevelOn(XP[198], 1e9, 1e6, XP) === 200 && levelOn({ xp: XP[199], perDay: 1e9 }, 1e9, XP) === 200, 'clock: level 200 ends the clock');
}

// ---- The no-lead case: today's figure, by the same code flow ----
const oldPaybackDays = (cost, buyerNet) => (Number.isFinite(cost) && cost > 0 && Number.isFinite(buyerNet) && buyerNet > 0 ? cost / buyerNet : null);
const oldOver = (cost, buyerNet, limit) => { if (!(limit > 0) || !(cost > 0)) return false; const d = oldPaybackDays(cost, buyerNet); return d === null || d > limit; };
{
    const rnd = lcg(5), table = [[3000, 10], [3000, 7], [0, 10], [3000, 0], [3000, -4], [3000, undefined], [undefined, 5], [NaN, 5], [Infinity, 5], [3000, Infinity], [-100, 5], [1e9, 1e-3], [1, 1e12]];
    for (let i = 0; i < 200; i++) table.push([Math.round(rnd() * 1e9), (rnd() - 0.2) * 1e6]);
    const bad = table.filter(([c, g]) => !Object.is(payback({ cost: c, gain: g }), oldPaybackDays(c, g)) || !Object.is(paybackDays(c, g), oldPaybackDays(c, g)));
    check(bad.length === 0, `no lead: payback() and paybackDays give today's cost over gain exactly, the null cases included (${table.length} pairs)`, JSON.stringify(bad.slice(0, 3)));
    const limits = [0, null, undefined, 1, 30, 299.99, 300, 365, 1e6];
    const badL = table.flatMap(([c, g]) => limits.filter((l) => overPaybackLimit(c, g, l) !== oldOver(c, g, l)).map((l) => [c, g, l]));
    check(badL.length === 0, 'no lead: overPaybackLimit unchanged on every pair and limit (at the limit passes, over it is out)', JSON.stringify(badL.slice(0, 3)));
    check(payback({ cost: 3000, gain: 10 }, { maxDays: 300 }) === 300 && payback({ cost: 3000, gain: 10 }, { maxDays: 299 }) === null, 'no lead: maxDays is the most looked at (300 days at 300 pays back, at 299 not)');
}

// ---- Books on an ability: the books report's arithmetic ----
// The reference, as the books report holds it (x0: XP now; add: XP bought; r: XP per day from casting; g: gain per whole level per day).
const levelOf = (x) => levelAt(x, XP);
function breakEven(x0, add, r, g, cost, maxT = 20000) {
    let cum = 0;
    for (let t = 0; t < maxT; t++) { cum += g * (levelOf(x0 + add + r * (t + 0.5)) - levelOf(x0 + r * (t + 0.5))); if (cum >= cost) return t + 1; }
    return null;
}
const books = (x0, add, r, g, cost) => ({ cost, gain: 0, leads: [{ gainPerLevel: g, with: { xp: x0 + add, perDay: r }, without: { xp: x0, perDay: r } }] });
{
    const cases = [
        [XP[29] + 100, XP[49] - XP[29], 300, 9000, 4e6],
        [XP[59], XP[64] - XP[59], 1200, 30000, 8e6],
        [XP[79] + 5000, XP[89] - XP[79], 2500, 60000, 9e7],
        [XP[9], XP[39] - XP[9], 50, 4000, 3e6],
        [XP[99], XP[119] - XP[99], 8000, 95000, 1.8e8],
        [XP[69], XP[70] - XP[69], 900, 7000, 6e5],
        [XP[39], XP[59] - XP[39], 400, 7000, 9e8],   // never within 20,000 days
        [XP[19], XP[24] - XP[19], 0, 5000, 1e6],     // not cast: the lead holds, cost over (gain per level times 5)
    ];
    const rnd = lcg(11);
    for (let i = 0; i < 40; i++) { const lv = 5 + Math.floor(rnd() * 120), up = 1 + Math.floor(rnd() * 40); cases.push([XP[lv - 1] + rnd() * (XP[lv] - XP[lv - 1]), XP[Math.min(199, lv - 1 + up)] - XP[lv - 1], rnd() * 5000, 2000 + rnd() * 90000, rnd() * 3e8]); }
    const got = cases.map((c) => { const p = payback(books(...c), { table: XP, maxDays: 20000 }); return [p === null ? null : Math.ceil(p), breakEven(...c)]; });
    const bad = got.map((g, i) => [i, ...g]).filter(([, a, b]) => a !== b);
    check(bad.length === 0, `books: the same break-even day as the books report's reference on ${cases.length} made-up inputs`, JSON.stringify(bad.slice(0, 5)));
    check(got[6][0] === null && got[6][1] === null, 'books: the never case (null within the days looked at)');
    check(payback(books(...cases[7]), { table: XP }) === 1e6 / (5000 * 5), 'books: an ability not cast keeps its lead: cost over gain per level times the levels');
    // A lead that shrinks to nothing: both clocks reach level 200, the summed difference stops growing, and no end of days pays back.
    const x0 = XP[195], add = XP[199] - XP[195], r = (XP[199] - XP[195]) / 50; // with is at 200 now, without reaches it in 50 days
    const covered = breakEven(x0, add, r, 1000, Infinity, 60); // never: but read the sum the reference reaches in 60 days
    const sum60 = (() => { let s = 0; for (let t = 0; t < 60; t++) s += 1000 * (levelOf(x0 + add + r * (t + 0.5)) - levelOf(x0 + r * (t + 0.5))); return s; })();
    check(covered === null && payback(books(x0, add, r, 1000, sum60 * 1.01), { table: XP }) === null && Math.ceil(payback(books(x0, add, r, 1000, sum60 * 0.99), { table: XP })) <= 50, 'books: a lead that shrinks to nothing never pays back past what it summed (null, no end of days needed)');
}

// ---- Any change, against a plain day-by-day sum (the reference's arithmetic, generalised) ----
const dayByDay = (ch, maxT = 20000) => {
    let cum = 0;
    for (let t = 0; t < maxT; t++) { cum += ch.gain + ch.leads.reduce((a, l) => a + l.gainPerLevel * (levelOn(l.with, t + 0.5, XP) - levelOn(l.without, t + 0.5, XP)), 0); if (cum >= ch.cost) return t + 1; }
    return null;
};
{
    // A switch: the new ability from level 1 (learned by one book), cast 400 times a day; the old one no longer cast (frozen at its XP),
    // against casting it on. Day one loses 6K a day; the new levels overtake.
    const oldXp = XP[39], sw = (gain, newUses) => ({ cost: 2e6, gain, leads: [
        { gainPerLevel: 4000, with: abilityClock(0, newUses), without: abilityClock(0, 0) },
        { gainPerLevel: 3000, with: abilityClock(oldXp, 0), without: abilityClock(oldXp, 500) }] });
    const s = sw(-6000, 400), p = payback(s, { table: XP, maxDays: 20000 });
    const firstGain = (() => { for (let t = 0; t < 20000; t++) if (s.gain + s.leads.reduce((a, l) => a + l.gainPerLevel * (levelOn(l.with, t + 0.5, XP) - levelOn(l.without, t + 0.5, XP)), 0) > 0) return t; return null; })();
    const noLoss = payback({ ...s, gain: 0 }, { table: XP, maxDays: 20000 });
    check(p !== null && Math.ceil(p) === dayByDay(s), 'switch: the same day as a plain day-by-day sum', `${p} vs ${dayByDay(s)}`);
    check(firstGain > 0 && p > firstGain && p > noLoss, 'switch: the losing days come first and are counted (later than the first winning day, later than without the day-one loss)', `${firstGain} ${p} ${noLoss}`);
    check(payback(sw(-6000, 0), { table: XP }) === null && dayByDay(sw(-6000, 0)) === null, 'switch: a new ability never cast never pays back (null)');
    const rnd = lcg(23), bad = [];
    for (let i = 0; i < 60; i++) {
        const ch = { cost: rnd() * 5e7, gain: (rnd() - 0.6) * 4e4, leads: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
            const x = XP[Math.floor(rnd() * 150)] + rnd() * 1e4, skill = rnd() < 0.5;
            const a = skill ? skillClock(x + rnd() * 1e6, rnd() * 3e4) : abilityClock(x + rnd() * 3e5, rnd() * 9e3);
            const b = skill ? skillClock(x, rnd() * 3e4) : abilityClock(x, rnd() * 9e3);
            return { gainPerLevel: rnd() * 6e4, with: a, without: b };
        }) };
        const p2 = payback(ch, { table: XP, maxDays: 20000 }), want = dayByDay(ch);
        if ((p2 === null ? null : Math.ceil(p2)) !== want) bad.push([i, p2, want]);
    }
    check(bad.length === 0, 'any change: the same day as a plain day-by-day sum on 60 made-up changes (skills and abilities, gains up and down)', JSON.stringify(bad.slice(0, 3)));
}

// ---- A skill lead from XP per hour; half a level gives nothing ----
{
    const x = XP[59], span = XP[60] - XP[59];
    // A Charm-like change: +10% XP per hour on one skill. 2,000 XP an hour without, 2,200 with.
    const ch = { cost: 1e6, gain: 0, leads: [{ gainPerLevel: 20000, with: skillClock(x, 2200), without: skillClock(x, 2000) }] };
    const half = (span / 2) / (200 * 24); // days until the change is half a level ahead
    check(payback(ch, { table: XP, maxDays: half }) === null, 'skill: half a level ahead gives nothing (no payback while the lead is under a whole level)');
    const p = payback(ch, { table: XP, maxDays: 20000 });
    check(p !== null && Math.ceil(p) === dayByDay(ch), 'skill: the lead from XP per hour pays back on the day-by-day sum\'s day', `${p} vs ${dayByDay(ch)}`);
    check(throws(() => payback(ch)) && payback({ ...ch, leads: [{ ...ch.leads[0], gainPerLevel: NaN }] }, { table: XP }) === null, 'a lead needs the table; a gain per level that is not a number gives no payback');
}

// ---- The evenness check ----
{
    // +10 se 3, +20 se 8: the error of the difference is sqrt(3^2 + (8/2)^2) = 5, so the margin is 10.
    const inside = evenness([{ levels: 10, gain: 110, se: 3 }, { levels: 20, gain: 200, se: 8 }]);
    const outside = evenness([{ levels: 10, gain: 110.001, se: 3 }, { levels: 20, gain: 200, se: 8 }]);
    const below = evenness([{ levels: 10, gain: 90, se: 3 }, { levels: 20, gain: 200, se: 8 }]);
    check(inside.pairs[0].seDiff === 5 && inside.pairs[0].even && !inside.flagged && inside.perLevel === 10 && inside.lastEven.levels === 20, 'evenness: just inside (the +10 gain 10 off half the +20 gain, at twice the error) is even; the gain per level is the +20 gain over 20');
    check(!outside.pairs[0].even && outside.flagged && outside.perLevel === 11.0001 && outside.lastEven.levels === 10, 'evenness: just outside is not even, flagged, and ends at the last even step (+10)');
    check(below.pairs[0].even && !below.flagged, 'evenness: the margin holds both ways (10 under half is still inside)');
    const doubling = evenness([{ levels: 10, gain: 100, se: 5 }, { levels: 20, gain: 205, se: 6 }, { levels: 40, gain: 400, se: 8 }, { levels: 80, gain: 450, se: 9 }, { levels: 160, gain: 900, se: 9 }]);
    check(doubling.flagged && doubling.lastEven.levels === 40 && doubling.perLevel === 10 && doubling.pairs.length === 3 && doubling.pairs.map((x) => x.even).join() === 'true,true,false', 'evenness: a failed doubling (+80 against +40) ends at the last even step (+40) and flags; nothing past it is read (+160 never checked)');
    check(evenness([]).perLevel === null && evenness([{ levels: 20, gain: 300, se: 50 }]).perLevel === 15 && evenness([{ levels: 20, gain: 300, se: 50 }]).pairs.length === 0, 'evenness: no step gives nothing; one step gives its gain over its levels with no check made');
    check(throws(() => evenness([{ levels: 20, gain: 1, se: 1 }, { levels: 10, gain: 1, se: 1 }])) && throws(() => evenness([{ levels: 10, gain: NaN, se: 1 }])), 'evenness: steps must rise and carry numbers');
}

// ---- The stopping level ----
{
    // Books on an ability at level 40, cast for 500 XP a day; a book gives 1,000 XP at 50K. The level's cost is the books to reach it.
    const r = 500, bookXp = 1000, price = 5e4, booksFrom = (from) => { const x0 = XP[from - 1] + 3000; return (g) => (level) => ({ cost: Math.ceil(Math.max(0, XP[level - 1] - x0) / bookXp) * price, gain: 0, leads: [{ gainPerLevel: g, with: { xp: Math.max(x0, XP[level - 1]), perDay: r }, without: { xp: x0, perDay: r } }] }); };
    const from = 40, at = booksFrom(from);
    const alone = (g, n) => { const a = at(g)(n), b = at(g)(n + 1); return payback({ cost: b.cost - a.cost, gain: 0, leads: [{ gainPerLevel: g, with: b.leads[0].with, without: a.leads[0].with }] }, { table: XP }); };
    const limit = 365, g = 15000, s = stoppingLevel({ from, changeAt: at(g), limit, measuredTo: from + 20, table: XP });
    check(s.level > from && s.level < TOP && alone(g, s.level - 1) <= limit && (alone(g, s.level) === null || alone(g, s.level) > limit), 'stopping level: stops where the next level alone no longer pays back within the limit', JSON.stringify({ s, last: alone(g, s.level - 1), next: alone(g, s.level) }));
    check(s.cost === at(g)(s.level).cost && s.payback === payback(at(g)(s.level), { table: XP }) && s.levels === s.level - from, 'stopping level: the total is the whole change to that level (its cost and payback)');
    check(s.pastMeasured === s.level > from + 20, 'stopping level: says whether it lies past the largest measured step');
    const far = stoppingLevel({ from, changeAt: at(g), limit, measuredTo: from + 2, table: XP }), near = stoppingLevel({ from, changeAt: at(g), limit, measuredTo: TOP, table: XP });
    check(far.pastMeasured === true && near.pastMeasured === false && far.level === near.level, 'stopping level: past the largest measured step is reported (+2 measured), inside it not');
    const top = stoppingLevel({ from: 190, changeAt: booksFrom(190)(1e10), limit, measuredTo: 200, table: XP });
    check(top.level === TOP && top.levels === 10, 'stopping level: a level that always pays back stops at 200, the game\'s top');
    const none = stoppingLevel({ from, changeAt: at(1), limit, measuredTo: 60, table: XP });
    check(none.level === from && none.levels === 0 && none.cost === 0 && none.payback === null && none.pastMeasured === false, 'stopping level: not one level paying back stops at today\'s level, no cost, no payback');
    const longer = stoppingLevel({ from, changeAt: at(g), limit: 3 * 365, measuredTo: 60, table: XP });
    check(longer.level > s.level, 'stopping level: a longer limit recommends more levels');
}

// ---- The use counter: tryUseAbility -> simResult -> the what-if run record ----
{
    const E = await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href);
    const abilities = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/abilityDetailMap.json'), 'utf8'));
    const I = (n) => '/items/' + n, A = (n, level) => ({ abilityHrid: '/abilities/' + n, level });
    const mk = (name, weapon, loc, abl) => ({ name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
        player: { staminaLevel: 80, intelligenceLevel: 80, attackLevel: 80, meleeLevel: 80, defenseLevel: 80, rangedLevel: 80, magicLevel: 80, equipment: [{ itemLocationHrid: '/item_locations/' + loc, itemHrid: I(weapon), enhancementLevel: 0 }] },
        abilities: abl, food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [null, null, null] } });
    const setups = [mk('Ann', 'blooming_trident', 'main_hand', [null, A('fireball', 20), A('ice_spear', 15), A('heal', 10), null]), mk('Ben', 'cursed_bow', 'two_hand', [null, A('rain_of_arrows', 12), A('quick_shot', 30), null, null])];
    let sim;
    const run = await E.runParty({ setups, seed: 11, checkpoints: [1, 2], tier: 0, zone: '/actions/combat/fly', onPlayers: (p, n, s) => { sim = s; } });
    sim.players.forEach((p) => sim.simResult.setManaUsed(p));
    const r = sim.simResult, rows = sim.players.flatMap((p) => Object.entries(r.manaUsed[p.hrid]).map(([h, mana]) => ({ p: p.hrid, h, mana, uses: r.abilityUses[p.hrid][h] })));
    check(rows.length >= 3 && rows.every((x) => x.uses > 0 && x.uses * abilities[x.h].manaCost === x.mana) && sim.players.every((p) => Object.keys(r.abilityUses[p.hrid]).length === Object.keys(r.manaUsed[p.hrid]).length), 'counter: in a seeded simulation, for every ability cast, casts times its mana cost equals the mana recorded', JSON.stringify(rows));
    const cp = run.checkpoints.at(-1), names = ['Ann', 'Ben'];
    check(names.every((n, i) => Object.entries(r.abilityUses['player' + (i + 1)]).every(([h, u]) => Math.abs(cp.players[n].abilityUsesPerDay[h] - u / cp.simHours * 24) < 1e-9)) && run.checkpoints[0].players.Ann.abilityUsesPerDay['/abilities/fireball'] > 0, 'counter: the what-if run record carries each player\'s casts per day per ability');
    const strip = run.checkpoints.map((c) => ({ ...c, players: Object.fromEntries(Object.entries(c.players).map(([k, v]) => [k, { ...v, abilityUsesPerDay: undefined }])) }));
    const hash = createHash('sha256').update(JSON.stringify(strip)).digest('hex');
    check(hash === '470c633ffd357f725833ef0729dca105e6cd4d420dd12804f62b3d1635aadd3b', 'counter: the run\'s figures are the same as before the counter (hash of the record without the new field, taken on the code before it)', hash);
}

console.log(fails ? `FAIL ${fails}` : 'PASS');
process.exit(fails ? 1 : 0);
