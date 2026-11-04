// The player DTO the UI builds from a ground-truth setup file (docs/ground-truth/setups/<name>.json):
// doSoloImport (src/main.js) then buildSimPlayerDTO / startSimulation. Needs hooks.mjs registered first.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const src = (p) => new URL('file:///' + path.join(root, 'src', p).replace(/\\/g, '/')).href;

const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { default: itemDetailMap } = await import(src('combatsimulator/data/itemDetailMap.json'));
const { default: abilitySlotsLevelRequirementList } = await import(src('combatsimulator/data/abilitySlotsLevelRequirementList.json'));
const { default: combatTriggerConditionDetailMap } = await import(src('combatsimulator/data/combatTriggerConditionDetailMap.json'));
const { default: getImportedGuildBuffs } = await import(src('importGuildBuffs.js'));

export function readSetup(name) {
    return JSON.parse(readFileSync(path.join(root, 'docs', 'ground-truth', 'setups', name + '.json'), 'utf8'));
}

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
