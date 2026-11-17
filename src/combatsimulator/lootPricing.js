import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json"

// How a player's loot is priced: every monster kill with the drop rate, rare find and drop quantity the player has at that
// kill (SimResult.addDeath records them in killMultipliers). The one place of the drop arithmetic for the page (src/main.js
// calcDropMaps: rolledDrops and expectedDrops), tools/calibration/run.mjs and the what-if engine (tools/whatif/engine.mjs).

const isPlayerHrid = (hrid) => /^player\d+$/.test(hrid);

// The groups of a player's kills, one per set of multipliers they were made under:
// [{ dropRate, rareFind, dropQuantity, deaths: { monsterHrid: kills } }]. A result without the record (an older one)
// gives one group: its end-of-run multipliers over all its kills.
export function killGroups(simResult, playerHrid) {
    const rec = simResult.killMultipliers?.[playerHrid];
    if (rec) return Object.values(rec);
    const deaths = {};
    for (const [hrid, n] of Object.entries(simResult.deaths)) if (!isPlayerHrid(hrid)) deaths[hrid] = n;
    return [{
        dropRate: simResult.dropRateMultiplier[playerHrid],
        rareFind: simResult.rareFindMultiplier[playerHrid],
        dropQuantity: simResult.combatDropQuantity[playerHrid],
        deaths,
    }];
}

// The monsters killed in the run, sorted (the page's order).
export function killedMonsters(simResult) {
    return Object.keys(simResult.deaths).filter((hrid) => !isPlayerHrid(hrid)).sort();
}

// What one kill of a monster can drop for one group of multipliers: [{ itemHrid, dropRate, dropMin, dropMax }], the drop
// table then the rare drop table. dropRate is the party's chance per kill: a normal drop's is capped at 1 after the drop
// rate multiplier, a rare drop's is not capped (as before).
export function monsterDrops(monsterHrid, difficultyTier, group) {
    const md = combatMonsterDetailMap[monsterHrid];
    const out = [];
    if (!md?.dropTable) return out;
    for (const drop of md.dropTable) {
        if (drop.minDifficultyTier > difficultyTier) continue;
        const multiplier = 1.0 + 0.1 * difficultyTier;
        const dropRate = Math.min(1.0, multiplier * (drop.dropRate + (drop.dropRatePerDifficultyTier ?? 0) * difficultyTier));
        if (dropRate <= 0) continue;
        out.push({ itemHrid: drop.itemHrid, dropRate: Math.min(1.0, dropRate * group.dropRate), dropMin: drop.minCount, dropMax: drop.maxCount });
    }
    for (const drop of md.rareDropTable || []) {
        if (drop.minDifficultyTier > difficultyTier) continue;
        out.push({ itemHrid: drop.itemHrid, dropRate: drop.dropRate * group.rareFind, dropMin: drop.minCount, dropMax: drop.maxCount });
    }
    return out;
}

// A player's expected ("No RNG") drops of the run: Map itemHrid -> amount.
export function expectedDrops(simResult, playerHrid) {
    const gap = simResult.debuffOnLevelGap[playerHrid];
    const n = simResult.numberOfPlayers;
    const groups = killGroups(simResult, playerHrid);
    const out = new Map();
    for (const monster of killedMonsters(simResult)) {
        for (const g of groups) {
            const kills = g.deaths[monster];
            if (!kills) continue;
            for (const d of monsterDrops(monster, simResult.difficultyTier, g)) {
                const amount = kills * d.dropRate * ((d.dropMax + d.dropMin) / 2) * (1 + gap) * (1 + g.dropQuantity) / n;
                out.set(d.itemHrid, (out.get(d.itemHrid) ?? 0) + amount);
            }
        }
    }
    return out;
}

// A fractional amount rounds up with the chance of its fraction.
function fidDropAmount(dropAmount, random) {
    if (Number.isInteger(dropAmount)) return dropAmount;
    const intPart = Math.floor(dropAmount);
    const fracPart = dropAmount - intPart;
    return random() < fracPart ? intPart + 1 : intPart;
}

// A player's drops of the run rolled kill by kill (the page's random drops): Map itemHrid -> amount. random: Math.random.
export function rolledDrops(simResult, playerHrid, random = Math.random) {
    const gap = simResult.debuffOnLevelGap[playerHrid];
    const n = simResult.numberOfPlayers;
    const groups = killGroups(simResult, playerHrid);
    const out = new Map();
    for (const monster of killedMonsters(simResult)) {
        for (const g of groups) {
            const kills = g.deaths[monster];
            if (!kills) continue;
            const drops = monsterDrops(monster, simResult.difficultyTier, g);
            for (const d of drops) if (!out.has(d.itemHrid)) out.set(d.itemHrid, 0);
            for (let i = 0; i < kills; i++) {
                for (const d of drops) {
                    if (random() <= d.dropRate / n) {
                        const amount = Math.floor(random() * (d.dropMax - d.dropMin + 1) + d.dropMin) * (1 + gap) * (1 + g.dropQuantity);
                        out.set(d.itemHrid, out.get(d.itemHrid) + fidDropAmount(amount, random));
                    }
                }
            }
        }
    }
    return out;
}
