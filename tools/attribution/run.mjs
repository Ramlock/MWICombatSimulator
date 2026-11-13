// Damage-bonus attribution for one recorded window: both answers per bonus unit (leave-one-out, even split), with validation.
// Usage: node tools/attribution/run.mjs --export <group export.json> (--combat <combat.jsonl> | --saved <saved recording.json>) --out <dir>
//          --saved reads the file the Combat Tracker's "Save combat recording (file)" writes, as the same rows the helper writes (saved-file.mjs).
//          [--window <window key prefix, default: the last party window>] [--chance off|conditional] [--levels base|unit] [--encounters N]
//          --levels base (default): skill levels are part of the base (never off); unit: one unit per skill, off = level 1.
// Reads private files given on the command line and writes results only to --out; commits nothing.
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine } from './engine-node.mjs';
import * as core from './attribution-core.mjs';
import { savedFileToRows } from './saved-file.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const engine = await loadEngine();
const t0 = Date.now();

const exp = JSON.parse(fs.readFileSync(args.export, 'utf8'));
if (!!args.combat === !!args.saved) { console.error('Give exactly one of --combat <combat.jsonl> or --saved <saved recording.json>.'); process.exit(1); }
let rows;
try { rows = args.saved ? savedFileToRows(JSON.parse(fs.readFileSync(args.saved, 'utf8'))) : fs.readFileSync(args.combat, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { console.error(e.message); process.exit(1); }
const recs = rows.map((r) => r.rec);
const windows = recs.filter((r) => r.type === 'window');
let win;
if (args.window) win = windows.filter((w) => w.key.startsWith(args.window)).pop();
else win = windows.filter((w) => w.data.numberOfPlayers > 1).pop();
if (!win) throw new Error('No window found');
const W = win.data;
let encounters = recs.filter((r) => r.type === 'encounter' && r.data.startedAt >= W.startedAt && r.data.endedAt <= W.endedAt + 1 && r.data.players.length === W.numberOfPlayers).map((r) => r.data);
if (args.encounters) encounters = encounters.slice(-Number(args.encounters));

// Party from the export; a missing task badge and missing shrine levels are inferred from the recorded window (flagged).
const inferred = [];
const party = Object.entries(exp).map(([key, setup]) => ({ key, setup }));
for (const m of party) m.base = core.baseFromSetup(engine, m.setup);
const slotToParty = core.matchSlots(W, party);
for (const [slot, pi] of Object.entries(slotToParty)) {
    const pl = W.players.find((p) => p.slot === Number(slot)), m = party[pi];
    const badge = core.inferTaskBadge(engine, pl.stats.combatDetails.combatStats.taskDamage);
    if (badge && !m.base.equipment['/equipment_types/trinket']) { m.base.equipment['/equipment_types/trinket'] = badge; inferred.push({ party: m.key, what: 'task badge from recorded taskDamage', value: badge }); }
    if (!m.setup.guildCombatBuffLevels && !m.setup.guildBuffs) {
        const lv = core.inferShrineLevels(engine, pl.stats.buffs || {});
        m.base = core.baseFromSetup(engine, { ...m.setup, guildCombatBuffLevels: lv }, { equipment: badge ? [badge] : [] });
        inferred.push({ party: m.key, what: 'shrine levels from recorded guild buffs', value: lv });
    }
}
const levelChanges = core.useRecordedAbilityLevels(W, party, slotToParty);
const selfSlot = W.players.find((p) => p.self)?.slot;
const results = [], report = { chance: null, levels: null, window: win.key, zone: W.zone, tier: W.difficultyTier, encounters: encounters.length, minutes: (W.endedAt - W.startedAt) / 60000, inferred, levelChanges, unmatchedSlots: W.players.map((p) => p.slot).filter((s) => slotToParty[s] == null), slots: slotToParty, targets: [] };
const chance = args.chance || 'off';
const levels = args.levels === 'unit' ? 'unit' : 'base';
report.chance = chance; report.levels = levels;

for (const [slotStr, target] of Object.entries(slotToParty)) {
    const slot = Number(slotStr), tStart = Date.now();
    const tasks = new Set(slot === selfSlot ? (W.tasksAtStart || []).map((t) => t.monsterHrid).filter(Boolean) : []);
    const ctx = { party, slotToParty, tier: W.difficultyTier, tasks, units: core.playerUnits(engine, party, target, { levelsAsUnits: levels === 'unit' }) };
    const { keys, perEnc, skipped, unmapped } = core.buildKeys(engine, ctx, W, encounters, slot);
    const allNames = ctx.units.map((u) => u.id);
    const formulaFor = (names) => core.makeFormula(engine, ctx, target, keys, names, { chance });
    const log = (...a) => console.error(new Date().toISOString(), ...a);
    log("slot", slot, "units", allNames.length, "keys", keys.length);
    const names = core.relevantUnits(formulaFor, allNames);
    log("relevant", names.length, names.join(" "));
    const res = engine.attributeBonuses(formulaFor(names), names, { samples: Number(args.samples || 2000), exactMax: Number(args.exactMax || 12) });
    const predMid = core.makeFormula(engine, ctx, target, keys, names, { chance, meanRoll: true })(names.map(() => true));
    const recorded = perEnc.reduce((s, e) => s + e.sources.reduce((a, x) => a + x.recorded, 0), 0);
    const us = perEnc.flatMap((e) => e.sources.filter((s) => s.u != null).map((s) => ({ ...s, battleId: e.battleId })));
    const out = us.filter((s) => s.u < 0 || s.u > 1);
    const critOnly = perEnc.flatMap((e) => e.sources.filter((s) => s.critOnly).map((s) => s.critOnly));
    const sumHits = us.reduce((s, x) => s + (x.hits - x.crits), 0);
    const meanU = us.reduce((s, x) => s + x.u * (x.hits - x.crits), 0) / (sumHits || 1);
    const builtFull = core.makeEvaluator(engine, ctx, target)(new Map(), core.unitsOnAtStart(ctx.units, W, slot)).player;
    const pl = W.players.find((p) => p.slot === slot);
    const units = names.map((n, i) => ({ id: n, owner: ctx.units.find((u) => u.id === n).owner, label: ctx.units.find((u) => u.id === n).label, leaveOneOut: res.leaveOneOut[i], shapley: res.shapley[i], stderr: res.stderr ? res.stderr[i] : null }));
    const r = {
        slot, targetKey: party[target].key, recorded, full: res.full, base: res.base, method: res.method, evals: res.evals, seconds: (Date.now() - tStart) / 1000,
        sumCheck: { basePlusShapley: res.base + res.shapley.reduce((a, b) => a + b, 0), full: res.full },
        validation: {
            predictedAtMeanRoll: predMid, recorded, mismatchPct: (100 * (predMid - recorded)) / recorded,
            meanU, uCount: us.length, uOutside: out.length, uOutsideDamage: out.reduce((s, x) => s + x.recorded, 0),
            uOutsideWorst: out.sort((a, b) => Math.abs(b.u - 0.5) - Math.abs(a.u - 0.5)).slice(0, 5).map((x) => ({ battleId: x.battleId, src: x.src, u: x.u, hits: x.hits, crits: x.crits, recorded: x.recorded })),
            critOnly: { count: critOnly.length, predicted: critOnly.reduce((s, x) => s + x.predicted, 0), recorded: critOnly.reduce((s, x) => s + x.recorded, 0) },
            skippedSources: skipped.sources, unmappedBuffs: unmapped,
        },
        statsCheck: core.compareStats(builtFull, pl.stats.combatDetails).filter((x) => Math.abs(x.diff) > 1e-6),
        perEncounter: perEnc, units, droppedUnits: allNames.filter((n) => !names.includes(n)),
    };
    results.push(r);
    report.targets.push(r);
}
report.ownership = core.ownershipTotals(results);
report.seconds = (Date.now() - t0) / 1000;
fs.mkdirSync(args.out, { recursive: true });
const file = path.join(args.out, 'attribution-' + chance + '-levels-' + levels + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 1));
console.log(file, 'in', report.seconds, 's');
