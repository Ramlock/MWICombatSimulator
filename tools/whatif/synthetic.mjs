// Synthetic simulation for the what-if search (test tooling; the core's code path stays one). A scenario file (tools/test/synthetic/*.json) holds a small
// generic party, a generic price snapshot and, for the changes the core will build from them, each one's known true gain, cost and noise. The core gets
// the real seams everywhere (data, store, sink, hash, buildDtos, Trigger) except two, which this file fakes:
//   pool  createSyntheticPool(scenario): run(task) answers { variant, seed, wallSeconds, checkpoints } computed from the scenario instead of an engine run
//   sim   syntheticSim(realSim, scenario): measureNeed answers the scenario's food need; runParty throws (only the trigger probe calls it, and the trigger lever is off)
// The core does not know it is fake. Nothing here imports the core, the engine or any file API but readFileSync (loadScenario).
//
// Scenario:
//   name, players (the setups, each with its name), market ({ marketData, timestamp }), budgets { <player>: coin },
//   request   the search's own flags/levers the runner puts over the window's request (applyScenarioToRequest)
//   model     { lootPerDay (party loot after tax per day), lootSd50 (its sd at 50 sim hours; falls as 1/sqrt(hours/50)), supplies { <player>: per day },
//               suppliesSd50, need { <player>: { hp, mp } per hour }, deathsPerHour, encountersPerHour, expPerHour, msPerRun (pause per run, for a page run) }
//   effects   [{ match: { op, player, slot|index, delta|item ... }, loot, supplies, searchBonus, noiseSd, note }]: what one op of a task changes, the first match wins, an op
//             that matches none changes nothing. loot = the party's loot per day; supplies = that op's player's own consumables per day (negative = saves);
//             searchBonus = extra loot per day on the search seeds only (1..confirmOffset): a change that looks better in the search than on fresh seeds;
//             noiseSd = extra sd (50 h) in quadrature. A task's ops add up (the chain stacks).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const loadScenario = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const scenarioHash = (scenario) => createHash('sha1').update(JSON.stringify(scenario)).digest('hex').slice(0, 12);

// The ops of a task that `match` describes: every field of the match equals the op's.
export const opMatches = (op, match) => Object.entries(match).every(([k, v]) => op[k] === v);
export const effectOf = (scenario, op) => scenario.effects.find((e) => opMatches(op, e.match)) ?? null;

