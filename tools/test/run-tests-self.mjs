// Test of the test loop's pure parts (tools/test/run-tests.mjs): the count line's parsing, the relaunch decision, the minutes, the file names.
import { countLines, shouldRelaunch, minutesFor, resolveFiles, exitCode, memoryArgs, DEFAULT_MINUTES, MEMORY_FLOOR_GB, WHATIF_FLOOR_GB } from './run-tests.mjs';
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const c = countLines('ok   a\nFAIL b\nPASS: all\n2026-11-15 18:00:00 ok   stamped\n✔ node test\n✖ node fail\nnot ok 3\nlooks ok\n');
check('counts ok lines (plain, PASS, stamped, ✔)', c.ok === 4, JSON.stringify(c));
check('counts fail lines (FAIL, ✖, not ok)', c.fail === 3, JSON.stringify(c));
check('relaunches when not under HeavyRun and it exists', shouldRelaunch({}, true) === true);
check('no relaunch under HeavyRun', shouldRelaunch({ MWI_UNDER_HEAVYRUN: '1' }, true) === false);
check('no relaunch where HeavyRun does not exist', shouldRelaunch({}, false) === false);
check('minutes: default per file', minutesFor(['tools/test/a.mjs', 'tools/test/b.mjs']) === 2 * DEFAULT_MINUTES);
check('minutes: a long file counts its own', minutesFor(['tools/test/whatif-runner-exe.mjs']) === 15 && minutesFor(['tools/test/whatif-synthetic.mjs']) === 14);
check('minutes: never cut to 60', minutesFor(Array(40).fill('tools/test/whatif-presses.mjs')) === 480);
const k = countLines(['SKIPPED the scan: no setups', 'ok   a', '2026-11-15 18:00:00 SKIPPED other'].join(String.fromCharCode(10)));
check('counts SKIPPED lines (plain and stamped)', k.skipped === 2 && k.ok === 1, JSON.stringify(k));
check('a skip passes without --strict', exitCode([{ code: 0, skipped: 1 }], false) === 0);
check('a skip fails under --strict', exitCode([{ code: 0, skipped: 1 }], true) === 1);
check('no skip passes under --strict', exitCode([{ code: 0, skipped: 0 }], true) === 0);
check('a failed file fails', exitCode([{ code: 1, skipped: 0 }], false) === 1);
check('memory floor without what-if files', JSON.stringify(memoryArgs(['tools/test/talismans.mjs'])) === JSON.stringify(['--memory-gb', String(MEMORY_FLOOR_GB)]));
check('what-if files: the measured floor or none', JSON.stringify(memoryArgs(['tools/test/whatif-food.mjs'])) === JSON.stringify(WHATIF_FLOOR_GB ? ['--memory-gb', String(WHATIF_FLOOR_GB)] : []));
check('names resolve without extension', resolveFiles(['talismans'])[0] === 'tools/test/talismans.mjs');
check('userscript names resolve', resolveFiles(['tracker.test.cjs'])[0] === 'userscript/test/tracker.test.cjs');
let threw = false; try { resolveFiles(['no-such-file']); } catch { threw = true; }
check('an unknown name throws', threw);
check('all: excludes the loop itself', !resolveFiles([]).includes('tools/test/run-tests.mjs'));
process.exit(failed ? 1 : 0);
