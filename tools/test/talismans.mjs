// Test: the talisman module (src/combatsimulator/talismans.js) and its one call site (createSimPlayer / applyTalismans in
// src/simSetup.js, the extra line in Player.updateCombatDetails): the modifier table, the effects and stats of a mocked
// talisman, the optional `talismans` field of the player DTO as gear stats, that every modifier moves the engine (the unique
// ones change no combat stat; their engine effects, Echo's included, are tested at the end), that a gear stat gives the same player as the buff it replaces (and Damage Taken adds to the buffs'), and that an absent field changes nothing (same stats, a byte-equal simulation).
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
const BUILT = ['smite', 'shatter', 'fortify', 'overkill', 'echo'];
check(BUILT.every((i) => same(T.TALISMAN_MODIFIERS[i].effects, [{ stat: i }])), 'table: Smite, Shatter, Fortify, Overkill and Echo each have one effect under their own id');
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
const stats = [...new Set(mods.filter((m) => !m.unique).flatMap((m) => m.effects).map((e) => e.stat))];
const unsummed = stats.filter((s) => !playerSrc.includes('"' + s + '"'));
check(unsummed.length === 0, 'table: every stat is one the player sums', unsummed.join(','));
check(BUILT.every((i) => !playerSrc.includes('"' + i + '"')), 'table: the unique ids are no gear stat the player sums (the engine reads them from talismanStats)');

// ---- The functions on a mocked talisman ----
check(same(T.talismanEffects(undefined), []) && same(T.talismanEffects({}), []) && same(T.talismanEffects({ lines: [] }), []), 'effects: none for no talismans');
const mock = { power: 0, lines: [{ modifier: 'armor', grade: 3 }, { modifier: 'elemental_amplify', grade: 1 }, { modifier: 'auto_attack_damage', grade: 2 }, { modifier: 'echo', grade: 1 }] };
const eff = T.talismanEffects(mock);
check(eff.length === 6 && same(eff[5], { modifier: 'echo', stat: 'echo', value: 0.03 }), 'effects: armor 1, elemental amplify 3, auto attack 1, echo 1 (G1 0.03 under its id)', String(eff.length));
check(same(eff[0], { modifier: 'armor', stat: 'armor', value: 4 }), 'effects: Armor G3 is +4 armor');
check(same(eff.slice(1, 4).map((e) => e.stat), ['waterAmplify', 'natureAmplify', 'fireAmplify']) && eff.slice(1, 4).every((e) => e.value === 0.01), 'effects: Elemental Amplify G1 is +0.01 on all three elements');
check(eff[4].stat === 'autoAttackDamage' && eff[4].value === 0.018, 'effects: Auto Attack Damage G2 is +0.018');
check(same(T.talismanEffects({ lines: mock.lines }), eff) && same(T.talismanEffects({ power: 0, lines: mock.lines }), eff), 'effects: power defaults to 0, the raw grade value');
check(Math.abs(T.talismanEffects({ power: 0.4, lines: [{ modifier: 'armor', grade: 3 }] })[0].value - 5.6) < 1e-9, 'effects: talisman power scales the grade value by (1 + power)');
check(throws(() => T.talismanEffects({ lines: [{ modifier: 'nope', grade: 1 }] })), 'effects: an unknown modifier throws');
for (const bad of [0, 7, 1.5, '3', null, undefined]) check(throws(() => T.talismanEffects({ lines: [{ modifier: 'armor', grade: bad }] })), `effects: grade ${JSON.stringify(bad)} throws`);
check(same(T.talismanEffects({ lines: [{ modifier: 'fortify', grade: 4 }, { modifier: 'smite', grade: 1 }, { modifier: 'echo', grade: 2 }] }), [{ modifier: 'fortify', stat: 'fortify', value: 0.025 }, { modifier: 'smite', stat: 'smite', value: 0.03 }, { modifier: 'echo', stat: 'echo', value: 0.045 }]), 'effects: Fortify G4 is 0.025, Smite G1 0.03 and Echo G2 0.045 under their ids');
check(Math.abs(T.talismanStats({ power: 0.5, lines: [{ modifier: 'overkill', grade: 2 }] }).overkill - 0.3375) < 1e-12, 'effects: talisman power scales a unique line like the others');
check(T.talismanEffects({ lines: [{ modifier: 'threat_reduction', grade: 2 }] })[0].value === -6, 'effects: Reduced Threat is negative');
check(same(T.talismanStats(mock), { armor: 4, waterAmplify: 0.01, natureAmplify: 0.01, fireAmplify: 0.01, autoAttackDamage: 0.018, echo: 0.03 }), 'stats: the mocked talisman as five gear stats and its Echo value');
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
check(same(atZero(withTal([{ modifier: 'echo', grade: 6 }, { modifier: 'fortify', grade: 1 }])).combatDetails, base.combatDetails), 'setup: unique modifiers change no combat stat');
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
check(same(idle.sort(), [...UNIQUE].sort()) && movers.length === 43, 'engine: all 43 combat modifiers change the player at G6, the five unique ones change no combat stat', idle.join(','));

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

