// Test: a run's loot is priced kill by kill, with the drop rate, rare find and drop quantity each player has at each kill
// (SimResult.addDeath / killMultipliers, src/combatsimulator/lootPricing.js), not with the ones the player has at the run's
// last instant. Covers: a player whose multipliers at the end differ from those at his kills; a run whose multipliers never
// change gives the old figures exactly (expected and rolled); the capped chance per group; an older result without the
// record; the fight is unchanged (a simulation with the record is the simulation without it, byte for byte).
// Made-up data only. Its lines carry no timestamp of their own: the test loop (run-tests.mjs) stamps every line.
// Usage: node tools/test/loot-at-kill.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const L = await import(src('combatsimulator/lootPricing.js'));
const { default: SimResult } = await import(src('combatsimulator/simResult.js'));
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: combatMonsterDetailMap } = await import(src('combatsimulator/data/combatMonsterDetailMap.json'));

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const mapsClose = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && close(v, b.get(k)));
const mapsEqual = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// The old pricing (src/main.js calcDropMaps before this change): every kill of the run with the multipliers of the end.
function oldDrops(r, ph, random) {
    const dropRateMultiplier = r.dropRateMultiplier[ph], rareFindMultiplier = r.rareFindMultiplier[ph], combatDropQuantity = r.combatDropQuantity[ph], debuffOnLevelGap = r.debuffOnLevelGap[ph];
    const n = r.numberOfPlayers;
    const fid = (x) => { if (Number.isInteger(x)) return x; const i = Math.floor(x); return random() < x - i ? i + 1 : i; };
    const total = new Map(), noRng = new Map();
    for (const monster of Object.keys(r.deaths).filter((e) => !/^player\d$/.test(e)).sort()) {
        const dropMap = new Map(), rareDropMap = new Map();
        if (!combatMonsterDetailMap[monster].dropTable) continue;
        for (const drop of combatMonsterDetailMap[monster].dropTable) {
            if (drop.minDifficultyTier > r.difficultyTier) continue;
            const dropRate = Math.min(1.0, (1.0 + 0.1 * r.difficultyTier) * (drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * r.difficultyTier));
            if (dropRate <= 0) continue;
            dropMap.set(drop.itemHrid, { dropRate: Math.min(1.0, dropRate * dropRateMultiplier), number: 0, dropMin: drop.minCount, dropMax: drop.maxCount, noRng: 0 });
        }
        for (const drop of combatMonsterDetailMap[monster].rareDropTable || []) {
            if (drop.minDifficultyTier > r.difficultyTier) continue;
            rareDropMap.set(drop.itemHrid, { dropRate: drop.dropRate * rareFindMultiplier, number: 0, dropMin: drop.minCount, dropMax: drop.maxCount, noRng: 0 });
        }
        for (const o of [...dropMap.values(), ...rareDropMap.values()]) o.noRng += r.deaths[monster] * o.dropRate * ((o.dropMax + o.dropMin) / 2) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity) / n;
        for (let i = 0; i < r.deaths[monster]; i++) {
            for (const o of [...dropMap.values(), ...rareDropMap.values()]) {
                if (random() <= o.dropRate / n) o.number += fid(Math.floor(random() * (o.dropMax - o.dropMin + 1) + o.dropMin) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity));
            }
        }
        for (const [name, o] of [...dropMap.entries(), ...rareDropMap.entries()]) {
            total.set(name, total.has(name) ? total.get(name) + o.number : o.number);
            noRng.set(name, noRng.has(name) ? noRng.get(name) + o.noRng : o.noRng);
        }
    }
    return { total, noRng };
}

