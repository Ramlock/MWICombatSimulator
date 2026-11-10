// Test: the XP-vs-profit chart's pure functions (src/xpChart.mjs): the per-day profit, the dots for a selection, the frontier.
// Usage: node tools/test/xp-chart.mjs        Exit code 0 on pass, 1 on fail.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PARTY, XP_KEYS, profitPerDay, mapKey, playersOf, pointsFor, frontier } = await import(pathToFileURL(path.join(root, 'src/xpChart.mjs')).href);

let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const row = (zone, tier, player, over = {}) => ({
    ZoneName: zone, DifficultyTier: tier, Player: player, Encounters: 10, Deaths: 0,
    TotalExperience: 0, Stamina: 0, Intelligence: 0, Attack: 0, Magic: 0, Ranged: 0, Melee: 0, Defense: 0, ProfitPerDay: 0, ...over,
});

// Profit per day: a 12 h run and a 24 h run with the same total give a Y twice as high for the 12 h one.
check('24 h run: profit is the total', profitPerDay(1000, 24) === 1000);
check('12 h run: the same total gives twice the Y', profitPerDay(1000, 12) === 2 * profitPerDay(1000, 24));
check('48 h run: half', profitPerDay(1000, 48) === 500);
check('a negative profit scales the same way', profitPerDay(-300, 12) === -600);
check('no simulated time gives 0, not Infinity', profitPerDay(1000, 0) === 0);
const r12 = row('z', 1, 'player1', { ProfitPerDay: profitPerDay(1000, 12) }), r24 = row('z', 1, 'player1', { ProfitPerDay: profitPerDay(1000, 24) });
check('the dot of the 12 h rows sits twice as high as the 24 h one', pointsFor([r12])[0].y === 2 * pointsFor([r24])[0].y);

// The frontier.
const P = (x, y) => ({ x, y });
check('one dot is on the frontier', same(frontier([P(1, 1)]), [P(1, 1)]));
check('an empty list has no frontier', same(frontier([]), []));
const dominated = [P(1, 5), P(2, 4), P(3, 3), P(1, 1), P(2, 2), P(0, 0)];
check('dominated dots are left out, the rest come in increasing X', same(frontier(dominated), [P(1, 5), P(2, 4), P(3, 3)]));
check('a tie on X: the lower Y is dominated', same(frontier([P(2, 3), P(2, 5)]), [P(2, 5)]));
check('a tie on Y: the lower X is dominated', same(frontier([P(2, 3), P(5, 3)]), [P(5, 3)]));
check('equal dots are all on the frontier', frontier([P(2, 3), P(2, 3)]).length === 2);
check('one dot best on both axes is the whole frontier', same(frontier([P(1, 1), P(9, 9), P(5, 2)]), [P(9, 9)]));
check('negative profits work', same(frontier([P(1, -5), P(2, -9), P(3, -1)]), [P(3, -1)]));

// Party average, a specific player, each XP key, a map missing for one player.
const rows = [
    row('a', 1, 'player1', { TotalExperience: 100, Attack: 10, Deaths: 1, ProfitPerDay: 1000 }),
    row('a', 1, 'player2', { TotalExperience: 300, Attack: 30, Deaths: 3, ProfitPerDay: 3000 }),
    row('b', 2, 'player1', { TotalExperience: 50, Attack: 5, Deaths: 0, ProfitPerDay: 4000 }),
    // map b tier 2 is missing for player2: the dot uses the players it has
];
check('players are listed in first-seen order', same(playersOf(rows), ['player1', 'player2']));
const party = pointsFor(rows, { xKey: 'TotalExperience', player: PARTY });
check('Party has one dot per map', party.length === 2 && party[0].key === mapKey('a', 1) && party[1].key === mapKey('b', 2));
check('Party averages X, Y and deaths over the players', party[0].x === 200 && party[0].y === 2000 && party[0].deaths === 2 && same(party[0].players, ['player1', 'player2']));
check('a map missing for one player uses the players it has', party[1].x === 50 && party[1].y === 4000 && same(party[1].players, ['player1']));
check('the default selection is Party, Total', same(pointsFor(rows), party) && XP_KEYS[0] === 'TotalExperience');
const p2 = pointsFor(rows, { xKey: 'TotalExperience', player: 'player2' });
check('a specific player is that player\'s row only', p2.length === 1 && p2[0].x === 300 && p2[0].y === 3000 && p2[0].deaths === 3 && same(p2[0].players, ['player2']));
check('a player with no rows has no dots', pointsFor(rows, { player: 'player9' }).length === 0);
check('a skill key picks that skill\'s XP', pointsFor(rows, { xKey: 'Attack' })[0].x === 20 && pointsFor(rows, { xKey: 'Attack', player: 'player2' })[0].x === 30);
check('every XP key is a key of a display row', XP_KEYS.every((k) => k in rows[0]));
const f = frontier(party);
check('Party frontier: b (50, 4000) and a (200, 2000) do not dominate each other', f.length === 2 && f[0].zone === 'b' && f[1].zone === 'a');

console.log(failed ? failed + ' FAILED' : 'PASS');
process.exit(failed ? 1 : 0);
