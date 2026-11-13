// The Combat Tracker's saved recording ("Save combat recording (file)": one JSON object, format "mwics-loot") as the rows the
// helper writes to combat-YYYY-MM.jsonl ({"v":1,"seen":...,"rec":{"key","type","data"}}), so tools/attribution/run.mjs reads either
// through the same code. Keys follow the userscript's sink (userscript/mwics-exporter.user.js: encKey, winKeyOf, 'task:' + t); the saved file
// carries no keys of its own. A row's `seen` is the file's exportedAt (the helper's own time is not in the file). Pure: no Node imports.
export const SAVED_FORMAT = 'mwics-loot';

export function savedFileToRows(saved) {
    if (!saved || typeof saved !== 'object' || saved.format !== SAVED_FORMAT) {
        const got = saved && typeof saved === 'object' && saved.format !== undefined ? JSON.stringify(saved.format) : 'none';
        throw new Error('not a saved combat recording: its format is ' + got + ', expected "' + SAVED_FORMAT + '" (the file written by the Combat Tracker\'s "Save combat recording (file)")');
    }
    const seen = saved.exportedAt;
    const row = (key, type, data) => ({ v: 1, seen, rec: { key, type, data } });
    const rows = [];
    for (const w of saved.windows || []) rows.push(row('win:' + w.startedAt + '#' + w.battles + '.' + (w.buffEvents || []).length + (w.open ? '' : '.c'), 'window', w));
    for (const e of saved.encounters || []) rows.push(row('enc:' + e.startedAt + ':' + e.battleId, 'encounter', e));
    for (const q of saved.tasks || []) rows.push(row('task:' + q.t, 'task', q));
    return rows;
}