// Made-up players and monsters.
const mkPlayer = (hrid, dropRate, rareFind = 0, dropQuantity = 0) => ({ hrid, isPlayer: true, debuffOnLevelGap: 0, combatDetails: { combatStats: { combatDropRate: dropRate, combatRareFind: rareFind, combatDropQuantity: dropQuantity } } });
const set = (p, dropRate, rareFind, dropQuantity) => Object.assign(p.combatDetails.combatStats, { combatDropRate: dropRate, combatRareFind: rareFind, combatDropQuantity: dropQuantity });
const tierOk = (d) => !(d.minDifficultyTier > 0);
// A monster with a drop table and a rare drop table, and a normal drop whose chance is between 0.5 and 0.9 at tier 0.
const [CAP_MONSTER, CAP_DROP] = (() => {
    for (const [hrid, md] of Object.entries(combatMonsterDetailMap)) {
        if (!md.dropTable || !(md.rareDropTable || []).some(tierOk)) continue;
        const d = md.dropTable.find((x) => tierOk(x) && x.dropRate >= 0.5 && x.dropRate <= 0.9);
        if (d) return [hrid, d];
    }
    return [];
})();
const OTHER_MONSTER = Object.keys(combatMonsterDetailMap).find((h) => h !== CAP_MONSTER && combatMonsterDetailMap[h].dropTable?.some(tierOk));
check(CAP_MONSTER && OTHER_MONSTER, 'data: a monster with a drop chance between 0.5 and 0.9 and a rare drop table, and another monster', `${CAP_MONSTER} ${OTHER_MONSTER}`);
const monster = (hrid) => ({ hrid, isPlayer: false });
const finish = (r, players) => { for (const p of players) r.setDropRateMultipliers(p); return r; };

// ---- A player whose multipliers at the end differ from those at his kills ----
{
    const a = mkPlayer('player1', 0.2, 0.3, 0.1), b = mkPlayer('player2', 0.1);
    const r = new SimResult({ hrid: '/actions/combat/test', difficultyTier: 0 }, null, 2);
    for (let i = 0; i < 40; i++) r.addDeath(monster(CAP_MONSTER), [a, b]);
    for (let i = 0; i < 25; i++) r.addDeath(monster(OTHER_MONSTER), [a, b]);
    r.addDeath(a, [a, b]); // a player's death records no kill
    set(a, 0, 0, 0); // at the last instant the buffs are gone
    finish(r, [a, b]);
    const groupsA = L.killGroups(r, 'player1');
    check(groupsA.length === 1 && groupsA[0].dropRate === 1.2 && groupsA[0].rareFind === 1.3 && groupsA[0].dropQuantity === 0.1, 'record: all of a\'s kills are under his kill-time multipliers', JSON.stringify(groupsA));
    check(groupsA[0].deaths[CAP_MONSTER] === 40 && groupsA[0].deaths[OTHER_MONSTER] === 25 && !('player1' in groupsA[0].deaths), 'record: the kills are counted per monster, a player death is not a kill');
    check(r.dropRateMultiplier.player1 === 1.2 && r.rareFindMultiplier.player1 === 1.3 && r.combatDropQuantity.player1 === 0.1, 'shown multipliers: those of the kills, not of the last instant');
    const now = L.expectedDrops(r, 'player1');
    const atEnd = oldDrops({ ...r, dropRateMultiplier: { player1: 1 }, rareFindMultiplier: { player1: 1 }, combatDropQuantity: { player1: 0 } }, 'player1', lcg(1)).noRng;
    const atKills = oldDrops(r, 'player1', lcg(1)).noRng;
    check(mapsEqual(now, atKills), 'priced by the kills: equals the old arithmetic with the kill-time multipliers');
    const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0);
    check(sum(now) > sum(atEnd) * 1.05, 'the old end-of-run pricing gives less (the bug)', `${sum(now)} vs ${sum(atEnd)}`);
}

// ---- Multipliers that never change: the old figures exactly ----
{
    const a = mkPlayer('player1', 0.15, 0.25, 0.05), b = mkPlayer('player2', 0.3, 0.1, 0.2), c = mkPlayer('player3', 0);
    const r = new SimResult({ hrid: '/actions/combat/test', difficultyTier: 0 }, null, 3);
    for (let i = 0; i < 300; i++) r.addDeath(monster(i % 3 ? CAP_MONSTER : OTHER_MONSTER), [a, b, c]);
    finish(r, [a, b, c]);
    for (const ph of ['player1', 'player2', 'player3']) {
        const old = oldDrops(r, ph, lcg(77));
        check(mapsEqual(L.expectedDrops(r, ph), old.noRng), `unchanged multipliers: expected drops of ${ph} are the old ones exactly`);
        check(mapsEqual(L.rolledDrops(r, ph, lcg(77)), old.total), `unchanged multipliers: rolled drops of ${ph} are the old ones exactly (same random numbers)`);
    }
    // An older result without the record prices with its multipliers, as before.
    const older = { ...r, killMultipliers: undefined };
    check(mapsEqual(L.expectedDrops(older, 'player2'), oldDrops(r, 'player2', lcg(1)).noRng), 'a result without the record: the old pricing');
}

