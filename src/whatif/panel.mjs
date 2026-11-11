// The What-if window's logic, DOM-free so it is tested in Node (tools/test/whatif-panel.mjs). The window talks to the
// local runner (docs/codebase/whatif-window.md): it sends the page's setup and the search settings, shows the runner's
// progress, and shows the optimizer's result.json as it is. It computes no figure: every number shown is a field of the
// result or of the progress (the UI is output only); the only thing it works out itself is which page slot an op names
// and where the page's setup differs from the one the search ran on.
import { applyOps } from './applyOps.mjs';
import { numberHtml, formatNumber } from '../numberFormat.js';
import { isMarketplace } from '../marketplace.mjs';
import { paybackDays } from './payback.mjs';

// The optimizer's levers (tools/whatif/optimize.mjs LEVERS), in the order the window lists them. Seals and the
// Labyrinth are not levers. Books (ability levels, new abilities) are left out until the long-term model can say what
// waiting for the XP is worth (the optimizer keeps both levers, see tools/whatif/levers/houses.mjs). `def` = checked by default (the optimizer's own default is equip only).
export const LEVERS = [
    { id: 'equip', def: true },
    { id: 'consumables' },
    { id: 'pairs' },
    { id: 'owned' },
    { id: 'abilities' },
    { id: 'order' },
    { id: 'triggers' },
    { id: 'houses' },
    { id: 'skills' },
];

export const API = {
    version: '/api/version',
    search: '/api/search',
    // since: the version of the live report the window has; the runner sends the report so far only when it has a newer one.
    status: (id, since) => '/api/search/' + encodeURIComponent(id) + (since ? '?since=' + encodeURIComponent(since) : ''),
    stop: (id) => '/api/search/' + encodeURIComponent(id) + '/stop',
    results: '/api/results',
    result: (id) => '/api/results/' + encodeURIComponent(id),
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? numberHtml(v) : '—');
const upper = (row) => row?.costBound === 'upper';
// A figure is read as "no change" (a player is not used to error margins) when it is strictly inside one error, or smaller than
// `floor` (the size floor: result.basePerUser / 10000, worked out once in renderResult and passed down; null = no floor). The word
// replaces the value and its error, so they never show on different scales; the real value ("+288K ± 242K") is its hover title.
// Exactly one error shows the number. This is the one helper for the rule: every place that shows a value with its error goes through it.
const isNoChange = (v, se, floor) => Number.isFinite(v) && ((Number.isFinite(se) && Math.abs(v) < se) || (Number.isFinite(floor) && Math.abs(v) < floor));
const signedPlain = (v) => (v > 0 ? '+' : '') + formatNumber(v);
const realValue = (v, se) => signedPlain(v) + (Number.isFinite(se) ? ' ± ' + formatNumber(se) : '');
const noChange = (v, se, t) => `<span title="${esc(realValue(v, se))}">${esc(t('result.noChange'))}</span>`;
// One figure in a line of text: "no change", or "<value> ± <error>".
const figure = (v, se, t, floor) => (isNoChange(v, se, floor) ? noChange(v, se, t) : num(v) + ' ± ' + num(se));
// The two cells of a gain and its error: "no change" and "—" (both with the real value as title) when it reads as no change.
function gainPair(v, se, t, floor) {
    if (isNoChange(v, se, floor)) { const title = ` title="${esc(realValue(v, se))}"`; return `<td class="num"${title}>${esc(t('result.noChange'))}</td><td class="num"${title}>—</td>`; }
    return `<td class="num">${num(v)}</td><td class="num">± ${num(se)}</td>`;
}
// A chosen change or filling shows its fresh reading (the optimizer's pick check: the same change measured again on fresh seeds
// against what was chosen before it) in place of the search's own: [value, error] of a pair of fields from `fresh` when it has both,
// else from `row` (an older result with no fresh reading, and a row that has none). Output only: every figure is a field.
const reading = (fresh, row, valueKey, errorKey) => (Number.isFinite(fresh?.[valueKey]) && Number.isFinite(fresh?.[errorKey]) ? [fresh[valueKey], fresh[errorKey]] : [row[valueKey], row[errorKey]]);

// slots: [{ id: "1", name: "<tab name>", json: "<the slot's setup JSON>" }] for the players in the search.
// The setups the runner gets: each slot's JSON with its name, in the optimizer's setup format.
export function pageSetups(slots) {
    return slots.map((s) => ({ ...JSON.parse(s.json), name: s.name }));
}

// The request body of POST /api/search (delivery design, section 10). budgets: { "<player>": coin }.
// marketplace: the market snapshot fetched when the search starts ({ marketData, timestamp }), sent as it came.
export function searchBody({ slots, goal, budgets, levers, zone, tier, marketplace, exports, maxPayback }) {
    const setups = pageSetups(slots);
    const options = {};
    if (zone) options.zone = zone;
    if (tier !== undefined && tier !== null && tier !== '') options.tier = Number(tier);
    if (marketplace) options.marketplace = marketplace;
    const body = { setups, options, goal, budgets, levers, players: setups.map((s) => s.name) };
    // exports: { "<player name>": that player's character export }, only for players that have one.
    if (exports && Object.keys(exports).length) body.export = exports;
    // The payback limit in days (0 = no limit): the runner passes it to the search as --max-payback.
    if (maxPayback !== undefined && maxPayback !== null && maxPayback !== '') body.maxPayback = Number(maxPayback);
    return body;
}

