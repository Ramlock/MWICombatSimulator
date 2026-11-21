// Test: the error window's copy keeps the stack (src/errorReport.mjs, used by showErrorModal in src/main.js): a worker's
// error, after the structured clone postMessage does, and a window "error" event, each give their text and their stack.
// Usage: node tools/test/error-report.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

let mod = null;
try { mod = await import('../../src/errorReport.mjs'); } catch (e) { check('src/errorReport.mjs loads', false, e.message); }

function throwNullMap() { const list = null; return list.map((x) => x); }
let thrown;
try { throwNullMap(); } catch (e) { thrown = e; }

if (mod) {
    const { workerErrorReport, windowErrorReport } = mod;
    const posted = structuredClone(thrown); // what the page receives as event.data.error
    const r = workerErrorReport(posted);
    check('worker error: text as before', r.message === "TypeError: Cannot read properties of null (reading 'map')", r.message);
    check('worker error: stack kept, naming the throwing function', typeof r.stack === 'string' && r.stack.includes('throwNullMap'), String(r.stack));
    check('worker error that is a string: text, no stack', JSON.stringify(workerErrorReport('boom')) === JSON.stringify({ message: 'boom', stack: null }));

    const w = windowErrorReport({ message: 'Uncaught ' + String(thrown), error: thrown, filename: 'bundle.js', lineno: 1, colno: 2 });
    check('window error: text as before', w.message === "Uncaught TypeError: Cannot read properties of null (reading 'map')", w.message);
    check('window error: stack of the thrown error', w.stack === thrown.stack);
    check('window error with no error object: the script position', windowErrorReport({ message: 'Script error.', error: null, filename: 'bundle.js', lineno: 3, colno: 4 }).stack === 'bundle.js:3:4');
    check('window error with nothing known: no stack', windowErrorReport({ message: 'Script error.', error: null, filename: '' }).stack === null);
}

// The page uses it on all three paths (worker, multi-worker, window) and copies the stack.
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
check('main.js: both worker paths pass the error object', (main.match(/showErrorModal\(workerErrorReport\(event\.data\.error\)\)/g) || []).length === 2);
check('main.js: the window path passes the event', main.includes('showErrorModal(windowErrorReport(event))'));
check('main.js: no path keeps only the text', !main.includes('event.data.error.toString()') && !main.includes('showErrorModal(event.message)'));
check('main.js: the copy carries the stack', /stack:\s*report\.stack/.test(main));

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
