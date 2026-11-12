// The Node shell of the what-if search (docs/codebase/whatif-runner.md): everything the search core (core.mjs) needs from the machine.
// The core imports no fs, process, os or child_process; this file gives it, as objects:
//   data   the party's setups, the price snapshot, the exporter JSON, the user's trigger candidates (loadNodeData)
//   store  runs.jsonl and --cache-from files, and the small cache files <out>/need.json and <out>/probe.json (createNodeStore)
//   pool   forked run processes (batch.mjs --child), one engine run per task, at this process's priority (createNodePool)
//   sink   progress.json, partial.json, rounds.jsonl, result.json, result.md, and the IPC messages to the runner (createNodeSink)
//   stop   { requested }, set by the runner's 'stop' message (optimize.mjs)
//   hash   sha1 of a text (run keys)
//   sim    the engine's own functions (engine.mjs) and the Trigger class
import { fork } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { list } from './options.mjs';

// The price snapshot's market table (what prices.mjs makePricer reads).
export function loadMarket(file) {
    return JSON.parse(readFileSync(file, 'utf8')).marketData;
}

// The data seam. `readParty` is variants.mjs's, `arg` the flags' reader (options.mjs).
export function loadNodeData(arg, { setupsDir, pricesFile, readParty }) {
    const snapshot = JSON.parse(readFileSync(pricesFile, 'utf8'));
    return {
        exportData: arg('export', null) ? JSON.parse(readFileSync(arg('export'), 'utf8')) : null,
        userTrig: arg('trigger-cands', null) ? JSON.parse(readFileSync(arg('trigger-cands'), 'utf8')) : {},
        setups: readParty(setupsDir),
        market: snapshot.marketData,
        pricesTimestamp: snapshot.timestamp,
    };
}

export const sha1 = (text) => createHash('sha1').update(text).digest('hex');

// The store seam. load() yields every saved run record: --cache-from files first (read only), then <out>/runs.jsonl. put(record)
// appends to <out>/runs.jsonl. readAux / writeAux keep the small cache files next to it (need.json, probe.json).
export function createNodeStore(out, cacheFrom) {
    const file = path.join(out, 'runs.jsonl');
    return {
        *load() {
            for (const f of [...(list(cacheFrom) || []), file]) if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) yield JSON.parse(l);
        },
        put(record) { appendFileSync(file, JSON.stringify(record) + '\n'); },
        readAux(name) { const f = path.join(out, name); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; },
        writeAux(name, value) { writeFileSync(path.join(out, name), JSON.stringify(value)); },
    };
}

// The pool seam. run(task) sends the task to an idle run process (forked on demand, at this process's priority) and resolves with its
// result message { variant, seed, wallSeconds, checkpoints }; resolves null when kill() ended it. A run process that exits by itself rejects.
export function createNodePool() {
    const self = fileURLToPath(new URL('./batch.mjs', import.meta.url));
    const idle = [], all = new Set();
    let killed = false;
    function spawn() {
        const c = fork(self, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        try { os.setPriority(c.pid, os.getPriority()); } catch { /* the child exited already */ }
        all.add(c);
        c.on('exit', () => { all.delete(c); const i = idle.indexOf(c); if (i >= 0) idle.splice(i, 1); });
        return c;
    }
    return {
        run(task) {
            if (killed) return Promise.resolve(null);
            const c = idle.pop() || spawn();
            return new Promise((resolve, reject) => {
                const onMessage = (res) => { c.off('exit', onExit); idle.push(c); resolve(res); };
                const onExit = (code) => { c.off('message', onMessage); if (killed) resolve(null); else reject(new Error('child exited ' + code)); };
                c.once('message', onMessage);
                c.once('exit', onExit);
                c.send(task);
            });
        },
        kill() { killed = true; for (const c of all) c.kill(); },
    };
}

// Replay counter: wraps any pool seam and counts the runs that reach it. The core asks the pool only for a run the store does not hold
// (core.mjs ensure(): a run in the cache is never asked), so every run counted here is a real simulation and every other run of the search was replayed from
// recorded runs. count() is the total so far, byTag() the total per task tag; the wrapper logs 'N real simulations so far' every `every` runs.
// It changes neither the pool nor the store: it only forwards run() and kill().
export function createCountingPool(pool, log = (line) => console.log(line), every = 50) {
    let total = 0;
    const tags = new Map();
    const stamp = () => new Date().toISOString();
    return {
        run(task) {
            total++;
            tags.set(task.tag ?? '', (tags.get(task.tag ?? '') ?? 0) + 1);
            if (total % every === 0) log(`${stamp()} replay counter: ${total} real simulations so far (the rest of the runs came from recorded runs)`);
            return pool.run(task);
        },
        kill() { return pool.kill(); },
        count() { return total; },
        byTag() { return Object.fromEntries(tags); },
        summary() { return `${stamp()} replay counter: ${total} real simulations in this search${total ? ' (' + [...tags].map(([t, n]) => `${t || 'untagged'} ${n}`).join(', ') + ')' : ' (every run came from recorded runs)'}`; },
    };
}

// The sink seam: files in <out> and the runner's IPC messages (only with an IPC channel).
export function createNodeSink(out) {
    return {
        progress(p) {
            writeFileSync(path.join(out, 'progress.json'), JSON.stringify(p));
            if (process.connected) process.send({ type: 'progress', progress: p });
        },
        partial(snapshot) { if (process.connected) process.send({ type: 'partial', result: snapshot }); },
        // One search round (rounds.jsonl, one line each, and the IPC message `round`). A provisional record (`provisional: true`, the first look at
        // round 1: figures read from the cache while the round's runs are still going) goes to the window only: rounds.jsonl holds only the
        // finished rounds, so its lines stay one per round, in round order.
        round(r) {
            if (!r.provisional) appendFileSync(path.join(out, 'rounds.jsonl'), JSON.stringify(r) + '\n');
            if (process.connected) process.send({ type: 'round', round: r });
        },
        stopped(snapshot) { writeFileSync(path.join(out, 'partial.json'), JSON.stringify(snapshot, null, 1)); },
        // result.json and result.md; returns the markdown file's path (the log line names it).
        final(snapshot, markdown) {
            writeFileSync(path.join(out, 'result.json'), JSON.stringify(snapshot, null, 1));
            const md = path.join(out, 'result.md');
            writeFileSync(md, markdown);
            return md;
        },
    };
}
