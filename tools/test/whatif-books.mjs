// Test: the books stage of the what-if search (tools/whatif/books.mjs) and its place in the search (core.mjs, on the synthetic pool): every row's
// payback is payback() of its own change; casts a day missing from the runs are never read as zero; a switch whose favourable end does not pay back
// gets no more runs; the switch rows of a made-up party; under the books levers the rows are in result.books and result.md, and none of them races.
// Made-up players only. Usage: node tools/test/run-tests.mjs whatif-books.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { booksForPlayer } from '../whatif/books.mjs';
import { booksChangeAt, switchChangeAt } from '../whatif/ladder.mjs';
import { payback, abilityClock } from '../../src/whatif/payback.mjs';
import { BOOK_OF, XP, booksNeeded } from '../whatif/levers/houses.mjs';
import { loadScenario, runSynthetic } from '../whatif/synthetic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.log('FAIL', what, detail); } else console.log('ok  ', what); };
const hash = (t) => { let x = 2166136261; for (const c of t) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return (x >>> 0) / 4294967296; };
const noise = (t) => Math.sqrt(-2 * Math.log(Math.max(hash(t + 'a'), 1e-12))) * Math.cos(2 * Math.PI * hash(t + 'b'));

const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
const made = (p, int = 90) => ({ ...structuredClone(p), player: { ...p.player, intelligenceLevel: int } });

// A fake measure: a held ability's +L is worth perLevel x L a day; a switch's ability at level L is worth dayOne + newPerLevel x (L - 1). Paired noise.
function fakeMeasure({ player, perLevel = 4000, dayOne = () => -5000, newPerLevel = 3000, sigma = 20000, uses = 400, calls = [] }) {
    return async (ops, k, h) => {
        calls.push({ ops, k, h });
        const o = ops[0], samples = {};
        for (let s = 1; s <= k; s++) {
            const g = !o ? 0 : o.op === 'abilityLevel' ? perLevel * o.delta : dayOne(o.ability) + newPerLevel * (o.level - 1);
            samples[s] = g + (o ? sigma * Math.sqrt(300 / h) * (noise(`${JSON.stringify(o)}|${s}`) - noise(`start|${s}`)) : 0);
        }
        const all = Object.fromEntries([...Object.keys(BOOK_OF)].map((a) => [a, uses]));
        return { samples, uses: uses === null ? null : all };
    };
}
const buy = () => 20000, limit = 365;

// ---- books.mjs on a made-up player ----
{
    const p = made(scenario.players[0]), name = p.name, learned = [{ abilityHrid: '/abilities/poke', level: 10, experience: XP[9] + 10 }];
    const calls = [];
    const got = await booksForPlayer({ player: name, setup: p, learned, buy, limit, measure: fakeMeasure({ player: name, calls }), firstHours: 75, fullHours: 300 });
    const held = got.rows.filter((r) => r.kind === 'abilityLevel'), sw = got.rows.filter((r) => r.kind === 'switch');
    check(held.length === 1 && held[0].ability === '/abilities/poke' && held[0].from === 10 && held[0].to > 10 && sw.length > 0, 'books: a row for the held ability and rows for the switches', JSON.stringify(held[0]));
    // One code flow: the row's payback is payback() of the change rebuilt from the row's own figures.
    const bx = BOOK_OF['/abilities/poke'].abilityBookDetail.experienceGain, xpNow = XP[9] + 10, n = (L) => booksNeeded(xpNow, L, bx);
    const h = held[0], ch = booksChangeAt({ xpNow, perDay: abilityClock(0, 400).perDay, costAt: (L) => 20000 * n(L), xpAfter: (L) => xpNow + n(L) * bx, perLevel: h.perLevel, knee: h.knee ? h.knee.from : undefined })(h.to);
    check(h.payback === payback(ch, { table: XP }) && h.cost === ch.cost && h.books === n(h.to), 'books: a held ability\'s payback and cost are payback() and the books of its change at the recommended level');
    const s = sw.find((r) => r.to >= 1);
    if (s) {
        const bs = BOOK_OF[s.ability].abilityBookDetail.experienceGain, ns = (L) => booksNeeded(0, L, bs, true);
        const cs = switchChangeAt({ dayOne: s.dayOne, costAt: (L) => 20000 * ns(L), xpAfter: (L) => (ns(L) - 1) * bs, newPerDay: abilityClock(0, 400).perDay, newPerLevel: s.perLevel, newKnee: s.knee ? s.knee.from : undefined, oldXp: 0, oldPerDay: 0, oldPerLevel: 0 })(s.to);
        check(s.payback === payback(cs, { table: XP }) && s.cost === cs.cost, 'books: a switch\'s payback is payback() of its change (day-one gain, the new ability\'s levels, the first book)');
    } else check(false, 'books: some switch pays back in the fake model');
    check(calls[0].k === 16 && calls[0].h === 75 && calls.every((c) => c.h <= 300 && c.k <= 64), 'books: the first block is 16 seeds of the first hours; nothing past the pick check\'s hours and seed ceiling');

    // A switch that loses far more on day one than its levels can win back: settled out on its first block (day one, +10, +20), no switch.
    const lose = await booksForPlayer({ player: name, setup: p, learned, buy, limit, measure: fakeMeasure({ player: name, dayOne: () => -5e6 }), firstHours: 75, fullHours: 300 });
    const out = lose.rows.filter((r) => r.kind === 'switch');
    check(out.length > 0 && out.every((r) => r.to === 0 && r.payback === null && r.states === 2), 'books: a switch whose favourable end never pays back gets no run past its first block, and is "no switch"', JSON.stringify(out.find((r) => !(r.to === 0 && r.payback === null && r.states === 2))));

    // Casts a day missing from the runs (a record from before they were counted): never read as zero; the rows are listed apart, not judged.
    const c2 = [];
    const old = await booksForPlayer({ player: name, setup: p, learned, buy, limit, measure: fakeMeasure({ player: name, uses: null, calls: c2 }), firstHours: 75, fullHours: 300 });
    check(old.rows.filter((r) => r.kind === 'abilityLevel').length === 0 && old.apart.some((a) => a.kind === 'abilityLevel' && /casts a day unknown/.test(a.note)) && !c2.some((c) => c.ops[0]?.op === 'abilityLevel'), 'books: unknown casts a day: the held ability is not judged (listed apart), and none of its states is run');
    check(old.rows.filter((r) => r.kind === 'switch').length === 0 && old.apart.filter((a) => a.kind === 'switch').length > 0, 'books: unknown casts a day: no switch is judged either');
}

