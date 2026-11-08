// Test: the Portuguese locale. locales/pt/common.json has exactly the keys of locales/en/common.json, and every
// game-string key the page uses (data-i18n in index.html, outside common:) resolves in the inlined game pt bundle.
// Usage: node tools/test/locale-coverage.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];

const leafKeys = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leafKeys(v, prefix + k + '.') : [prefix + k]);
const en = new Set(leafKeys(JSON.parse(read('locales/en/common.json'))));
const pt = new Set(leafKeys(JSON.parse(read('locales/pt/common.json'))));
for (const k of en) if (!pt.has(k)) failures.push('locales/pt/common.json lacks ' + k);
for (const k of pt) if (!en.has(k)) failures.push('locales/pt/common.json has extra ' + k);

// js/i18n.js is a browser script: run it with a stub document and read its bundles.
const context = { document: { addEventListener() {} } };
vm.runInNewContext(read('js/i18n.js') + '\n;globalThis.__bundles = { en: Wa.en.translation, pt: Pa };', context);
const { en: gameEn, pt: gamePt } = context.__bundles;
const lookup = (bundle, key) => key.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), bundle);
// Hrid keys ("itemNames./items/coin") split once after the section name.
const resolve = (bundle, key) => {
    const slash = key.indexOf('./');
    if (slash > 0) return lookup(bundle, key.slice(0, slash))?.[key.slice(slash + 1)];
    return lookup(bundle, key);
};

const pageKeys = [...new Set([...read('index.html').matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]))]
    .filter((k) => !k.includes(':'));
let inEnToo = 0;
for (const key of pageKeys) {
    if (resolve(gameEn, key) === undefined) continue; // not a game key the en bundle has either
    inEnToo++;
    if (typeof resolve(gamePt, key) !== 'string') failures.push('game pt bundle lacks ' + key);
}

const names = ['itemNames', 'monsterNames', 'abilityNames', 'actionNames'];
for (const section of names) {
    const enCount = Object.keys(gameEn[section] ?? {}).length;
    const missing = Object.keys(gameEn[section] ?? {}).filter((k) => typeof gamePt[section]?.[k] !== 'string');
    if (missing.length) failures.push(`${section}: ${missing.length}/${enCount} en names have no pt name (first: ${missing.slice(0, 3).join(', ')})`);
}

if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`FAIL ${failures.length}`);
    process.exit(1);
}
console.log(`PASS: pt common.json matches en (${en.size} keys); ${inEnToo} page game keys resolve in pt; ${names.join(', ')} fully covered`);
