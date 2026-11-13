// The What-if window's logic, DOM-free so it is tested in Node (tools/test/whatif-panel.mjs). The window talks to the
// local runner (docs/codebase/whatif-window.md): it sends the page's setup and the search settings, shows the runner's
// progress, and shows the optimizer's result.json as it is. It computes no figure: every number shown is a field of the
// result or of the progress (the UI is output only); the only thing it works out itself is which page slot an op names
// and where the page's setup differs from the one the search ran on.
import { applyOps } from './applyOps.mjs';
import { numberHtml, formatNumber } from '../numberFormat.js';
import { isMarketplace } from '../marketplace.mjs';
import { paybackDays } from './payback.mjs';
import { FIGURE_MIN_SEEDS, figureSeeds } from './figure.mjs';

// The optimizer's levers (tools/whatif/optimize.mjs LEVERS), in the order the window lists them. Seals and the
// Labyrinth are not levers. Books (ability levels, new abilities) are left out until the long-term model can say what
// waiting for the XP is worth (the optimizer keeps both levers, see tools/whatif/levers/houses.mjs). The window no longer offers `pairs`
// (the foods and drinks race tries whole combinations; the optimizer ignores the name) nor `skills` (the optimizer keeps the lever, only the
// window stops offering it). `def` = checked by default: every box starts ticked (a lever that needs an export stays ticked, its player is skipped and listed).
export const LEVERS = [
    { id: 'equip', def: true },
    { id: 'foods', def: true },
    { id: 'drinks', def: true },
    { id: 'owned', def: true },
    { id: 'abilities', def: true },
    { id: 'order', def: true },
    { id: 'triggers', def: true },
    { id: 'houses', def: true },
];