// ---- The switch rows of a made-up party shaped like a real one (four ability slots and the special one open, one held ability, the style's own list) ----
{
    const counts = [];
    for (const p0 of scenario.players) {
        const p = made(p0);
        const got = await booksForPlayer({ player: p.name, setup: p, learned: [{ abilityHrid: '/abilities/poke', level: 10, experience: 0 }], buy, limit, measure: fakeMeasure({ player: p.name, dayOne: () => -5e6 }), firstHours: 75, fullHours: 300 });
        counts.push(got.rows.filter((r) => r.kind === 'switch').length + got.apart.filter((r) => r.kind === 'switch').length);
    }
    console.log(`  switch rows per made-up player (intelligence 90): ${counts.join(', ')}; party ${counts.reduce((a, b) => a + b, 0)}`);
    check(counts.every((c) => c > 0), 'books: every made-up player has switch rows');
}

// ---- In the search (core.mjs on the synthetic pool) ----
{
    const scen = structuredClone(scenario);
    scen.request = { ...scen.request, levers: ['equip', 'abilitylevels'] };
    scen.market.marketData['/items/poke'] = { 0: { a: 20000, b: 19000 } };
    scen.effects.unshift({ match: { op: 'abilityLevel', player: scen.players[0].name, index: 0 }, lootPerLevel: 9000, note: 'poke per level' });
    scen.model.abilityUses = Object.fromEntries(scen.players.map((p) => [p.name, { '/abilities/poke': 400 }]));
    const run = await runSynthetic(scen, { 'max-steps': 0 });
    const r = run.result, a = r.books?.find((x) => x.player === scen.players[0].name);
    check(r.books?.length === scen.players.length && a && a.to > a.from && a.payback !== null, 'search: under --levers abilitylevels every held ability has a books row; the one that gains is recommended', JSON.stringify(r.books?.map((x) => [x.player, x.from, x.to, x.mark])));
    check(!r.candidateList.some((c) => /:ability\d\+/.test(c.id)) && !r.steps.some((s) => /:ability\d\+/.test(s.id ?? '')), 'search: no books row races or joins the chain (the books stage alone judges them)');
    check(/## Ability books and switches/.test(run.markdown) && run.markdown.includes(`| ${a.player} | poke ${a.from} | to ${a.to}`), 'search: result.md lists the books rows');
    const oldScen = structuredClone(scen); delete oldScen.model.abilityUses;
    const old = await runSynthetic(oldScen, { 'max-steps': 0 });
    check(old.result.books.length === 0 && old.result.booksApart.length === scen.players.length && old.result.booksApart.every((x) => /casts a day unknown/.test(x.note)), 'search: runs without casts a day (an old record) give no books row, each listed apart with the reason');
    check(r.books.every((x) => !x.step && x.notTaken), 'merge: with no step allowed (--max-steps 0) no row is taken, and each says why', JSON.stringify(r.books.map((x) => x.notTaken)));

    // The merge (placement B): the row that pays back is bought as a step of the plan, with the row's own payback (payback(), never a second
    // figure), only before a race pick whose payback is longer; its levels join the base; every row not taken says why.
    const merged = await runSynthetic(scen, { 'max-steps': 4 });
    const m = merged.result, mb = m.books.find((x) => x.player === scen.players[0].name), ms = m.steps.find((s) => s.book);
    check(mb?.step >= 1 && ms && m.steps[mb.step - 1] === ms && ms.payback === mb.payback && ms.cost === mb.cost, 'merge: the books row that pays back is a step of the plan, with its own payback and cost', JSON.stringify({ step: mb?.step, steps: m.steps.map((s) => [s.desc, s.payback]) }));
    check(m.steps.filter((s) => s.book).every((s) => s.versus == null || s.payback < s.versus), 'merge: a row is taken only before a race pick with a longer payback');
    check(JSON.stringify(ms?.ops) === JSON.stringify(mb?.ops) && mb.ops[0].delta === mb.to - mb.from, 'merge: the step buys the row\'s recommended levels');
    check(m.books.filter((x) => !x.step).every((x) => ['unsettled', 'noPayback', 'slotTaken', 'overBudget', 'stepLimit'].includes(x.notTaken)), 'merge: every row not taken says why', JSON.stringify(m.books.map((x) => [x.step, x.notTaken])));
    check(/books: before the race's pick/.test(merged.markdown) && /measured once against the baseline after foods and drinks, not on top of the steps before it/.test(merged.markdown), 'merge: result.md marks the books step and says its weak point');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
