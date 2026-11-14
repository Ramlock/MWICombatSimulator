// Test: the talisman module (src/combatsimulator/talismans.js) and its one call site (createSimPlayer / applyTalismans in
// src/simSetup.js, the extra line in Player.updateCombatDetails): the modifier table, the effects and stats of a mocked
// talisman, the optional `talismans` field of the player DTO as gear stats, that every modifier moves the engine (the unique
// ones have no effect), that a gear stat gives the same player as the buff it replaces (and Damage Taken adds to the buffs'), and that an absent field changes nothing (same stats, a byte-equal simulation).
// Generic setup, no private data.
// Usage: node tools/test/talismans.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const src = (p) => pathToFileURL(path.join(root, 'src', p)).href;
const T = await import(src('combatsimulator/talismans.js'));
const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
const { default: Player } = await import(src('combatsimulator/player.js'));
const { default: Zone } = await import(src('combatsimulator/zone.js'));
const { default: Equipment } = await import(src('combatsimulator/equipment.js'));
const { default: Consumable } = await import(src('combatsimulator/consumable.js'));
const { default: Ability } = await import(src('combatsimulator/ability.js'));
const { buildExtraBuffs, createZoneAndLabyrinth, createSimPlayer, applyTalismans, startPlayerAtTimeZero } = await import(src('simSetup.js'));

let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- The table ----
const ids = Object.keys(T.TALISMAN_MODIFIERS), mods = Object.values(T.TALISMAN_MODIFIERS);
const UNIQUE = ['smite', 'overkill', 'echo', 'shatter', 'fortify'];
check(ids.length === 48 && ids.filter((i) => !T.TALISMAN_MODIFIERS[i].unique).length === 43, 'table: 43 combat modifiers plus 5 unique', String(ids.length));
check(same(ids.filter((i) => T.TALISMAN_MODIFIERS[i].unique).sort(), [...UNIQUE].sort()), 'table: the unique ones are Smite, Overkill, Echo, Shatter, Fortify');
check(UNIQUE.every((i) => T.TALISMAN_MODIFIERS[i].effects.length === 0), 'table: a unique modifier has no effect');
check(mods.every((m) => m.grades.length === 6 && m.grades.every(Number.isFinite)), 'table: six numeric grade values each');
check(mods.filter((m) => !m.unique).every((m) => m.effects.length >= 1), 'table: every non-unique modifier has an effect');
// The game's grades follow one shared curve times [1, 1.5, 2, 2.5, 3, 4] of G1.
const CURVE = [1, 1.5, 2, 2.5, 3, 4];
check(mods.every((m) => m.grades.every((g, i) => Math.abs(g - m.grades[0] * CURVE[i]) < 1e-12)), 'table: every row is G1 times 1, 1.5, 2, 2.5, 3, 4');
check(ids.every((i) => !/[A-Z]/.test(i)), 'table: ids are lower snake case');
// Values the game showed on screen (generic game facts): Armor Penetration G1 +2 %, G3 +4 %; Auto Attack Damage G2 +1.8 %; Max Manapoints G1 +20; Damage Taken G1 -0.5 %.
const g = (id, n) => T.TALISMAN_MODIFIERS[id].grades[n - 1];
check(g('armor_penetration', 1) === 0.02 && g('armor_penetration', 3) === 0.04 && g('auto_attack_damage', 2) === 0.018 && g('max_manapoints', 1) === 20 && g('damage_taken', 1) === -0.005, 'table: the grade values the game showed');
check(mods.every((m) => m.effects.every((e) => Object.keys(e).join() === 'stat')), 'table: an effect is only a stat name (every line is a gear stat, no buff)');
// Every stat named in the table is one the player sums from equipment.
const playerSrc = readFileSync(path.join(root, 'src/combatsimulator/player.js'), 'utf8');
const stats = [...new Set(mods.flatMap((m) => m.effects).map((e) => e.stat))];
const unsummed = stats.filter((s) => !playerSrc.includes('"' + s + '"'));
check(unsummed.length === 0, 'table: every stat is one the player sums', unsummed.join(','));

