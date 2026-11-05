// Runs every (variant, seed) of a spec, in parallel child processes, and writes per-seed results.
// Usage: node tools/whatif/batch.mjs --spec <spec.json> --out <results.jsonl> [--jobs 24] [--only base,small]
// Spec: { "checkpoints": [50,150,300,500], "seeds": [1,2,...] | {"from":1,"to":20},
//         "options": { "comdrop": 20, "comexp": 20, "tier": 4, "zone": "...", "prices": "<file>" },
//         "setupsDir": "<dir, default docs/ground-truth/setups>",
//         "variants": [ { "name": "base", "ops": [] }, { "name": "ring+1", "ops": [ ...variants.mjs ops ] } ] }
// Output: one JSON line per finished run, { variant, seed, wallSeconds, checkpoints: [metrics per checkpoint] }.
// Runs already in the output file are skipped, so a cut-off batch resumes where it stopped.
import { fork } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return def;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

if (arg('child', false) === true) {
    const { runParty } = await import('./engine.mjs');
    const { readParty, applyOps } = await import('./variants.mjs');
    const cache = new Map();
    process.on('message', async (t) => {
        if (t === 'exit') process.exit(0);
        const key = t.setupsDir || '';
        if (!cache.has(key)) cache.set(key, readParty(t.setupsDir || undefined));
        const setups = applyOps(cache.get(key), t.ops);
        const res = await runParty({ ...t.options, setups, seed: t.seed, checkpoints: t.checkpoints });
        process.send({ variant: t.variant, seed: t.seed, ...res });
    });
} else {
    const spec = JSON.parse(readFileSync(arg('spec'), 'utf8'));
    const OUT = arg('out');
    if (!OUT) throw new Error('--out required');
    const jobs = Number(arg('jobs', os.availableParallelism()));
    const only = arg('only', null);
    const seeds = Array.isArray(spec.seeds) ? spec.seeds : Array.from({ length: spec.seeds.to - spec.seeds.from + 1 }, (_, i) => spec.seeds.from + i);
    const done = new Set();
    if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); done.add(r.variant + '#' + r.seed); }
    const tasks = [];
    // Seed-major order, so a cut-off batch leaves whole seeds (every variant) rather than whole variants.
    for (const seed of seeds) for (const v of spec.variants) {
        if (only && !only.split(',').includes(v.name)) continue;
        if (done.has(v.name + '#' + seed)) continue;
        tasks.push({ variant: v.name, ops: v.ops || [], seed, checkpoints: spec.checkpoints, options: spec.options || {}, setupsDir: spec.setupsDir });
    }
    console.log(`${tasks.length} runs to do (${done.size} already done), ${Math.min(jobs, tasks.length)} processes`);
    const t0 = Date.now();
    let next = 0, finished = 0;
    const self = fileURLToPath(import.meta.url);
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((resolve, reject) => {
        const c = fork(self, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        const feed = () => { if (next < tasks.length) c.send(tasks[next++]); else c.send('exit'); };
        c.on('message', (r) => {
            appendFileSync(OUT, JSON.stringify(r) + '\n');
            finished++;
            console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${finished}/${tasks.length} ${r.variant} seed ${r.seed} (${r.wallSeconds.toFixed(0)}s)`);
            feed();
        });
        c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('child exited ' + code))));
        feed();
    })));
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
