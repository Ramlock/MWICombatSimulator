#!/usr/bin/env node
// Echo check: reads the combat tracker's test-server file and lists, per ability cast, the events that follow it and the ratio of each to the
// cast's first event. It prints counts only and concludes nothing (no proc is decided here).
//
// Usage:  node tools/echo-analysis.mjs <file> [--window-ms 2000] [--casts] [--json]
//   <file>        what the helper wrote for the test server (combat-test-YYYY-MM.jsonl): one JSON per line, each { v, seen, rec: { key, type, data } } (an
//                 `encounter` record carries the row in `data`), or a bare record { key, type, data }, a bare encounter row, or a whole recording ({ encounters: [...] }, e.g. the tracker's "Save combat recording").
//                 Only encounters that carry a `trace` (the tracker 0.10.0 writes it on the test server) are used; the rest are counted and skipped.
//   --window-ms   how long after a cast an event still counts as following it (default 2000); a later cast by the same player also ends it.
//   --casts       one line per cast with its events (ms after the cast, damage or heal, amount, ratio to the first event).
//   --json        the same numbers as one JSON object.
//
// What it reads: the trace rows (docs/codebase/combat-tracker.md, "Echo check"). A cast is a player row with dAtk > 0 (the ability is the row's
// `src`). An event is a monster row with drop > 0 (damage; dDmg splats, drop HP lost) or a player row with rise > 0 (a heal). The events of a cast
// are the ones from its own update on, up to the window or the same player's next cast. Damage cannot be told apart by dealer, so with more than one
// player casting the events of one player's cast can include another's: the header says how many players cast, and a solo fight is the clean case.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const BINS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, 2.0];

const binLabel = (r) => {
    let i = 0;
    while (i + 1 < BINS.length && r >= BINS[i + 1]) i++;
    return i === BINS.length - 1 ? '>=' + BINS[i] : BINS[i] + '-' + BINS[i + 1];
};

// Takes any of the file's shapes and returns the encounter rows in it.
export function encountersIn(obj) {
    if (Array.isArray(obj)) return obj.flatMap(encountersIn);
    if (!obj || typeof obj !== 'object') return [];
    if (obj.rec && typeof obj.rec === 'object') return encountersIn(obj.rec); // a helper line: { v, seen, rec: { key, type, data } }
    if (Array.isArray(obj.records)) return obj.records.flatMap(encountersIn);
    if (obj.type === 'encounter' && obj.data) return [obj.data];
    if (Array.isArray(obj.encounters)) return obj.encounters;
    if (obj.trace || obj.players) return [obj];
    return [];
}

export async function readEncounters(file) {
    const out = [];
    let parsedLine = false;
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
        const t = line.trim();
        if (!t) continue;
        let o;
        try { o = JSON.parse(t); } catch { continue; }
        if (!o || typeof o !== 'object' || Array.isArray(o)) continue; // a stray number or row of a pretty-printed file is not a record
        parsedLine = true;
        out.push(...encountersIn(o));
    }
    if (!parsedLine) { try { out.push(...encountersIn(JSON.parse(fs.readFileSync(file, 'utf8')))); } catch { /* not JSON */ } }
    return out;
}

const decode = (tr) => tr.rows.map((r) => { const o = {}; tr.fields.forEach((f, i) => { o[f] = r[i]; }); o.ability = tr.src[o.src]; return o; });