// ---- The functions on a mocked talisman ----
check(same(T.talismanEffects(undefined), []) && same(T.talismanEffects({}), []) && same(T.talismanEffects({ lines: [] }), []), 'effects: none for no talismans');
const mock = { power: 0, lines: [{ modifier: 'armor', grade: 3 }, { modifier: 'elemental_amplify', grade: 1 }, { modifier: 'auto_attack_damage', grade: 2 }, { modifier: 'echo', grade: 1 }] };
const eff = T.talismanEffects(mock);
check(eff.length === 5, 'effects: armor 1, elemental amplify 3, auto attack 1, echo 0', String(eff.length));
check(same(eff[0], { modifier: 'armor', stat: 'armor', value: 4 }), 'effects: Armor G3 is +4 armor');
check(same(eff.slice(1, 4).map((e) => e.stat), ['waterAmplify', 'natureAmplify', 'fireAmplify']) && eff.slice(1, 4).every((e) => e.value === 0.01), 'effects: Elemental Amplify G1 is +0.01 on all three elements');
check(eff[4].stat === 'autoAttackDamage' && eff[4].value === 0.018, 'effects: Auto Attack Damage G2 is +0.018');
check(same(T.talismanEffects({ lines: mock.lines }), eff) && same(T.talismanEffects({ power: 0, lines: mock.lines }), eff), 'effects: power defaults to 0, the raw grade value');
check(Math.abs(T.talismanEffects({ power: 0.4, lines: [{ modifier: 'armor', grade: 3 }] })[0].value - 5.6) < 1e-9, 'effects: talisman power scales the grade value by (1 + power)');
check(throws(() => T.talismanEffects({ lines: [{ modifier: 'nope', grade: 1 }] })), 'effects: an unknown modifier throws');
for (const bad of [0, 7, 1.5, '3', null, undefined]) check(throws(() => T.talismanEffects({ lines: [{ modifier: 'armor', grade: bad }] })), `effects: grade ${JSON.stringify(bad)} throws`);
check(same(T.talismanEffects({ lines: [{ modifier: 'fortify', grade: 4 }, { modifier: 'smite', grade: 1 }] }), []), 'effects: unique modifiers give no effect');
check(T.talismanEffects({ lines: [{ modifier: 'threat_reduction', grade: 2 }] })[0].value === -6, 'effects: Reduced Threat is negative');
check(same(T.talismanStats(mock), { armor: 4, waterAmplify: 0.01, natureAmplify: 0.01, fireAmplify: 0.01, autoAttackDamage: 0.018 }), 'stats: the mocked talisman as five gear stats');
const sum = T.talismanStats({ lines: [{ modifier: 'ranged_damage', grade: 2 }, { modifier: 'ranged_damage', grade: 1 }] });
check(Math.abs(sum.rangedDamage - 0.075) < 1e-12, 'stats: lines of the same stat add up');
check(same(T.talismanStats(undefined), {}) && same(T.talismanStats({ lines: [] }), {}), 'stats: nothing in, nothing out');
check(same(T.talismanStats({ lines: [{ modifier: 'damage_taken', grade: 3 }] }), { damageTaken: -0.01 }), 'stats: Damage Taken is listed as a stat');