export const API = {
    version: '/api/version',
    search: '/api/search',
    // since: the version of the live report the window has; the runner sends the report so far only when it has a newer one.
    status: (id, since) => '/api/search/' + encodeURIComponent(id) + (since ? '?since=' + encodeURIComponent(since) : ''),
    stop: (id) => '/api/search/' + encodeURIComponent(id) + '/stop',
    done: (id) => '/api/search/' + encodeURIComponent(id) + '/done',
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
// Precision follows the error: a figure is written with no digit finer than its ± supports (the ± itself to its leading two digits), so a
// figure never reads "-2,118 ± 337k". `half`: the ± (the error, or half a range, which is symmetric: a t range around the figure). The one
// helper every figure with an error goes through, in the rounds table, the Best tables and the Each change alone table.
export function fit(v, half) {
    if (!Number.isFinite(v) || !(half > 0)) return v;
    const unit = 10 ** (Math.floor(Math.log10(half)) - 1);
    return Number((Math.round(v / unit) * unit).toFixed(Math.max(0, Math.round(-Math.log10(unit)))));
}
// Half the width of a range [low, high] (the ± of a t range), null without one.
export const halfOf = (low, high) => (Number.isFinite(low) && Number.isFinite(high) ? (high - low) / 2 : null);
// The parts of "<figure> ± <error>": { main, err, zero }. A figure whose range reaches 0 (|v| <= ±) reads "≈ 0"; no error known (one run): the
// bare figure and err null; no figure: null.
function pmParts(v, half) {
    if (!Number.isFinite(v)) return null;
    if (!(half > 0)) return { main: num(v), err: null, zero: false };
    const zero = Math.abs(v) <= half;
    return { main: zero ? '≈ 0' : num(fit(v, half)), err: num(fit(half, half)), zero };
}
// "<figure> ± <error>" in one cell, greyed when the range reaches 0; "—" without a figure.
function pm(v, half) {
    const p = pmParts(v, half);
    if (!p) return '—';
    const body = p.err === null ? p.main : p.main + ' ± ' + p.err;
    return p.zero ? `<span class="whatif-dim">${body}</span>` : body;
}
// One table cell for the party gain or the buyer's gain, in the rounds tables and the Best tables (the one helper for both columns). `seeds`: the
// runs the figure rests on (null = not known, an older result: the figure is drawn). Fewer than FIGURE_MIN_SEEDS: a dim "—" and a hover text.
function pmCell(v, half, t, seeds = null) {
    if (Number.isFinite(seeds) && seeds < FIGURE_MIN_SEEDS) return `<td class="num whatif-dim" title="${esc(t('rounds.needsMoreRuns'))}">—</td>`;
    return `<td class="num">${pm(v, half)}</td>`;
}
// One figure in a line of text: "no change", or "<value> ± <error>".
const figure = (v, se, t, floor) => (isNoChange(v, se, floor) ? noChange(v, se, t) : num(fit(v, se)) + ' ± ' + num(fit(se, se)));
// One cell for a gain and its error, "<value> ± <error>": "no change" (the real value as title) when it reads as no change.
function gainCell(v, se, t, floor) {
    if (isNoChange(v, se, floor)) return `<td class="num" title="${esc(realValue(v, se))}">${esc(t('result.noChange'))}</td>`;
    return `<td class="num">${num(fit(v, se))}${Number.isFinite(se) ? ' ± ' + num(fit(se, se)) : ''}</td>`;
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
// The boxes of the levers that need a character export ("Items you own", "Abilities"): off, unticked and not interactable (with a tooltip
// saying why) while no ticked player has a kept export, and on, ticked, the moment one has. `hasExport`: some ticked player has a kept
// export; `wasDisabled`: the box was off before (true on the first draw); `wasChecked`: its tick before. Returns the box's state.
export function exportLeverView({ hasExport, wasDisabled, wasChecked }, t) {
    if (!hasExport) return { disabled: true, checked: false, title: t('exportLeverOff') };
    return { disabled: false, checked: wasDisabled ? true : !!wasChecked, title: '' };
}
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
export function renderProgress(status, t, pressed = null) {
    if (!status) return '';
    const p = status.progress || {};
    if (Array.isArray(p.parts) && p.parts.length) return renderParts(status, t, pressed);
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
// A count with a noun after it: the key's own singular (key + 'One', in every language) when the count is 1.
const plural = (t, key, n, params) => t(Number(n) === 1 ? key + 'One' : key, params);
// A part's key (the buttons' data-whatif-part, and the pressed button main.js keeps): the same part keeps the same key across polls.
export const partKey = (r) => r.kind + ':' + (r.index ?? 0);
// The two buttons of the race stage that runs now (main.js posts API.done with the mode): "Accept current winner" (only while some pool without a
// lock has a leader whose figure is shown with a gain above 0: row.acceptable) and "Skip <stage>". Accept ends the stage after the round it is in,
// with its pick as it is; Skip ends it at once. `pressed` ({ key, mode }, main.js): the button pressed on this part stays drawn, both buttons disabled
// (the second press would change the first), and Accept's note says the round is being finished (Skip ends at once: no note). The state is in the
// markup, so the redraw of the next poll gives the same button.
function stageButtons(t, label, acceptable, key, pressed) {
    const done = pressed && pressed.key === key ? pressed.mode : null;
    const b = (mode, text, tip) => `<button type="button" class="btn btn-outline-secondary btn-sm py-0 whatif-stage-done" data-whatif-done="${mode}" data-whatif-part="${esc(key)}" title="${esc(t(tip))}"${done ? ' disabled' : ''}>${esc(text)}</button>`;
    const note = done === 'accept' ? ` <span class="whatif-dim small" data-whatif-note="accept">${esc(t('progress.stageFinishing'))}</span>` : '';
    return (acceptable > 0 || done === 'accept' ? b('accept', t('progress.stageAccept'), 'progress.stageAcceptTip') + ' ' : '') + b('skip', t('progress.stageSkip', { stage: label }), 'progress.stageSkipTip') + note;
}
export function renderParts(status, t, pressed = null) {
    const p = status.progress || {}, parts = p.parts;
    // The search's own state decides what is drawn as running: a search that is stopped, done or failed has no part that runs, whatever the
    // last progress record says (the part that was running when it stopped is drawn halted, with the figures it had).
    const live = status.state === 'running';
    const running = live ? parts.findIndex((r) => r.state === 'running') : -1;
    const rowsHtml = parts.map((row) => {
        const r = row.state === 'running' && !live ? { ...row, state: 'halted' } : row;
        const label = r.kind === 'foods' ? t('progress.partFoods')
            : r.kind === 'drinks' ? t('progress.partDrinks')
            : r.kind === 'screen' ? t('progress.partScreen')
            : r.kind === 'halving' ? t('progress.partHalving', { n: r.index })
            : r.kind === 'steps' ? t('progress.partSteps', { n: r.maxSteps })
            : r.kind === 'picks' ? t('progress.partPicks')
            : r.kind === 'step' ? t('progress.partStep', { n: r.index })
            : r.kind === 'moreSteps' ? t('progress.partMoreSteps', { n: r.stepsLeft })
            : r.state === 'waiting' ? t('progress.partConfirmationWaiting') : t('progress.partConfirmation');
        // A part of a race stage (it carries `round`) has no total known in advance, so it has no filling bar (a bar only ever moves forward):
        // its label names the round being run, the phase (a word) and the contention of the last finished round (plain numbers, they may fall
        // and rise); its right-hand text holds counters that only grow: the runs finished in the stage, the simulated hours spent in it and
        // the candidates dropped so far. A stage that has ended shows done as any part does.
        const rounded = r.round !== undefined && r.round !== null && r.state !== 'waiting';
        const race = rounded && r.state === 'running'; // the stage that runs now and is a race: its counters and the "done with this stage" button sit on its line
        const phase = r.phase === 'reading' ? t('progress.phaseReading') : t('progress.phaseSearch');
        // The pool nearest to ending (two or three changes standing): the rounds it still needs to separate, after the still-in-the-running count of the stage that runs.
        const separate = race && r.separate ? ' · ' + (r.separate.rounds === null ? t('progress.separateFar') : plural(t, 'progress.separateRounds', r.separate.rounds, { n: num(r.separate.rounds) })) : '';
        const left = rounded ? ' · ' + fill(t, 'progress.stageLabel', { separate, round: t(r.state === 'running' ? 'rounds.roundRunning' : r.state === 'halted' ? 'rounds.roundStopped' : r.skipped ? 'rounds.roundSkipped' : 'rounds.roundFinished', { n: num(r.round) }), phase: r.state === 'running' ? ' · ' + esc(phase) : '', contending: num(r.contending), paused: num(r.paused) })
            : (r.kind === 'halving' || r.kind === 'foods' || r.kind === 'drinks') && r.candidatesLeft != null ? ' · ' + plural(t, 'progress.optionsLeft', r.candidatesLeft, { n: num(r.candidatesLeft) }) : '';
        const counters = rounded ? fill(t, 'progress.stageCounters', { runs: plural(t, 'progress.runsCount', r.runs, { n: num(r.runs) }), hours: plural(t, 'progress.hoursCount', r.simHours, { n: num(r.simHours) }), dropped: num(r.dropped) }) : '';
        // The picks part of a search whose picks were all left out inside a race (no pick reached the check on fresh runs, so it counted no runs): done, with none confirmed.
        const noneConfirmed = r.state === 'done' && r.kind === 'picks' && !(r.runsPlanned > 0) && r.leftOut > 0;
        let text = '', cls;
        if (r.state === 'waiting') { if (r.runsUpTo !== undefined) text = plural(t, 'progress.upTo', r.runsUpTo, { n: num(r.runsUpTo) }); else if (r.kind === 'picks' && r.runsPlanned > 0) text = plural(t, 'progress.runsOf', r.runsPlanned, { done: num(r.runsDone), total: num(r.runsPlanned) }); cls = 'waiting'; }
        else if (r.state === 'done') {
            // A foods or drinks stage whose accepted picks are being checked on fresh runs (r.checking, its own run counts): the check shows on this row,
            // not as a part of its own after the later stages, so the later stages keep their waiting state.
            // The total is the stage's so far (it grows as the next player's check plans his own arm), so the row names whose check it is: "player N of M".
            const runs = r.checking ? plural(t, 'progress.runsOf', r.checkPlanned, { done: num(r.checkDone), total: num(r.checkPlanned) }) : '';
            const checking = r.checking ? (r.checkWho ? fill(t, 'progress.checkingPicksOf', { n: num(r.checkWho.index), of: num(r.checkWho.of), runs }) : fill(t, 'progress.checkingPicks', { runs })) : null;
            text = noneConfirmed ? fill(t, 'progress.picksNoneConfirmed', { n: num(r.leftOut) }) : (rounded ? counters : plural(t, 'progress.runsOf', r.runsPlanned, { done: num(r.runsPlanned), total: num(r.runsPlanned) })) + ' · ' + (checking ?? esc(t('progress.done')));
            cls = checking ? 'running' : 'done';
        }
        else if (r.state === 'skipped') { text = esc(t(r.kind === 'confirmation' ? 'progress.skippedNoStep' : 'progress.skippedNoPick')); cls = 'skipped'; } // a part of a finished search that never started (progress.mjs)
        else if (r.state === 'halted') { text = rounded ? counters : plural(t, 'progress.runsOf', r.runsPlanned, { done: num(r.runsDone), total: num(r.runsPlanned) }); cls = 'halted'; } // the part that was running when the search stopped (or failed): its figures, no running mark
        else if (rounded) { cls = 'running'; } // a race stage's counters follow its status text on the stage's own line (below), not a line of their own
        else {
            text = plural(t, 'progress.runsOf', r.runsPlanned, { done: num(r.runsDone), total: num(r.runsPlanned) });
            if (r.etaSeconds !== null && r.etaSeconds !== undefined) text += ' · ' + esc(t('progress.timeLeft', { time: duration(r.etaSeconds) }));
            cls = 'running';
        }
        // One icon column of equal width: a plain text glyph (︎ asks for the text form, never a colour emoji).
        const mark = { done: '✓', running: '▶︎', waiting: '○', halted: '■︎', skipped: '–' }[cls];
        const pct = r.state === 'done' ? 100 : (r.state === 'running' || r.state === 'halted' || (r.state === 'waiting' && r.kind === 'picks')) && r.runsPlanned > 0 ? Math.min(100, Math.max(0, Number.isFinite(r.fill) ? r.fill * 100 : (r.runsDone / r.runsPlanned) * 100)) : 0;
        // A race stage's row in any state (running, done, halted) has no bar and wraps like the running one: its status text is long, and a
        // done row's grid columns cut it and pushed its figures past the window edge.
        const bar = rounded || cls === 'skipped' || noneConfirmed ? '<span class="whatif-no-bar"></span>' : `<div class="progress whatif-progress" style="height: 8px;"><div class="progress-bar" style="width: ${pct}%"></div></div>`;
        return `<div class="whatif-part whatif-part-${cls}${rounded ? ' whatif-part-race' : ''}" data-kind="${esc(r.kind)}" data-state="${cls}"><span class="whatif-part-mark">${mark}</span><span class="whatif-part-label"><b>${esc(label)}</b>${left}${race ? ' · ' + counters + ' ' + stageButtons(t, label, r.acceptable, partKey(r), pressed) : ''}</span>${bar}${race ? '' : `<span class="whatif-part-text">${text}</span>`}</div>`;
    }).join('');
    const title = running >= 0 ? esc(t('state.running')) + ' · ' + esc(t('progress.partOf', { k: running + 1, n: parts.length })) : esc(t('state.' + status.state));
    const small = [];
    if (p.secondsPerRun !== undefined && p.secondsPerRun !== null) small.push(esc(t('progress.secondsPerRunCap')) + ' ' + `<span title="${esc(p.secondsPerRun)}">${esc(Number(p.secondsPerRun).toFixed(2))}</span>`);
    if (p.elapsedSeconds !== undefined && p.elapsedSeconds !== null) small.push(esc(t('progress.elapsed')) + ' ' + esc(duration(p.elapsedSeconds)));
    let html = `<div class="whatif-parts"><div class="mb-1"><b>${title}</b></div>${rowsHtml}${small.length ? `<div class="small mt-1">${small.join(' · ')}</div>` : ''}</div>`;
    if (status.state === 'error' && status.error) html += `<div class="text-danger">${esc(status.error)}</div>`;
    return html;
}

// The search rounds (the runner's `round` record, one per round of the search that keeps refining): a round counter, the contention counts and,
// per pool, the table of its current leaders. Output only: every figure is a field of the record (the figure and its range are the leader's
// reading seeds', the runner/optimizer computed them); a leader with too few reading seeds says so. `names`: the game names (namesFrom), or null.
export function renderRounds(round, t, names = null) {
    if (!round || !Array.isArray(round.pools)) return '';
    const who = (p) => p;
    const players = [...new Set(round.pools.flatMap((p) => (p.leaders || []).map((l) => l.player).filter(Boolean)))];
    const c = round.candidates || {};
    // A provisional record (`provisional: true`) is the first look at round 1: the candidates that have a first figure so far, in the same
    // tables; it carries no contention counts (nothing has been paused yet), and the real round replaces it.
    const prov = round.provisional === true;
    const head = [
        `<b>${esc(t('rounds.title'))}</b>`,
        // A real round record is a finished round; the first look (provisional) is the round still being run.
        t(prov ? 'rounds.roundRunning' : 'rounds.roundFinished', { n: `<span data-rounds="round">${num(round.round)}</span>` }),
        `${esc(t('rounds.simHours'))} ${num(round.simHours)}`,
        ...(prov ? [`<span data-rounds="firstLook">${esc(plural(t, 'rounds.firstLook', round.firstLook?.total ?? 0, { have: round.firstLook?.have ?? 0, total: round.firstLook?.total ?? 0 }))}</span>`] : [
            `${esc(t('rounds.contending'))} <span data-rounds="contending">${num(c.contending)}</span>`,
            `<span title="${esc(t('rounds.pausedTip'))}">${esc(t('rounds.paused'))}</span> <span data-rounds="paused">${num(c.paused)}</span>`,
            ...(c.refuted ? [`${esc(t('rounds.refuted'))} ${num(c.refuted)}`] : []),
            `${esc(t('rounds.coverage', { pct: Math.round((round.coverage ?? 0) * 100) }))}`,
        ]),
    ].join(' · ');
    const readingMin = round.readingMin ?? 8;
    const tables = round.pools.map((p) => {
        const [owner, kind] = String(p.key).includes(':') ? String(p.key).split(':') : [null, p.key];
        // The top leader's range width and the one a round earlier (the core's fields; a first round, or one with no range before, has no "was").
        const width = Number.isFinite(p.rangeWidth) ? ' · ' + (Number.isFinite(p.rangeWidthPrev) ? t('rounds.rangeWidthWas', { now: num(p.rangeWidth), before: num(p.rangeWidthPrev) }) : t('rounds.rangeWidth', { now: num(p.rangeWidth) })) : '';
        const counts = prov ? plural(t, 'rounds.poolSize', p.size, { n: p.size }) : t('rounds.poolCounts', { contending: p.contending, paused: p.paused });
        // A pool the core has not sorted yet (no row has enough runs for a figure; `sortedBy` null, the column it will sort by in `sortPending`) keeps the build order.
        const colName = (c) => t(c === 'reading' ? 'col.partyGain' : c === 'buyerNet' ? 'col.buyerGain' : 'rounds.col.' + c);
        const order = p.sortedBy ? ' · ' + t('rounds.sortedBy', { col: colName(p.sortedBy) }) : p.sortPending ? ' · ' + t('rounds.sortedByLater', { col: colName(p.sortPending) }) : '';
        const title = esc((owner ? who(owner) + ' · ' : '') + t('rounds.pool.' + kind) + ' · ' + counts) + width + esc(order);
        // A candidate ruled out is not listed (the heading counts it).
        const leaders = (p.leaders || []).filter((l) => l.status !== 'refuted');
        // A foods or drinks pool: one column per slot, the cell holding only the new item of a slot the candidate changes and nothing where the slot
        // stays; any other pool: one Change column with the candidate's text (the player is in the heading when the pool is his).
        const bySlot = leaders.length > 0 && leaders.every((l) => l.change && Array.isArray(l.change.slots));
        const nSlots = bySlot ? Math.max(...leaders.flatMap((l) => [...l.change.slots.map((s) => s.index + 1), (l.change.current || []).length]), 1) : 0;
        // A slot the candidate changes shows the new item; one it leaves alone shows what the player has there now, greyed ("empty", greyed, when there is nothing).
        const changeCells = (l) => (bySlot
            ? Array.from({ length: nSlots }, (_, i) => {
                const s = l.change.slots.find((x) => x.index === i), cur = (l.change.current || [])[i];
                return `<td class="chg">${s ? itemLabel(s, names) : cur ? greyed(itemLabel({ item: cur }, names)) : i < (l.change.current || []).length ? emptyWord(t) : ''}</td>`;
            }).join('')
            : `<td class="chg">${esc(localizeDesc(l.desc, names, players, owner))}</td>`);
        // The pool's title is the header of its own table: it takes the place of the first column's header (the Change column). A table with one
        // column per slot puts it over the slot columns (a header row of its own), the slot names under it; the other columns span both rows.
        const titleTh = `<th class="whatif-pool-title"${bySlot ? ` colspan="${nSlots}"` : ''} data-pool="${esc(p.key)}"><b>${title}</b></th>`;
        const slotHead = bySlot ? Array.from({ length: nSlots }, (_, i) => `<th>${esc(t('result.slot', { n: i + 1 }))}</th>`).join('') : '';
        const rows = leaders.map((l) => {
            // The status in plain words; a row with no fresh run yet says so there. A range that reaches 0 greys the row (status zero).
            // One or two words that say what a user can do with the row; the counts and the internal state are the cell's tooltip (facts only).
            const sk = l.tooFew ? 'tooFew' : l.status, vals = { n: l.status === 'first' ? l.seeds : l.readingSeeds, more: Math.max(0, readingMin - (l.readingSeeds ?? 0)), min: readingMin };
            const status = t('rounds.status.' + sk), statusTip = t('rounds.status.' + sk + 'Tip', vals);
            const figSeeds = figureSeeds(l);
            const hours = Number.isFinite(l.hours) ? `<td class="num" title="${esc(t('rounds.hoursTitle', { search: formatNumber(l.searchHours), fresh: formatNumber(l.readHours) }))}">${num(l.hours)}</td>` : '<td class="num">—</td>';
            return `<tr data-status="${esc(l.status)}"${l.status === 'zero' ? ' class="whatif-dim"' : ''}>${changeCells(l)}<td class="num">${num(l.cost)}</td>${hours}${pmCell(l.reading, halfOf(l.low, l.high), t, figSeeds)}${pmCell(l.buyerNet, halfOf(l.netLow, l.netHigh), t, figSeeds)}<td class="num">${l.tooFew || l.payback == null ? '—' : num(l.payback)}</td><td class="wrap" title="${esc(statusTip)}">${esc(status)}</td></tr>`;
        }).join('');
        const head2 = `<th class="num c-cost">${esc(t('rounds.col.cost'))}</th><th class="num c-hours">${esc(t('rounds.col.hours'))}</th>${gainTh(t, 'partyGain', ' c-gain')}${gainTh(t, 'buyerGain', ' c-gain')}<th class="num c-pay">${esc(t('rounds.col.payback'))}</th><th class="c-status">${esc(t('rounds.col.status'))}</th>`;
        const thead = bySlot ? `<tr>${titleTh}${head2.replace(/<th /g, '<th rowspan="2" ')}</tr><tr>${slotHead}</tr>` : `<tr>${titleTh}${head2}</tr>`;
        return `<div class="whatif-sec">${listTable(t, leaders.length, () => `<table class="whatif-table"><thead>${thead}</thead><tbody>${rows}</tbody></table>`)}</div>`;
    }).filter((h, i, all) => !(i > 0 && h.includes('data-none') && all[i - 1].includes('data-none'))).join(''); // a run of empty pools is ONE "None." line, not one per pool
    return `<div class="whatif-rounds whatif-sec"><div class="small">${head}</div>${tables}</div>`;
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
    return gainCell(gain, gainSe, t, floor) + (!goalExp && Number.isFinite(net) ? gainCell(net, netSe, t, floor) : '<td class="num">—</td>');
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
// An item's shown name (the page's own, else its id) and, for a food with a trigger, the readable text of the trigger in parentheses.
const itemLabel = (x, names) => {
    const name = names?.get('itemNames', slugOf(x.item)) ?? slugOf(x.item);
    return esc(name) + (x.trigger ? ' (' + esc(names ? swap(String(x.trigger), TRIGGER_TERMS, names) : String(x.trigger)) + ')' : '');
};
// A slot the change leaves alone shows what the player has there now, greyed (an item flagged `same`); a slot empty now and staying empty says
// "empty" greyed. The one place these two are written, for the rounds, Best foods and Best drinks tables.
const greyed = (html) => `<span class="whatif-dim">${html}</span>`;
const emptyWord = (t) => greyed(esc(t('rounds.slotEmpty')));
const slotText = (x, label) => (x.same ? greyed(label(x)) : label(x));
// "ended by you after round N" (Accept; result.endedByUser: the rounds the stage finished), or for a Skip (result.endedBySkip) "ended by you during round N+1, its finished runs kept".
const endedText = (t, n, skip) => skip ? t('result.endedByUserDuring', { n: n + 1 }) : t('result.endedByUser', { n });
// The mark of a pick the user took with "Accept current winner": taken as it is, with no check on fresh runs (result.steps[] / result.best[kind][p] acceptedAsIs).
const asIsMark = (t) => `<br><span class="whatif-dim small" data-accepted-as-is>${esc(t('result.acceptedAsIs'))}</span>`;
export function bestBlock(result, t, names = null, running = false, floor = null) {
    const best = result?.best;
    if (!best) return '';
    const readingMin = result.rounds?.readingMin ?? 8;
    const itemText = (x) => itemLabel(x, names);
    // One table per kind: Player, one column per slot (the item names), the party's gain per user and its error, the buyer's gain and its error
    // (the filling's fresh reading when it has one, else the search's own: an older result), then the split note. A player the search left unchanged
    // has a row saying "no change". A player whose stage still runs (soFar) shows the leader of his pool as the rounds table holds it: the figure,
    // its range in place of the error (one reading seed: "no range yet"), and a "few seeds (n)" note while it has fewer than --reading-min seeds.
    const table = (kind, label) => {
        const per = best[kind] || {};
        const who = Object.keys(per);
        if (!who.length) return '';
        const slots = Math.max(1, ...who.map((p) => Math.max(per[p].slots ?? 0, ...(per[p].items || []).map((x, k) => (x.slot ?? k) + 1))));
        const rows = who.map((p) => {
            const e = per[p], items = e.items || [];
            // A slot is shown by its place (older results have no `slot`: the item's order); one the pick leaves as it is shows the current food
            // greyed, one that is empty now and stays empty a greyed "empty" word, one the player does not have a dash.
            const cells = Array.from({ length: slots }, (_, i) => {
                const x = items.find((y, k) => (y.slot ?? k) === i);
                return `<td class="chg">${x ? slotText(x, itemText) : (e.empty || []).includes(i) ? emptyWord(t) : '—'}</td>`;
            }).join('');
            // The so-far note: a range that reaches 0 says it is not yet different from no change, else how many fresh runs it has and how many it still needs.
            // The core flags a leader without a clear gain (`unclear`, and `loses` when the shared loot falls): the row shows the player's current items
            // (the final's unchanged form) and the status; the leader's items and figures are the status cell's tooltip, a fact.
            const unclear = e.soFar && e.unclear;
            const plainPm = (v, half) => (Number.isFinite(v) ? formatNumber(fit(v, half)) +(half > 0 ? ' ± ' + formatNumber(fit(half, half)) : '') : '—');
            const tip = !unclear ? '' : e.loses ? t('rounds.status.losesTip') : t('rounds.status.bestTip', {
                items: (e.candidate || []).map((x) => names?.get('itemNames', slugOf(x.item)) ?? slugOf(x.item)).join(', ') || '—',
                figures: e.tooFew ? t('rounds.tooFew') : `${t('col.partyGain')} ${plainPm(e.gainPerUser, halfOf(e.low, e.high))}; ${t('col.buyerGain')} ${plainPm(e.buyerNet, halfOf(e.netLow, e.netHigh))}`,
                n: e.readingSeeds ?? 0 });
            const few = unclear ? `<br><span class="whatif-dim small" data-best-status="${e.loses ? 'loses' : 'zero'}" title="${esc(tip)}">${esc(t(e.loses ? 'rounds.status.loses' : 'rounds.status.zero'))}</span>` : '';
            let nums, note = '';
            // A row with no figure is one cell over the two gain columns, centred between their headings (a left-aligned word sat under the gap
            // left of the first heading, as if in a column of its own).
            const spanCell = (text) => `<td colspan="2" class="whatif-dim whatif-span">${esc(text)}</td>`;
            if (unclear) nums = spanCell('—');
            else if (e.unchanged) nums = spanCell(t('result.noChange'));
            else if (e.soFar && e.tooFew) nums = spanCell(t('rounds.tooFew'));
            else if (e.soFar) {
                nums = pmCell(e.gainPerUser, halfOf(e.low, e.high), t, e.readingSeeds) + pmCell(e.buyerNet, halfOf(e.netLow, e.netHigh), t, e.readingSeeds);
            } else {
                const [gain, gainSe] = reading(e.fresh, e, 'gainPerUser', 'sePerUser'), [net, netSe] = reading(e.fresh, e, 'buyerNet', 'buyerNetSe');
                const seeds = e.fresh?.seeds ?? e.readingSeeds;
                nums = pmCell(gain, gainSe, t, seeds) + (Number.isFinite(net) ? pmCell(net, netSe, t, seeds) : '<td class="num">—</td>');
                if (Number.isFinite(net)) note = supplyNote({ sharedGainPerUser: gain, ownSuppliesByPlayer: { [p]: e.ownSuppliesPerDay } }, p, t, gainSe, floor);
            }
            return `<tr><td>${esc(p)}${few}${e.acceptedAsIs ? asIsMark(t) : ''}</td>${cells}${nums}<td class="small">${note}</td></tr>`;
        });
        // A group with an entry still so far (its stage is running) carries the same "so far" mark as the steps heading.
        const endedRound = result.endedByUser?.[kind];
        // A stage the user has ended no longer reads "so far": it says "ended by you after round N" alone (its pick check shows on its progress row).
        const soFar = (endedRound === undefined && who.some((p) => per[p].soFar) ? ' <span class="text-secondary fw-normal small">· ' + esc(t('result.soFar')) + '</span>' : '')
            + (endedRound !== undefined ? ` <span class="text-secondary fw-normal small" data-ended="${kind}">· ${esc(endedText(t, endedRound, result.endedBySkip?.[kind]))}</span>` : '');
        const head = `<th>${esc(t('col.player'))}</th>` + Array.from({ length: slots }, (_, i) => `<th>${esc(t('result.slot', { n: i + 1 }))}</th>`).join('') + colHead(t) + '<th></th>';
        // The search picks on its own runs and the rounds table orders by the fresh ones: when a player's pick is not the table's first row, one line says so.
        const pickNote = who.some((p) => per[p].soFar && per[p].notFirst) ? `<div class="small text-secondary" data-best-note="${kind}">${esc(t('result.pickNote'))}</div>` : '';
        return `<div class="fw-bold mt-2">${esc(label)}${soFar}</div><table class="table table-sm whatif-table whatif-best-table" data-best="${kind}"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>${pickNote}`;
    };
    const foods = table('foods', t('result.bestFoods')), drinks = table('drinks', t('result.bestDrinks'));
    if (!foods && !drinks) return '';
    // While the search runs the line waits for both groups, final: it says everything below is measured on the foods and drinks.
    const anySoFar = ['foods', 'drinks'].some((k) => Object.values(best[k] || {}).some((e) => e.soFar));
    const baseline = running && (!(foods && drinks) || anySoFar) ? '' : `<div class="small text-secondary mt-1">${esc(t('result.bestBaseline'))}</div>`;
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
// The one renderer of every list the window draws as a table: with no row it is ONE grey line ("None."), never a header row over nothing and never a label
// of its own. `table` makes the whole table's html, called only when there are rows.
function listTable(t, count, table) {
    if (count > 0) return table();
    return `<div class="whatif-dim" data-none>${esc(t('result.none'))}</div>`;
}
const colHead = (t) => [
    gainTh(t, 'partyGain'), gainTh(t, 'buyerGain')].join('');
// The two gain column heads (name and tooltip): the one definition every table with these columns uses (the rounds table too).
function gainTh(t, key, cls = '') { return `<th class="num${cls}" title="${esc(t('col.' + key + 'Tip'))}">${esc(t('col.' + key))}</th>`; }

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
    // The screen and the greedy steps the user ended with "done with this stage": one line each, under the steps heading.
    const endedStages = Object.entries(result.endedByUser || {}).filter(([k]) => k !== 'foods' && k !== 'drinks');
    if (!running || result.steps?.length) L.push(`<div class="fw-bold mt-2">${esc(t('result.steps'))}${running ? ' <span class="text-secondary fw-normal small">· ' + esc(t('result.soFar')) + '</span>' : ''}</div>`);
    for (const [stage, n] of endedStages) {
        const m = /^greedy step (\d+)$/.exec(stage), name = m ? t('progress.partStep', { n: m[1] }) : stage === 'screen' ? t('progress.partScreen') : stage;
        L.push(`<div class="small text-secondary" data-ended="${esc(stage)}">${esc(name)} · ${esc(endedText(t, n, result.endedBySkip?.[stage]))}</div>`);
    }
    if (!result.steps?.length) { if (!running) L.push(`<div class="text-secondary">${esc(t('result.noSteps'))}</div>`); }
    else {
        L.push('<table class="table table-sm whatif-table"><thead><tr>' +
            ['#', t('col.player'), t('col.change')].map((h) => `<th>${esc(h)}</th>`).join('') + colHead(t) + [t('col.cost'), t('col.payback')].map((h) => `<th class="num">${esc(h)}</th>`).join('') +
            `<th>${esc(t('col.costPath'))}</th><th></th></tr></thead><tbody>`);
        result.steps.forEach((s, i) => {
            L.push(`<tr${s.accepted === false ? ' class="whatif-weak"' : ''}><td>${i + 1}</td><td>${esc(s.player)}</td><td class="chg">${shown(s)}${s.acceptedAsIs ? asIsMark(t) : ''}</td>` +
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
        if (!perPlayer) L.push(`<div class="mb-2">${esc(t(goalExp ? 'result.confirmed' : 'result.confirmedParty'))}: <b>${figure(c.gainPerUser, c.sePerUser, t, floor)}</b> ${esc(t('result.perUserDay'))}, ` +
            `${esc(t('col.cost'))} ${costCell({ cost: c.cost, costBound: bound })}, ${esc(t('col.payback'))} ${paybackCell({ payback: confirmedPayback(c.payback), costBound: bound, cost: c.cost }, t)}</div>`);
        if (perPlayer) {
            // One table: Player, the buyer's gain per day and its error, the days he takes to pay back (a player who bought nothing, his running
            // spend exactly 0, has nothing to pay back: the free wording, not a dash), then the split note.
            const party = `<tr data-confirm-row="party"><td>${esc(t('result.confirmedPartyRow'))}</td>${gainCell(c.gainPerUser, c.sePerUser, t, floor)}<td class="num">—</td><td class="small">${esc(t('col.cost'))} ${costCell({ cost: c.cost, costBound: bound })}</td></tr>`;
            const body = party + Object.entries(c.buyerByPlayer).map(([p, b]) => {
                const free = c.runningSpend?.[p] === 0;
                const payback = free ? esc(t('result.noCost')) : paybackCell({ payback: confirmedPayback(b.payback), costBound: bound });
                return `<tr><td>${esc(p)}</td>${gainCell(b.gain, b.se, t, floor)}<td class="num${free ? ' whatif-free' : ''}">${payback}</td><td class="small">${supplyNote(c, p, t, c.sePerUser, floor)}</td></tr>`;
            }).join('');
            L.push(`<table class="table table-sm whatif-table whatif-confirm" data-confirm="players"><thead><tr><th>${esc(t('col.player'))}</th><th class="num">${esc(t('result.gainPerDay'))}</th><th class="num">${esc(t('result.paysBackIn'))}</th><th></th></tr></thead><tbody>${body}</tbody></table>`);
        }
        else if (!goalExp) L.push(`<div class="mb-1 small whatif-dim">${esc(t('result.oldSplit'))}</div>`);
    }
    const anySingles = (result.singles || []).some((s) => !s.hiddenFood);
    if (!running || anySingles) L.push(`<div class="fw-bold mt-3">${esc(t('result.singles'))} <span class="text-secondary fw-normal small">${esc(t('result.singlesNote'))}</span></div>`);
    // With a round table (the race has run and the first figures exist) a change is counted as not measured only for want of the reading minimum:
    // the line says how many were searched and that none is checked on that many fresh runs yet, not that none was measured.
    const readMin = result.round?.readingMin;
    const yet = Number.isFinite(readMin) && readMin > 0 && result.singlesNotShown > 0;
    if (!result.singles?.length) { if (!running) L.push(`<div class="text-secondary">${yet ? plural(t, 'result.noSinglesYet', result.singlesNotShown, { n: num(result.singlesNotShown), need: num(readMin) }) : esc(t('result.noSingles'))}</div>`); }
    else if (running && !anySingles) { /* only the foods and drinks fillings are in so far: they are not a table */ }
    else {
        const eachHead = '<thead><tr>' + [t('col.player'), t('col.change')].map((h) => `<th>${esc(h)}</th>`).join('') + colHead(t) + [t('col.cost'), t('col.payback')].map((h) => `<th class="num">${esc(h)}</th>`).join('') + `<th>${esc(t('col.costPath'))}</th>` + '<th></th></tr></thead>';
        // Accepted rows first; the grey rows sit in a second body, collapsed behind one toggle (N is a row count).
        const row = (s, i) => `<tr${s.accepted ? '' : ' class="whatif-weak"'}><td>${esc(s.player)}</td><td class="chg">${shown(s)}</td>` +
            gainCells(s, goalExp, t, floor) + `<td class="num">${costCell(s)}</td>${paybackTd(s, goalExp, t)}` + pathCell(s) +
            (isTimeOnly(s) ? '<td></td>' : `<td><button type="button" class="btn ${s.accepted ? 'btn-primary' : 'btn-secondary'} btn-sm py-0" data-whatif-apply="single:${i}">${esc(t('apply'))}</button></td>`) + '</tr>';
        const rows = result.singles.map((s, i) => [s, i]).filter(([s]) => !s.hiddenFood); // hiddenFood: a food row the search left out (one food row per player)
        const weak = rows.filter(([s]) => !s.accepted);
        // The accepted rows are two lists, free changes first (ranked by the buyer's gain), then those that cost something (by payback): the core
        // sorted them with one comparator, the window only splits them by cost.
        const accepted = rows.filter(([s]) => s.accepted), isFree = ([s]) => !(s.cost > 0);
        const group = (key, list) => (list.length ? `<tr class="whatif-group" data-group="${key}"><td colspan="8" class="small text-secondary">${esc(t('rounds.pool.' + key))}</td></tr>` + list.map(([s, i]) => row(s, i)).join('') : '');
        // The accepted rows are the list; the grey rows stay behind the toggle, in the same table (so the columns line up when it opens), or, when nothing is
        // accepted, in a table of their own (hidden whole, header included), so that no header stands over an empty list.
        const weakBody = '<tbody class="whatif-more" id="whatIfMoreSingles" hidden>' + weak.map(([s, i]) => row(s, i)).join('') + '</tbody>';
        const eachTable = (inner, attrs = '') => `<table class="table table-sm whatif-table whatif-each"${attrs}>${eachHead}${inner}</table>`;
        L.push(listTable(t, accepted.length, () => eachTable('<tbody>' + group('free', accepted.filter(isFree)) + group('paid', accepted.filter((r) => !isFree(r))) + '</tbody>' + (weak.length ? weakBody : ''))));
        if (!accepted.length && weak.length) L.push(`<table class="table table-sm whatif-table whatif-each" id="whatIfMoreSingles" hidden>${eachHead}<tbody class="whatif-more">${weak.map(([s, i]) => row(s, i)).join('')}</tbody></table>`);
        if (weak.length) L.push(`<button type="button" class="btn btn-link btn-sm p-0 mb-2" data-whatif-more="whatIfMoreSingles" data-show="${esc(t('result.showMore', { n: weak.length }))}" data-hide="${esc(t('result.showLess', { n: weak.length }))}">${esc(t('result.showMore', { n: weak.length }))}</button>`);
    }
    if (result.singlesNotShown > 0 && (anySingles || !running)) L.push(`<div class="small text-secondary mb-2" data-singles="not-shown">${yet ? plural(t, 'result.singlesNotShownYet', result.singlesNotShown, { n: num(result.singlesNotShown), need: num(readMin) }) : t('result.singlesNotShown', { n: num(result.singlesNotShown) })}</div>`);
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
        L.push(`<div class="mt-3"><span class="fw-bold">${esc(plural(t, 'result.dominated', result.dominated.length, { n: result.dominated.length }))}</span> ` +
            `<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-whatif-more="whatIfDominated" data-show="${esc(t('result.dominatedShow'))}" data-hide="${esc(t('result.dominatedHide'))}">${esc(t('result.dominatedShow'))}</button></div>` +
            '<ul class="small whatif-more" id="whatIfDominated" hidden>' +
            result.dominated.map((a) => `<li>${esc(a.player)}, ${shown(a)}</li>`).join('') + '</ul>');
    }
    if (result.otherStyle?.length) {
        // The swaps to gear whose only bonuses are another combat style's or element's (the search never offers them): same fold.
        L.push(`<div class="mt-3"><span class="fw-bold">${esc(plural(t, 'result.otherStyle', result.otherStyle.length, { n: result.otherStyle.length }))}</span> ` +
            `<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-whatif-more="whatIfOtherStyle" data-show="${esc(t('result.dominatedShow'))}" data-hide="${esc(t('result.dominatedHide'))}">${esc(t('result.dominatedShow'))}</button></div>` +
            '<ul class="small whatif-more" id="whatIfOtherStyle" hidden>' +
            result.otherStyle.map((a) => `<li>${esc(a.player)}, ${shown(a)}</li>`).join('') + '</ul>');
    }
    if (result.skippedNoExport?.length) {
        // One folded line: the players the levers that need a character export skipped; the list sits closed behind it.
        const lever = (g) => t('lever.' + g.lever + '.name');
        const n = new Set(result.skippedNoExport.flatMap((g) => g.players)).size;
        L.push(`<div class="mt-3"><span class="fw-bold">${esc(plural(t, 'result.skippedNoExport', n, { n, levers: result.skippedNoExport.map(lever).join(', ') }))}</span> ` +
            `<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-whatif-more="whatIfSkippedNoExport" data-show="${esc(t('result.dominatedShow'))}" data-hide="${esc(t('result.dominatedHide'))}">${esc(t('result.dominatedShow'))}</button></div>` +
            '<ul class="small whatif-more" id="whatIfSkippedNoExport" hidden>' +
            result.skippedNoExport.map((g) => `<li>${esc(lever(g))}: ${esc(g.players.join(', '))}</li>`).join('') + '</ul>');
    }
    if (result.apart?.length) L.push(closedList('apart', 'whatIfApart', result.apart.map((a) => `<li>${shown(a)}: ${esc(a.note)}</li>`), {}, t));
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
    if (x >= 86400) return plural(t, 'age.days', Math.floor(x / 86400), { n: Math.floor(x / 86400) });
    if (x >= 3600) return plural(t, 'age.hours', Math.floor(x / 3600), { n: Math.floor(x / 3600) });
    return plural(t, 'age.minutes', Math.floor(x / 60), { n: Math.floor(x / 60) });
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
