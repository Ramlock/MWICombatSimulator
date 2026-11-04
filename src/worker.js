import CombatSimulator from "./combatsimulator/combatSimulator";
import { buildExtraBuffs, createZoneAndLabyrinth, createSimPlayer } from "./simSetup";

onmessage = async function (event) {
    switch (event.data.type) {
        case "start_simulation":
            let extraBuffs = buildExtraBuffs(event.data.extra);
            let playersData = event.data.players;
            let players = [];
            let { zone, labyrinth } = createZoneAndLabyrinth(event.data.zone, event.data.labyrinth);
            for (let i = 0; i < playersData.length; i++) {
                players.push(createSimPlayer(playersData[i], zone, labyrinth, extraBuffs));
            }
            let simulationTimeLimit = event.data.simulationTimeLimit;
            let enableHpMpVisualization = event.data.extra.enableHpMpVisualization || false;
            let combatSimulator = new CombatSimulator(players, zone, labyrinth, { enableHpMpVisualization });
            combatSimulator.addEventListener("progress", (event) => {
                this.postMessage({ 
                    type: "simulation_progress", 
                    progress: event.detail.progress, 
                    zone: event.detail.zone, 
                    difficultyTier: event.detail.difficultyTier,
                    labyrinth: event.detail.labyrinth,
                    roomLevel: event.detail.roomLevel,
                    timeSeriesData: event.detail.timeSeriesData
                });
            });

            try {
                let simResult = await combatSimulator.simulate(simulationTimeLimit);
                this.postMessage({ type: "simulation_result", simResult: simResult });
            } catch (e) {
                console.log(e);
                this.postMessage({ type: "simulation_error", error: e });
            }
            break;
    }
};
