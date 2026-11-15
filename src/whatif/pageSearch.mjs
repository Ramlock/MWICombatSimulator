// The what-if search run in the page: the runner's interface (docs/codebase/whatif-window.md, "The runner's interface") as functions, with the
// same answers, so the window's code (renderProgress, renderResult, its polling) reads them as it reads the runner's. Not wired into the page yet.
// The search is the same core (tools/whatif/core.mjs main) on the page's seams:
//   data   the request itself (setups, options.marketplace, export, triggerCands), as the runner's optimizer reads them from the files it writes
//   store  IndexedDB under the search's id (idbStore.mjs): its runs, and the runner folder's small files (request.json, progress.json, partial.json,
//          result.json, result.md, need.json, probe.json, presses.json)
//   pool   Web Workers (pagePool.mjs), one per core; Stop terminates them
//   sim    probeRun and measureNeed in a worker (pool.call), buildDtos on the main thread (it runs no simulation)
//   hash   the page's sha1 (sha1.mjs)
//   sink   kept in memory for status(), and the reports written to the store as the runner writes them to the search's folder
// The search's id is the runner's (request.mjs searchIdWith with the same sha1 hex), so the same request starts the same search: Start on a stopped
// one resumes it from its stored runs, as does stop() on it (the window's Resume). One search runs at a time.
//   start(body)            { id } | { error, id, running } (one running already) | { error }
//   status(id, since)      { state, progress, error?, result?, partial?, partialVersion?, round?, roundVersion? } | null
//   stop(id)               { id, stopping: true } | { id, resumed: true } | { error, state }
//   done(id, mode)         { id, done: mode } | { error, ... }: the stage buttons, 'accept' or 'skip'
//   results()              [{ id, finished, goal, players, stopped? }] newest first;  result(id): its result, or a stopped one's partial | null
//   exportRuns(id) / importRuns(id, text)   the search's runs as runs.jsonl text, and back (runsJsonl.mjs)
// opts: { indexedDB, dbName, size (workers, default navigator.hardwareConcurrency), makeWorker } (a test passes its own).
import { main } from '../../tools/whatif/core.mjs';
import { parseFlags } from '../../tools/whatif/options.mjs';
import { buildDtos } from '../../tools/whatif/engine-pure.mjs';
import { isMarketplace } from '../marketplace.mjs';
import { sha1 } from './sha1.mjs';
import { checkRequest, budgetArgs, flagArgs, searchIdWith } from './request.mjs';
import { createPagePool } from './pagePool.mjs';
import { createIdbStore, listSearches } from './idbStore.mjs';
import { exportRuns, importRuns } from './runsJsonl.mjs';

// The price snapshot's name in the run keys and in the tasks' options: the page has no file, so the key names the snapshot by its content.
const pricesKeyOf = (marketplace) => 'snapshot:' + sha1(JSON.stringify(marketplace)).slice(0, 12);

// The core's settings and data for a request (the runner's buildArgs and the optimizer's loadNodeData, without the files).
export function pageSettings(body, jobs) {
    checkRequest(body);
    const market = body.options?.marketplace;
    if (body.options?.prices != null) throw new Error('options.prices: the page search takes options.marketplace');
    if (!isMarketplace(market)) throw new Error('options.marketplace: the marketplace.json body, { marketData, timestamp }');
    const argv = [...budgetArgs(body), ...flagArgs(body)];
    return {
        settings: { flags: parseFlags(argv), argsText: argv.join(' '), jobs, setupsDir: undefined, pricesFile: 'marketplace.json', pricesKey: pricesKeyOf(market) },
        data: { setups: body.setups, market: market.marketData, pricesTimestamp: market.timestamp, exportData: body.export ?? null, userTrig: body.triggerCands ?? body['trigger-cands'] ?? {} },
    };
}

