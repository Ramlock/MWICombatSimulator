// The runs.jsonl line format: one run record per line, JSON. The one reading and writing of it: the Node store (tools/whatif/node-shell.mjs) appends
// and reads its files with it, and the page exports and imports its IndexedDB store's runs with it, so a page search's runs open in the runner and back.
// Pure: no I/O of its own.

// One record as its line.
export const jsonlLine = (record) => JSON.stringify(record) + '\n';

// Every record of a runs.jsonl text, in its order (blank lines skipped).
export function* readJsonl(text) {
    for (const l of text.split('\n')) if (l.trim()) yield JSON.parse(l);
}

// A store seam's runs as runs.jsonl text (load() as the core reads it: a plain or an async iterable).
export async function exportRuns(store) {
    let text = '';
    for await (const r of store.load()) text += jsonlLine(r);
    return text;
}

// A runs.jsonl text into a store seam; resolves with the number of records read once all are written (putAll when the store has it: one write).
export async function importRuns(store, text) {
    const records = [...readJsonl(text)];
    if (store.putAll) await store.putAll(records);
    else for (const r of records) await store.put(r);
    return records.length;
}
