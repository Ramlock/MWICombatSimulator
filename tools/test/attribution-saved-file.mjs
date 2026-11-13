// Test: tools/attribution/run.mjs --saved (the Combat Tracker's saved recording, format "mwics-loot") against --combat (the helper's rows).
// A synthetic one-player recording built from the game data (a bow, a coffee, one window, two encounters; no party data, no real recording):
// the rows built from the saved file equal the helper-row shape written out by hand, a file of another format is refused with a plain message,
// and a full attribution run gives the same result on both paths. Usage: node tools/test/attribution-saved-file.mjs   Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../attribution/engine-node.mjs';
import * as core from '../attribution/attribution-core.mjs';
import { savedFileToRows } from '../attribution/saved-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engine = await loadEngine();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('FAIL', msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- The synthetic recording ----
const setup = { player: { staminaLevel: 100, intelligenceLevel: 100, attackLevel: 100, meleeLevel: 1, defenseLevel: 100, rangedLevel: 100, magicLevel: 1, equipment: [{ itemLocationHrid: '/item_locations/two_hand', itemHrid: '/items/cursed_bow', enhancementLevel: 0 }] }, abilities: [{ abilityHrid: '/abilities/rain_of_arrows', level: 10 }], drinks: { '/action_types/combat': [{ itemHrid: '/items/super_ranged_coffee' }] }, food: {}, houseRooms: { '/house_rooms/archery_range': 2 }, achievements: {}, name: 'Synthetic A' };
const exportFile = { 1: setup };
const party = [{ key: '1', setup, base: core.baseFromSetup(engine, setup) }];
const units = core.playerUnits(engine, party, 0, {});
const drinkBuff = engine.itemDetailMap['/items/super_ranged_coffee'].consumableDetail.buffs[0].uniqueHrid;
const t0 = 1_000_000, t1 = t0 + 20_000, t2 = t1 + 20_000;
const mkWindow = () => ({ open: false, zone: '/actions/combat/fly', difficultyTier: 0, combatStartTime: '2026-01-01T00:00:00.000Z', numberOfPlayers: 1, startedAt: t0, endedAt: t2, battles: 2, kills: {}, fragments: [{ startedAt: t0, endedAt: t2, encounters: 2 }], players: [{ slot: 0, self: true, stats: { combatDetails: { combatStats: { taskDamage: 0 } }, abilities: [{ abilityHrid: '/abilities/rain_of_arrows', level: 10 }], buffs: { [drinkBuff]: { uniqueHrid: drinkBuff, duration: 300e9, startTime: new Date(t0 - 1000).toISOString() } } }, totals: {} }], buffEvents: [], monsterStats: {}, tasksAtStart: null });
const ctx = { party, slotToParty: { 0: 0 }, tier: 0, tasks: new Set(), units };
const p = core.makeEvaluator(engine, ctx, 0)(new Map(), ['drink:super_ranged_coffee']).player;
const hm = core.hitModel(p, core.buildMonster(engine, '/monsters/fly', 0, []), null, false);
const mkEnc = (i, start, end, u, hits, crits) => {
    const amount = Math.round(crits * hm.C + (hits - crits) * (hm.A + u * hm.B) + core.ROUND_UP * hits);
    return { index: i, battleId: i, combatStartTime: '2026-01-01T00:00:00.000Z', startedAt: start, endedAt: end, casts: [], ambiguous: [], monsters: [], players: [{ slot: 0, self: true, dealt: { total: amount, bySource: { auto: { amount, hits, crits } }, byMonster: { '/monsters/fly': amount } } }] };
};
const saved = {
    format: 'mwics-loot', version: 1, exportedAt: '2026-01-01T01:00:00.000Z', selfOnly: false, attribution: 'synthetic',
    windows: [mkWindow()], encounters: [mkEnc(1, t0, t1, 0.3, 5, 2), mkEnc(2, t1, t2, 0.6, 7, 1)], tasks: [{ t: 500, tasks: [] }], lootLog: [], notes: { closed: 2 },
};

