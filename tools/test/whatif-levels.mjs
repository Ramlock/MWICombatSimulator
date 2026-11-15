// Test: the enhancement levels the what-if search offers (tools/whatif/prices.mjs listedLevels, upgradeLevels, swapLevelsOf,
// and their use in tools/whatif/core.mjs candidatesFor). With no --max-up and no --swap-levels, every level the market sells is offered;
// a level with no ask is not, and has no price: the Philosopher's Mirror is not priced for now. Either option given keeps its old meaning.
// The market below is made up.
// Usage: node tools/test/run-tests.mjs whatif-levels.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = await import(pathToFileURL(path.join(root, 'tools/whatif/prices.mjs')).href);
let fails = 0;
const check = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const market = {
    '/items/sword': { 0: { a: 1000, b: 900 }, 5: { a: 50000, b: 40000 }, 7: { a: 200000, b: 150000 } }, // sold at +0, +5 and +7 only
    '/items/hat': { 0: { a: 2000, b: 1800 }, 1: { a: 5000, b: 4000 } }, // sold at +0 and +1 only
    '/items/rare': { 3: { b: 100 } }, // no ask at any level (a bid only)
    '/items/philosophers_mirror': { 0: { a: 10000 } }, // listed, and priced by nothing
};
const pr = P.makePricer(market);
const known = (costs) => costs.filter((c) => c.known).map((c) => c.to);
const ups = (hrid, from, maxUp, all) => P.upgradeLevels(pr, hrid, from, maxUp, all).map((to) => pr.upgrade(hrid, from, to));

// The Philosopher's Mirror is not priced for now (it returns with self-enhancing): a level the market does not sell has no price.
const h2 = pr.upgrade('/items/hat', 0, 2);
check(!h2.known && h2.note === 'no seller', 'a level with no ask is not priced, even with a Mirror listed (today the Mirror path priced the hat +0 -> +2)');
check(!pr.swap(null, 0, '/items/hat', 2).known, 'a swap to a level with no ask is not priced, even with a Mirror listed');
const h1 = pr.upgrade('/items/hat', 0, 1);
check(h1.known && h1.cost === 5000 - 1800 * 0.96 && h1.path === 'buy, sell old' && !('mirrors' in h1), 'a level the market sells costs its ask less the old item bid after tax, with no Mirror field');

check(P.MAX_ENHANCEMENT === JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json'), 'utf8')).length - 1, 'the highest level is the last of the game table (+20)');
check(same(pr.listedLevels('/items/sword'), [0, 5, 7]) && same(pr.listedLevels('/items/rare'), []), 'listedLevels: the levels with an ask, lowest first; a bid alone is not a seller');

// Swaps, no --swap-levels: every level the market sells.
check(same(P.swapLevelsOf(pr, '/items/sword', 4, ['0', 'same'], true), [0, 5, 7]), 'swap: a new item sold at +0, +5 and +7 is offered at those three levels (today: +0 and the worn +4)');
check(same(P.swapLevelsOf(pr, '/items/sword', null, ['0', 'same'], true), [0, 5, 7]), 'swap into an empty slot: every level sold, not +0 alone');
check(!P.swapLevelsOf(pr, '/items/hat', 2, ['0', 'same'], true).includes(2), 'swap: the worn level is not offered when the market does not sell it');
check(same(P.swapLevelsOf(pr, '/items/rare', 3, ['0', 'same'], true), []), 'swap: an item with no ask at any level is not offered');

// Upgrades, no --max-up: +1 to +3 as before (one with no ask listed apart as no seller) and every higher level sold.
const sw = ups('/items/sword', 0, 3, true);
check(same(sw.map((c) => c.to), [1, 2, 3, 5, 7]) && same(known(sw), [5, 7]), 'upgrade: a worn +0 sold only at +5 and +7 is offered +5 and +7 (today none: they are above +3)');
check(sw.filter((c) => !c.known).every((c) => c.note === 'no seller') && sw.filter((c) => !c.known).length === 3, 'upgrade: +1 to +3 with no ask are listed apart as no seller');
check(same(ups('/items/sword', 5, 3, true).map((c) => c.to), [6, 7, 8]) && same(known(ups('/items/sword', 5, 3, true)), [7]), 'upgrade: a level beyond +3 with no ask is not listed at all (the apart list does not grow by it)');

const legs = P.makePricer({ '/items/legs': { 0: { a: 1000, b: 900 }, 5: { a: 50000, b: 40000 }, 7: { a: 200000, b: 150000 }, 10: { a: 9000000, b: 8000000 } } });
const lg = P.upgradeLevels(legs, '/items/legs', 5, 3, true).map((to) => legs.upgrade('/items/legs', 5, to)), ten = lg.find((c) => c.to === 10);
check(same(known(lg), [7, 10]) && ten.cost === 9000000 - 40000 * 0.96 && ten.path === 'buy, sell old', 'upgrade: a worn +5 sold at +7 and +10 is offered +5 -> +10 directly, a jump of 5 levels, at the +10 ask less the +5 bid after tax (today only +5 -> +7, then +7 -> +10 in a later step)');

const top = P.makePricer({ '/items/top': { 0: { a: 1000, b: 900 }, 20: { a: 9000000, b: 8000000 } } });
check(same(P.upgradeLevels(top, '/items/top', 19, 3, true), [20]) && same(P.upgradeLevels(top, '/items/top', 19, 3, false), [20]), 'upgrade: a worn +19 is offered +20 only, with --max-up or without (no level above +20)');
check(same(P.upgradeLevels(top, '/items/top', 20, 3, true), []) && same(P.upgradeLevels(top, '/items/top', 20, 3, false), []), 'upgrade: a worn +20 is offered nothing, with --max-up or without');

// Either option given: its old meaning.
check(same(P.upgradeLevels(pr, '/items/sword', 0, 3, false), [1, 2, 3]), '--max-up 3: +1 to +3 only');
check(same(P.swapLevelsOf(pr, '/items/sword', 4, ['0', 'same'], false), [0, 4]) && same(P.swapLevelsOf(pr, '/items/sword', null, ['0', 'same'], false), [0]), '--swap-levels 0,same: the old levels (an empty slot +0)');

// The search uses them, one flow for both loops, and the options decide.
const core = readFileSync(path.join(root, 'tools/whatif/core.mjs'), 'utf8');
const loop = core.slice(core.indexOf('function candidatesFor'), core.indexOf('// ---- Phase 2 levers'));
check(/upgradeLevels\(pricer, it\.itemHrid, it\.enhancementLevel, maxUp, upAllListed\)/.test(loop) && /swapLevelsOf\(pricer, item\.hrid, it \? it\.enhancementLevel : null, swapLevels, swapAllListed\)/.test(loop), 'core: both loops take their levels from prices.mjs');
check(/const upAllListed = arg\('max-up', null\) == null;/.test(core) && /const swapAllListed = arg\('swap-levels', null\) == null;/.test(core), 'core: every level sold only when --max-up / --swap-levels is not given');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
