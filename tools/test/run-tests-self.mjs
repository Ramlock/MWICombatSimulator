// Test of the test loop's pure parts (tools/test/run-tests.mjs): the count line's parsing, the relaunch decision, the minutes, the file names.
import { countLines, shouldRelaunch, minutesFor, resolveFiles, DEFAULT_MINUTES } from './run-tests.mjs';
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const c = countLines('ok   a\nFAIL b\nPASS: all\n2026-11-15 18:00:00 ok   stamped\n✔ node test\n✖ node fail\nnot ok 3\nlooks ok\n');
check('counts ok lines (plain, PASS, stamped, ✔)', c.ok === 4, JSON.stringify(c));
check('counts fail lines (FAIL, ✖, not ok)', c.fail === 3, JSON.stringify(c));
check('relaunches when not under HeavyRun and it exists', shouldRelaunch({}, true) === true);
check('no relaunch under HeavyRun', shouldRelaunch({ MWI_UNDER_HEAVYRUN: '1' }, true) === false);
check('no relaunch where HeavyRun does not exist', shouldRelaunch({}, false) === false);
check('minutes: default per file', minutesFor(['tools/test/a.mjs', 'tools/test/b.mjs']) === 2 * DEFAULT_MINUTES);
check('minutes: a long file counts its own', minutesFor(['tools/test/whatif-runner-exe.mjs']) === 15);
check('minutes: capped at 60', minutesFor(Array(40).fill('tools/test/runner-search.mjs')) === 60);
check('names resolve without extension', resolveFiles(['talismans'])[0] === 'tools/test/talismans.mjs');
check('userscript names resolve', resolveFiles(['tracker.test.cjs'])[0] === 'userscript/test/tracker.test.cjs');
let threw = false; try { resolveFiles(['no-such-file']); } catch { threw = true; }
check('an unknown name throws', threw);
check('all: excludes the loop itself', !resolveFiles([]).includes('tools/test/run-tests.mjs'));
process.exit(failed ? 1 : 0);
