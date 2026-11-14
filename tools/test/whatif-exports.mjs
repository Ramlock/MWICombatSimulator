// Test: the character export per player in the What-if search. (1) The window's pure logic (src/whatif/panel.mjs): the
// request carries the export map, a paste is validated, the status line, the folded "skipped" line of the result and its
// strings in en, pt and zh. (2) The runner accepts the old single export and the new map. (3) The optimizer
// (tools/whatif/optimize.mjs) on a generic party of two: with a map where one player has an export, the levers that need
// it run for that player and skip the other (result.skippedNoExport), with none they skip both, and nothing throws; the old
// single form still works. Generic fixtures only; temporary folders under the OS temp folder, removed.
// Usage: node tools/test/whatif-exports.mjs [--skip-optimizer]       Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const panel = await imp('src/whatif/panel.mjs');
const R = await imp('tools/whatif/runner/server.mjs');
const locales = Object.fromEntries(['en', 'pt', 'zh'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, `locales/${l}/common.json`), 'utf8')).whatIf]));
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const lookup = (o, key) => key.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const tFor = (l) => (key, params = {}) => { const s = lookup(locales[l], key); return typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k])) : '#' + key; };
const t = tFor('en');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-exports-'));

// ---- (1) The window's logic ----
const generic = (name, weapon, head) => ({
    name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
    player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
        { itemLocationHrid: '/item_locations/main_hand', itemHrid: weapon, enhancementLevel: 0 },
        { itemLocationHrid: '/item_locations/head', itemHrid: head, enhancementLevel: 0 }] },
    abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] },
});
const party = [generic('Alpha', '/items/cheese_sword', '/items/cheese_helmet'), generic('Beta', '/items/cheese_mace', '/items/cheese_helmet')];
const slots = party.map((s, i) => { const { name, ...rest } = s; return { id: String(i + 1), name, json: JSON.stringify(rest) }; });
const exA = { name: 'Alpha', coin: 5, inventory: [{ itemHrid: '/items/cheese_sword', enhancementLevel: 2, count: 1 }], learnedAbilities: [] };

check('request: no exports, no export field', !('export' in panel.searchBody({ slots, goal: 'profit', budgets: {}, levers: [] })) && !('export' in panel.searchBody({ slots, goal: 'profit', budgets: {}, levers: [], exports: {} })));
check('request: the export map rides along as sent', JSON.stringify(panel.searchBody({ slots, goal: 'profit', budgets: {}, levers: [], exports: { Alpha: exA } }).export) === JSON.stringify({ Alpha: exA }));
check('paste: an object with an inventory or learned abilities is a character export', panel.parseExport(JSON.stringify(exA)).ok && panel.parseExport('{"learnedAbilities":[]}').ok && panel.parseExport('{"inventory":[]}').ok);
check('paste: anything else is not', ['', 'hello', '[]', '{}', '{"name":"x"}', '{"inventory":3}', 'null', '5'].every((x) => !panel.parseExport(x).ok));
check('status: kept shows the export\'s own name', panel.exportStatus({ kept: exA, text: '' }, ['owned'], t) === 'kept (Alpha)');
check('status: none names the ticked levers that need it, in the window\'s names', panel.exportStatus({ kept: null, text: '' }, ['equip', 'owned', 'books', 'abilitylevels'], t) === 'no export: skipped by Items you own');
check('status: none with no such lever ticked has nothing extra', panel.exportStatus({ kept: null, text: '' }, ['equip', 'abilitylevels'], t) === 'no export');
check('status: a bad paste says so, even over a kept export', panel.exportStatus({ kept: exA, text: 'nope' }, [], t) === 'not a character export: not kept');
check('status: one key per player name', panel.exportKey('Alpha') !== panel.exportKey('Beta') && panel.exportKey('Alpha').includes('Alpha'));
const skipped = [{ lever: 'owned', players: ['Beta'] }, { lever: 'books', players: ['Beta', 'Gamma'] }];
const base = { goal: 'profit', budgets: {}, steps: [], singles: [], skippedNoExport: skipped };
const dom = (l, r = base) => panel.renderResult(r, tFor(l), Date.now(), {});
const en = dom('en');
check('result line: players counted once, lever names as the window shows them, closed behind Show / Hide', en.includes('<span class="fw-bold">2 players skipped by Items you own, New abilities</span>') && /<ul class="small whatif-more" id="whatIfSkippedNoExport" hidden>/.test(en) && en.includes('data-whatif-more="whatIfSkippedNoExport" data-show="Show" data-hide="Hide">Show</button>'), en.slice(en.indexOf('skipped by') - 60, en.indexOf('skipped by') + 300));
check('result line: the open list is one row per lever with its players', en.includes('<li>Items you own: Beta</li>') && en.includes('<li>New abilities: Beta, Gamma</li>'));
check('result line: nothing when absent or empty', !dom('en', { ...base, skippedNoExport: undefined }).includes('whatIfSkippedNoExport') && !dom('en', { ...base, skippedNoExport: [] }).includes('whatIfSkippedNoExport'));
check('result line: in pt the line and the lever names follow the language', dom('pt').includes(locales.pt.result.skippedNoExport.replace('{{n}}', '2').replace('{{levers}}', locales.pt.lever.owned.name + ', ' + locales.pt.lever.books.name)));
check('strings exist in en, pt and zh', ['exportLabel', 'exportKept', 'exportNone', 'exportNoneBare', 'exportBad', 'result.skippedNoExport'].every((k) => ['en', 'pt', 'zh'].every((l) => typeof lookup(locales[l], k) === 'string' && lookup(locales[l], k) !== '')) && ['pt', 'zh'].every((l) => locales[l].exportKept !== locales.en.exportKept));

