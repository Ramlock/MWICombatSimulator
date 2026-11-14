// Test: every file the runner loads is in the runner zip. Reads the `git archive` path list from tools/runner-zip/build-zip.ps1 itself,
// then follows every relative import (static, `export ... from`, `import('...')`, `new URL('...', import.meta.url)`) from the runner's
// entry points (server.mjs, the optimizer it forks, the run worker batch.mjs) and fails on any file that resolves outside that list
// or does not exist. A file added to src/ and imported by the runner but not named in build-zip.ps1 broke every search of a release once.
// Usage: node tools/test/runner-zip-files.mjs [--root <repo root, default this checkout>]. Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const opt = (n) => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : process.argv[i + 1]; };
const root = path.resolve(opt('root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

const ps = fs.readFileSync(path.join(root, 'tools', 'runner-zip', 'build-zip.ps1'), 'utf8');
const line = ps.split(/\r?\n/).find((l) => /git -C \$repo archive\b/.test(l));
if (!line) { console.log('FAIL no `git archive` line in build-zip.ps1'); process.exit(1); }
const listed = line.replace(/^.*?\$sha\s+/, '').trim().split(/\s+/).map((p) => p.replace(/\/$/, ''));
const inZip = (r) => listed.some((p) => r === p || r.startsWith(p + '/'));

const entries = ['tools/whatif/runner/server.mjs', 'tools/whatif/optimize.mjs', 'tools/whatif/batch.mjs'];
const specs = (src) => {
    const out = [];
    const res = [/\bimport\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g, /\bexport\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
    for (const re of res) for (const m of src.matchAll(re)) out.push(m[1]);
    return out.filter((s) => s.startsWith('./') || s.startsWith('../'));
};
let fails = 0;
const seen = new Set();
const queue = entries.map((e) => path.join(root, e));
while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(m?js|cjs)$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const s of specs(src)) {
        const t = path.resolve(path.dirname(f), s.split('?')[0]);
        const r = rel(t);
        if (!fs.existsSync(t)) { fails++; console.log('FAIL', rel(f), 'imports a missing file', s); continue; }
        if (!inZip(r)) { fails++; console.log('FAIL', rel(f), 'loads', r, 'which build-zip.ps1 does not archive'); continue; }
        queue.push(t);
    }
}
console.log(`${seen.size} files followed from ${entries.length} entry points; archive list: ${listed.join(' ')}`);
console.log(fails ? `${fails} FAILED` : 'ok   every file the runner loads is in the zip');
process.exit(fails ? 1 : 0);
