// Test: the Combat Stats panel (getTimeZeroPlayer with drinks and auras, as src/main.js shows it) equals the stats
// the same player has in a real combat once its drinks and auras are on. Generic setup, no private data.
// Usage: node tools/test/panel-matches-combat.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { getTimeZeroPlayer, buildExtraBuffs } = await import(src('simSetup.js'));
const { getCombatStatsPanelValues } = await import(src('combatStatsPanel.js'));

const ZONE = { zoneHrid: '/actions/combat/fly', difficultyTier: 0 };
const EXTRA = { mooPass: false, comExp: 0, comDrop: 0, personalBuffs: [] };
const dto = {
    hrid: 'player1', staminaLevel: 80, intelligenceLevel: 80, attackLevel: 100, meleeLevel: 60, defenseLevel: 90, rangedLevel: 60, magicLevel: 100,
    equipment: {
        '/equipment_types/main_hand': new Equipment('/items/blooming_trident', 5),
        '/equipment_types/body': new Equipment('/items/royal_nature_robe_top', 5),
    },
    food: [null, null, null],
    drinks: [new Consumable('/items/ultra_magic_coffee'), new Consumable('/items/channeling_coffee'), null],
    abilities: [new Ability('/abilities/speed_aura', 20), new Ability('/abilities/guardian_aura', 20), new Ability('/abilities/entangle', 30), null, null],
    houseRooms: {}, labyrinthUpgrades: {}, guildBuffs: {}, achievements: {}, debuffOnLevelGap: 0,
};

// Panel: what the UI shows.
const panel = getCombatStatsPanelValues(getTimeZeroPlayer(dto, ZONE, null, EXTRA).combatDetails);
const noDrinksAuras = getCombatStatsPanelValues(getTimeZeroPlayer(dto, ZONE, null, EXTRA, false).combatDetails);

// Combat: the same player in a real simulation; take its stats at the first moment every drink and aura buff is on.
const zone = new Zone(ZONE.zoneHrid, ZONE.difficultyTier);
const p = Player.createFromDTO(structuredClone(dto));
p.zoneBuffs = zone.buffs || [];
p.extraBuffs = buildExtraBuffs(EXTRA);
const sim = new CombatSimulator([p], zone, null, {});
const wanted = ['magic_coffee', 'channeling_coffee', 'speed_aura_attack_speed', 'speed_aura_cast_speed', 'guardian_aura'];
let combat = null;
const addNext = sim.addNextAttackEvent.bind(sim);
sim.addNextAttackEvent = function (source) {
    addNext(source);
    if (!combat && source === p && wanted.every((w) => Object.keys(p.combatBuffs).some((k) => k.includes(w)))) {
        combat = getCombatStatsPanelValues(structuredClone(p.combatDetails));
    }
};
await sim.simulate(60e9);

let failures = 0;
if (!combat) { console.log('FAIL: drinks and auras never all became active in the combat'); process.exit(1); }
for (const key of Object.keys(combat)) {
    if (panel[key] !== combat[key]) { failures++; console.log(`MISMATCH ${key}: panel ${panel[key]} combat ${combat[key]}`); }
}
// The test is only meaningful if the drinks and auras move the stats.
const moved = ['attackInterval', 'castSpeed', 'magicMaxDamage', 'totalArmor', 'healingAmplify'].filter((k) => noDrinksAuras[k] !== combat[k]);
if (moved.length < 5) { failures++; console.log(`FAIL: drinks and auras should change all of attackInterval, castSpeed, magicMaxDamage, totalArmor, healingAmplify; changed only: ${moved}`); }
console.log(['attackInterval', 'castSpeed', 'magicMaxDamage', 'totalArmor', 'healingAmplify', 'magicLevel']
    .map((k) => `${k}: without ${noDrinksAuras[k]} | panel ${panel[k]} | combat ${combat[k]}`).join('\n'));
console.log(failures === 0 ? `PASS: panel equals the combat in all ${Object.keys(combat).length} rows.` : `FAIL: ${failures} problems.`);
process.exit(failures === 0 ? 0 : 1);