// ---- The player setup (createSimPlayer, the one call site) ----
const ZONE = { zoneHrid: '/actions/combat/fly', difficultyTier: 0 };
const EXTRA = { mooPass: true, comExp: 0, comDrop: 0, personalBuffs: [] };
const mkDto = () => ({
    hrid: 'player1', staminaLevel: 80, intelligenceLevel: 80, attackLevel: 100, meleeLevel: 60, defenseLevel: 90, rangedLevel: 60, magicLevel: 100,
    equipment: {
        '/equipment_types/main_hand': new Equipment('/items/blooming_trident', 5),
        '/equipment_types/body': new Equipment('/items/royal_nature_robe_top', 5),
    },
    food: [null, null, null],
    drinks: [new Consumable('/items/ultra_magic_coffee'), null, null],
    abilities: [new Ability('/abilities/entangle', 30), null, null, null, null],
    houseRooms: {}, labyrinthUpgrades: {}, guildBuffs: {}, achievements: {}, debuffOnLevelGap: 0,
});
const { zone, labyrinth } = createZoneAndLabyrinth(ZONE, null);
const extra = buildExtraBuffs(EXTRA);
const atZero = (dto) => startPlayerAtTimeZero(createSimPlayer(dto, zone, labyrinth, extra));
const withTal = (lines, power) => ({ ...mkDto(), talismans: { power, lines } });

// Absent field: the extra buffs are the very array given, no talisman stats; the stats equal those of the setup built the old way.
const plain = createSimPlayer(mkDto(), zone, labyrinth, extra);
check(plain.extraBuffs === extra && plain.talismanStats === undefined, 'setup: no talismans field, nothing is added');
const oldWay = Player.createFromDTO(structuredClone(mkDto())); oldWay.zoneBuffs = zone.buffs || []; oldWay.extraBuffs = extra; startPlayerAtTimeZero(oldWay);
const base = atZero(mkDto());
check(same(base.combatDetails, oldWay.combatDetails), 'setup: no talismans field, the stats equal the setup before the module');
check(applyTalismans(plain, undefined) === plain && plain.talismanStats === undefined, 'setup: applyTalismans with no talismans leaves the player as it is');

// With talismans: Armor G3 is +4 armor, and the shared extra buffs are not touched.
const withT = atZero(withTal([{ modifier: 'armor', grade: 3 }, { modifier: 'combat_experience', grade: 6 }], 0));
check(Math.abs(withT.combatDetails.totalArmor - (base.combatDetails.totalArmor + 4)) < 1e-9, 'setup: Armor G3 adds 4 to total armor', `${base.combatDetails.totalArmor} -> ${withT.combatDetails.totalArmor}`);
check(Math.abs(withT.combatDetails.combatStats.combatExperience - (base.combatDetails.combatStats.combatExperience + 0.04)) < 1e-9, 'setup: Combat Experience G6 adds 0.04 on top of the Moo Pass buff');
check(extra.length === 1 && extra[0].typeHrid === '/buff_types/wisdom' && withT.extraBuffs === extra, 'setup: the extra buffs are untouched');
check(same(atZero(mkDto()).combatDetails, base.combatDetails), 'setup: another player built after it has no talisman stats');
check(same(atZero(withTal([{ modifier: 'echo', grade: 6 }, { modifier: 'fortify', grade: 1 }])).combatDetails, base.combatDetails), 'setup: unique modifiers only, nothing changes');
check(same(atZero(withTal([], 0.2)).combatDetails, base.combatDetails), 'setup: a power with no lines, nothing changes');
check(createSimPlayer(withTal([{ modifier: 'armor', grade: 1 }]), zone, labyrinth, undefined).talismanStats.armor === 2, 'setup: talismans work when no extra buffs are given');
// A talisman stat adds to the gear's own: same stat from a worn item and a talisman.
const gearAndTal = atZero(withTal([{ modifier: 'magic_damage', grade: 1 }]));
check(Math.abs(gearAndTal.combatDetails.combatStats.magicDamage - (base.combatDetails.combatStats.magicDamage + 0.03)) < 1e-9, 'setup: a talisman stat adds to the gear stat of the same name');

// ---- Every modifier moves the engine ----
const movers = [], idle = [];
for (const id of ids) {
    const p = atZero(withTal([{ modifier: id, grade: 6 }]));
    (!same(p.combatDetails, base.combatDetails) ? movers : idle).push(id);
}
check(same(idle.sort(), [...UNIQUE].sort()) && movers.length === 43, 'engine: all 43 combat modifiers change the player at G6, the five unique ones do not', idle.join(','));