// A page-shaped setup: the slot JSON the page keeps (its import carried `talismans`), made into the search's setup by the page's own pageSetups.
const { pageSetups } = await import(pathToFileURL(path.join(root, 'src/whatif/panel.mjs')).href);
const fromPage = (extra) => pageSetups([{ id: '1', name: 'P', json: JSON.stringify(gen(extra)) }])[0];
check(await runOf(fromPage({ talismans: TAL })) === eTal && await runOf(fromPage()) === eBase, 'engine: a what-if run from a page-shaped setup counts its talismans, and without the field equals the run with none');

// ---- The four unique modifiers in the engine (from the in-game text) ----
// Direct calls of CombatUtilities.processAttack with Math.random fixed at R: every roll is the same, so two calls differ only by the talisman.
const { default: CombatUtilities } = await import(src('combatsimulator/combatUtilities.js'));
const { default: Monster } = await import(src('combatsimulator/monster.js'));
const S = T.UNIQUE_SETTINGS, DEFAULTS = { ...S };
const withRandom = (r, fn) => { const real = Math.random; Math.random = () => r; try { return fn(); } finally { Math.random = real; } };
const actionMap = JSON.parse(readFileSync(path.join(root, 'src/combatsimulator/data/actionDetailMap.json'), 'utf8'));
const bossZone = Object.entries(actionMap).find(([, a]) => a.combatZoneInfo && !a.combatZoneInfo.isDungeon && a.combatZoneInfo.fightInfo?.bossSpawns?.length)[0];
const BOSS_HRID = actionMap[bossZone].combatZoneInfo.fightInfo.bossSpawns[0].combatMonsterHrid;
const mkMonster = (flags = {}, hp) => { const m = new Monster(BOSS_HRID, 0); Object.assign(m, flags); m.reset(0); if (hp !== undefined) m.combatDetails.currentHitpoints = hp; return m; };
// Every player carries Critical Rate G6 (0.024 > R = 0.01): each hit is a crit, so its roll is the maximum, not the minimum.
const pl = (lines) => atZero(withTal([{ modifier: 'critical_rate', grade: 6 }, ...lines], 0));
const hit = (p, m, r = 0.01, ae = null, attack = null) => withRandom(r, () => CombatUtilities.processAttack(p, m, ae, attack));

// Defaults are the plainest reading of the text.
check(same(DEFAULTS, { SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES: true, SMITE_ON_REFLECT: true, SHATTER_ADDS_TO_PENETRATION: true, SHATTER_ON_ABILITIES: true, FORTIFY_NEW_STACK_RESTARTS_ALL: true, FORTIFY_ON_MISS: false, OVERKILL_CARRIES_ACROSS_FIGHTS: true, OVERKILL_KILLS_ADD_UP: true, OVERKILL_AREA_KILLS: true, OVERKILL_DOT_KILLS: false, OVERKILL_REFLECT_KILLS: false, OVERKILL_EXCESS_AFTER_MITIGATION: true, OVERKILL_PARRY_IS_DIRECT: true, ECHO_STRENGTH: 0.5, ECHO_OWN_DAMAGE_ROLL: true, ECHO_ON_MISSED_TARGETS: true, ECHO_REPEATS_ABILITY_EFFECTS: false, ECHO_REPEAT_STARTS_DOT: false, ECHO_TRIGGERS_ON_HIT_EFFECTS: true, ECHO_CAN_REPEAT_ITSELF: false, ECHO_REPEATS_BLAZE: false, ECHO_HEAL_SAME_TARGETS: true, ECHO_SAME_ATTACK_FOR_OVERKILL: true }), 'unique: the open-question settings and their defaults');
check(T.FORTIFY_MAX_STACKS === 4 && T.FORTIFY_DURATION === 5e9, 'unique: Fortify stacks up to 4 for 5 s');

// The zone marks its boss encounter, and a dungeon's fixed waves.
const bz = new Zone(bossZone, 0); bz.encountersKilled = bz.monsterSpawnInfo.battlesPerBoss;
const bossWave = bz.getRandomEncounter(), plainWave = bz.getRandomEncounter();
check(bossWave.length > 0 && bossWave.every((m) => m.spawnedAsBoss === true && T.isBoss(m)) && plainWave.every((m) => !m.spawnedAsBoss && !T.isBoss(m)), 'smite: the zone boss encounter is a boss, a plain encounter is not');
const dz = new Zone('/actions/combat/chimerical_den', 0); dz.encountersKilled = 5;
const fixed = dz.getNextWave();
check(fixed.length > 0 && fixed.every((m) => m.spawnedInFixedWave === true && T.isBoss(m)), 'smite: a dungeon fixed wave counts as bosses (SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES)');
S.SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES = false; check(!T.isBoss(fixed[0]), 'smite: with the setting off a fixed wave is no boss'); S.SMITE_DUNGEON_FIXED_WAVES_ARE_BOSSES = true;

