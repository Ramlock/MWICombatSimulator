// Check: the Combat Stats panel equals the engine's time-0 stats for Ramlock's setup.
// Panel side: what src/main.js updateCombatStatsUI renders, getTimeZeroPlayer (src/simSetup.js) then
// getCombatStatsPanelValues (src/combatStatsPanel.js). Engine side: a real CombatSimulator run, set up as
// the worker sets players up, with the player's combatDetails captured at the first combat start (time 0),
// after generatePermanentBuffs and reset, before the first encounter spawns.
// Cases: houses as in the file, all houses 0, and houses as file with every extra toggle on.
// Usage: node tools/calibration/panel-check.mjs [--setup Ramlock] [--zone /actions/combat/infernal_abyss] [--tier 4]
// Exit code 0 when every panel value equals the engine's in every case, 1 otherwise.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i < 0 ? def : process.argv[i + 1];
}
const SETUP = arg('setup', 'Ramlock');
const ZONE = arg('zone', '/actions/combat/infernal_abyss');
const TIER = Number(arg('tier', 4));

const { buildDto, readSetup, src } = await import('./setupDto.mjs');
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { getTimeZeroPlayer, buildExtraBuffs } = await import(src('simSetup.js'));
const { getCombatStatsPanelValues } = await import(src('combatStatsPanel.js'));

const NO_EXTRA = { mooPass: false, comExp: 0, comDrop: 0, personalBuffs: [] };
const ALL_EXTRA = {
    mooPass: true, comExp: 20, comDrop: 20,
    personalBuffs: ['/items/seal_of_attack_speed', '/items/seal_of_cast_speed', '/items/seal_of_combat_drop', '/items/seal_of_critical_rate',
        '/items/seal_of_damage', '/items/seal_of_rare_find', '/items/seal_of_wisdom'],
};
const TEXT_STATS = ['combatStyleHrid', 'damageType', 'primaryTraining', 'focusTraining'];

// The engine's combatDetails at time 0, from a real simulation.
async function engineTimeZero(dto, extra) {
    const zone = new Zone(ZONE, TIER);
    const p = Player.createFromDTO(structuredClone(dto));
    p.zoneBuffs = zone.buffs || [];
    p.extraBuffs = buildExtraBuffs(extra);
    const sim = new CombatSimulator([p], zone, null, {});
    let captured = null;
    const startNewEncounter = sim.startNewEncounter;
    sim.startNewEncounter = function () {
        if (!captured) captured = structuredClone(this.players[0].combatDetails);
        return startNewEncounter.call(this);
    };
    await sim.simulate(1e9);
    return captured;
}

// What the panel showed before this change: the UI player's own updateCombatDetails, no buffs.
function oldPanel(dto) {
    const p = Player.createFromDTO(structuredClone(dto));
    p.updateCombatDetails();
    return p.combatDetails;
}

const setup = readSetup(SETUP);
const fileDto = buildDto(setup, 1);
fileDto.debuffOnLevelGap = 0;
const zeroDto = structuredClone(fileDto);
for (const hrid of Object.keys(zeroDto.houseRooms)) zeroDto.houseRooms[hrid] = 0;

const cases = [
    { name: 'houses as file', dto: fileDto, extra: NO_EXTRA },
    { name: 'houses 0', dto: zeroDto, extra: NO_EXTRA },
    { name: 'houses as file, all extras on', dto: fileDto, extra: ALL_EXTRA },
];

let failures = 0;
const table = {};
for (const c of cases) {
    const zoneSpec = { zoneHrid: ZONE, difficultyTier: TIER };
    const panelUnit = getTimeZeroPlayer(c.dto, zoneSpec, null, c.extra);
    const panel = getCombatStatsPanelValues(panelUnit.combatDetails);
    const engineDetails = await engineTimeZero(c.dto, c.extra);
    const engine = getCombatStatsPanelValues(engineDetails);
    const old = getCombatStatsPanelValues(oldPanel(c.dto));
    let mismatches = 0, oldMismatches = 0;
    for (const key of Object.keys(engine)) {
        if (panel[key] !== engine[key]) { mismatches++; console.log(`MISMATCH [${c.name}] ${key}: panel ${panel[key]} engine ${engine[key]}`); }
        if (old[key] !== engine[key]) oldMismatches++;
        (table[key] ??= {})[c.name] = { panel: panel[key], engine: engine[key], old: old[key] };
    }
    for (const key of TEXT_STATS) {
        if (panelUnit.combatDetails.combatStats[key] !== engineDetails.combatStats[key]) {
            mismatches++; console.log(`MISMATCH [${c.name}] ${key}: panel ${panelUnit.combatDetails.combatStats[key]} engine ${engineDetails.combatStats[key]}`);
        }
    }
    // The raw numbers behind the rows, not only their rounded text.
    const raw = (d) => JSON.stringify(d, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(15)) : v));
    const rawEqual = raw(panelUnit.combatDetails) === raw(engineDetails);
    if (!rawEqual) { mismatches++; console.log(`MISMATCH [${c.name}] raw combatDetails differ`); }
    failures += mismatches;
    console.log(`[${c.name}] rows ${Object.keys(engine).length + TEXT_STATS.length}, panel vs engine mismatches ${mismatches}, raw combatDetails equal ${rawEqual}; old panel vs engine: ${oldMismatches} rows differ`);
}

const show = ['staminaLevel', 'intelligenceLevel', 'attackLevel', 'meleeLevel', 'defenseLevel', 'rangedLevel', 'magicLevel',
    'maxHitpoints', 'maxManapoints', 'attackInterval', 'magicAccuracyRating', 'magicMaxDamage', 'totalArmor',
    'hpRegenPer10', 'mpRegenPer10', 'castSpeed', 'combatExperience', 'combatRareFind'];
console.log('\n| Row | Old panel | Houses as file: panel | engine | Houses 0: panel | engine | All extras: panel | engine |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const key of show) {
    const t = table[key];
    console.log(`| ${key} | ${t['houses as file'].old} | ${t['houses as file'].panel} | ${t['houses as file'].engine} | ${t['houses 0'].panel} | ${t['houses 0'].engine} | ${t['houses as file, all extras on'].panel} | ${t['houses as file, all extras on'].engine} |`);
}
console.log(failures === 0 ? '\nPASS: every panel value equals the engine at time 0 in every case.' : `\nFAIL: ${failures} mismatches.`);
process.exit(failures === 0 ? 0 : 1);
