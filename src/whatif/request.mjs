// The what-if window's search request (docs/codebase/whatif-window.md, POST /api/search) read as the optimizer's flags: the one reading, used by the
// runner (tools/whatif/runner/server.mjs buildArgs, which adds the files it writes) and by the page's own search (src/whatif/pageSearch.mjs).
// Pure: no I/O, no node: module. Throws on a malformed request.

// The optimizer's flags a request may set (camelCase or dashed). --out, --setups, --export and --prices are set by the shell itself;
// --cache-from is not offered (it reads arbitrary files).
// The rounds options (unit-hours ... confirm-seeds, confirm-hours) are the search's named options; `stages` and `keep` are still accepted and ignored by the search.
export const PASS = ['unit-hours', 'first-seeds', 'round-seeds', 'leaders', 'pause-mult', 'coverage', 'reading-step', 'reading-min', 'lock-rule', 'max-rounds', 'confirm-seeds', 'confirm-hours', 'players', 'levers', 'goal', 'stages', 'keep', 'error', 'base-mult', 'z', 'max-up', 'swaps', 'swap-levels', 'sell-down', 'slots', 'only-candidates', 'max-steps', 'max-payback', 'min-gain-pct', 'jobs', 'max-minutes', 'confirm-seed-offset', 'skill-up', 'skill-left', 'charms', 'house-rooms', 'house-up', 'ability-steps', 'book-levels', 'shrine-cap', 'shrine-steps', 'probe', 'trigger-owners', 'trigger-fixed', 'budget', 'comdrop', 'comexp', 'tier', 'zone'];
const dashed = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const RESERVED = new Set(['synthetic', 'setups', 'options', 'budgets', 'export', 'prices', 'marketplace', 'triggerCands', 'trigger-cands']);
export const SAFE_NAME = /^[^\\/:*?"<>|\r\n]+$/;

const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
// The text a search's id is the sha1 of (its first 12 hex digits). The foods and drinks levers used to be one lever, `consumables`: a request that
// ticks both hashes in that old form, so a rerun with both ticked finds the old search's folder, runs and result. Foods alone or drinks alone is its own search.
const oldLevers = (levers) => { const i = levers.indexOf('foods'); return i < 0 || !levers.includes('drinks') ? levers : levers.flatMap((l, j) => (j === i ? ['consumables'] : l === 'drinks' ? [] : [l])); };
export const searchText = (body) => JSON.stringify(canonical(Array.isArray(body?.levers) ? { ...body, levers: oldLevers(body.levers) } : body));
export const searchIdWith = (sha1, body) => sha1(searchText(body)).slice(0, 12);

// The checks on the request's own parts: the body, its setups, its export.
export function checkRequest(body) {
    if (!body || typeof body !== 'object') throw new Error('body must be a JSON object');
    const setups = body.setups;
    if (!Array.isArray(setups) || !setups.length || setups.some((s) => !s || typeof s.name !== 'string' || !SAFE_NAME.test(s.name) || !s.player)) throw new Error('setups: a list of setups, each with a name and a player');
    // export: the old single character export (an object with its `name`) or a map { "<player name>": that player's export }.
    if (body.export != null && (typeof body.export !== 'object' || Array.isArray(body.export))) throw new Error('export: a character export object, or { "<player name>": <export> }');
}

// --budgets from the request's budgets map ([] for none).
export function budgetArgs(body) {
    if (body.budgets == null) return [];
    if (typeof body.budgets !== 'object') throw new Error('budgets: { "<player>": <coin> }');
    const list = Object.entries(body.budgets).map(([p, v]) => { if (!SAFE_NAME.test(p) || p.includes(',') || p.includes('=') || !(Number(v) >= 0)) throw new Error(`budgets: bad entry ${p}`); return `${p}=${Number(v)}`; });
    return list.length ? ['--budgets', list.join(',')] : [];
}

// --players (every setup's name, when the request names none) and every other flag of the request (and of its options) by its PASS name.
export function flagArgs(body) {
    const args = [];
    if (body.players == null) args.push('--players', body.setups.map((s) => s.name).join(','));
    for (const [k, v] of Object.entries({ ...(body.options || {}), ...body })) {
        if (RESERVED.has(k) || v == null) continue;
        const name = dashed(k);
        if (!PASS.includes(name)) throw new Error(`unknown option ${k}`);
        if (v === false) { args.push('--no-' + name); continue; }
        if (v === true) { args.push('--' + name); continue; }
        const text = Array.isArray(v) ? v.join(',') : String(v);
        if (text.startsWith('--') || /[\r\n]/.test(text)) throw new Error(`option ${k}: bad value`);
        args.push('--' + name, text);
    }
    return args;
}