// The character export (the userscript's "Copy character export"): a JSON object with an inventory or a learned-ability list.
// The levers that skip a player with none (the optimizer's skippedNoExport). Ability levels are not among them: without
// the export they keep their labelled upper-bound cost.
export const EXPORT_LEVERS = ['owned', 'abilities'];
export const exportKey = (name) => 'whatIfExport:' + name;
export function parseExport(text) {
    try {
        const d = JSON.parse(text);
        if (d && typeof d === 'object' && !Array.isArray(d) && (Array.isArray(d.inventory) || Array.isArray(d.learnedAbilities))) return { ok: true, data: d };
    } catch (e) { /* not JSON */ }
    return { ok: false };
}
// The status line under a player's paste box. kept: the stored export or null; text: what the box holds now (a bad
// paste stays in it); levers: the ticked lever ids.
export function exportStatus({ kept, text }, levers, t) {
    if (text && text.trim() && !parseExport(text).ok) return t('exportBad');
    if (kept) return t('exportKept', { who: kept.name ?? '' });
    const names = EXPORT_LEVERS.filter((l) => levers.includes(l)).map((l) => t('lever.' + l + '.name'));
    return names.length ? t('exportNone', { levers: names.join(', ') }) : t('exportNoneBare');
}

// The request with the market snapshot fetched now (delivery design section 3). Returns { body }, or { error } when
// the fetch fails or answers no snapshot: then no search starts (no fallback to an older snapshot).
export async function searchRequest(params, getMarketplace) {
    let marketplace;
    try { marketplace = await getMarketplace(); } catch (e) { return { error: String(e?.message || e) }; }
    if (!isMarketplace(marketplace)) return { error: 'no marketData or timestamp' };
    return { body: searchBody({ ...params, marketplace }) };
}

// Apply ops to the page's slots. Returns { missing: [player names no slot holds] } and applies nothing when any op
// names a player the page does not hold; else { slots: { "<slot id>": "<new slot JSON>" } } for every slot an op touched.
export function applyToSlots(slots, ops) {
    const names = new Set(slots.map((s) => s.name));
    const missing = [...new Set(ops.map((o) => o.player).filter((p) => !names.has(p)))];
    if (missing.length) return { missing };
    const touched = new Set(ops.map((o) => o.player));
    const after = applyOps(pageSetups(slots), ops);
    const out = {};
    slots.forEach((s, i) => {
        if (!touched.has(s.name)) return;
        const { name, ...rest } = after[i];
        out[s.id] = JSON.stringify(rest);
    });
    return { slots: out };
}

// The ops of the first n chosen steps, in order ("Apply 1 to n").
export const stepsOps = (result, n) => result.steps.slice(0, n).flatMap((s) => s.ops || []);

// The best foods and drinks the search chose first (result.baselineOps; every other row is measured on top of them). Every Apply
// puts them in first, then its own ops, so one click gives the measured setup. A result without the field (older) adds nothing.
const baselineOps = (result) => (Array.isArray(result.baselineOps) ? result.baselineOps : []);

