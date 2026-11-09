// Node loader for attribution-core.mjs: registers the engine's import hooks and gathers the classes and tables the core takes.
import { register, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const imp = async (p) => (await import(src(p))).default;

export async function loadEngine() {
    const scaling = await import(src('combatsimulator/buffScaling.js'));
    const require = createRequire(import.meta.url);
    const { attributeBonuses } = require(path.join(root, 'userscript', 'mwics-exporter.user.js'));
    return {
        Player: await imp('combatsimulator/player.js'),
        Monster: await imp('combatsimulator/monster.js'),
        Buff: await imp('combatsimulator/buff.js'),
        Equipment: await imp('combatsimulator/equipment.js'),
        itemDetailMap: await imp('combatsimulator/data/itemDetailMap.json'),
        abilityDetailMap: await imp('combatsimulator/data/abilityDetailMap.json'),
        guildBuffDetailMap: await imp('combatsimulator/data/guildBuffDetailMap.json'),
        combatMonsterDetailMap: await imp('combatsimulator/data/combatMonsterDetailMap.json'),
        enhancementTable: await imp('combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json'),
        scaleAbilityBuff: scaling.scaleAbilityBuff,
        scaleConsumableBuff: scaling.scaleConsumableBuff,
        attributeBonuses,
    };
}