// ---- 1. Rows from the saved file equal the helper-row shape, written out by hand ----
const handRows = [
    { v: 1, seen: saved.exportedAt, rec: { key: 'win:1000000#2.0.c', type: 'window', data: saved.windows[0] } },
    { v: 1, seen: saved.exportedAt, rec: { key: 'enc:1000000:1', type: 'encounter', data: saved.encounters[0] } },
    { v: 1, seen: saved.exportedAt, rec: { key: 'enc:1020000:2', type: 'encounter', data: saved.encounters[1] } },
    { v: 1, seen: saved.exportedAt, rec: { key: 'task:500', type: 'task', data: saved.tasks[0] } },
];
ok(same(savedFileToRows(saved), handRows), 'rows from the saved file equal the helper-row shape');
{
    const open = { ...saved, windows: [{ ...saved.windows[0], open: true }] };
    ok(savedFileToRows(open)[0].rec.key === 'win:1000000#2.0', 'an open window has no .c suffix, as the userscript keys it');
    ok(savedFileToRows({ format: 'mwics-loot', exportedAt: 'x' }).length === 0, 'a file with no records gives no rows');
}

// ---- 2. Another format is refused with a plain message ----
for (const [what, bad] of [['another format', { format: 'mwics-loot-capture', version: 1 }], ['no format', { windows: [] }], ['a non-object', [1, 2]]]) {
    let msg = '';
    try { savedFileToRows(bad); } catch (e) { msg = e.message; }
    ok(/^not a saved combat recording: its format is .* expected "mwics-loot"/.test(msg), what + ' is refused: ' + msg);
}

// ---- 3. run.mjs: the --combat path as before, the --saved path, and the argument checks ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-saved-'));
const put = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
const exportPath = put('export.json', JSON.stringify(exportFile));
const savedPath = put('saved.json', JSON.stringify(saved));
const rowsPath = put('combat.jsonl', handRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/attribution/run.mjs'), '--export', exportPath, '--window', 'win:', ...a], { encoding: 'utf8' });
const clean = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.seconds; for (const t of c.targets || []) { delete t.seconds; } return c; };
const outFile = (dir) => path.join(dir, 'attribution-off-levels-base.json');

const rc = run('--combat', rowsPath, '--out', path.join(tmp, 'outC'));
ok(rc.status === 0, '--combat run exits 0: ' + rc.stderr.slice(-300));
const rs = run('--saved', savedPath, '--out', path.join(tmp, 'outS'));
ok(rs.status === 0, '--saved run exits 0: ' + rs.stderr.slice(-300));
if (rc.status === 0 && rs.status === 0) {
    const a = JSON.parse(fs.readFileSync(outFile(path.join(tmp, 'outC')), 'utf8')), b = JSON.parse(fs.readFileSync(outFile(path.join(tmp, 'outS')), 'utf8'));
    ok(a.targets.length === 1 && a.encounters === 2 && a.targets[0].units.length > 0 && a.targets[0].recorded > 0, 'the run is a real attribution: one target, 2 encounters, units, recorded damage');
    ok(same(clean(a), clean(b)), 'the two outputs are equal (all but the timing)');
}
{
    const other = put('other.json', JSON.stringify({ format: 'mwics-loot-capture', version: 1 }));
    const r = run('--saved', other, '--out', path.join(tmp, 'outX'));
    ok(r.status === 1 && /not a saved combat recording/.test(r.stderr) && !/at file:/.test(r.stderr), 'run.mjs refuses another format with a plain message: ' + r.stderr.trim());
    const both = run('--saved', savedPath, '--combat', rowsPath, '--out', path.join(tmp, 'outY'));
    const none = run('--out', path.join(tmp, 'outZ'));
    ok(both.status === 1 && none.status === 1 && /exactly one of --combat/.test(both.stderr + none.stderr), 'both or neither of --combat/--saved is refused');
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