// ---- A gear stat gives the same player as the buff it replaces ----
// The 18 modifiers that have a buff type of the same bonus, checked on a bare player with no other
// buff and no other gear stat of that kind: the stat is summed where the buff would be added, same number. [buff types, field].
const BUFF_OF = {
    attack_speed: [['attack_speed'], 'ratioBoost'], cast_speed: [['cast_speed']], critical_rate: [['critical_rate']], critical_damage: [['critical_damage']],
    healing_amplify: [['healing_amplify']], physical_amplify: [['physical_amplify']], elemental_amplify: [['water_amplify', 'nature_amplify', 'fire_amplify']],
    thorns: [['physical_thorns', 'elemental_thorns']], armor: [['armor']], tenacity: [['tenacity']], hp_regen: [['hp_regen']], mp_regen: [['mp_regen']],
    elemental_resistance: [['water_resistance', 'nature_resistance', 'fire_resistance']], threat: [['threat']], threat_reduction: [['threat']],
    damage_taken: [['damage_taken']], combat_drop_rate: [['combat_drop_rate']], combat_rare_find: [['rare_find']], combat_experience: [['wisdom']],
};
// The raw inputs the engine reads and then folds into a derived number are left out of the comparison: combatStats.attackSpeed,
// armor and the three resistances (folded into attackInterval, totalArmor and the totalXResistance values, which are compared) and totalThreat (display only; the engine uses
// combatStats.threat, which is compared). Everything else must be identical.
const derived = (cd) => { const c = structuredClone(cd); delete c.combatStats.attackSpeed; for (const k of ['armor', 'waterResistance', 'natureResistance', 'fireResistance']) delete c.combatStats[k]; delete c.totalThreat; return c; };
const bareDto = () => ({ ...mkDto(), equipment: {}, drinks: [null, null, null], abilities: [null, null, null, null, null] });
const bareBase = atZero(bareDto());
for (const [id, [types, field = 'flatBoost']] of Object.entries(BUFF_OF)) {
    for (const grade of [1, 6]) {
        const value = T.TALISMAN_MODIFIERS[id].grades[grade - 1];
        const viaStat = atZero({ ...bareDto(), talismans: { lines: [{ modifier: id, grade }] } });
        const viaBuff = Player.createFromDTO(structuredClone(bareDto())); viaBuff.zoneBuffs = zone.buffs || [];
        viaBuff.extraBuffs = [...extra, ...types.map((t) => ({ uniqueHrid: '/buff_uniques/t_' + t, typeHrid: '/buff_types/' + t, flatBoost: field === 'flatBoost' ? value : 0, ratioBoost: field === 'ratioBoost' ? value : 0, flatBoostLevelBonus: 0, ratioBoostLevelBonus: 0, startTime: '0001-01-01T00:00:00Z', duration: 0 }))];
        startPlayerAtTimeZero(viaBuff);
        check(same(derived(viaStat.combatDetails), derived(viaBuff.combatDetails)) && !same(derived(viaStat.combatDetails), derived(bareBase.combatDetails)), `engine: ${id} G${grade} as a gear stat equals the buff`);
    }
}

// Damage Taken: the gear part adds to the buffs' part, and a rebuild after the crowd-control reset restores both.
const dtPlayer = createSimPlayer(withTal([{ modifier: 'damage_taken', grade: 6 }]), zone, labyrinth, extra);
dtPlayer.extraBuffs = [...extra, { uniqueHrid: '/buff_uniques/t_dt', typeHrid: '/buff_types/damage_taken', flatBoost: 0.05, ratioBoost: 0, flatBoostLevelBonus: 0, ratioBoostLevelBonus: 0, startTime: '0001-01-01T00:00:00Z', duration: 0 }];
startPlayerAtTimeZero(dtPlayer);
check(Math.abs(dtPlayer.combatDetails.combatStats.damageTaken - 0.03) < 1e-12, 'damage taken: gear -0.02 plus buff +0.05 is 0.03', String(dtPlayer.combatDetails.combatStats.damageTaken));
dtPlayer.clearCCs(); dtPlayer.removeExpiredBuffs(1e9);
check(Math.abs(dtPlayer.combatDetails.combatStats.damageTaken - 0.03) < 1e-12, 'damage taken: restored after the crowd-control reset', String(dtPlayer.combatDetails.combatStats.damageTaken));