// ---- (2) The runner ----
const mk = (n) => { const d = path.join(tmp, n); fs.mkdirSync(d, { recursive: true }); return d; };
const args = (body, n) => { const d = mk(n); const a = R.buildArgs(body, d); return { a, d, file: a.includes('--export') ? JSON.parse(fs.readFileSync(a[a.indexOf('--export') + 1], 'utf8')) : null }; };
const oldForm = args({ setups: party, exports: undefined, export: exA }, 'old');
const mapForm = args({ setups: party, export: { Alpha: exA } }, 'map');
const none = args({ setups: party }, 'none');
check('runner: the old single export is written as it came and passed with --export', JSON.stringify(oldForm.file) === JSON.stringify(exA));
check('runner: the map is written as it came and passed with --export', JSON.stringify(mapForm.file) === JSON.stringify({ Alpha: exA }));
check('runner: no export, no --export', !none.a.includes('--export'));
check('runner: an export that is not an object is refused', ['x', 5, [1]].every((e) => { try { args({ setups: party, export: e }, 'bad' + String(e)); return false; } catch (err) { return true; } }));

// ---- (3) The optimizer on a generic party ---- (--skip-optimizer runs only the light parts above)
if (process.argv.includes('--skip-optimizer')) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} console.log(failed ? `${failed} failed (optimizer parts skipped)` : 'all passed (optimizer parts skipped)'); process.exit(failed ? 1 : 0); }
const run = (name, body) => {
    const d = mk(name);
    const a = R.buildArgs({ setups: party, options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, prices: 'marketplace-2026-11-03.json' }, goal: 'profit', budgets: { Alpha: 1, Beta: 1 },
        levers: ['owned', 'abilities', 'books', 'abilitylevels'], unitHours: 1, confirmHours: 1, maxRounds: 3, lockRule: 'reading', readingStep: 8, swaps: false, z: 0, jobs: 2, ...body }, d).filter((x) => x !== '--low-priority');
    let out = '';
    try { out = execFileSync(process.execPath, [path.join(root, 'tools/whatif/optimize.mjs'), ...a], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 400) }; }
    return { out, res: JSON.parse(fs.readFileSync(path.join(d, 'result.json'), 'utf8')) };
};
const group = (res, lever) => res.skippedNoExport?.find((g) => g.lever === lever)?.players.join(',');
const mapRun = run('opt-map', { export: { Alpha: exA } });
check('optimizer, map with one export: no throw', !mapRun.error, mapRun.error);
if (mapRun.res) {
    const r = mapRun.res;
    check('map: Beta is skipped by owned, abilities and books; Alpha by none', group(r, 'owned') === 'Beta' && group(r, 'abilities') === 'Beta' && group(r, 'books') === 'Beta' && r.skippedNoExport.every((g) => !g.players.includes('Alpha')), JSON.stringify(r.skippedNoExport));
    check('map: ability levels never skip (their upper-bound rows stay)', !r.skippedNoExport.some((g) => g.lever === 'abilitylevels'));
    check('map: the levers ran for Alpha (an owned candidate) and none for Beta', r.candidateList.some((c) => c.id.startsWith('Alpha:') && c.id.includes('=own:')) && !r.candidateList.some((c) => c.id.startsWith('Beta:') && c.id.includes('=own:')), JSON.stringify(r.candidateList.map((c) => c.id)));
    check('map: the budgets come from --budgets', JSON.stringify(r.budgets) === JSON.stringify({ Alpha: 1, Beta: 1 }) && /per player/.test(r.budgetSource), r.budgetSource);
}
const noneRun = run('opt-none', {});
check('optimizer, no export at all: no throw', !noneRun.error, noneRun.error);
if (noneRun.res) {
    const r = noneRun.res;
    check('none: every lever that needs an export lists both players', ['owned', 'abilities', 'books'].every((l) => group(r, l) === 'Alpha,Beta'), JSON.stringify(r.skippedNoExport));
    check('none: nothing owned or learned is offered', !r.candidateList.some((c) => c.id.includes('=own:') || c.id.includes('=book:')));
}
const oldRun = run('opt-old', { export: exA });
check('optimizer, the old single export: no throw', !oldRun.error, oldRun.error);
if (oldRun.res) check('old form: Alpha has its export, Beta is skipped', group(oldRun.res, 'owned') === 'Beta' && oldRun.res.candidateList.some((c) => c.id.startsWith('Alpha:') && c.id.includes('=own:')), JSON.stringify(oldRun.res.skippedNoExport));
check('result.json has the group on every result (empty when nothing was skipped)', Array.isArray(run('opt-equip', { levers: ['equip'] }).res?.skippedNoExport));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
