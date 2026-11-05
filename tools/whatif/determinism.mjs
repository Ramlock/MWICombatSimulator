// Determinism check: the same seed must give identical results.
// Usage: node tools/whatif/determinism.mjs [--seed 7] [--hours 50] [--comdrop 20 --comexp 20]
// Compares, for one seed: (a) a run of --hours, (b) the same run again in the same process after a run on
// another seed, (c) the --hours checkpoint of a run of 3x --hours, (d) tools/calibration/run.mjs at --hours in a
// fresh process (its panel income, consumables, EXP/h and deaths/h). Prints each comparison and exits 1 on a mismatch.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runParty, root } from './engine.mjs';
import { readParty } from './variants.mjs';

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i < 0 ? def : process.argv[i + 1];
}
const SEED = Number(arg('seed', 7));
const HOURS = Number(arg('hours', 50));
const options = { comdrop: Number(arg('comdrop', 20)), comexp: Number(arg('comexp', 20)) };
const setups = readParty();
const strip = (r) => JSON.stringify(r.checkpoints.at(-1));

const a = await runParty({ ...options, setups, seed: SEED, checkpoints: [HOURS] });
await runParty({ ...options, setups, seed: SEED + 1000, checkpoints: [HOURS / 5] });
const b = await runParty({ ...options, setups, seed: SEED, checkpoints: [HOURS] });
const c = await runParty({ ...options, setups, seed: SEED, checkpoints: [HOURS, 3 * HOURS] });
let ok = true;
const check = (label, same) => { console.log(`${same ? 'SAME' : 'DIFFERENT'}  ${label}`); ok &&= same; };
check('run twice in one process', strip(a) === strip(b));
check(`checkpoint ${HOURS} h of a ${3 * HOURS} h run`, strip(a) === JSON.stringify(c.checkpoints[0]));

const out = execFileSync(process.execPath, [path.join(root, 'tools', 'calibration', 'run.mjs'), '--hours', String(HOURS), '--seed', String(SEED), '--comdrop', String(options.comdrop), '--comexp', String(options.comexp)], { encoding: 'utf8', maxBuffer: 1 << 26 });
const cal = JSON.parse(out);
const m = a.checkpoints[0];
const rows = [];
for (const [name, p] of Object.entries(cal.players)) {
    const q = m.players[name];
    rows.push([name, 'income', p.panel.dailyIncome, q.incomePerDay], [name, 'consumables', p.panel.dailyConsumables, q.consumablesPerDay], [name, 'EXP/h', p.expPerHour, q.expPerHour], [name, 'deaths/h', p.deathsPerHour, q.deathsPerHour]);
}
rows.push(['party', 'encounters', cal.encounters, m.encounters]);
const sameCal = rows.every(([, , x, y]) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)));
for (const r of rows) console.log(`  ${r[0]} ${r[1]}: run.mjs ${r[2]}  engine.mjs ${r[3]}`);
check('tools/calibration/run.mjs in a fresh process', sameCal);
process.exit(ok ? 0 : 1);