// Smite: more damage to a boss, none to another monster.
{
    const sm = pl([{ modifier: 'smite', grade: 6 }]), none = pl([]);
    const a = hit(sm, mkMonster({ spawnedAsBoss: true })), b = hit(none, mkMonster({ spawnedAsBoss: true }));
    const c = hit(sm, mkMonster()), d = hit(none, mkMonster());
    check(a.didHit && b.didHit && a.damageDone > b.damageDone && Math.abs(a.damageDone / b.damageDone - 1.12) < 0.02, 'smite: G6 deals about 12 % more to a boss', `${b.damageDone} -> ${a.damageDone}`);
    check(c.damageDone === d.damageDone && c.damageDone > 0, 'smite: no change on a monster that is not a boss');
}

// Shatter: a crit gains penetration, a plain hit does not.
{
    const sh = pl([{ modifier: 'shatter', grade: 6 }]), noSh = pl([]);
    const m0 = mkMonster(); const resist = m0.combatDetails.totalNatureResistance;
    const a = hit(sh, mkMonster()), b = hit(noSh, mkMonster());
    check(resist > 0 && a.isCrit && b.isCrit && a.damageDone > b.damageDone, 'shatter: a crit deals more through the target\'s resistance', `${b.damageDone} -> ${a.damageDone}, resist ${resist}`);
    const plainSh = pl([{ modifier: 'shatter', grade: 6 }]), plainNone = pl([]);
    const e = hit(plainSh, mkMonster(), 0.5), f = hit(plainNone, mkMonster(), 0.5);
    check(!e.isCrit && !f.isCrit && e.didHit && e.damageDone === f.damageDone, 'shatter: a plain hit is unchanged');
    check(Math.abs(T.shatterPenetration(sh, 0.1, true, false) - 0.26) < 1e-12 && T.shatterPenetration(sh, 0.1, false, false) === 0.1, 'shatter: G6 adds 0.16 to a crit\'s penetration (SHATTER_ADDS_TO_PENETRATION)');
    check(Math.abs(T.shatterPenetration(sh, 0.1, true, true) - 0.26) < 1e-12, 'shatter: an ability\'s crit too (SHATTER_ON_ABILITIES)');
}

// Fortify: a stack per landed hit, at most 4, gone 5 s after the last (all stacks restart together).
{
    const { default: CombatSimulator } = await import(src('combatsimulator/combatSimulator.js'));
    const fo = pl([{ modifier: 'fortify', grade: 4 }]);
    const baseArmor = fo.combatDetails.totalArmor, baseFire = fo.combatDetails.totalFireResistance;
    const events = [];
    const sim = { simulationTime: 0, eventQueue: { addEvent: (e) => events.push(e) } };
    const applyAt = (t, didHit = true) => { sim.simulationTime = t; CombatSimulator.prototype.applyFortify.call(sim, fo, { didHit }); };
    applyAt(1e9);
    check(T.fortifyStacks(fo, 1e9) === 1 && Math.abs(fo.combatDetails.totalArmor - baseArmor * 1.025) < 1e-9 && Math.abs(fo.combatDetails.totalFireResistance - baseFire * 1.025) < 1e-9, 'fortify: one hit gives 2.5 % armor and resistances', `${baseArmor} -> ${fo.combatDetails.totalArmor}`);
    for (let i = 2; i <= 6; i++) applyAt(i * 1e9);
    check(T.fortifyStacks(fo, 6e9) === 4 && Math.abs(fo.combatDetails.totalArmor - baseArmor * 1.1) < 1e-9, 'fortify: six hits reach 4 stacks, never 5 (+10 %)');
    applyAt(7e9, false);
    check(T.fortifyStacks(fo, 7e9) === 4 && events.length === 6, 'fortify: a missed attack adds nothing and schedules nothing (FORTIFY_ON_MISS)');
    check(events.every((e, i) => e.time === (i + 1) * 1e9 + 5e9), 'fortify: each stack schedules its run-out check 5 s later', events.map((e) => e.time).join(','));
    fo.removeExpiredBuffs(10.9e9);
    check(T.fortifyStacks(fo, 10.9e9) === 4, 'fortify: still on 4.9 s after the last hit (a new stack restarted all)');
    fo.removeExpiredBuffs(11e9);
    check(T.fortifyStacks(fo, 11e9) === 0 && fo.combatDetails.totalArmor === baseArmor && fo.combatDetails.totalFireResistance === baseFire, 'fortify: gone 5 s after the last hit');
    // Each stack its own timer (the other setting): the first stack runs out alone.
    S.FORTIFY_NEW_STACK_RESTARTS_ALL = false;
    applyAt(20e9); applyAt(22e9);
    fo.removeExpiredBuffs(25e9);
    const own = T.fortifyStacks(fo, 25e9);
    S.FORTIFY_NEW_STACK_RESTARTS_ALL = true;
    check(own === 1, 'fortify: with own timers, the first stack runs out 5 s after its own hit', String(own));
    const plain = pl([]); sim.simulationTime = 0; CombatSimulator.prototype.applyFortify.call(sim, plain, { didHit: true });
    check(T.fortifyStacks(plain, 0) === 0 && Object.keys(plain.combatBuffs).every((k) => !k.includes('fortify')), 'fortify: nothing for a player without it');
}

