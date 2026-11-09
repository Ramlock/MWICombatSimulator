// The What-if window's logic, DOM-free so it is tested in Node (tools/test/whatif-panel.mjs). The window talks to the
// local runner (docs/codebase/whatif-window.md): it sends the page's setup and the search settings, shows the runner's
// progress, and shows the optimizer's result.json as it is. It computes no figure: every number shown is a field of the
// result or of the progress (the UI is output only); the only thing it works out itself is which page slot an op names
// and where the page's setup differs from the one the search ran on.
import { applyOps } from './applyOps.mjs';
import { numberHtml } from '../numberFormat.js';
import { isMarketplace } from '../marketplace.mjs';

// The optimizer's levers (tools/whatif/optimize.mjs LEVERS), in the order the window lists them. Seals and the
// Labyrinth are not levers. `def` = checked by default (the optimizer's own default is equip only).
export const LEVERS = [
    { id: 'equip', def: true },
    { id: 'consumables' },
    { id: 'pairs' },
    { id: 'owned' },
    { id: 'abilities' },
    { id: 'order' },
    { id: 'triggers' },
    { id: 'houses' },
    { id: 'abilitylevels' },
    { id: 'books' },
    { id: 'skills' },
];

export const API = {
    version: '/api/version',
    search: '/api/search',
    status: (id) => '/api/search/' + encodeURIComponent(id),
    stop: (id) => '/api/search/' + encodeURIComponent(id) + '/stop',
    results: '/api/results',
    result: (id) => '/api/results/' + encodeURIComponent(id),
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? numberHtml(v) : '—');
const upper = (row) => row?.costBound === 'upper';

// slots: [{ id: "1", name: "<tab name>", json: "<the slot's setup JSON>" }] for the players in the search.
// The setups the runner gets: each slot's JSON with its name, in the optimizer's setup format.
export function pageSetups(slots) {
    return slots.map((s) => ({ ...JSON.parse(s.json), name: s.name }));
}

// The request body of POST /api/search (delivery design, section 10). budgets: { "<player>": coin }.
// marketplace: the market snapshot fetched when the search starts ({ marketData, timestamp }), sent as it came.
export function searchBody({ slots, goal, budgets, levers, zone, tier, marketplace, exports }) {
    const setups = pageSetups(slots);
    const options = {};
    if (zone) options.zone = zone;
    if (tier !== undefined && tier !== null && tier !== '') options.tier = Number(tier);
    if (marketplace) options.marketplace = marketplace;
    const body = { setups, options, goal, budgets, levers, players: setups.map((s) => s.name) };
    // exports: { "<player name>": that player's character export }, only for players that have one.
    if (exports && Object.keys(exports).length) body.export = exports;
    return body;
}

// The character export (the userscript's "Copy character export"): a JSON object with an inventory or a learned-ability list.
// The levers that skip a player with none (the optimizer's skippedNoExport). Ability levels are not among them: without
// the export they keep their labelled upper-bound cost.
export const EXPORT_LEVERS = ['owned', 'abilities', 'books'];
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
        const label = r.kind === 'screen' ? t('progress.partScreen')
            : r.kind === 'halving' ? t('progress.partHalving', { n: r.index })
            : r.kind === 'step' ? t('progress.partStep', { n: r.index })
            : t('progress.partConfirmation');
        const left = r.kind === 'halving' && r.candidatesLeft != null ? ' · ' + fill(t, 'progress.optionsLeft', { n: num(r.candidatesLeft) }) : '';
        let text, mark, cls;
        if (r.state === 'waiting') { text = fill(t, 'progress.upTo', { n: num(r.runsUpTo) }); mark = '·'; cls = 'waiting'; }
        else if (r.state === 'done') { text = fill(t, 'progress.runsOf', { done: num(r.runsPlanned), total: num(r.runsPlanned) }) + ' · ' + esc(t('progress.done')); mark = '✓'; cls = 'done'; }
        else {
            text = fill(t, 'progress.runsOf', { done: num(r.runsDone), total: num(r.runsPlanned) });
            if (r.etaSeconds !== null && r.etaSeconds !== undefined) text += ' · ' + esc(t('progress.timeLeft', { time: duration(r.etaSeconds) }));
            mark = '▶'; cls = 'running';
        }
        const pct = r.state === 'done' ? 100 : r.state === 'running' && r.runsPlanned > 0 ? Math.min(100, Math.max(0, (r.runsDone / r.runsPlanned) * 100)) : 0;
        return `<div class="whatif-part whatif-part-${cls}" data-kind="${esc(r.kind)}" data-state="${cls}"><span class="whatif-part-label"><span class="whatif-part-mark">${mark}</span> <b>${esc(label)}</b>${left}</span><div class="progress whatif-progress" style="height: 8px;"><div class="progress-bar" style="width: ${pct}%"></div></div><span class="whatif-part-text">${text}</span></div>`;
    }).join('');
    const title = running >= 0 ? esc(t('state.running')) + ' · ' + esc(t('progress.stageN', { n: running + 1 })) : esc(t('state.' + status.state));
    const small = [];
    if (p.secondsPerRun !== undefined && p.secondsPerRun !== null) small.push(esc(t('progress.secondsPerRunCap')) + ' ' + num(p.secondsPerRun));
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

