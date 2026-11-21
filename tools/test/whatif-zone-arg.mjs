// Test: the what-if runner's --zone flag (tools/whatif/zone-arg.mjs zoneOf, read by core.mjs main and charm.mjs). A known zone passes; the Windows path
// Git Bash makes of "/actions/..." is turned back into the zone; anything else fails with "unknown zone <value>" and the MSYS_NO_PATHCONV hint, at the
// start of the search, not as a TypeError in the engine (src/combatsimulator/zone.js). The search part runs the real core on the synthetic pool.
// Usage: node tools/test/run-tests.mjs whatif-zone-arg.mjs        Exit code 0 on pass, 1 on fail.
import './heavyrun-guard.mjs';   // first, before any other import: runs only through the test loop (docs/codebase/test-loop.md)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const errorOf = async (f) => { try { await f(); return null; } catch (e) { return String(e?.message ?? e); } };

// ---- The search: an unknown zone stops it at once, with the zone named (old code: the synthetic search ran on and never looked at the zone) ----
const { loadScenario, runSynthetic } = await imp('tools/whatif/synthetic.mjs');
const scenario = loadScenario(path.join(root, 'tools/test/synthetic/scenario.json'));
const bad = 'C:/Program Files/Git/actions/combat/no_such_zone';
const err = await errorOf(() => runSynthetic(scenario, { zone: bad, 'max-steps': 1 }));
check('search: an unknown zone fails with "unknown zone <value>"', err !== null && err.includes(`unknown zone ${bad}`), String(err));
check('search: the failure carries the MSYS_NO_PATHCONV hint', err !== null && err.includes('MSYS_NO_PATHCONV=1'), String(err));

// ---- zoneOf itself ----
const zoneArg = await errorOf(() => imp('tools/whatif/zone-arg.mjs'));
if (zoneArg) check('zone-arg.mjs loads', false, zoneArg);
else {
    const { zoneOf, COMBAT_ZONES } = await imp('tools/whatif/zone-arg.mjs');
    check('combat zones: the planets and a dungeon are known', COMBAT_ZONES.has('/actions/combat/fly') && COMBAT_ZONES.has('/actions/combat/golem_cave') && COMBAT_ZONES.size > 11);
    check('a known zone passes as it is', zoneOf('/actions/combat/golem_cave') === '/actions/combat/golem_cave');
    check('Git Bash\'s path is turned back into the zone', zoneOf('C:/Program Files/Git/actions/combat/golem_cave') === '/actions/combat/golem_cave');
    check('the same with backslashes', zoneOf('C:\\Program Files\\Git\\actions\\combat\\golem_cave') === '/actions/combat/golem_cave');
    const e1 = await errorOf(() => zoneOf('/actions/combat/no_such_zone'));
    check('an unknown zone fails, named, with no path hint', e1 === 'unknown zone /actions/combat/no_such_zone', String(e1));
    const e2 = await errorOf(() => zoneOf('/actions/milking/cow'));
    check('a non-combat action is not a zone', e2 !== null && e2.startsWith('unknown zone'), String(e2));
}
process.exit(failed ? 1 : 0);
