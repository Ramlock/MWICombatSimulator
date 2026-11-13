// Test: the talisman module (src/combatsimulator/talismans.js) and its one call site (createSimPlayer in src/simSetup.js):
// the modifier table, the effects of a mocked talisman, the buff / stat split, the optional `talismans` field of the player
// DTO, and that an absent field changes nothing (same extra buffs, same stats, a byte-equal simulation). Generic setup, no private data.
// Usage: node tools/test/talismans.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
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
const { buildExtraBuffs, createZoneAndLabyrinth, createSimPlayer, startPlayerAtTimeZero } = await import(src('simSetup.js'));

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
// Every buff type named in the table is one the engine's stat code reads.
const unitSrc = (await import('node:fs')).readFileSync(path.join(root, 'src/combatsimulator/combatUnit.js'), 'utf8');
const buffTypes = [...new Set(mods.flatMap((m) => m.effects).filter((e) => e.buff).map((e) => e.buff.type))];
check(buffTypes.every((t) => unitSrc.includes('"/buff_types/' + t + '"')), 'table: every buff type is read by the engine', buffTypes.filter((t) => !unitSrc.includes('"/buff_types/' + t + '"')).join(','));
// Every stat named in the table is one the player sums from equipment (or damageTaken, which only buffs set).
const playerSrc = (await import('node:fs')).readFileSync(path.join(root, 'src/combatsimulator/player.js'), 'utf8');
const stats = [...new Set(mods.flatMap((m) => m.effects).map((e) => e.stat))];
check(stats.every((s) => s === 'damageTaken' || playerSrc.includes('"' + s + '"')), 'table: every stat is one the player sums', stats.filter((s) => s !== 'damageTaken' && !playerSrc.includes('"' + s + '"')).join(','));

// ---- The function on a mocked talisman ----
check(same(T.talismanEffects(undefined), []) && same(T.talismanEffects({}), []) && same(T.talismanEffects({ lines: [] }), []), 'effects: none for no talismans');
const mock = { power: 0, lines: [{ modifier: 'armor', grade: 3 }, { modifier: 'elemental_amplify', grade: 1 }, { modifier: 'auto_attack_damage', grade: 2 }, { modifier: 'echo', grade: 1 }] };
const eff = T.talismanEffects(mock);
check(eff.length === 5, 'effects: armor 1, elemental amplify 3, auto attack 1, echo 0', String(eff.length));
check(same(eff[0], { modifier: 'armor', stat: 'armor', value: 4, buff: { type: 'armor', field: 'flatBoost' } }), 'effects: Armor G3 is +4 flat armor');
check(same(eff.slice(1, 4).map((e) => e.stat), ['waterAmplify', 'natureAmplify', 'fireAmplify']) && eff.slice(1, 4).every((e) => e.value === 0.01), 'effects: Elemental Amplify G1 is +0.01 on all three elements');
check(eff[4].stat === 'autoAttackDamage' && eff[4].value === 0.018 && eff[4].buff === null, 'effects: Auto Attack Damage G2 is a stat with no buff');
check(same(T.talismanEffects({ lines: mock.lines }), eff) && same(T.talismanEffects({ power: 0, lines: mock.lines }), eff), 'effects: power defaults to 0, the raw grade value');
check(T.talismanEffects({ power: 0.4, lines: [{ modifier: 'armor', grade: 3 }] })[0].value > 4, 'effects: a power above 0 raises the value (the formula itself is unverified)');
check(throws(() => T.talismanEffects({ lines: [{ modifier: 'nope', grade: 1 }] })), 'effects: an unknown modifier throws');
for (const bad of [0, 7, 1.5, '3', null, undefined]) check(throws(() => T.talismanEffects({ lines: [{ modifier: 'armor', grade: bad }] })), `effects: grade ${JSON.stringify(bad)} throws`);
check(same(T.talismanEffects({ lines: [{ modifier: 'fortify', grade: 4 }, { modifier: 'smite', grade: 1 }] }), []), 'effects: unique modifiers give no effect');
check(T.talismanEffects({ lines: [{ modifier: 'threat_reduction', grade: 2 }] })[0].value === -6, 'effects: Reduced Threat is negative');
check(T.talismanEffects({ lines: [{ modifier: 'damage_taken', grade: 1 }] })[0].value === -0.005, 'effects: Damage Taken is negative');