// opts: { windowMs }. Returns { encounters, used, skipped, casts, players, byAbility, list } (the numbers only).
export function analyze(encounters, opts) {
    const windowMs = opts && opts.windowMs != null ? opts.windowMs : 2000;
    const res = { encounters: encounters.length, used: 0, skipped: 0, casts: 0, castingPlayers: 0, byAbility: {}, list: [] };
    const castingSlots = new Set();
    encounters.forEach((enc, ei) => {
        if (!enc || !enc.trace || !Array.isArray(enc.trace.rows) || !Array.isArray(enc.trace.fields)) { res.skipped++; return; }
        res.used++;
        const rows = decode(enc.trace);
        rows.forEach((r, i) => {
            if (r.side !== 0 || !(r.dAtk > 0)) return;
            castingSlots.add(ei + ':' + r.idx);
            let end = rows.length;
            for (let j = i + 1; j < rows.length; j++) if (rows[j].side === 0 && rows[j].idx === r.idx && rows[j].dAtk > 0) { end = j; break; }
            const events = [];
            for (let j = i; j < end; j++) {
                const e = rows[j];
                if (e.ms - r.ms > windowMs) break;
                if (e.side === 1 && e.drop > 0) events.push({ kind: 'damage', msg: e.msg - r.msg, ms: e.ms - r.ms, amount: e.drop, splats: e.dDmg, crit: !!e.crit });
                else if (e.side === 0 && e.rise > 0) events.push({ kind: 'heal', msg: e.msg - r.msg, ms: e.ms - r.ms, amount: e.rise, splats: 0, crit: false });
            }
            const base = events[0] || null;
            const extras = base ? events.slice(1).map((e) => ({ ...e, ratio: base.amount > 0 ? e.amount / base.amount : null })) : [];
            const a = res.byAbility[r.ability] || (res.byAbility[r.ability] = { casts: 0, noEvent: 0, noExtra: 0, oneExtra: 0, manyExtra: 0, extraSameUpdate: 0, extraLater: 0, extraDamage: 0, extraHeal: 0, multiSplatRows: 0, ratios: {} });
            a.casts++; res.casts++;
            if (!base) a.noEvent++;
            else if (!extras.length) a.noExtra++;
            else if (extras.length === 1) a.oneExtra++;
            else a.manyExtra++;
            for (const e of events) if (e.splats > 1) a.multiSplatRows++;
            for (const e of extras) {
                if (e.msg === 0) a.extraSameUpdate++; else a.extraLater++;
                if (e.kind === 'damage') a.extraDamage++; else a.extraHeal++;
                if (e.ratio !== null) { const k = binLabel(e.ratio); a.ratios[k] = (a.ratios[k] || 0) + 1; }
            }
            res.list.push({ encounter: ei, ms: r.ms, slot: r.idx, ability: r.ability, base, extras });
        });
    });
    res.castingPlayers = castingSlots.size ? new Set([...castingSlots].map((s) => s.split(':')[1])).size : 0;
    return res;
}

export function format(res, opts) {
    const L = [];
    L.push('encounters ' + res.encounters + ', with trace ' + res.used + ', skipped (no trace) ' + res.skipped + ', casts ' + res.casts + ', players that cast ' + res.castingPlayers);
    for (const [ab, a] of Object.entries(res.byAbility).sort((x, y) => y[1].casts - x[1].casts)) {
        L.push('');
        L.push(ab + ': casts ' + a.casts + '; no event ' + a.noEvent + ', first event only ' + a.noExtra + ', one more ' + a.oneExtra + ', two or more ' + a.manyExtra);
        L.push('  extra events: same update ' + a.extraSameUpdate + ', later update ' + a.extraLater + '; damage ' + a.extraDamage + ', heal ' + a.extraHeal + '; update rows with 2+ splats ' + a.multiSplatRows);
        const bins = Object.entries(a.ratios).sort((x, y) => parseFloat(x[0]) - parseFloat(y[0]));
        L.push('  ratio of an extra event to the first event: ' + (bins.length ? bins.map(([k, v]) => k + ' x' + v).join(', ') : 'none'));
    }
    if (opts && opts.casts) {
        L.push('');
        for (const c of res.list) {
            L.push('enc ' + c.encounter + ' +' + c.ms + 'ms slot ' + c.slot + ' ' + c.ability + ' first ' + (c.base ? c.base.kind + ' ' + c.base.amount : 'none') +
                c.extras.map((e) => ' | +' + e.ms + 'ms ' + (e.msg === 0 ? 'same update' : 'update +' + e.msg) + ' ' + e.kind + ' ' + e.amount + ' ratio ' + (e.ratio === null ? 'n/a' : e.ratio.toFixed(3))).join(''));
        }
    }
    return L.join('\n');
}

async function main() {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--window-ms');
    if (!file) { console.error('usage: node tools/echo-analysis.mjs <file> [--window-ms 2000] [--casts] [--json]'); process.exit(2); }
    const wi = args.indexOf('--window-ms');
    const windowMs = wi >= 0 ? Number(args[wi + 1]) : 2000;
    if (!Number.isFinite(windowMs) || windowMs < 0) { console.error('--window-ms needs a number of milliseconds'); process.exit(2); }
    const res = analyze(await readEncounters(file), { windowMs });
    console.log(args.includes('--json') ? JSON.stringify(res) : format(res, { casts: args.includes('--casts') }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
