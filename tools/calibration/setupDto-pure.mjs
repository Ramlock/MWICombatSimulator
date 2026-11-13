// The player DTO the UI builds from a ground-truth setup file (docs/ground-truth/setups/<name>.json):
// doSoloImport (src/main.js) then buildSimPlayerDTO / startSimulation.
// The pure part: static imports only, no node: module, no file read, no import.meta, no computed import(), so a bundler (webpack, for a
// Web Worker) and Node load it alike. In Node the loader hooks (tools/calibration/hooks.mjs) must be registered before this file is
// imported; setupDto.mjs is the Node side (the setups folder, root, src paths) and re-exports this.
import Player from '../../src/combatsimulator/player.js';
import Equipment from '../../src/combatsimulator/equipment.js';
import Consumable from '../../src/combatsimulator/consumable.js';
import Ability from '../../src/combatsimulator/ability.js';
import itemDetailMap from '../../src/combatsimulator/data/itemDetailMap.json';
import abilitySlotsLevelRequirementList from '../../src/combatsimulator/data/abilitySlotsLevelRequirementList.json';
import combatTriggerConditionDetailMap from '../../src/combatsimulator/data/combatTriggerConditionDetailMap.json';
import getImportedGuildBuffs from '../../src/importGuildBuffs.js';

// src/main.js fixTriggerMap
export function fixTriggerMap(triggerMap) {
    for (const key of Object.keys(triggerMap)) {
        if (triggerMap[key] == null) triggerMap[key] = [];
        if (triggerMap[key].some((t) => !combatTriggerConditionDetailMap[t.conditionHrid])) delete triggerMap[key];
    }
}

// src/main.js calcCombatLevel
export function calcCombatLevel(sta, int, def, att, mel, ran, mag) {
    return 0.1 * (sta + int + att + def + Math.max(mel, ran, mag)) + 0.5 * Math.max(att, def, mel, ran, mag);
}

// legacyImport: read guildBuffs only, as the import did before calibration batch 2.
export function buildDto(setup, j, { legacyImport = false } = {}) {
    const triggerMap = structuredClone(setup.triggerMap || {});
    fixTriggerMap(triggerMap);
    const p = setup.player;
    const dto = {
        hrid: 'player' + j,
        staminaLevel: p.staminaLevel, intelligenceLevel: p.intelligenceLevel, attackLevel: p.attackLevel,
        meleeLevel: p.meleeLevel ?? p.powerLevel, defenseLevel: p.defenseLevel, rangedLevel: p.rangedLevel, magicLevel: p.magicLevel,
        equipment: {}, food: [], drinks: [], abilities: [],
        houseRooms: setup.houseRooms || {},
        labyrinthUpgrades: {}, // buildSimPlayerDTO: labyrinth upgrades only in labyrinth simulations
        guildBuffs: legacyImport ? { ...(setup.guildBuffs || {}) } : getImportedGuildBuffs(setup),
        achievements: setup.achievements || {},
    };
    // Equipment selects exist for these locations only (doSoloImport); trinket has no UI slot.
    for (const loc of ['head', 'body', 'legs', 'feet', 'hands', 'off_hand', 'pouch', 'neck', 'earrings', 'ring', 'back', 'charm', 'main_hand', 'two_hand']) {
        const it = p.equipment.find((e) => e.itemLocationHrid === '/item_locations/' + loc);
        if (!it) continue;
        const type = itemDetailMap[it.itemHrid].equipmentDetail.type;
        dto.equipment[type] = new Equipment(it.itemHrid, it.enhancementLevel);
    }
    // Slot counts come from the pouch (buildSimPlayerDTO via player.combatDetails).
    const probe = Player.createFromDTO(structuredClone({ ...dto, food: [], drinks: [], abilities: [] }));
    probe.updateCombatDetails();
    const food = (setup.food['/action_types/combat'] || []).map((f) => f?.itemHrid || '');
    const drinks = (setup.drinks['/action_types/combat'] || []).map((d) => (d?.itemHrid || '').replace('power', 'melee'));
    for (let i = 0; i < 3; i++) {
        dto.food[i] = food[i] && i < probe.combatDetails.combatStats.foodSlots ? new Consumable(food[i], triggerMap[food[i]]) : null;
        dto.drinks[i] = drinks[i] && i < probe.combatDetails.combatStats.drinkSlots ? new Consumable(drinks[i], triggerMap[drinks[i]]) : null;
    }
    // Abilities: 5 entries → slots 0..4 (doSoloImport); slot gate in buildSimPlayerDTO.
    const abil = setup.abilities || [];
    const hasSpecial = abil.length == 5;
    for (let i = 0; i < 5; i++) {
        const a = hasSpecial ? abil[i] : abil[i - 1];
        dto.abilities[i] = a && a.abilityHrid && Number(a.level) > 0 && dto.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]
            ? new Ability(a.abilityHrid, Number(a.level), triggerMap[a.abilityHrid]) : null;
    }
    return structuredClone(dto);
}