// Overkill: a kill stores value x excess; the next landed direct attack's first target takes it once as true damage.
{
    const ok = pl([{ modifier: 'overkill', grade: 2 }]), none = pl([]);
    const full = hit(none, mkMonster()).damageDone; // the same roll on a monster with full HP: the hit's damage
    const k = hit(ok, mkMonster({}, 10), 0.01, null, {});
    check(full > 10 && k.damageDone === 10 && Math.abs(ok.overkillStore.amount - 0.225 * (full - 10)) < 1e-9, 'overkill: a kill stores 22.5 % of the excess', `${ok.overkillStore?.amount} vs ${0.225 * (full - 10)}`);
    const stored = Math.floor(ok.overkillStore.amount);
    const miss = hit(ok, mkMonster(), 0.999999, null, {});
    check(!miss.didHit && ok.overkillStore?.amount > 0, 'overkill: a missed attack keeps the store');
    const n = hit(ok, mkMonster(), 0.01, null, {});
    check(n.damageDone === full + stored && n.hitDamageDone === full && ok.overkillStore === null, 'overkill: the next landed attack adds it as true damage and the store empties', `${n.damageDone} vs ${full}+${stored}`);
    const again = hit(ok, mkMonster(), 0.01, null, {});
    check(again.damageDone === full, 'overkill: spent once');
    // The same attack's later targets do not spend the store it filled; two kills in it add up (OVERKILL_KILLS_ADD_UP).
    const A = {};
    hit(ok, mkMonster({}, 10), 0.01, null, A); hit(ok, mkMonster({}, 20), 0.01, null, A);
    check(Math.abs(ok.overkillStore.amount - 0.225 * (2 * full - 30)) < 1e-9, 'overkill: two kills in one attack add up');
    const same2 = hit(ok, mkMonster(), 0.01, null, A);
    check(same2.damageDone === full && ok.overkillStore.amount > 0, 'overkill: the attack that filled the store does not spend it');
    ok.overkillStore = null;
    S.OVERKILL_KILLS_ADD_UP = false;
    const B = {}; hit(ok, mkMonster({}, 10), 0.01, null, B); hit(ok, mkMonster({}, 20), 0.01, null, B);
    S.OVERKILL_KILLS_ADD_UP = true;
    check(Math.abs(ok.overkillStore.amount - 0.225 * (full - 20)) < 1e-9, 'overkill: with the setting off the later kill overwrites');
    ok.overkillStore = null;
    // An area ability's kill counts (OVERKILL_AREA_KILLS); a parry's counterattack is direct (OVERKILL_PARRY_IS_DIRECT).
    const area = { combatStyleHrid: ok.combatDetails.combatStats.combatStyleHrid, damageType: ok.combatDetails.combatStats.damageType, targetType: 'allEnemies', bonusAccuracyRatio: 0, damageFlat: 0, damageRatio: 1, armorDamageRatio: 0 };
    hit(ok, mkMonster({}, 1), 0.01, area, {});
    check(ok.overkillStore?.amount > 0, 'overkill: an area ability\'s kill fills the store');
    ok.overkillStore = null;
    withRandom(0.01, () => CombatUtilities.processAttack(ok, mkMonster({}, 10), null, null, true));
    check(ok.overkillStore?.amount > 0, 'overkill: a parry\'s kill fills the store');
    // The true damage ignores armor, crit and Smite; no store for a player without it.
    ok.overkillStore = { amount: 50.7, attack: null };
    const boss = hit(ok, mkMonster({ spawnedAsBoss: true }), 0.01, null, {});
    check(boss.damageDone - boss.hitDamageDone === 50, 'overkill: the stored amount lands as is (floored), with no armor or multiplier');
    hit(none, mkMonster({}, 10), 0.01, null, {});
    check(!none.overkillStore, 'overkill: nothing stored for a player without it');
}
for (const [k, v] of Object.entries(DEFAULTS)) S[k] = v;

