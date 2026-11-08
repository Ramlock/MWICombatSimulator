// Test: Dark Mode is the default. The inline script right after <body> in index.html adds the dark-mode class before
// first paint unless the stored setting is 'false', and src/main.js sets the toggle by the same rule.
// Usage: node tools/test/dark-mode-default.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const failures = [];

// The first thing in <body> is the inline script: synchronous, before any content is parsed, so before first paint.
const m = html.match(/<body[^>]*>\s*<script>([\s\S]*?)<\/script>/);
if (!m) failures.push('index.html: no inline <script> directly after <body>');
else {
    const run = (stored, throws = false) => {
        const classes = new Set();
        vm.runInNewContext(m[1], {
            localStorage: { getItem: (k) => { if (throws) throw new Error('blocked'); return k === 'darkModeEnabled' ? stored : null; } },
            document: { body: { classList: { add: (c) => classes.add(c) } } },
        });
        return classes.has('dark-mode');
    };
    for (const [stored, want, throws] of [[null, true], ['true', true], ['false', false], [null, true, true]]) {
        const got = run(stored, throws);
        if (got !== want) failures.push(`inline script, stored ${stored}${throws ? ' (storage blocked)' : ''}: dark ${got}, want ${want}`);
    }
}
if (!main.includes("if (localStorage.getItem('darkModeEnabled') !== 'false') {"))
    failures.push("src/main.js: the toggle is not checked by default (expected the !== 'false' rule)");

if (failures.length) { console.log(failures.join('\n')); console.log(`FAIL ${failures.length}`); process.exit(1); }
console.log('PASS: dark by default before first paint (no setting, true, storage blocked); a stored false stays light; main.js agrees');
