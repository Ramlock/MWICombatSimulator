// The core's store seam in the page: IndexedDB (database `mwi-whatif`), one search's records under its search id.
//   runs  the run records, the same record the Node store appends to runs.jsonl, keyed [search, record.key + '#' + record.seed] (the core's own run id);
//         a record with fewer hours than the one stored under its id is not written (the core keeps the longer run too)
//   aux   the small cache files of the Node store (need.json, probe.json, presses.json, progress.json), keyed [search, name]
// put / putAll / writeAux resolve once their transaction has committed. load() streams the search's runs in batches (each batch its own transaction,
// so the reader may await between records). `indexedDB` is passed in so a test can give its own.
const DB_NAME = 'mwi-whatif', DB_VERSION = 1, BATCH = 500;

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const committed = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });

export function openWhatIfDb(idb = globalThis.indexedDB, name = DB_NAME) {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs');
        if (!db.objectStoreNames.contains('aux')) db.createObjectStore('aux');
    };
    return done(req);
}

// Every key of one search: [search, x] for any string x (an array sorts after every string, so [search, []] bounds them).
const searchRange = (search, after) => after === undefined ? IDBKeyRange.bound([search], [search, []]) : IDBKeyRange.bound(after, [search, []], true);
const runId = (r) => r.key + '#' + r.seed;

// Every search with cache files: { <search id>: [its aux names] }.
export async function listSearches({ indexedDB, dbName } = {}) {
    const db = await openWhatIfDb(indexedDB, dbName);
    try {
        const keys = await done(db.transaction('aux').objectStore('aux').getAllKeys());
        const out = {};
        for (const [search, name] of keys) (out[search] ||= []).push(name);
        return out;
    } finally { db.close(); }
}

export async function createIdbStore(search, { indexedDB, dbName } = {}) {
    const db = await openWhatIfDb(indexedDB, dbName);
    // Writes the records in one transaction, each only when it has more hours than the stored one.
    async function write(records) {
        const longest = new Map(); // one record per id, the longest (a runs.jsonl may hold an id twice)
        for (const r of records) { const p = longest.get(runId(r)); if (!p || p.hours < r.hours) longest.set(runId(r), r); }
        const tx = db.transaction('runs', 'readwrite'), os = tx.objectStore('runs'), end = committed(tx);
        for (const r of longest.values()) {
            const k = [search, runId(r)], get = os.get(k);
            get.onsuccess = () => { if (!get.result || get.result.hours < r.hours) os.put(r, k); };
        }
        await end;
    }
    return {
        async *load() {
            let after;
            for (;;) {
                const tx = db.transaction('runs'), os = tx.objectStore('runs'), range = searchRange(search, after);
                const [keys, values] = await Promise.all([done(os.getAllKeys(range, BATCH)), done(os.getAll(range, BATCH))]);
                for (const v of values) yield v;
                if (keys.length < BATCH) return;
                after = keys[keys.length - 1];
            }
        },
        put: (record) => write([record]),
        putAll: (records) => write(records),
        async readAux(name) {
            const v = await done(db.transaction('aux').objectStore('aux').get([search, name]));
            return v === undefined ? null : v;
        },
        async writeAux(name, value) {
            const tx = db.transaction('aux', 'readwrite'), end = committed(tx);
            tx.objectStore('aux').put(structuredClone(value), [search, name]);
            await end;
        },
        // The number of runs stored for this search.
        count: () => done(db.transaction('runs').objectStore('runs').count(searchRange(search))),
        // Removes this search's runs and cache files.
        async clear() {
            const tx = db.transaction(['runs', 'aux'], 'readwrite'), end = committed(tx);
            tx.objectStore('runs').delete(searchRange(search));
            tx.objectStore('aux').delete(searchRange(search));
            await end;
        },
        close: () => db.close(),
    };
}