// ---- The split ----
const split = T.splitEffects(eff);
check(split.buffs.length === 4 && same(split.stats, { autoAttackDamage: 0.018 }), 'split: 4 buffs (armor, three amplifies), one stat-only effect');
check(same(split.buffs[0], { uniqueHrid: '/buff_uniques/talisman_armor', typeHrid: '/buff_types/armor', flatBoost: 4, ratioBoost: 0, flatBoostLevelBonus: 0, ratioBoostLevelBonus: 0, startTime: '0001-01-01T00:00:00Z', duration: 0 }), 'split: a buff has the shape extraBuffs take');
const spd = T.splitEffects(T.talismanEffects({ lines: [{ modifier: 'attack_speed', grade: 1 }] }));
check(spd.buffs[0].typeHrid === '/buff_types/attack_speed' && spd.buffs[0].ratioBoost === 0.01 && spd.buffs[0].flatBoost === 0, 'split: Attack Speed is a ratio buff');
const sum = T.splitEffects(T.talismanEffects({ lines: [{ modifier: 'ranged_damage', grade: 2 }, { modifier: 'ranged_damage', grade: 1 }] }));
check(Math.abs(sum.stats.rangedDamage - 0.075) < 1e-12 && sum.buffs.length === 0, 'split: stat-only effects of the same stat add up');
check(same(T.splitEffects([]), { buffs: [], stats: {} }), 'split: nothing in, nothing out');

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

// Absent field: the extra buffs are the very array given; the stats equal those of the setup built the old way.
const plain = createSimPlayer(mkDto(), zone, labyrinth, extra);
check(plain.extraBuffs === extra, 'setup: no talismans field, the extra buffs are passed as given');
const oldWay = Player.createFromDTO(structuredClone(mkDto())); oldWay.zoneBuffs = zone.buffs || []; oldWay.extraBuffs = extra; startPlayerAtTimeZero(oldWay);
const base = atZero(mkDto());
check(same(base.combatDetails, oldWay.combatDetails), 'setup: no talismans field, the stats equal the setup before the module');

// With talismans: Armor G3 is +4 armor, and the shared extra buffs are not touched.
const withT = atZero({ ...mkDto(), talismans: { power: 0, lines: [{ modifier: 'armor', grade: 3 }, { modifier: 'combat_experience', grade: 6 }] } });
check(Math.abs(withT.combatDetails.totalArmor - (base.combatDetails.totalArmor + 4)) < 1e-9, 'setup: Armor G3 adds 4 to total armor', `${base.combatDetails.totalArmor} -> ${withT.combatDetails.totalArmor}`);
check(Math.abs(withT.combatDetails.combatStats.combatExperience - (base.combatDetails.combatStats.combatExperience + 0.04)) < 1e-9, 'setup: Combat Experience G6 adds 0.04 on top of the Moo Pass buff');
check(extra.length === 1 && extra[0].typeHrid === '/buff_types/wisdom', 'setup: the shared extra buffs array is not changed');
const other = atZero(mkDto());
check(same(other.combatDetails, base.combatDetails), 'setup: another player built after it has no talisman buffs');
const uniqueOnly = atZero({ ...mkDto(), talismans: { lines: [{ modifier: 'echo', grade: 6 }, { modifier: 'fortify', grade: 1 }] } });
check(same(uniqueOnly.combatDetails, base.combatDetails), 'setup: unique modifiers only, nothing changes');
check(same(atZero({ ...mkDto(), talismans: { power: 0.2, lines: [] } }).combatDetails, base.combatDetails), 'setup: a power with no lines, nothing changes');
const noExtra = createSimPlayer({ ...mkDto(), talismans: { lines: [{ modifier: 'armor', grade: 1 }] } }, zone, labyrinth, undefined);
check(noExtra.extraBuffs.length === 1, 'setup: talismans work when no extra buffs are given');
const dmg = atZero({ ...mkDto(), talismans: { lines: [{ modifier: 'damage_taken', grade: 6 }] } });
check(dmg.combatDetails.combatStats.damageTaken === -0.02, 'setup: Damage Taken G6 is -0.02 in the stats');

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
const viaTal = await run((z) => createSimPlayer({ ...mkDto(), talismans: { lines: [{ modifier: 'armor', grade: 6 }, { modifier: 'damage_taken', grade: 6 }] } }, z, null, buildExtraBuffs(EXTRA)));
check(viaTal !== viaOld, 'run: with talismans the same simulation differs');

console.log(fails === 0 ? 'PASS: talismans.' : `FAIL: ${fails} problems.`);
process.exit(fails === 0 ? 0 : 1);