// Deterministic gaussian from a text (Box-Muller on two 32-bit halves of its sha1).
export function gauss(text) {
    const h = createHash('sha1').update(text).digest();
    const u1 = (h.readUInt32BE(0) + 1) / 4294967297, u2 = h.readUInt32BE(4) / 4294967296;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// A run's noise at `h` sim hours, seeded by (variant, seed) alone: one draw per run, shrunk by sqrt(50/h), so the readings of one run at different
// hours agree with each other (the longer reading is the shorter one with less noise) and a run recorded at one length answers a reading of
// any other length with the value a run of that length would have given. That is what lets a replay of recorded runs follow the same search.
export const walk = (text, h) => Math.sqrt(50 / h) * gauss(text);

// One checkpoint of a task at `h` sim hours: the model's base figures plus the ops' effects plus noise (walk above).
export function checkpointFor(scenario, task, h, confirmOffset = 10000) {
    const m = scenario.model, names = scenario.players.map((p) => p.name);
    const eff = task.ops.map((op) => effectOf(scenario, op));
    const search = task.seed <= confirmOffset;
    const sdLoot50 = Math.sqrt(m.lootSd50 ** 2 + eff.reduce((a, e) => a + (e?.noiseSd ?? 0) ** 2, 0));
    const loot = m.lootPerDay + eff.reduce((a, e) => a + (e?.loot ?? 0) + (search ? (e?.searchBonus ?? 0) : 0), 0) + sdLoot50 * walk(`${m.noiseSalt ?? ''}|${task.variant}|${task.seed}|loot`, h);
    const players = {};
    for (const n of names) {
        const delta = task.ops.reduce((a, op, i) => a + (op.player === n ? (eff[i]?.supplies ?? 0) : 0), 0);
        players[n] = { consumablesPerDay: Math.max(0, m.supplies[n] + delta + m.suppliesSd50 * walk(`${m.noiseSalt ?? ''}|${task.variant}|${task.seed}|sup|${n}`, h)) };
    }
    const consumables = Object.values(players).reduce((a, p) => a + p.consumablesPerDay, 0);
    return { simHours: h, players, party: { profitAfterTaxPerDay: loot - consumables, consumablesPerDay: consumables, expPerHour: m.expPerHour, deathsPerHour: m.deathsPerHour }, encountersPerHour: m.encountersPerHour };
}

// The pool seam: run(task) resolves with the run's result (after msPerRun, so a page can watch the search), null once kill() was called.
export function createSyntheticPool(scenario, { confirmOffset = 10000 } = {}) {
    let killed = false;
    const ms = scenario.model.msPerRun ?? 0;
    return {
        async run(task) {
            if (killed) return null;
            if (ms > 0) await new Promise((r) => setTimeout(r, ms));
            if (killed) return null;
            return { variant: task.variant, seed: task.seed, wallSeconds: Math.max(ms, 1) / 1000, checkpoints: task.checkpoints.map((h) => checkpointFor(scenario, task, h, confirmOffset)) };
        },
        kill() { killed = true; },
    };
}

// The sim seam: the real buildDtos and Trigger, the scenario's food need, no engine run.
export function syntheticSim(realSim, scenario) {
    return {
        ...realSim,
        async measureNeed({ seeds, hours = 20 }) {
            return { hours, seeds, perSeed: [], mean: structuredClone(scenario.model.need), sources: { hp: [], mp: [] } };
        },
        async runParty() { throw new Error('synthetic scenario: runParty is not available (the trigger lever must be off)'); },
    };
}

// The runner's request with the scenario's party and prices in place of the window's: the window's own fields stay except the party, the price
// snapshot, the budgets and what the scenario's `request` sets; `synthetic` (the scenario's hash) makes the search id follow the scenario.
export function applyScenarioToRequest(body, scenario) {
    const options = { ...(body?.options ?? {}) };
    delete options.prices;
    options.marketplace = scenario.market;
    return { ...(body ?? {}), ...(scenario.request ?? {}), setups: scenario.players, players: scenario.players.map((p) => p.name), options, budgets: scenario.budgets, synthetic: scenarioHash(scenario) };
}

// The scenario's request as the optimizer's flags (what the command line would have been).
export function flagsFromRequest(req, extra = {}) {
    const flags = {};
    for (const [k, v] of Object.entries({ ...req, ...extra })) {
        const name = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        if (v === false) flags['no-' + name] = true;
        else if (v === true) flags[name] = true;
        else if (v != null) flags[name] = Array.isArray(v) ? v.join(',') : String(v);
    }
    return flags;
}

// The whole search on a scenario, in this process, without a page: the real core on the real seams except the pool and measureNeed (above) and an in-memory store
// and sink. `extra` flags win over the scenario's request; `onRound(record, stop)` can press the stage buttons (stop.done = 'accept' | 'skip') or stop.requested = true.
// `records` primes the store with earlier runs (a run that reaches the pool is a store miss, counted in `runs`). Resolves { outcome, result, markdown, rounds, partials, lastProgress, runs, records, stop, seen }.
export async function runSynthetic(scenario, extra = {}, { onRound, records: prior = [], poolWrap = (p) => p } = {}) {
    const E = await import('./engine.mjs'); // registers the loader hooks: the core is imported after it
    const { default: Trigger } = await import(new URL('../../src/combatsimulator/trigger.js', import.meta.url));
    const { main } = await import('./core.mjs');
    const flags = flagsFromRequest(scenario.request, { budgets: Object.entries(scenario.budgets).map(([p, v]) => `${p}=${v}`).join(','), jobs: 8, players: scenario.players.map((p) => p.name), ...extra });
    const records = [...prior], aux = new Map(), rounds = [], partials = [];
    const seen = { separate: new Set(), checkingWho: new Set(), checking: new Set() }; // what the progress records showed (the stage rows read them)
    const stop = { requested: false, done: false };
    let result = null, markdown = null, lastProgress = null, runs = 0;
    const pool = createSyntheticPool({ ...scenario, model: { ...scenario.model, msPerRun: 0 } }, { confirmOffset: Number(flags['confirm-seed-offset'] ?? 10000) });
    const counted = poolWrap({ run: async (t) => { runs++; return pool.run(t); }, kill: pool.kill });
    const seams = {
        data: { setups: structuredClone(scenario.players), market: scenario.market.marketData, pricesTimestamp: scenario.market.timestamp, exportData: null, userTrig: {} },
        store: { *load() { yield* records; }, put(r) { records.push(r); }, readAux: (n) => aux.get(n) ?? null, writeAux: (n, v) => { aux.set(n, JSON.parse(JSON.stringify(v))); } },
        pool: counted, stop, hash: (t) => createHash('sha1').update(t).digest('hex'),
        sink: {
            progress(p) {
                lastProgress = JSON.parse(JSON.stringify(p));
                if (p.stageSeparate) seen.separate.add(p.stageSeparate.rounds);
                if (p.checkingWho) seen.checkingWho.add(`${p.checking} ${p.checkingWho.index} of ${p.checkingWho.of}`);
                if (p.checking) seen.checking.add(p.checking);
            },
            partial(s) { partials.push(s); },
            round(r) { if (!r.provisional) rounds.push(r); onRound?.(r, stop); },
            stopped(s) { result = s; },
            final(s, md) { result = s; markdown = md; return 'memory'; },
        },
        sim: syntheticSim({ runParty: E.runParty, measureNeed: E.measureNeed, buildDtos: E.buildDtos, Trigger }, scenario),
    };
    const settings = { flags, argsText: 'synthetic', jobs: Number(flags.jobs), pricesFile: 'synthetic', pricesKey: 'synthetic', setupsDir: 'synthetic' };
    const outcome = await main(settings, seams);
    return { outcome, result, markdown, rounds, partials, lastProgress, runs, records, stop, seen };
}
