import combatStyleDetailMap from "./data/combatStyleDetailMap.json"
import { isOwnMpTrigger } from "./triggerHolds.js";

class SimResult {
    constructor(zone, labyrinth, numberOfPlayers) {
        this.deaths = {};
        this.experienceGained = {};
        this.encounters = 0;
        this.attacks = {};
        this.consumablesUsed = {};
        this.hitpointsGained = {};
        this.manapointsGained = {};
        this.debuffOnLevelGap = {};
        this.dropRateMultiplier = {};
        this.rareFindMultiplier = {};
        this.combatDropQuantity = {};
        this.playerRanOutOfMana = {
            "player1": false,
            "player2": false,
            "player3": false,
            "player4": false,
            "player5": false
        };
        this.playerRanOutOfManaTime = {};
        // "Held by trigger": per player hrid, per ability hrid, one record per trigger condition (index order).
        // A condition holds the ability while the ability is ready but the condition fails; see updateTriggerHolds.
        this.triggerHolds = {};
        // "Held for mana": per player hrid, the time the player is out of mana or held by an own-MP condition.
        this.manaHolds = {};
        this.manaUsed = {};
        this.timeSpentAlive = [];
        this.bossSpawns = [];
        this.hitpointsSpent = {};
        this.zoneName = zone?.hrid;
        this.difficultyTier = zone?.difficultyTier;
        this.labyrinthName = labyrinth?.monsterHrid;
        this.roomLevel = labyrinth?.roomLevel;
        this.isDungeon = false;
        this.isLabyrinth = labyrinth ? true : false;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.maxWaveReached = 0;
        this.numberOfPlayers = numberOfPlayers;
        this.maxEnrageStack = 0;
        this.minDungenonTime = 0;
        this.maxDungenonTime = 0;
        this.lastDungeonFinishTime = 0;
        this.lastEncounterFinishTime = 0;
        this.labyAttemptCount = 0;

        this.wipeEvents = [];
        
        // 时间序列数据用于图表显示
        this.timeSeriesData = {
            timestamps: [],
            players: {}
        };
    }

    addWipeEvent(logs, simulationTime, wave) {
        this.wipeEvents.push({
            simulationTime: simulationTime,
            logs: logs,
            wave: wave,
            timestamp: new Date().toISOString()
        });
    }
    
    addDeath(unit) {
        if (!this.deaths[unit.hrid]) {
            this.deaths[unit.hrid] = 0;
        }

        this.deaths[unit.hrid] += 1;
    }