export function createPageSearch(opts = {}) {
    const size = opts.size || (globalThis.navigator && navigator.hardwareConcurrency) || 4;
    const idb = { indexedDB: opts.indexedDB, dbName: opts.dbName };
    const searches = new Map(); // id -> { state, progress, error, partial, partialVersion, round, roundVersion, result, stop, pool, ended }
    const stores = new Map(); // id -> Promise of its store
    let running = null, seq = 0; // seq: one counter for the partial and round versions, as the runner's
    const storeOf = (id) => { if (!stores.has(id)) stores.set(id, createIdbStore(id, idb)); return stores.get(id); };
    const idOf = (body) => searchIdWith(sha1, body);

    async function launch(id, body) {
        const store = await storeOf(id);
        const { settings, data } = pageSettings(body, size);
        const pool = createPagePool({ setups: data.setups, market: data.market }, { size, ...(opts.makeWorker ? { makeWorker: opts.makeWorker } : {}) });
        const stop = { requested: false, done: false }, writes = [];
        const write = (name, value) => { writes.push(store.writeAux(name, value)); };
        const s = { state: 'running', progress: { stage: 'start', candidatesLeft: null, runsDone: 0, runsPlanned: 0, secondsPerRun: null, etaSeconds: null }, error: null, stop, pool };
        searches.set(id, s);
        running = id;
        const sink = {
            progress(p) { s.progress = p; write('progress.json', p); },
            partial(snapshot) { s.partial = snapshot; s.partialVersion = ++seq; },
            round(r) { s.round = r; s.roundVersion = ++seq; },
            stopped(snapshot) { write('partial.json', snapshot); write('saved.json', new Date().toISOString()); },
            final(snapshot, markdown) { s.result = snapshot; write('result.json', snapshot); write('result.md', markdown); write('saved.json', new Date().toISOString()); return 'result.md'; },
        };
        const sim = { probeRun: (o) => pool.call('probeRun', o), measureNeed: (o) => pool.call('measureNeed', o), buildDtos: (setups, o) => buildDtos(setups, o) };
        const seams = { data, store, pool, sink, stop, hash: sha1, sim };
        // The runner's exit codes, here: done (result written), stopped (Stop, or --max-minutes), error (the core threw; a call the Stop ended counts as stopped).
        s.ended = main(settings, seams).then(
            (outcome) => ({ state: outcome.stopped ? 'stopped' : 'done' }),
            (err) => (stop.requested ? { state: 'stopped' } : { state: 'error', error: String(err && err.message || err) }),
        ).then(async (end) => {
            pool.kill();
            await Promise.allSettled(writes);
            Object.assign(s, end);
            if (running === id) running = null;
        });
    }

    async function status(id, since = 0) {
        const s = searches.get(id), store = await storeOf(id);
        const progress = s?.progress ?? (await store.readAux('progress.json'));
        if (s?.state === 'running') return { state: 'running', progress, ...(s.partial && s.partialVersion > since ? { partial: s.partial, partialVersion: s.partialVersion } : {}), ...(s.round && s.roundVersion > since ? { round: s.round, roundVersion: s.roundVersion } : {}) };
        const result = s?.result ?? (await store.readAux('result.json'));
        if (result) return { state: 'done', progress, result };
        if (s?.state === 'error') return { state: 'error', progress, error: s.error };
        if (await store.readAux('request.json')) return { state: 'stopped', progress };
        return null;
    }

    async function start(body) {
        try {
            if (running) return { error: 'a search is running', id: running, running };
            pageSettings(body, size); // the request's checks, before anything is stored
            const id = idOf(body), store = await storeOf(id);
            if (await store.readAux('result.json')) return { id }; // finished already
            await store.writeAux('request.json', body);
            await launch(id, body);
            return { id };
        } catch (e) { return { error: e.message }; }
    }

    async function stop(id) {
        const s = searches.get(id);
        if ((!s || s.state !== 'running') && (await status(id))?.state === 'stopped') {
            const r = await start(await (await storeOf(id)).readAux('request.json'));
            return r.error ? r : { id, resumed: true };
        }
        if (!s || s.state !== 'running') return { error: 'not running', state: (await status(id))?.state ?? null };
        s.stop.requested = true;
        s.pool.kill();
        return { id, stopping: true };
    }

    async function done(id, mode) {
        const s = searches.get(id);
        if (!s || s.state !== 'running') return { error: 'not running', state: (await status(id))?.state ?? null };
        if (mode !== 'accept' && mode !== 'skip') return { error: 'mode must be accept or skip' };
        s.stop.press?.(mode);
        return { id, done: mode };
    }

    async function results() {
        const all = await listSearches(idb), out = [];
        for (const [id, names] of Object.entries(all)) {
            if (id === running) continue;
            const stopped = !names.includes('result.json');
            if (stopped && !names.includes('partial.json')) continue;
            const store = await storeOf(id), r = await store.readAux(stopped ? 'partial.json' : 'result.json');
            out.push({ id, finished: await store.readAux('saved.json'), goal: r.goal, players: r.players, ...(stopped ? { stopped: true } : {}) });
        }
        return out.sort((a, b) => (a.finished < b.finished ? 1 : -1));
    }

    async function result(id) {
        const store = await storeOf(id);
        return (await store.readAux('result.json')) ?? (await store.readAux('partial.json'));
    }

    return {
        start, status, stop, done, results, result,
        exportRuns: async (id) => exportRuns(await storeOf(id)),
        importRuns: async (id, text) => importRuns(await storeOf(id), text),
        // Resolves once the running search (if any) has ended and its reports are stored (a test waits on it).
        settled: async () => { for (const s of searches.values()) await s.ended; },
        idOf,
    };
}