// The page's simulation and the what-if engine get the four by the same path: a run with them differs from one without.
const U = { power: 0, lines: [{ modifier: 'smite', grade: 6 }, { modifier: 'shatter', grade: 6 }, { modifier: 'fortify', grade: 6 }, { modifier: 'overkill', grade: 6 }] };
const viaU = await run((z) => createSimPlayer(withTal(U.lines, 0), z, null, buildExtraBuffs(EXTRA)));
check(viaU !== viaOld, 'run: the four unique modifiers change a 10 minute simulation');
check(await runOf(gen({ talismans: U })) !== eBase, 'engine: the four unique modifiers change the what-if run');
// ---- Echo (talisman, checked against a test-server recording) ----
// Direct calls with Math.random fixed or counted; casts through tryUseAbility on a simulator with live monsters.
{
    const { createHash } = await import('node:crypto');
    const { default: DamageOverTimeEvent } = await import(src('combatsimulator/events/damageOverTimeEvent.js'));
    const counted = (r, fn) => { let n = 0; const real = Math.random; Math.random = () => { n++; return r; }; try { return { out: fn(), n }; } finally { Math.random = real; } };
    const spy = (obj, name, fn) => { const real = obj[name]; const log = []; obj[name] = function (...a) { log.push(a); return real.apply(this, a); }; try { return { out: fn(), log }; } finally { obj[name] = real; } };
    const ab = (hrid) => new Ability(hrid, 30);
    const effectOf = (hrid) => ab(hrid).abilityEffects[0];
    const ep = () => pl([{ modifier: 'echo', grade: 6 }]); // Echo G6 (0.12) and Critical Rate G6
    const mkSim = (p, n = 3, hp) => {
        const sim = new CombatSimulator([p], new Zone(ZONE.zoneHrid, ZONE.difficultyTier), null, {});
        sim.simulationTime = 0; sim.players = [p];
        sim.enemies = Array.from({ length: n }, () => mkMonster({}, hp));
        for (const m of sim.enemies) sim.simResult.updateTimeSpentAlive(m.hrid, true, 0); // spawned, as the engine marks it
        return sim;
    };
    // A cast with Math.random fixed at r: the processAttack calls ([source, target, effect, attack, isParry, echo]), the random calls.
    const cast = (p, hrid, r, n = 3, hp, sim = mkSim(p, n, hp)) => {
        const ability = ab(hrid);
        const { out, log } = spy(CombatUtilities, 'processAttack', () => counted(r, () => sim.tryUseAbility(p, ability)));
        return { sim, ability, used: out.out, randoms: out.n, attacks: log, repeats: log.filter((a) => a[5]), originals: log.filter((a) => !a[5]) };
    };

    // The chance: the line value times (1 + Talisman Power), one roll, none without the line.
    const g4 = atZero(withTal([{ modifier: 'echo', grade: 4 }], 0.224));
    check(Math.abs(T.uniqueValue(g4, 'echo') - 0.0918) < 1e-12, 'echo: G4 at power 0.224 is 0.0918 (the game\'s own stat)');
    check(withRandom(0.0917, () => T.echoProcs(g4)) && !withRandom(0.0919, () => T.echoProcs(g4)), 'echo: a roll just under the scaled value repeats, just over it does not');
    check(counted(0, () => T.echoProcs(pl([]))).n === 0 && !withRandom(0, () => T.echoProcs(pl([]))), 'echo: no roll and no repeat for a player without the line');

    // One roll per cast, on an area ability: all targets repeated or none.
    {
        const none = cast(pl([]), '/abilities/flame_blast', 0.5), failed = cast(ep(), '/abilities/flame_blast', 0.5);
        check(none.used && failed.used && none.originals.length === 3 && failed.repeats.length === 0, 'echo: a failed roll repeats nothing (area ability, 3 targets)');
        check(failed.randoms === none.randoms + 1, 'echo: one roll per cast (one random call more than without Echo)', `${none.randoms} -> ${failed.randoms}`);
        const won = cast(ep(), '/abilities/flame_blast', 0.001);
        check(won.originals.length === 3 && won.repeats.length === 3 && won.repeats.every((a, i) => a[1] === won.originals[i][1] && a[5].strength === 0.5 && a[5].roll === null), 'echo: a won roll repeats on every target the cast struck, at half, with its own rolls');
        check(won.repeats.every((a) => a[3] === won.originals[0][3]) && won.repeats.every((a) => a[2] === won.originals[0][2]), 'echo: the repeat is the same ability effect and, for Overkill, the cast\'s attack (ECHO_SAME_ATTACK_FOR_OVERKILL)');
        const killed = cast(ep(), '/abilities/flame_blast', 0.001, 3, 1), killedNone = cast(pl([]), '/abilities/flame_blast', 0.001, 3, 1);
        check(killed.originals.length === 3 && killed.repeats.length === 0 && killed.randoms === killedNone.randoms, 'echo: a cast that killed every target repeats on nothing and rolls nothing');
        const one = cast(ep(), '/abilities/life_drain', 0.001);
        check(one.originals.length === 1 && one.repeats.length === 1 && one.repeats[0][1] === one.originals[0][1], 'echo: a single-target ability repeats on its one target');
    }

    // The repeat's size, hit, crit and drain (direct processAttack calls).
    {
        const ld = effectOf('/abilities/life_drain');
        const p = ep(); p.combatDetails.currentHitpoints = 1;
        const full = withRandom(0.01, () => CombatUtilities.processAttack(p, mkMonster(), ld, null));
        p.combatDetails.currentHitpoints = 1;
        const half = withRandom(0.01, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: 0.5, roll: null }));
        check(full.didHit && half.didHit && full.damageDone > 100 && Math.abs(half.damageDone / full.damageDone - 0.5) < 0.01, 'echo: the repeat deals half', `${full.damageDone} -> ${half.damageDone}`);
        const drain = Math.floor(ld.hpDrainRatio * half.hitDamageDone * (1 + p.combatDetails.combatStats.healingAmplify));
        check(half.hpDrain > 0 && half.hpDrain === drain, 'echo: Life Drain\'s repeat drains at the full rate on its own damage', `${half.hpDrain} vs ${drain}`);
        const plainHit = withRandom(0.5, () => CombatUtilities.processAttack(p, mkMonster(), ld, null));
        const critRepeat = withRandom(0.01, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: 0.5, roll: null }));
        const missRepeat = withRandom(0.999999, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: 0.5, roll: null }));
        check(!plainHit.isCrit && critRepeat.isCrit && full.didHit && !missRepeat.didHit, 'echo: the repeat rolls its own crit and its own hit');
        const n0 = counted(0.5, () => CombatUtilities.processAttack(p, mkMonster(), ld, null)).n, n1 = counted(0.5, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: 0.5, roll: null })).n;
        check(n0 === n1, 'echo: the repeat makes the same rolls as a hit (ECHO_OWN_DAMAGE_ROLL)');
        // ECHO_OWN_DAMAGE_ROLL off: the original's roll and crit at half, no crit or damage roll of its own.
        const same = counted(0.5, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: 0.5, roll: full }));
        check(same.n < n0 && same.out.isCrit === full.isCrit && same.out.damageRollRaw === full.damageRollRaw && Math.abs(same.out.damageDone / full.damageDone - 0.5) < 0.01, 'echo: with ECHO_OWN_DAMAGE_ROLL off the repeat is half of the original\'s roll, crit copied');
    }

    // Nothing on an auto attack: a 10 minute run of a player with no ability is byte-equal with and without Echo.
    {
        const autoOnly = (lines) => ({ ...mkDto(), abilities: [null, null, null, null, null], ...(lines ? { talismans: { power: 0, lines } } : {}) });
        const a = await run((z) => createSimPlayer(autoOnly(), z, null, buildExtraBuffs(EXTRA))), b = await run((z) => createSimPlayer(autoOnly([{ modifier: 'echo', grade: 6 }]), z, null, buildExtraBuffs(EXTRA)));
        check(a === b && a.length > 1000, 'echo: never on an auto attack (a run with auto attacks only is byte-equal with Echo G6)');
    }

    // A heal ability: its healing comes again at half; Bloom is not repeated.
    {
        const p = ep(); p.combatDetails.currentHitpoints = 1;
        const sim = mkSim(p);
        const qa = ab('/abilities/quick_aid'); // the weapon's Bloom also heals at this roll: count Quick Aid's own heals
        const { log } = spy(CombatUtilities, 'processHeal', () => withRandom(0.001, () => sim.tryUseAbility(p, qa)));
        const heals = log.filter((a) => a[1] === qa.abilityEffects[0]).map((a) => a[3] ?? 1);
        const got = sim.simResult.hitpointsGained[p.hrid]['/abilities/quick_aid'];
        check(same(heals, [1, 0.5]), 'echo: a heal ability\'s healing is repeated once, at half', JSON.stringify(heals));
        const one = CombatUtilities.processHeal; const healRoll = withRandom(0.001, () => { const q = ep(); q.combatDetails.currentHitpoints = 1; return one.call(CombatUtilities, q, effectOf('/abilities/quick_aid'), q); });
        check(got === healRoll + Math.floor(healRoll * 0.5), 'echo: the repeat heals half the roll, floored', `${got} vs ${healRoll}`);
        const b = ep(); b.combatDetails.currentHitpoints = 1;
        const bsim = mkSim(b); b.combatDetails.combatStats.bloom = 1;
        const bl = spy(bsim, 'processAbilityHealEffect', () => cast(b, '/abilities/life_drain', 0.001, 3, undefined, bsim));
        const bloomCalls = bl.log.filter((a) => /bloom/.test(a[1].hrid));
        check(bl.out.repeats.length === 1 && bloomCalls.length === 1 && bloomCalls[0][3] === undefined && bl.log.every((a) => a[3] === undefined), 'echo: Bloom heals once, never repeated, and the repeat rolls no Bloom');
    }

    // The repeat is not a cast: no mana, no cooldown.
    {
        const p = ep(); const mana = p.combatDetails.currentManapoints;
        const c = cast(p, '/abilities/life_drain', 0.001);
        check(c.repeats.length === 1 && mana - p.combatDetails.currentManapoints === c.ability.manaCost && c.ability.lastUsed === 0 && p.abilityManaCosts.get(c.ability.hrid) === c.ability.manaCost, 'echo: the repeat costs no mana and starts no cooldown');
    }

    // Each setting behaves as its default says, and as its other value.
    {
        const S = T.UNIQUE_SETTINGS;
        const p = ep(); const ld = effectOf('/abilities/life_drain');
        S.ECHO_STRENGTH = 1;
        const fullEcho = withRandom(0.01, () => CombatUtilities.processAttack(p, mkMonster(), ld, null, false, { strength: S.ECHO_STRENGTH, roll: null }));
        const fullHit = withRandom(0.01, () => CombatUtilities.processAttack(p, mkMonster(), ld, null));
        S.ECHO_STRENGTH = 0.5;
        check(fullEcho.damageDone === fullHit.damageDone, 'echo: ECHO_STRENGTH 1 gives a full-size repeat');
        // ECHO_ON_MISSED_TARGETS: a target the original missed is repeated on; off, only the ones it landed on.
        const plan = (sim) => [{ ability: ab('/abilities/flame_blast'), abilityEffect: effectOf('/abilities/flame_blast'), attack: {}, struck: [{ target: sim.enemies[0], attackResult: { didHit: true } }, { target: sim.enemies[1], attackResult: { didHit: false } }] }];
        const repeatsOf = (fn) => spy(CombatUtilities, 'processAttack', () => withRandom(0.001, fn)).log.length;
        const s1 = mkSim(p); const onMissed = repeatsOf(() => s1.processEcho(p, plan(s1)));
        S.ECHO_ON_MISSED_TARGETS = false; const s2 = mkSim(p); const offMissed = repeatsOf(() => s2.processEcho(p, plan(s2))); S.ECHO_ON_MISSED_TARGETS = true;
        check(onMissed === 2 && offMissed === 1, 'echo: ECHO_ON_MISSED_TARGETS on repeats on a target the cast missed; off, not', `${onMissed} ${offMissed}`);
        // ECHO_CAN_REPEAT_ITSELF: off, one round; on, it rolls again after each repeat.
        S.ECHO_CAN_REPEAT_ITSELF = true; const s3 = mkSim(p); const chain = repeatsOf(() => s3.processEcho(p, plan(s3))); S.ECHO_CAN_REPEAT_ITSELF = false;
        check(chain > 2, 'echo: ECHO_CAN_REPEAT_ITSELF on chains repeats', String(chain));
        // ECHO_REPEATS_ABILITY_EFFECTS: Toxic Pollen's debuff and Entangle's stun roll are not applied again by default.
        const tp = effectOf('/abilities/toxic_pollen');
        const buffsOn = (echo) => { const sim = mkSim(p); const m = sim.enemies[0]; return spy(m, 'addBuff', () => withRandom(0.001, () => sim.processAbilityHit(p, ab('/abilities/toxic_pollen'), tp, m, {}, echo))).log.length; };
        const ECHO = { strength: 0.5, roll: null };
        const bOrig = buffsOn(null), bRep = buffsOn(ECHO); S.ECHO_REPEATS_ABILITY_EFFECTS = true; const bRepOn = buffsOn(ECHO); S.ECHO_REPEATS_ABILITY_EFFECTS = false;
        check(bOrig > 0 && bRep === 0 && bRepOn === bOrig, 'echo: ECHO_REPEATS_ABILITY_EFFECTS off, the repeat applies no debuff; on, it does', `${bOrig} ${bRep} ${bRepOn}`);
        const en = effectOf('/abilities/entangle');
        const rolls = (echo) => { const sim = mkSim(p); return counted(0.001, () => sim.processAbilityHit(p, ab('/abilities/entangle'), en, sim.enemies[0], {}, echo)).n; };
        const rOrig = rolls(null), rRep = rolls(ECHO);
        check(rRep === rOrig - 1, 'echo: the repeat makes no stun roll (ECHO_REPEATS_ABILITY_EFFECTS)', `${rOrig} ${rRep}`);
        // ECHO_REPEAT_STARTS_DOT: an ability with a damage over time.
        const dotEffect = { ...effectOf('/abilities/flame_blast'), damageOverTimeRatio: 0.5, damageOverTimeDuration: 9e9 };
        const dots = (echo) => { const sim = mkSim(p); return spy(sim.eventQueue, 'addEvent', () => withRandom(0.001, () => sim.processAbilityHit(p, ab('/abilities/flame_blast'), dotEffect, sim.enemies[0], {}, echo))).log.filter((a) => a[0] instanceof DamageOverTimeEvent).length; };
        const dOrig = dots(null), dRep = dots(ECHO); S.ECHO_REPEAT_STARTS_DOT = true; const dRepOn = dots(ECHO); S.ECHO_REPEAT_STARTS_DOT = false;
        check(dOrig === 1 && dRep === 0 && dRepOn === 1, 'echo: ECHO_REPEAT_STARTS_DOT off, the repeat starts no damage over time; on, it does');
        // ECHO_TRIGGERS_ON_HIT_EFFECTS: the target's Fortify (and Curse, Fury, Weaken) on the repeat.
        const fort = (echo) => { const sim = mkSim(p); return spy(sim, 'applyFortify', () => withRandom(0.001, () => sim.processAbilityHit(p, ab('/abilities/life_drain'), ld, sim.enemies[0], {}, echo))).log.length; };
        const fOn = fort(ECHO); S.ECHO_TRIGGERS_ON_HIT_EFFECTS = false; const fOff = fort(ECHO); S.ECHO_TRIGGERS_ON_HIT_EFFECTS = true;
        check(fOn === 1 && fOff === 0, 'echo: ECHO_TRIGGERS_ON_HIT_EFFECTS on, the repeat sets off on-hit effects; off, not');
        // ECHO_REPEATS_BLAZE: a Blaze that came with the cast.
        const blazeRepeats = () => { const b = ep(); const sim = mkSim(b); b.combatDetails.combatStats.blaze = 1; const c = cast(b, '/abilities/entangle', 0.001, 3, undefined, sim); return c.repeats.length - 1; };
        const blOff = blazeRepeats(); S.ECHO_REPEATS_BLAZE = true; const blOn = blazeRepeats(); S.ECHO_REPEATS_BLAZE = false;
        check(blOff === 0 && blOn > 0, 'echo: ECHO_REPEATS_BLAZE off, Blaze is not repeated; on, it is', `${blOff} ${blOn}`);
        // ECHO_HEAL_SAME_TARGETS: the repeat heals the cast's targets, or picks again.
        const healArgs = () => { const h = ep(); h.combatDetails.currentHitpoints = 1; const sim = mkSim(h); return spy(sim, 'processAbilityHealEffect', () => withRandom(0.001, () => sim.tryUseAbility(h, ab('/abilities/quick_aid')))).log.filter((a) => a[1].hrid === '/abilities/quick_aid'); };
        const same1 = healArgs(); S.ECHO_HEAL_SAME_TARGETS = false; const pick = healArgs(); S.ECHO_HEAL_SAME_TARGETS = true;
        check(same1.length === 2 && Array.isArray(same1[1][4]) && same1[1][4].length === 1 && pick.length === 2 && pick[1][4] === null, 'echo: ECHO_HEAL_SAME_TARGETS on, the repeat heals the cast\'s target; off, it picks again');
        // ECHO_SAME_ATTACK_FOR_OVERKILL off: the repeat is an attack of its own.
        S.ECHO_SAME_ATTACK_FOR_OVERKILL = false; const own = cast(ep(), '/abilities/life_drain', 0.001); S.ECHO_SAME_ATTACK_FOR_OVERKILL = true;
        check(own.repeats.length === 1 && own.repeats[0][3] !== own.originals[0][3], 'echo: ECHO_SAME_ATTACK_FOR_OVERKILL off, the repeat is an attack of its own');
    }
    for (const [k, v] of Object.entries(DEFAULTS)) S[k] = v;

    // A page run and a what-if run that Echo changes.
    const viaEcho = await run((z) => createSimPlayer(withTal([{ modifier: 'echo', grade: 6 }], 0), z, null, buildExtraBuffs(EXTRA)));
    check(viaEcho !== viaOld, 'run: Echo changes a 10 minute simulation of a player who casts');
    const caster = { abilities: [null, { abilityHrid: '/abilities/entangle', level: 30 }, null, null, null] };
    check(await runOf(gen({ ...caster, talismans: { power: 0, lines: [{ modifier: 'echo', grade: 6 }] } })) !== await runOf(gen(caster)), 'engine: Echo changes the what-if run of a player who casts');

    // A run without Echo is unchanged: byte-equal with Echo's step removed, and the same as before Echo was built.
    const noEchoDto = () => ({ ...mkDto(), abilities: [new Ability('/abilities/toxic_pollen', 30), new Ability('/abilities/life_drain', 30), new Ability('/abilities/entangle', 30), new Ability('/abilities/quick_aid', 30), new Ability('/abilities/flame_blast', 30)] });
    const runSeeded = async (seed) => { const real = Math.random; Math.random = lcg(seed); try { const z = new Zone(ZONE.zoneHrid, ZONE.difficultyTier); const p = createSimPlayer(noEchoDto(), z, null, buildExtraBuffs(EXTRA)); const r = await new CombatSimulator([p], z, null, {}).simulate(600e9); return JSON.stringify({ r, details: p.combatDetails }); } finally { Math.random = real; } };
    const withStep = await runSeeded(4242);
    const realEcho = CombatSimulator.prototype.processEcho; CombatSimulator.prototype.processEcho = () => {};
    const withoutStep = await runSeeded(4242);
    CombatSimulator.prototype.processEcho = realEcho;
    check(withStep === withoutStep, 'echo: without the line, a run is byte-equal with Echo\'s step taken out (no random call added)');
    // Pinned on commit 3634182, the engine before Echo; an engine change that moves this run re-pins it here. Re-pinned at the merge with loot at
    // each kill, which adds the result's killMultipliers: with that field taken out, this run still hashes to the 3634182 pin (380a7240...).
    const sha = createHash('sha256').update(withStep).digest('hex');
    check(sha === 'ee5bf7902ba68f3719ff8380ffd9511f37665e24474c00e825cb203dc1afcbdf', 'echo: a 10 minute run with five abilities and no Echo is the same as before Echo was built', sha);
}
console.log(fails === 0 ? 'PASS: talismans.' : `FAIL: ${fails} problems.`);
process.exit(fails === 0 ? 0 : 1);