    updateTimeSpentAlive(name, alive, time) {
        const i = this.timeSpentAlive.findIndex(e => e.name === name);
        if (alive) {
            if (i !== -1) {
                this.timeSpentAlive[i].alive = true;
                this.timeSpentAlive[i].spawnedAt = time;
            } else {
                this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });
            }
        } else {
            const timeAlive = time - this.timeSpentAlive[i].spawnedAt;
            this.timeSpentAlive[i].alive = false;
            this.timeSpentAlive[i].timeSpentAlive += timeAlive;
            this.timeSpentAlive[i].count += 1;
        }
    }

    updateDungenonFinish(beginFlag, finishTime) {
        const i = this.timeSpentAlive.findIndex(e => e.name === beginFlag); 
        if (i == -1) {
            return;
        }

        const currentDungenonTime = finishTime - this.timeSpentAlive[i].spawnedAt;

        if (this.minDungenonTime == 0 || this.minDungenonTime > currentDungenonTime) {
            this.minDungenonTime = currentDungenonTime;
        }

        if (this.maxDungenonTime < currentDungenonTime) {
            this.maxDungenonTime = currentDungenonTime;
        }
    }

    addExperienceGain(unit, experience) {
        if (!unit.isPlayer) {
            return;
        }

        if (!this.experienceGained[unit.hrid]) {
            this.experienceGained[unit.hrid] = {
                stamina: 0,
                intelligence: 0,
                attack: 0,
                melee: 0,
                defense: 0,
                ranged: 0,
                magic: 0,
            };
        }

        let experienceGainedRate = {
            "stamina": 0,
            "intelligence": 0,
            "attack": 0,
            "melee": 0,
            "defense": 0,
            "ranged": 0,
            "magic": 0,
        };

        const primaryTraining = unit.combatDetails.combatStats.primaryTraining;
        experienceGainedRate[primaryTraining.split("/")[2]] = .3;

        const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;
        const skillExpMapLength = Object.keys(skillExpMap).length;

        const focusTraining = unit.combatDetails.combatStats.focusTraining;
        if (focusTraining && skillExpMap[focusTraining]) {
            experienceGainedRate[focusTraining.split("/")[2]] += .7;
        } else {
            Object.keys(skillExpMap).forEach(skillHrid => {
                experienceGainedRate[skillHrid.split("/")[2]] += .7 / skillExpMapLength;
            });
        }

        for (const [type, rate] of Object.entries(experienceGainedRate)) {
            if (rate <= 0) continue;

            const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + "Experience"]);

            this.experienceGained[unit.hrid][type] += (
                experience
                * (1 + unit.combatDetails.combatStats.combatExperience)
                * skillExperience
                * (1 + unit.debuffOnLevelGap)

            );
        }
    }

    addEncounterEnd() {
        this.encounters++;
    }

    addAttack(source, target, ability, hit) {
        if (!this.attacks[source.hrid]) {
            this.attacks[source.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid]) {
            this.attacks[source.hrid][target.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid][ability]) {
            this.attacks[source.hrid][target.hrid][ability] = {};
        }

        if (!this.attacks[source.hrid][target.hrid][ability][hit]) {
            this.attacks[source.hrid][target.hrid][ability][hit] = 0;
        }

        this.attacks[source.hrid][target.hrid][ability][hit] += 1;
    }

    addConsumableUse(unit, consumable) {
        if (!this.consumablesUsed[unit.hrid]) {
            this.consumablesUsed[unit.hrid] = {};
        }
        if (!this.consumablesUsed[unit.hrid][consumable.hrid]) {
            this.consumablesUsed[unit.hrid][consumable.hrid] = 0;
        }

        this.consumablesUsed[unit.hrid][consumable.hrid] += 1;
    }

    addHitpointsGained(unit, source, amount) {
        if (!this.hitpointsGained[unit.hrid]) {
            this.hitpointsGained[unit.hrid] = {};
        }
        if (!this.hitpointsGained[unit.hrid][source]) {
            this.hitpointsGained[unit.hrid][source] = 0;
        }

        this.hitpointsGained[unit.hrid][source] += amount;
    }

    addManapointsGained(unit, source, amount) {
        if (!this.manapointsGained[unit.hrid]) {
            this.manapointsGained[unit.hrid] = {};
        }
        if (!this.manapointsGained[unit.hrid][source]) {
            this.manapointsGained[unit.hrid][source] = 0;
        }

        this.manapointsGained[unit.hrid][source] += amount;
    }

    setDropRateMultipliers(unit) {
        if (!this.dropRateMultiplier[unit.hrid]) {
            this.dropRateMultiplier[unit.hrid] = {};
        }
        this.dropRateMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;

        if (!this.rareFindMultiplier[unit.hrid]) {
            this.rareFindMultiplier[unit.hrid] = {};
        }
        this.rareFindMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;

        if (!this.combatDropQuantity[unit.hrid]) {
            this.combatDropQuantity[unit.hrid] = {};
        }
        this.combatDropQuantity[unit.hrid] = unit.combatDetails.combatStats.combatDropQuantity;

        if (!this.debuffOnLevelGap[unit.hrid]) {
            this.debuffOnLevelGap[unit.hrid] = {};
        }
        this.debuffOnLevelGap[unit.hrid] = unit.debuffOnLevelGap;
    }

    setManaUsed(unit) {
        this.manaUsed[unit.hrid] = {};
        for (let [key, value] of unit.abilityManaCosts.entries()) {
            this.manaUsed[unit.hrid][key] = value;
        }
    }

    addHitpointsSpent(unit, source, amount) {
        if (!this.hitpointsSpent[unit.hrid]) {
            this.hitpointsSpent[unit.hrid] = {};
        }
        if (!this.hitpointsSpent[unit.hrid][source]) {
            this.hitpointsSpent[unit.hrid][source] = 0;
        }

        this.hitpointsSpent[unit.hrid][source] += amount;
    }

    addRanOutOfManaCount(unit, isOutOfMana, time) {
        if (isOutOfMana) this.playerRanOutOfMana[unit.hrid] = true;

        if (!this.playerRanOutOfManaTime[unit.hrid]) {
            this.playerRanOutOfManaTime[unit.hrid] = {isOutOfMana: false, startTimeForOutOfMana:0, totalTimeForOutOfMana:0};
        }

        if (isOutOfMana) {
            if (!this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = true;
                this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana = time;
            }
        } else {
            if (this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = false;
                this.playerRanOutOfManaTime[unit.hrid].totalTimeForOutOfMana += time - this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana;
            }
        }
        this.syncManaHold(unit.hrid, time);
    }

    // One check of a ready-or-not ability: failed holds the indexes of the trigger conditions that failed while the
    // ability was otherwise ready. A condition's hold starts at the first check it fails and ends at the next check
    // it passes (the ability fired, or something else still holds it), or at death or the encounter's end.
    updateTriggerHolds(unit, ability, failed, time) {
        const triggers = ability.triggers;
        if (!triggers || triggers.length == 0) return;
        let byAbility = this.triggerHolds[unit.hrid];
        if (!byAbility) byAbility = this.triggerHolds[unit.hrid] = {};
        let records = byAbility[ability.hrid];
        if (!records) {
            records = byAbility[ability.hrid] = triggers.map((t) => ({
                dependencyHrid: t.dependencyHrid, conditionHrid: t.conditionHrid, comparatorHrid: t.comparatorHrid, value: t.value,
                ownMp: isOwnMpTrigger(t), held: false, start: 0, total: 0, count: 0,
            }));
        }
        let mpChanged = false;
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const fails = failed.includes(i);
            if (fails && !r.held) {
                r.held = true; r.start = time; r.count++;
                if (r.ownMp) mpChanged = true;
            } else if (!fails && r.held) {
                r.held = false; r.total += time - r.start;
                if (r.ownMp) mpChanged = true;
            }
        }
        if (mpChanged) this.syncManaHold(unit.hrid, time);
    }

    // Ends every open hold of the player (death, encounter end).
    closeTriggerHolds(unit, time) {
        const byAbility = this.triggerHolds[unit.hrid];
        if (!byAbility) return;
        let mpChanged = false;
        for (const records of Object.values(byAbility)) {
            for (const r of records) {
                if (r.held) {
                    r.held = false; r.total += time - r.start;
                    if (r.ownMp) mpChanged = true;
                }
            }
        }
        if (mpChanged) this.syncManaHold(unit.hrid, time);
    }

    // "Held for mana" is the union of "ran out of mana" and every open own-MP hold of the player.
    syncManaHold(hrid, time) {
        let held = !!this.playerRanOutOfManaTime[hrid]?.isOutOfMana;
        if (!held) {
            const byAbility = this.triggerHolds[hrid];
            if (byAbility) held = Object.values(byAbility).some((records) => records.some((r) => r.ownMp && r.held));
        }
        let m = this.manaHolds[hrid];
        if (!m) {
            if (!held) return;
            m = this.manaHolds[hrid] = { held: false, start: 0, total: 0, count: 0 };
        }
        if (held && !m.held) {
            m.held = true; m.start = time; m.count++;
        } else if (!held && m.held) {
            m.held = false; m.total += time - m.start;
        }
    }

    // 添加时间序列数据点
    addTimeSeriesSnapshot(time, players) {
        this.timeSeriesData.timestamps.push(time);
        
        players.forEach(player => {
            if (!this.timeSeriesData.players[player.hrid]) {
                this.timeSeriesData.players[player.hrid] = {
                    hp: [],
                    mp: [],
                    maxHp: [],
                    maxMp: []
                };
            }
            
            const playerData = this.timeSeriesData.players[player.hrid];
            playerData.hp.push(player.combatDetails.currentHitpoints);
            playerData.mp.push(player.combatDetails.currentManapoints);
            playerData.maxHp.push(player.combatDetails.maxHitpoints);
            playerData.maxMp.push(player.combatDetails.maxManapoints);
        });
    }
}

export default SimResult;