// Where the page's setup differs from the result's base setups, on what the levers touch. Each difference:
// { player, field, page, result } with raw values (hrids, levels); a player missing on either side has field "player".
export function diffSetups(page, base) {
    const out = [];
    const byName = (list) => new Map((list || []).map((s) => [s.name, s]));
    const P = byName(page), B = byName(base);
    for (const name of new Set([...P.keys(), ...B.keys()])) {
        const p = P.get(name), b = B.get(name);
        if (!p || !b) { out.push({ player: name, field: 'player', page: p ? 'present' : 'absent', result: b ? 'present' : 'absent' }); continue; }
        const add = (field, x, y) => { if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) out.push({ player: name, field, page: x ?? null, result: y ?? null }); };
        for (const k of ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic']) add(k + 'Level', Number(p.player?.[k + 'Level']), Number(b.player?.[k + 'Level']));
        const eq = (s) => Object.fromEntries((s.player?.equipment || []).map((e) => [e.itemLocationHrid.replace('/item_locations/', ''), e.itemHrid + ' +' + Number(e.enhancementLevel)]));
        const pe = eq(p), be = eq(b);
        for (const slot of new Set([...Object.keys(pe), ...Object.keys(be)])) add(slot, pe[slot], be[slot]);
        const items = (s, k) => (s[k]?.['/action_types/combat'] || []).map((x) => x?.itemHrid || null);
        const pf = items(p, 'food'), bf = items(b, 'food'), pd = items(p, 'drinks'), bd = items(b, 'drinks');
        for (let i = 0; i < Math.max(pf.length, bf.length); i++) add('food ' + (i + 1), pf[i] || null, bf[i] || null);
        for (let i = 0; i < Math.max(pd.length, bd.length); i++) add('drink ' + (i + 1), pd[i] || null, bd[i] || null);
        const ab = (s) => (s.abilities || []).map((a) => (a?.abilityHrid ? a.abilityHrid + ' ' + Number(a.level) : null));
        const pa = ab(p), ba = ab(b);
        for (let i = 0; i < Math.max(pa.length, ba.length); i++) add('ability ' + (i + 1), pa[i] || null, ba[i] || null);
        const rooms = (s) => Object.fromEntries(Object.entries(s.houseRooms || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
        const pr = rooms(p), br = rooms(b);
        for (const r of new Set([...Object.keys(pr), ...Object.keys(br)])) add(r, pr[r] ?? 0, br[r] ?? 0);
        const pt = p.triggerMap || {}, bt = b.triggerMap || {};
        for (const h of new Set([...Object.keys(pt), ...Object.keys(bt)])) add('triggers ' + h, pt[h], bt[h]);
    }
    return out;
}

// Progress line from GET /api/search/<id>: the runner's own fields, shown as they come.
export function renderProgress(status, t) {
    if (!status) return '';
    const p = status.progress || {};
    if (Array.isArray(p.parts) && p.parts.length) return renderParts(status, t);
    const parts = [`<b>${esc(t('state.' + status.state))}</b>`];
    if (p.stage) parts.push(esc(t('progress.stage')) + ' ' + esc(p.stage));
    if (p.candidatesLeft !== undefined) parts.push(esc(t('progress.candidatesLeft')) + ' ' + num(p.candidatesLeft));
    if (p.runsPlanned !== undefined) parts.push(esc(t('progress.runs')) + ' ' + num(p.runsDone) + ' / ' + num(p.runsPlanned));
    if (p.secondsPerRun !== undefined) parts.push(esc(t('progress.secondsPerRun')) + ' ' + num(p.secondsPerRun));
    if (p.etaSeconds !== undefined && p.etaSeconds !== null) parts.push(esc(t('progress.eta')) + ' ' + esc(duration(p.etaSeconds)));
    let html = parts.join(' · ');
    if (p.runsPlanned > 0) {
        const pct = Math.min(100, Math.max(0, (p.runsDone / p.runsPlanned) * 100));
        html += `<div class="progress whatif-progress mt-1" style="height: 6px;"><div class="progress-bar" style="width: ${pct}%"></div></div>`;
    }
    if (status.state === 'error' && status.error) html += `<div class="text-danger">${esc(status.error)}</div>`;
    return html;
}

// Stacked rows from progress.parts (one per part of the search; output only, every figure is a field of the part).
// Params given to t() here are already-escaped HTML (num()), so the translated line is not escaped again.
const fill = (t, key, params) => t(key, params);
export function renderParts(status, t) {
    const p = status.progress || {}, parts = p.parts;
    const running = parts.findIndex((r) => r.state === 'running');
    const rowsHtml = parts.map((r) => {
        const label = r.kind === 'foods' ? t('progress.partFoods')
            : r.kind === 'drinks' ? t('progress.partDrinks')
            : r.kind === 'screen' ? t('progress.partScreen')
            : r.kind === 'halving' ? t('progress.partHalving', { n: r.index })
            : r.kind === 'steps' ? t('progress.partSteps', { n: r.maxSteps })
            : r.kind === 'picks' ? t('progress.partPicks')
            : r.kind === 'step' ? t('progress.partStep', { n: r.index })
            : r.kind === 'moreSteps' ? t('progress.partMoreSteps', { n: r.stepsLeft })
            : r.state === 'waiting' ? t('progress.partConfirmationWaiting') : t('progress.partConfirmation');
        const left = (r.kind === 'halving' || r.kind === 'foods' || r.kind === 'drinks') && r.candidatesLeft != null ? ' · ' + fill(t, 'progress.optionsLeft', { n: num(r.candidatesLeft) }) : '';
        let text = '', cls;
        if (r.state === 'waiting') { if (r.runsUpTo !== undefined) text = fill(t, 'progress.upTo', { n: num(r.runsUpTo) }); else if (r.kind === 'picks' && r.runsPlanned > 0) text = fill(t, 'progress.runsOf', { done: num(r.runsDone), total: num(r.runsPlanned) }); cls = 'waiting'; }
        else if (r.state === 'done') { text = fill(t, 'progress.runsOf', { done: num(r.runsPlanned), total: num(r.runsPlanned) }) + ' · ' + esc(t('progress.done')); cls = 'done'; }
        else {
            text = fill(t, 'progress.runsOf', { done: num(r.runsDone), total: num(r.runsPlanned) });
            if (r.etaSeconds !== null && r.etaSeconds !== undefined) text += ' · ' + esc(t('progress.timeLeft', { time: duration(r.etaSeconds) }));
            cls = 'running';
        }
        // One icon column of equal width: a plain text glyph (︎ asks for the text form, never a colour emoji).
        const mark = { done: '✓', running: '▶︎', waiting: '○' }[cls];
        const pct = r.state === 'done' ? 100 : (r.state === 'running' || (r.state === 'waiting' && r.kind === 'picks')) && r.runsPlanned > 0 ? Math.min(100, Math.max(0, (r.runsDone / r.runsPlanned) * 100)) : 0;
        return `<div class="whatif-part whatif-part-${cls}" data-kind="${esc(r.kind)}" data-state="${cls}"><span class="whatif-part-mark">${mark}</span><span class="whatif-part-label"><b>${esc(label)}</b>${left}</span><div class="progress whatif-progress" style="height: 8px;"><div class="progress-bar" style="width: ${pct}%"></div></div><span class="whatif-part-text">${text}</span></div>`;
    }).join('');
    const title = running >= 0 ? esc(t('state.running')) + ' · ' + esc(t('progress.partOf', { k: running + 1, n: parts.length })) : esc(t('state.' + status.state));
    const small = [];
    if (p.secondsPerRun !== undefined && p.secondsPerRun !== null) small.push(esc(t('progress.secondsPerRunCap')) + ' ' + `<span title="${esc(p.secondsPerRun)}">${esc(Number(p.secondsPerRun).toFixed(2))}</span>`);
    if (p.elapsedSeconds !== undefined && p.elapsedSeconds !== null) small.push(esc(t('progress.elapsed')) + ' ' + esc(duration(p.elapsedSeconds)));
    let html = `<div class="whatif-parts"><div class="mb-1"><b>${title}</b></div>${rowsHtml}${small.length ? `<div class="small mt-1">${small.join(' · ')}</div>` : ''}</div>`;
    if (status.state === 'error' && status.error) html += `<div class="text-danger">${esc(status.error)}</div>`;
    return html;
}

// Seconds as h:mm:ss (a clock reading of the runner's figure, not a new figure).
export function duration(s) {
    const x = Math.max(0, Math.round(Number(s)));
    const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = x % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---- Game names in the descriptions (output only: the ids stay in the result and the Apply buttons read the ops) ----
// The runner writes each desc with the game's internal ids (the last part of a hrid: "pathseeker_boots_refined",
// "feet", "berserk"). The window shows the names the page itself shows in its current language: the game bundle's
// itemNames, abilityNames, skillNames, equipmentTypeNames (slots), combatTriggerDependencyNames and
// combatTriggerConditionNames; a house room is written as its English name and is looked up by that name in
// houseRoomNames. A refined item has its own itemNames entry (with the page's "★"), so it needs no rule here.
const NAME_TABLES = {
    itemNames: '/items/',
    abilityNames: '/abilities/',
    skillNames: '/skills/',
    equipmentTypeNames: '/equipment_types/',
    combatTriggerDependencyNames: '/combat_trigger_dependencies/',
    combatTriggerConditionNames: '/combat_trigger_conditions/',
    actionNames: '/actions/', // the zone: "combat/fly"
    houseRoomNames: '/house_rooms/', // the "where the page differs" warning holds room hrids
    combatTriggerComparatorNames: '/combat_trigger_comparators/', // and trigger terms as JSON
};
// The lookups `localizeDesc` takes, from the game bundle of the shown language (`current`) and of English (`english`,
// the fallback i18next uses and the language the room names are written in). A bundle is { itemNames: { "/items/x": name }, ... }.
export function namesFrom(current, english = current) {
    const get = (table, slug) => {
        const hrid = NAME_TABLES[table] + slug;
        const name = current?.[table]?.[hrid] ?? english?.[table]?.[hrid];
        return typeof name === 'string' && name !== '' ? name : null;
    };
    const rooms = Object.entries(english?.houseRoomNames || {}).map(([hrid, en]) => [en, current?.houseRoomNames?.[hrid] || en])
        .sort((a, b) => b[0].length - a[0].length);
    return { get, rooms };
}

const ITEMS_ETC = ['itemNames', 'abilityNames', 'skillNames', 'equipmentTypeNames'];
const TRIGGER_TERMS = ['combatTriggerDependencyNames', 'combatTriggerConditionNames'];
const SLUG = /(?<![A-Za-z0-9_])[a-z][a-z0-9_]*(?![A-Za-z0-9_])/g;
const swap = (text, tables, names) => text.replace(SLUG, (id) => {
    for (const table of tables) { const name = names.get(table, id); if (name !== null) return name; }
    return id;
});
// A desc with every game id replaced by its name; an id with no name stays. `players` are the names the result
// holds: the player name leads the desc and is never touched. Trigger descs ("<owner> trigger: <terms>") read the
// owner as an item or ability and the terms as trigger dependency and condition (a condition can share an id with an ability).
// `dropPlayer`: when the desc leads with that player (the row's own, which has its own column), the lead is left off the shown desc.
export function localizeDesc(desc, names, players = [], dropPlayer = null) {
    const text = String(desc ?? '');
    const lead = [...players].sort((a, b) => b.length - a.length).find((p) => p && text.startsWith(p + ' '));
    const head = lead && lead !== dropPlayer ? lead + ' ' : '';
    const skip = lead ? lead.length + 1 : 0;
    if (!names) return head + text.slice(skip);
    const rest = text.slice(skip);
    const room = names.rooms.find(([en]) => rest.startsWith(en + ' '));
    if (room) return head + room[1] + rest.slice(room[0].length);
    const at = rest.indexOf(' trigger: ');
    if (at >= 0) return head + swap(rest.slice(0, at), ITEMS_ETC, names) + ' trigger: ' + swap(rest.slice(at + ' trigger: '.length), TRIGGER_TERMS, names);
    return head + swap(rest, ITEMS_ETC, names);
}

// The split of a player's confirmed gain: his share of the party's loot gain plus the food and drink he saved (or spent more on).
// `c.ownSuppliesByPlayer[p]` is the change in his own supplies spend (below 0 = saved); an older result has neither field: no note.
// The loot share is the party's gain per user: when that reads as no change (inside its error `se`, or under `floor`) the note says so too.
const supplyNote = (c, p, t, se, floor) => {
    const loot = c?.sharedGainPerUser, own = c?.ownSuppliesByPlayer?.[p];
    if (!Number.isFinite(loot) || !Number.isFinite(own)) return '';
    return ` <span class="whatif-dim">(${t(own <= 0 ? 'result.playerSplitSaved' : 'result.playerSplitMore', { loot: isNoChange(loot, se, floor) ? noChange(loot, se, t) : num(loot), amount: num(Math.abs(own)) })})</span>`;
};
// A cost cell: "≤" when the cost is only an upper bound.
const costCell = (row) => (upper(row) ? '≤ ' : '') + num(row.cost);
// In the confirmation lines, a payback that is not a number above 0 (a saved 0 means nothing was bought) is missing.
const confirmedPayback = (v) => (typeof v === 'number' && v > 0 ? v : null);
// A cost of exactly 0 (a free change) has nothing to pay back: that reads as words, not as the dash of a cost with no gain.
const paybackCell = (row, t) => (row.payback === null || row.payback === undefined ? (row.cost === 0 && t ? esc(t('result.noCost')) : '—') : (upper(row) ? '≤ ' : '') + num(row.payback));

// The split of a row: the party's gain per user and its error, then the buyer's gain per day and its error (profit goal; "—" on the EXP
// goal and on a result saved before the buyer's net). hasSplit: the row carries the buyer's split, so Payback is the buyer's.
const hasSplit = (row) => Number.isFinite(row?.sharedGainPerUser);
// withFresh: a chosen change, whose row shows its fresh reading.
function gainCells(row, goalExp, t, floor, withFresh = false) {
    const f = withFresh ? row.fresh : null, [gain, gainSe] = reading(f, row, 'gainPerUser', 'sePerUser'), [net, netSe] = reading(f, row, 'buyerNet', 'buyerNetSe');
    return gainPair(gain, gainSe, t, floor) + (!goalExp && Number.isFinite(net) ? gainPair(net, netSe, t, floor) : '<td class="num">—</td><td class="num">—</td>');
}
// How it is bought: the cost path and its note, without the upper-bound caveat (the "≤" on the cost and the footnote carry it).
const pathCell = (s) => {
    const note = String(s.note || '').replace('; upper bound (XP inside the level unknown)', '');
    // A skill level (cost path "time ..."): the word "time", the runner's full text on hover.
    if (/^time\b/.test(String(s.costPath || ''))) return `<td title="${esc(s.costPath)}">time</td>`;
    return `<td class="wrap">${esc(s.costPath)}${note ? ' (' + esc(note) + ')' : ''}</td>`;
};
// A skill level is not a setup change: it comes with time spent fighting (cost path "time ..."), so it has no Apply button.
const isTimeOnly = (s) => s.timeOnly === true || /^time/.test(String(s.costPath || ''));
// A chosen change (withFresh) with a fresh reading and a cost: the cost over the fresh buyer's gain (paybackDays, the search's own helper);
// with no cost or no positive buyer's gain, or any other row, what the row says.
const buyerPayback = (row, goalExp, t, withFresh = false) => {
    const days = withFresh && !goalExp ? paybackDays(row.cost, row.fresh?.buyerNet) : null;
    if (days !== null) return paybackCell({ payback: days, costBound: row.costBound, cost: row.cost }, t);
    return goalExp || !hasSplit(row) ? paybackCell(row, t) : paybackCell({ payback: row.paybackOwn, costBound: row.costBound, cost: row.cost }, t);
};
// The Payback cell: the words of a free change (class whatif-free) may wrap, so a narrow window gives the room to the Change column.
const paybackTd = (row, goalExp, t, withFresh = false) => { const html = buyerPayback(row, goalExp, t, withFresh); return `<td class="num${html === esc(t('result.noCost')) ? ' whatif-free' : ''}">${html}</td>`; };

// ---- Best foods and drinks (result.best) ----
// One line per player: "<player>: A, B, C" in slot order. A food shows its trigger in parentheses when it has one (the readable
// text of the runner, its game ids named like the trigger descs); a drink never does. A player the search left unchanged shows his
// current items and "no change". Returns '' for a result without `best` (saved before the foods-first search) or with no player in it.
const slugOf = (hrid) => String(hrid).split('/').pop();
export function bestBlock(result, t, names = null, running = false, floor = null) {
    const best = result?.best;
    if (!best) return '';
    const lines = (kind, label) => {
        const per = best[kind] || {};
        const who = Object.keys(per);
        if (!who.length) return '';
        const rows = who.map((p) => {
            const e = per[p];
            const items = (e.items || []).map((x) => {
                const name = names?.get('itemNames', slugOf(x.item)) ?? slugOf(x.item);
                return esc(name) + (x.trigger ? ' (' + esc(names ? swap(String(x.trigger), TRIGGER_TERMS, names) : String(x.trigger)) + ')' : '');
            });
            const text = items.length ? items.join(', ') : '—';
            // A changed line says what the change is worth: the party's gain, the buyer's gain and (when saved) its split. The figures are
            // the filling's fresh reading (the pick check, whatif-runner.md) when it has one, else the search's own (an older result).
            const [gain, gainSe] = reading(e.fresh, e, 'gainPerUser', 'sePerUser'), [net, netSe] = reading(e.fresh, e, 'buyerNet', 'buyerNetSe');
            // On the EXP goal there is no buyer's gain: the party's figure alone.
            const gains = e.unchanged ? ''
                : Number.isFinite(net) ? ' · <span class="whatif-dim">' + t('result.bestGain', { party: figure(gain, gainSe, t, floor), buyer: figure(net, netSe, t, floor) }) + '</span>'
                    + supplyNote({ sharedGainPerUser: gain, ownSuppliesByPlayer: { [p]: e.ownSuppliesPerDay } }, p, t, gainSe, floor)
                : result.goal === 'exp' && Number.isFinite(gain) ? ' · <span class="whatif-dim">' + t('result.bestGainExp', { party: figure(gain, gainSe, t, floor) }) + '</span>'
                : '';
            return `<div class="whatif-best-line">${esc(p)}: ${text}${e.unchanged ? ' · <span class="whatif-dim">' + esc(t('result.noChange')) + '</span>' : ''}${gains}</div>`;
        });
        return `<div class="fw-bold mt-2">${esc(label)}</div>${rows.join('')}`;
    };
    const foods = lines('foods', t('result.bestFoods')), drinks = lines('drinks', t('result.bestDrinks'));
    if (!foods && !drinks) return '';
    // While the search runs the line waits for both groups: it says everything below is measured on the foods and drinks.
    const baseline = running && !(foods && drinks) ? '' : `<div class="small text-secondary mt-1">${esc(t('result.bestBaseline'))}</div>`;
    return `<div class="whatif-best">${foods}${drinks}${baseline}</div>`;
}
// A closed list: a bold heading with a small note, one toggle link, and the items (html of <li>s) hidden behind it. The over-budget,
// pays-back-too-slowly and not-confirmed lists are this one renderer; `key` names their locale keys: <key>, <key>Note, <key>Show, <key>Hide.
function closedList(key, id, items, note, t) {
    const n = items.length;
    return `<div class="fw-bold mt-3">${esc(t('result.' + key))} <span class="text-secondary fw-normal small">${esc(t('result.' + key + 'Note', { n, ...note }))}</span></div>` +
        `<button type="button" class="btn btn-link btn-sm p-0 mb-1" data-whatif-more="${id}" data-show="${esc(t('result.' + key + 'Show', { n }))}" data-hide="${esc(t('result.' + key + 'Hide', { n }))}">${esc(t('result.' + key + 'Show', { n }))}</button>` +
        `<ul class="small whatif-more" id="${id}" hidden>${items.join('')}</ul>`;
}
const colHead = (t) => [
    `<th class="num" title="${esc(t('col.partyGainTip'))}">${esc(t('col.partyGain'))}</th>`, `<th class="num">${esc(t('col.se'))}</th>`,
    `<th class="num" title="${esc(t('col.buyerGainTip'))}">${esc(t('col.buyerGain'))}</th>`, `<th class="num">${esc(t('col.se'))}</th>`].join('');

// The result: chosen steps, confirmation, ranked singles, unknown costs, each player's spend. Buttons carry
// data-whatif-apply="steps:<n>" or "single:<index>".
// `running`: true, or 'stopped' for the last report of a search that stopped or failed: the result is the report so far of a search that is still going (a snapshot of the optimizer, the runner's `partial`): the
// same report with a "running" mark; what only the end has (the totals) is not there to draw, "so far" follows the steps heading, and
// the messages that say there is nothing ("no steps", "no change") are not shown, since the rows may simply not have come yet.
export function renderResult(result, t, now = Date.now(), names = null, running = false) {
    if (!result) return '';
    const L = [];
    if (running) L.push(`<div class="mb-2 small whatif-running">${esc(t(running === 'stopped' ? 'result.stoppedMark' : 'result.running'))}</div>`);
    const known = [...new Set([...Object.keys(result.budgets || {}), ...(result.setups || []).map((x) => x.name)])];
    const shown = (row) => esc(localizeDesc(row.desc, names, row.player ? [row.player, ...known] : known, row.player));
    const goal = result.goal === 'exp' ? t('goal.exp') : t('goal.profit');
    L.push(`<div class="mb-2">${esc(t('result.goal'))}: <b>${esc(goal)}</b></div>`);
    const zone = zoneLine(result, t, names);
    if (zone) L.push(`<div class="mb-2">${zone}</div>`);
    if (result.goal !== 'exp' && Number.isFinite(result.basePerUser) && result.basePerUser < 0) L.push(`<div class="mb-2 whatif-warn">${esc(t('result.baseLoses'))}</div>`);
    const prices = pricesLine(result, t, now);
    if (prices) L.push(`<div class="mb-2 small">${prices}</div>`);
    const goalExp = result.goal === 'exp';
    // The size floor of the "no change" rule, worked out once here and passed down to every figure with an error.
    const floor = Number.isFinite(result.basePerUser) ? result.basePerUser / 10000 : null;
    const bestHtml = bestBlock(result, t, names, running, floor);
    if (bestHtml) L.push(bestHtml);
    if (!running || result.steps?.length) L.push(`<div class="fw-bold mt-2">${esc(t('result.steps'))}${running ? ' <span class="text-secondary fw-normal small">· ' + esc(t('result.soFar')) + '</span>' : ''}</div>`);
    if (!result.steps?.length) { if (!running) L.push(`<div class="text-secondary">${esc(t('result.noSteps'))}</div>`); }
    else {
        L.push('<table class="table table-sm whatif-table"><thead><tr>' +
            ['#', t('col.player'), t('col.change')].map((h) => `<th>${esc(h)}</th>`).join('') + colHead(t) + [t('col.cost'), t('col.payback')].map((h) => `<th class="num">${esc(h)}</th>`).join('') +
            `<th>${esc(t('col.costPath'))}</th><th></th></tr></thead><tbody>`);
        result.steps.forEach((s, i) => {
            L.push(`<tr${s.accepted === false ? ' class="whatif-weak"' : ''}><td>${i + 1}</td><td>${esc(s.player)}</td><td class="chg">${shown(s)}</td>` +
                gainCells(s, goalExp, t, floor, true) + `<td class="num">${costCell(s)}</td>${paybackTd(s, goalExp, t, true)}` + pathCell(s) +
                `<td><button type="button" class="btn btn-primary btn-sm py-0" data-whatif-apply="steps:${i + 1}">${esc(i === 0 ? t('apply') : t('applyTo', { n: i + 1 }))}</button></td></tr>`);
        });
        L.push('</tbody></table>');
        if (!goalExp) L.push(`<div class="small whatif-dim mb-2">${esc(t('result.gainLegend'))}</div>`);
    }
    const c = result.confirmation;
    if (c) {
        // With the per-player lines the party payback is dropped (each line has its own buyer's payback); an older result keeps it.
        const perPlayer = !goalExp && !!c.buyerByPlayer;
        const bound = (result.steps || []).some(upper) ? 'upper' : undefined;
        L.push(`<div class="mb-2">${esc(t(goalExp ? 'result.confirmed' : 'result.confirmedParty'))}: <b>${figure(c.gainPerUser, c.sePerUser, t, floor)}</b> ${esc(t('result.perUserDay'))}, ` +
            `${esc(t('col.cost'))} ${costCell({ cost: c.cost, costBound: bound })}` +
            (perPlayer ? '' : `, ${esc(t('col.payback'))} ${paybackCell({ payback: confirmedPayback(c.payback), costBound: bound, cost: c.cost }, t)}`) + '</div>');
        if (perPlayer) for (const [p, b] of Object.entries(c.buyerByPlayer)) {
            // A player who bought nothing (his running spend is exactly 0) has nothing to pay back: the free wording, not a dash.
            const free = c.runningSpend?.[p] === 0, flat = isNoChange(b.gain, b.se, floor);
            const payback = paybackCell({ payback: confirmedPayback(b.payback), costBound: bound });
            const line = free ? t(flat ? 'result.playerLineFreeNoChange' : 'result.playerLineFree', { player: esc(p), gain: flat ? noChange(b.gain, b.se, t) : num(b.gain), se: num(b.se) })
                : flat ? t('result.playerLineNoChange', { player: esc(p), gain: noChange(b.gain, b.se, t), payback })
                    : t('result.playerLine', { player: esc(p), gain: num(b.gain), se: num(b.se), payback });
            L.push(`<div class="mb-1">${line}${supplyNote(c, p, t, c.sePerUser, floor)}</div>`);
        }
        else if (!goalExp) L.push(`<div class="mb-1 small whatif-dim">${esc(t('result.oldSplit'))}</div>`);
    }
    const anySingles = (result.singles || []).some((s) => !s.hiddenFood);
    if (!running || anySingles) L.push(`<div class="fw-bold mt-3">${esc(t('result.singles'))} <span class="text-secondary fw-normal small">${esc(t('result.singlesNote'))}</span></div>`);
    if (!result.singles?.length) { if (!running) L.push(`<div class="text-secondary">${esc(t('result.noSingles'))}</div>`); }
    else if (running && !anySingles) { /* only the foods and drinks fillings are in so far: they are not a table */ }
    else {
        L.push('<table class="table table-sm whatif-table whatif-each"><thead><tr>' +
            [t('col.player'), t('col.change')].map((h) => `<th>${esc(h)}</th>`).join('') + colHead(t) + [t('col.cost'), t('col.payback')].map((h) => `<th class="num">${esc(h)}</th>`).join('') + `<th>${esc(t('col.costPath'))}</th>` + '<th></th></tr></thead>');
        // Accepted rows first; the grey rows sit in a second body, collapsed behind one toggle (N is a row count).
        const row = (s, i) => `<tr${s.accepted ? '' : ' class="whatif-weak"'}><td>${esc(s.player)}</td><td class="chg">${shown(s)}</td>` +
            gainCells(s, goalExp, t, floor) + `<td class="num">${costCell(s)}</td>${paybackTd(s, goalExp, t)}` + pathCell(s) +
            (isTimeOnly(s) ? '<td></td>' : `<td><button type="button" class="btn ${s.accepted ? 'btn-primary' : 'btn-secondary'} btn-sm py-0" data-whatif-apply="single:${i}">${esc(t('apply'))}</button></td>`) + '</tr>';
        const rows = result.singles.map((s, i) => [s, i]).filter(([s]) => !s.hiddenFood); // hiddenFood: a food row the search left out (one food row per player)
        const weak = rows.filter(([s]) => !s.accepted);
        L.push('<tbody>' + rows.filter(([s]) => s.accepted).map(([s, i]) => row(s, i)).join('') + '</tbody>');
        if (weak.length) L.push('<tbody class="whatif-more" id="whatIfMoreSingles" hidden>' + weak.map(([s, i]) => row(s, i)).join('') + '</tbody>');
        L.push('</table>');
        if (weak.length) L.push(`<button type="button" class="btn btn-link btn-sm p-0 mb-2" data-whatif-more="whatIfMoreSingles" data-show="${esc(t('result.showMore', { n: weak.length }))}" data-hide="${esc(t('result.showLess', { n: weak.length }))}">${esc(t('result.showMore', { n: weak.length }))}</button>`);
    }
    if (result.overBudget?.length) {
        // The list sits closed behind one toggle, as the grey singles do; the heading keeps its count.
        L.push(closedList('overBudget', 'whatIfOverBudget', result.overBudget.map((a) => `<li>${esc(a.player)}, ${shown(a)}: ${costCell(a)}</li>`), {}, t));
    }
    if (result.overPayback?.length) {
        // The changes the payback limit left out (result.options.maxPaybackDays): each with its cost and the days it would take to pay back.
        const days = (a) => (Number.isFinite(a.paybackDays) ? t('result.overPaybackDays', { days: num(a.paybackDays) }) : esc(t('result.overPaybackNever')));
        L.push(closedList('overPayback', 'whatIfOverPayback', result.overPayback.map((a) => `<li>${esc(a.player)}, ${shown(a)}: ${costCell(a)}, ${days(a)}</li>`), { days: formatNumber(result.options?.maxPaybackDays) }, t));
    }
    if (result.notConfirmed?.length) {
        // The picks the search left out because their fresh reading did not confirm them: closed behind one toggle, like the over-budget list.
        const item = (a) => {
            const f = a.fresh || {};
            // Where it was left out: a greedy step, or the foods or the drinks stage (the optimizer's `kind`).
            const at = a.kind === 'food' ? t('result.notConfirmedAtFood') : a.kind === 'drink' ? t('result.notConfirmedAtDrink') : t('result.notConfirmedAtStep', { step: num(a.step) });
            const text = Number.isFinite(f.buyerNet) && !goalExp
                ? t('result.notConfirmedItem', { at, partyGain: figure(f.gainPerUser, f.sePerUser, t, floor), buyerGain: figure(f.buyerNet, f.buyerNetSe, t, floor) })
                : t('result.notConfirmedItemExp', { at, partyGain: figure(f.gainPerUser, f.sePerUser, t, floor) });
            return `<li>${esc(a.player)}, ${shown(a)}: ${text}</li>`;
        };
        L.push(closedList('notConfirmed', 'whatIfNotConfirmed', result.notConfirmed.map(item), {}, t));
    }
    if (result.dominated?.length) {
        // One line with the count and its toggle; the swaps the search skipped (no better on any stat) sit closed behind it.
        L.push(`<div class="mt-3"><span class="fw-bold">${esc(t('result.dominated', { n: result.dominated.length }))}</span> ` +
            `<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-whatif-more="whatIfDominated" data-show="${esc(t('result.dominatedShow'))}" data-hide="${esc(t('result.dominatedHide'))}">${esc(t('result.dominatedShow'))}</button></div>` +
            '<ul class="small whatif-more" id="whatIfDominated" hidden>' +
            result.dominated.map((a) => `<li>${esc(a.player)}, ${shown(a)}</li>`).join('') + '</ul>');
    }
    if (result.skippedNoExport?.length) {
        // One folded line: the players the levers that need a character export skipped; the list sits closed behind it.
        const lever = (g) => t('lever.' + g.lever + '.name');
        const n = new Set(result.skippedNoExport.flatMap((g) => g.players)).size;
        L.push(`<div class="mt-3"><span class="fw-bold">${esc(t('result.skippedNoExport', { n, levers: result.skippedNoExport.map(lever).join(', ') }))}</span> ` +
            `<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-whatif-more="whatIfSkippedNoExport" data-show="${esc(t('result.dominatedShow'))}" data-hide="${esc(t('result.dominatedHide'))}">${esc(t('result.dominatedShow'))}</button></div>` +
            '<ul class="small whatif-more" id="whatIfSkippedNoExport" hidden>' +
            result.skippedNoExport.map((g) => `<li>${esc(lever(g))}: ${esc(g.players.join(', '))}</li>`).join('') + '</ul>');
    }
    if (result.apart?.length) {
        L.push(`<div class="fw-bold mt-3">${esc(t('result.apart'))}</div><ul class="small">` +
            result.apart.map((a) => `<li>${shown(a)}: ${esc(a.note)}</li>`).join('') + '</ul>');
    }
    if ((result.steps || []).some(upper) || (result.singles || []).some(upper) || (result.overBudget || []).some(upper)) L.push(`<div class="small text-secondary">${esc(t('result.upperNote'))}</div>`);
    return L.join('');
}

// "Zone: <name>, tier <N> · base party profit <figure> per user per day": the request's zone and tier (result.options)
// and the party base profit the search compared against (result.basePerUser, already per user). The
// zone name is the page's own name for the zone in the shown language (the id's last part when there is none).
// Returns '' when the result holds no zone (an older result), and omits what it lacks.
export function zoneLine(result, t, names) {
    const hrid = result?.options?.zone;
    if (typeof hrid !== 'string' || !hrid) return '';
    const name = names?.get('actionNames', hrid.replace(/^\/actions\//, '')) ?? hrid.split('/').pop();
    const tier = result.options.tier;
    const parts = [esc(Number.isFinite(tier) ? t('result.zone', { zone: name, tier }) : t('result.zoneNoTier', { zone: name }))];
    if (result.goal !== 'exp' && Number.isFinite(result.basePerUser)) parts.push(esc(t('result.baseProfit')) + ' ' + num(result.basePerUser) + ' ' + esc(t('result.perUserDay')));
    return parts.join(' · ');
}

// The prices the search used: the snapshot's own time (result.options.pricesTimestamp, seconds) and its age at `now`
// (a clock reading of that field, as duration() is); "committed file" when the request carried no snapshot.
export function pricesLine(result, t, now = Date.now()) {
    const ts = result?.options?.pricesTimestamp;
    if (!Number.isFinite(ts)) return '';
    const when = new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const key = result.options.pricesSource === 'committed' ? 'result.pricesCommitted' : 'result.pricesSnapshot';
    return esc(t(key, { when, elapsed: age((now / 1000) - ts, t) }));
}
// Seconds as the largest whole unit (days, hours or minutes).
export function age(s, t) {
    const x = Math.max(0, Number(s));
    if (x >= 86400) return t('age.days', { n: Math.floor(x / 86400) });
    if (x >= 3600) return t('age.hours', { n: Math.floor(x / 3600) });
    return t('age.minutes', { n: Math.floor(x / 60) });
}

// The ops behind a button's data-whatif-apply value.
export function opsFor(result, key) {
    const [kind, n] = String(key).split(':');
    if (kind === 'steps') return [...baselineOps(result), ...stepsOps(result, Number(n))];
    if (kind === 'single') { const own = result.singles[Number(n)]?.ops; return own ? [...baselineOps(result), ...own] : []; }
    throw new Error('unknown apply key ' + key);
}

// Every hrid in a text ("/items/x +12", a trigger term's JSON) replaced by its game name through the same lookup as the
// descriptions; an hrid with no name (or of a kind no table covers) stays as it is.
const PREFIX_TABLE = Object.fromEntries(Object.entries(NAME_TABLES).map(([table, prefix]) => [prefix, table]));
const HRID = /\/[a-z_]+\/[a-z0-9_]+/g;
const hridsToNames = (text, names) => text.replace(HRID, (hrid) => {
    const cut = hrid.indexOf('/', 1) + 1;
    const table = PREFIX_TABLE[hrid.slice(0, cut)];
    return (table && names.get(table, hrid.slice(cut))) ?? hrid;
});

// A difference's field label as the warning shows it (output only; the difference keeps its raw field): a skill level
// ("magicLevel") as "<skill name> level", a slot ("feet") as its slot name, a room or a "triggers <hrid>" field with the hrid
// as a name. With no names, or no name for an id, the field stays as it is.
export function diffLabel(field, names, t) {
    if (!names) return field;
    const level = /^([a-z]+)Level$/.exec(field);
    if (level) { const skill = names.get('skillNames', level[1]); return skill === null ? field : t('diff.level', { skill }); }
    if (/^[a-z_]+$/.test(field)) return names.get('equipmentTypeNames', field) ?? field;
    return hridsToNames(field, names);
}

// The differences as one line each, for the warning. `names`: see namesFrom; the ids in the fields and values show as names.
export function renderDiff(diff, t, names = null) {
    if (!diff.length) return '';
    const value = (v) => (names ? hridsToNames(fmtRaw(v), names) : fmtRaw(v));
    const shown = diff.slice(0, 8).map((d) => `<li>${esc(d.player)}, ${esc(diffLabel(d.field, names, t))}: ${esc(t('diff.page'))} ${esc(value(d.page))}, ${esc(t('diff.result'))} ${esc(value(d.result))}</li>`).join('');
    const more = diff.length > 8 ? `<li>${esc(t('diff.more', { n: diff.length - 8 }))}</li>` : '';
    return `<div class="whatif-warn">${esc(t('diff.title'))}<ul class="mb-0">${shown}${more}</ul></div>`;
}
const fmtRaw = (v) => (v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
