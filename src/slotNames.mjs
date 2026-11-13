// The character name a player slot carries (the `name` key of an import) and the one rule for showing it.
// Every import path (Solo, All players, the per-player boxes) ends in applySlotNames (main.js), which shows each slot's name
// on its player tab and in every label that copies the tab's text; the What-if window and search read the same names.
// A slot's name is its saved JSON's `name`; a tab shows it only when it is unique: a name two slots share, or none, leaves
// the tab's own text (the player's own edit, or "Player N").

// The trimmed `name` of one slot's saved JSON, or '' (no data, bad JSON, no name).
export function slotNameOf(json) {
    try {
        const n = JSON.parse(json || 'null')?.name;
        return typeof n === 'string' ? n.trim() : '';
    } catch { return ''; }
}

// The slot's JSON with its name set. A blank name changes nothing; a slot that holds nothing (or bad JSON) starts from {}.
export function withSlotName(json, name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return json;
    let prior = {};
    try { prior = JSON.parse(json || 'null') ?? {}; } catch { prior = {}; }
    return JSON.stringify({ ...prior, name: trimmed });
}

// The name each slot is known by when no other slot has the same one, else '' (none, or shared). In slot order (index 0 = slot 1).
export function uniqueSlotNames(slotJsons) {
    const own = slotJsons.map(slotNameOf);
    return own.map((n) => (n && own.indexOf(n) === own.lastIndexOf(n) ? n : ''));
}

// The name each slot is shown under: its unique name, else the fallback (the tab's text). tabTexts in tab order.
export function shownNames(slotJsons, tabTexts) {
    const unique = uniqueSlotNames(tabTexts.map((_, i) => slotJsons[i]));
    return tabTexts.map((text, i) => unique[i] || String(text).trim());
}