// A cost cell: "≤" when the cost is only an upper bound.
const costCell = (row) => (upper(row) ? '≤ ' : '') + num(row.cost);
const paybackCell = (row) => (row.payback === null || row.payback === undefined ? '—' : (upper(row) ? '≤ ' : '') + num(row.payback));

// The result: chosen steps, confirmation, ranked singles, unknown costs, each player's spend. Buttons carry
// data-whatif-apply="steps:<n>" or "single:<index>".
export function renderResult(result, t, now = Date.now(), names = null) {
    if (!result) return '';
    const L = [];
    const known = [...new Set([...Object.keys(result.budgets || {}), ...(result.setups || []).map((x) => x.name)])];
    const shown = (row) => esc(localizeDesc(row.desc, names, row.player ? [row.player, ...known] : known, row.player));
    const goal = result.goal === 'exp' ? t('goal.exp') : t('goal.profit');
    L.push(`<div class="mb-2">${esc(t('result.goal'))}: <b>${esc(goal)}</b></div>`);
    const zone = zoneLine(result, t, names);
    if (zone) L.push(`<div class="mb-2">${zone}</div>`);
    if (result.goal !== 'exp' && Number.isFinite(result.basePerUser) && result.basePerUser < 0) L.push(`<div class="mb-2 whatif-warn">${esc(t('result.baseLoses'))}</div>`);
    const prices = pricesLine(result, t, now);
    if (prices) L.push(`<div class="mb-2 small">${prices}</div>`);
    const players = Object.keys(result.budgets || {});
    // Running spend per player: a step's own figure; "≤" from the first upper-bound cost of that player on.
    const upperFrom = {};
    (result.steps || []).forEach((s, i) => { if (upper(s) && upperFrom[s.player] === undefined) upperFrom[s.player] = i; });
    const spendCell = (s, i, p) => {
        const v = s.runningSpend?.[p];
        if (v === undefined) return '—';
        return (upperFrom[p] !== undefined && upperFrom[p] <= i ? '≤ ' : '') + num(v);
    };
    L.push(`<div class="fw-bold mt-2">${esc(t('result.steps'))}</div>`);
    if (!result.steps?.length) L.push(`<div class="text-secondary">${esc(t('result.noSteps'))}</div>`);
    else {
        L.push('<table class="table table-sm whatif-table"><thead><tr>' +
            ['#', t('col.player'), t('col.change'), t('col.gain'), t('col.se'), t('col.cost'), t('col.payback')].map((h) => `<th>${esc(h)}</th>`).join('') +
            players.map((p) => `<th>${esc(t('col.spent'))} ${esc(p)}</th>`).join('') + '<th></th></tr></thead><tbody>');
        result.steps.forEach((s, i) => {
            L.push(`<tr${s.accepted === false ? ' class="whatif-weak"' : ''}><td>${i + 1}</td><td>${esc(s.player)}</td><td>${shown(s)}</td>` +
                `<td class="num">${num(s.gainPerUser)}</td><td class="num">± ${num(s.sePerUser)}</td><td class="num">${costCell(s)}</td><td class="num">${paybackCell(s)}</td>` +
                players.map((p) => `<td class="num">${spendCell(s, i, p)}</td>`).join('') +
                `<td><button type="button" class="btn btn-primary btn-sm py-0" data-whatif-apply="steps:${i + 1}">${esc(i === 0 ? t('apply') : t('applyTo', { n: i + 1 }))}</button></td></tr>`);
        });
        L.push('</tbody></table>');
    }
    const c = result.confirmation;
    if (c) {
        L.push(`<div class="mb-2">${esc(t('result.confirmed'))}: <b>${num(c.gainPerUser)} ± ${num(c.sePerUser)}</b> ${esc(t('result.perUserDay'))}, ` +
            `${esc(t('col.cost'))} ${costCell({ cost: c.cost, costBound: (result.steps || []).some(upper) ? 'upper' : undefined })}, ` +
            `${esc(t('col.payback'))} ${paybackCell({ payback: c.payback, costBound: (result.steps || []).some(upper) ? 'upper' : undefined })}</div>`);
    }
    if (players.length) {
        const last = result.steps?.length ? result.steps[result.steps.length - 1] : null;
        L.push(`<div class="mb-2">${esc(t('result.budgets'))}: ` + players.map((p) =>
            `${esc(p)} ${last ? spendCell(last, result.steps.length - 1, p) : num(0)} / ${num(result.budgets[p])}`).join(' · ') + '</div>');
    }
    L.push(`<div class="fw-bold mt-3">${esc(t('result.singles'))} <span class="text-secondary fw-normal small">${esc(t('result.singlesNote'))}</span></div>`);
    if (!result.singles?.length) L.push(`<div class="text-secondary">${esc(t('result.noSingles'))}</div>`);
    else {
        L.push('<table class="table table-sm whatif-table"><thead><tr>' +
            [t('col.player'), t('col.change'), t('col.stage'), t('col.gain'), t('col.se'), t('col.cost'), t('col.payback'), t('col.costPath')].map((h) => `<th>${esc(h)}</th>`).join('') + '<th></th></tr></thead>');
        // Accepted rows first; the grey rows sit in a second body, collapsed behind one toggle (N is a row count).
        const row = (s, i) => `<tr${s.accepted ? '' : ' class="whatif-weak"'}><td>${esc(s.player)}</td><td>${shown(s)}</td><td>${esc(s.lastStage)}</td>` +
            `<td class="num">${num(s.gainPerUser)}</td><td class="num">± ${num(s.sePerUser)}</td><td class="num">${costCell(s)}</td><td class="num">${paybackCell(s)}</td>` +
            `<td class="wrap">${esc(s.costPath)}${s.note ? ' (' + esc(s.note) + ')' : ''}</td>` +
            `<td><button type="button" class="btn ${s.accepted ? 'btn-primary' : 'btn-secondary'} btn-sm py-0" data-whatif-apply="single:${i}">${esc(t('apply'))}</button></td></tr>`;
        const rows = result.singles.map((s, i) => [s, i]);
        const weak = rows.filter(([s]) => !s.accepted);
        L.push('<tbody>' + rows.filter(([s]) => s.accepted).map(([s, i]) => row(s, i)).join('') + '</tbody>');
        if (weak.length) L.push('<tbody class="whatif-more" id="whatIfMoreSingles" hidden>' + weak.map(([s, i]) => row(s, i)).join('') + '</tbody>');
        L.push('</table>');
        if (weak.length) L.push(`<button type="button" class="btn btn-link btn-sm p-0 mb-2" data-whatif-more="whatIfMoreSingles" data-show="${esc(t('result.showMore', { n: weak.length }))}" data-hide="${esc(t('result.showLess', { n: weak.length }))}">${esc(t('result.showMore', { n: weak.length }))}</button>`);
    }
    if (result.overBudget?.length) {
        // The list sits closed behind one toggle, as the grey singles do; the heading keeps its count.
        const n = result.overBudget.length;
        L.push(`<div class="fw-bold mt-3">${esc(t('result.overBudget'))} <span class="text-secondary fw-normal small">${esc(t('result.overBudgetNote', { n }))}</span></div>` +
            `<button type="button" class="btn btn-link btn-sm p-0 mb-1" data-whatif-more="whatIfOverBudget" data-show="${esc(t('result.overBudgetShow', { n }))}" data-hide="${esc(t('result.overBudgetHide', { n }))}">${esc(t('result.overBudgetShow', { n }))}</button>` +
            '<ul class="small whatif-more" id="whatIfOverBudget" hidden>' +
            result.overBudget.map((a) => `<li>${esc(a.player)}, ${shown(a)}: ${costCell(a)}</li>`).join('') + '</ul>');
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
    if (kind === 'steps') return stepsOps(result, Number(n));
    if (kind === 'single') return result.singles[Number(n)]?.ops || [];
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