// ---- A byte-equal simulation without the field ----
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
async function run(makePlayer) {
    const realRandom = Math.random; Math.random = lcg(12345);
    try {
        const z = new Zone(ZONE.zoneHrid, ZONE.difficultyTier);
        const p = makePlayer(z);
        const sim = new CombatSimulator([p], z, null, {});
        const r = await sim.simulate(600e9);
        return JSON.stringify({ r, details: p.combatDetails });
    } finally { Math.random = realRandom; }
}
const viaSetup = await run((z) => createSimPlayer(mkDto(), z, null, buildExtraBuffs(EXTRA)));
const viaOld = await run((z) => { const p = Player.createFromDTO(structuredClone(mkDto())); p.zoneBuffs = z.buffs || []; p.extraBuffs = buildExtraBuffs(EXTRA); return p; });
check(viaSetup === viaOld && viaSetup.length > 1000, 'run: a 10 minute simulation without the field is byte-equal to the one built the old way', String(viaSetup.length));
const viaTal = await run((z) => createSimPlayer(withTal([{ modifier: 'armor', grade: 6 }, { modifier: 'critical_rate', grade: 6 }]), z, null, buildExtraBuffs(EXTRA)));
check(viaTal !== viaOld, 'run: with talismans the same simulation differs');

// ---- The what-if engine takes the same field (setup.talismans, tools/whatif/engine.mjs) ----
const E = await import(pathToFileURL(path.join(root, 'tools/whatif/engine.mjs')).href);
const I = (n) => '/items/' + n;
const gen = (extra = {}) => ({
    name: 'P', guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 60, intelligenceLevel: 60, attackLevel: 60, meleeLevel: 60, defenseLevel: 60, rangedLevel: 60, magicLevel: 60, equipment: [
        { itemLocationHrid: '/item_locations/main_hand', itemHrid: I('blooming_trident'), enhancementLevel: 0 },
        { itemLocationHrid: '/item_locations/pouch', itemHrid: I('giant_pouch'), enhancementLevel: 0 }] },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [null, null, null] }, ...extra,
});
const TAL = { power: 0, lines: [{ modifier: 'armor', grade: 6 }, { modifier: 'critical_rate', grade: 6 }, { modifier: 'damage_taken', grade: 6 }] };
check(E.buildDtos([gen()])[0].talismans === undefined && same(E.buildDtos([gen({ talismans: TAL })])[0].talismans, TAL), 'engine: buildDtos carries setup.talismans onto the DTO, absent stays absent');
const runOf = async (setup) => JSON.stringify((await E.runParty({ setups: [setup], seed: 7, checkpoints: [1], tier: 0, zone: '/actions/combat/fly' })).checkpoints[0]);
const eBase = await runOf(gen()), eEmpty = await runOf(gen({ talismans: { lines: [] } })), eTal = await runOf(gen({ talismans: TAL }));
check(eBase === eEmpty && eBase.length > 200, 'engine: no talismans and an empty talismans give the same what-if run');
check(eBase !== eTal, 'engine: talismans on the setup change the what-if run');
let seen = null;
await E.runParty({ setups: [gen({ talismans: TAL })], seed: 7, checkpoints: [0.01], tier: 0, zone: '/actions/combat/fly', onPlayers: (pls) => { seen = pls[0].talismanStats; } });
check(same(seen, { armor: 8, criticalRate: 0.024, damageTaken: -0.02 }), 'engine: the player carries the summed talisman stats', JSON.stringify(seen));

console.log(fails === 0 ? 'PASS: talismans.' : `FAIL: ${fails} problems.`);
process.exit(fails === 0 ? 0 : 1);
