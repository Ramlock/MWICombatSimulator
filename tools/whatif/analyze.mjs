// Noise tables from a batch.mjs output: base spread per run length, and paired vs unpaired noise per variant.
// Usage: node tools/whatif/analyze.mjs --in <results.jsonl> [--base base] [--md <out.md>] [--json <out.json>]
// Spread is over seeds. sd = sample standard deviation of one run; se = sd/sqrt(k), the error of a mean of k runs.
// For a variant: d_i = variant - base on seed i. Unpaired sd = sqrt(sd_base^2 + sd_variant^2), the sd of the
// difference of two runs on different seeds; paired sd = sd of d_i. Cut = unpaired sd / paired sd.
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i < 0 ? def : process.argv[i + 1];
}
const runs = readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const BASE = arg('base', 'base');

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

const METRICS = [
    ['party profit/d after tax', (c) => c.party.profitAfterTaxPerDay],
    ['party income/d', (c) => c.party.incomePerDay],
    ['party EXP/h', (c) => c.party.expPerHour],
    ['party deaths/h', (c) => c.party.deathsPerHour],
];
const names = Object.keys(runs[0].checkpoints[0].players);
for (const n of names) {
    METRICS.push([`${n} profit/d after tax`, (c) => c.players[n].profitAfterTaxPerDay]);
    METRICS.push([`${n} EXP/h`, (c) => c.players[n].expPerHour]);
    METRICS.push([`${n} deaths/h`, (c) => c.players[n].deathsPerHour]);
}

const by = new Map();
for (const r of runs) { if (!by.has(r.variant)) by.set(r.variant, new Map()); by.get(r.variant).set(r.seed, r); }
const base = by.get(BASE);
const hoursList = runs[0].checkpoints.map((c) => c.simHours);
const fmt = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(4);
};
const pct = (v) => (v * 100).toFixed(2) + '%';

const json = { baseSeeds: base.size, hours: hoursList, base: {}, variants: {} };
const md = [];
md.push(`Base: ${base.size} seeds (${[...base.keys()].sort((a, b) => a - b).join(', ')}).`, '');
md.push('### Base vs base: spread of one run, and of a mean of k runs', '');
md.push('| Metric | Sim h | Mean | sd (one run) | sd % | se (k runs) | se % |', '| --- | --- | --- | --- | --- | --- | --- |');
for (const [label, f] of METRICS) {
    json.base[label] = [];
    hoursList.forEach((h, ci) => {
        const v = [...base.values()].map((r) => f(r.checkpoints[ci]));
        const m = mean(v), s = sd(v), se = s / Math.sqrt(v.length);
        json.base[label].push({ hours: h, k: v.length, mean: m, sd: s, se });
        md.push(`| ${ci === 0 ? label : ''} | ${h} | ${fmt(m)} | ${fmt(s)} | ${pct(s / Math.abs(m))} | ${fmt(se)} | ${pct(se / Math.abs(m))} |`);
    });
}
for (const [vname, vmap] of by) {
    if (vname === BASE) continue;
    const seeds = [...vmap.keys()].filter((s) => base.has(s)).sort((a, b) => a - b);
    json.variants[vname] = { seeds: seeds.length, metrics: {} };
    md.push('', `### ${vname} vs base, ${seeds.length} paired seeds`, '');
    md.push('| Metric | Sim h | Mean diff | Diff % of base | Unpaired sd | Paired sd | Cut | Paired se | Diff / paired se |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [label, f] of METRICS) {
        json.variants[vname].metrics[label] = [];
        hoursList.forEach((h, ci) => {
            const b = seeds.map((s) => f(base.get(s).checkpoints[ci]));
            const v = seeds.map((s) => f(vmap.get(s).checkpoints[ci]));
            const d = v.map((x, i) => x - b[i]);
            const md_ = mean(d), un = Math.sqrt(sd(b) ** 2 + sd(v) ** 2), pa = sd(d), se = pa / Math.sqrt(d.length);
            const row = { hours: h, k: d.length, meanDiff: md_, diffPct: md_ / mean(b), unpairedSd: un, pairedSd: pa, cut: un / pa, pairedSe: se, t: md_ / se };
            json.variants[vname].metrics[label].push(row);
            md.push(`| ${ci === 0 ? label : ''} | ${h} | ${fmt(md_)} | ${pct(row.diffPct)} | ${fmt(un)} | ${fmt(pa)} | ${pa > 0 ? row.cut.toFixed(1) + '×' : '∞'} | ${fmt(se)} | ${pa > 0 ? row.t.toFixed(1) : '—'} |`);
        });
    }
}
const wall = runs.reduce((a, r) => a + r.wallSeconds, 0);
md.push('', `Core time of these runs: ${(wall / 3600).toFixed(2)} core-hours over ${runs.length} runs.`);
json.coreHours = wall / 3600;
json.runs = runs.length;
if (arg('md')) writeFileSync(arg('md'), md.join('\n') + '\n');
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(json, null, 2));
console.log(md.join('\n'));