// ---- The capped chance: each group keeps its own cap ----
{
    const a = mkPlayer('player1', 0);
    const r = new SimResult({ hrid: '/actions/combat/test', difficultyTier: 0 }, null, 1);
    for (let i = 0; i < 10; i++) r.addDeath(monster(CAP_MONSTER), [a]);
    set(a, 1, 0, 0); // drop rate x2: the chance is capped at 1
    for (let i = 0; i < 10; i++) r.addDeath(monster(CAP_MONSTER), [a]);
    set(a, 0.5, 0, 0);
    finish(r, [a]);
    const groups = L.killGroups(r, 'player1');
    check(groups.length === 2 && close(r.dropRateMultiplier.player1, 1.5), 'two groups; the shown drop rate is the kill-weighted mean', String(r.dropRateMultiplier.player1));
    const base = CAP_DROP.dropRate, avg = (CAP_DROP.minCount + CAP_DROP.maxCount) / 2;
    const got = L.expectedDrops(r, 'player1').get(CAP_DROP.itemHrid);
    const want = 10 * base * avg + 10 * 1 * avg;   // the other drops of the same item, if any, are 0 in this monster's table
    const byMean = 20 * Math.min(1, base * 1.5) * avg;
    check(close(got, want), 'capped chance: 10 kills at the chance, 10 at the cap', `${got} vs ${want}`);
    check(!close(got, byMean), 'capped chance: not the mean multiplier\'s figure', `${got} vs ${byMean}`);
    // The rolled path takes each group's chance: at the cap every kill of the second group drops.
    let calls = 0;
    const highRandom = () => { calls++; return 0.999999; };  // every roll above every chance below 1, an amount at its max
    const rolled = L.rolledDrops(r, 'player1', highRandom).get(CAP_DROP.itemHrid);
    check(rolled === 10 * CAP_DROP.maxCount, 'rolled: the 10 kills at the cap drop, the 10 under it do not', `${rolled} vs ${10 * CAP_DROP.maxCount}, ${calls} draws`);
}

// ---- The fight is unchanged: a simulation with the record is the same simulation without it ----
{
    const ZONE = '/actions/combat/fly';
    const dto = { hrid: 'player1', staminaLevel: 30, intelligenceLevel: 30, attackLevel: 30, meleeLevel: 30, defenseLevel: 30, rangedLevel: 1, magicLevel: 1,
        equipment: [], food: [null, null, null], drinks: [null, null, null], abilities: [null, null, null, null, null], houseRooms: {}, achievements: {}, combatStyleHrid: '/combat_styles/smash', debuffOnLevelGap: 0 };
    async function run(record) {
        const realRandom = Math.random, realAdd = SimResult.prototype.addKillMultipliers;
        Math.random = lcg(4242);
        if (!record) SimResult.prototype.addKillMultipliers = () => {};
        try {
            const z = new Zone(ZONE, 0);
            const p = Player.createFromDTO(structuredClone(dto)); p.zoneBuffs = z.buffs || []; p.extraBuffs = [];
            const sim = new CombatSimulator([p], z, null, {});
            const r = await sim.simulate(1800e9);
            const { killMultipliers, ...rest } = r;
            return { fight: JSON.stringify({ rest, details: p.combatDetails }), killMultipliers, r };
        } finally { Math.random = realRandom; SimResult.prototype.addKillMultipliers = realAdd; }
    }
    let withRec, without;
    try { withRec = await run(true); without = await run(false); } catch (e) { check(false, 'fight: the simulation runs', String(e?.stack ?? e)); }
    if (withRec) {
        check(withRec.fight === without.fight && withRec.fight.length > 1000, 'fight: kills, deaths, consumables, experience and time are byte-equal with and without the record', String(withRec.fight.length));
        const kills = Object.entries(withRec.r.deaths).filter(([k]) => !/^player\d$/.test(k));
        const recorded = {};
        for (const g of Object.values(withRec.killMultipliers.player1 ?? {})) for (const [m, n] of Object.entries(g.deaths)) recorded[m] = (recorded[m] ?? 0) + n;
        check(kills.length > 0 && kills.every(([m, n]) => recorded[m] === n), 'fight: every monster kill is recorded once for the player', JSON.stringify(recorded));
    }
}

console.log(fails ? `FAIL ${fails}` : 'PASS');
process.exit(fails ? 1 : 0);
