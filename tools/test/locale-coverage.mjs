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

// Terminology: the simulator's pt strings use the game's own pt words. From every game string pair (en, pt) of
// one word, or equal to a whole common.json en value, take the game's most used pt rendering.
const flat = (o, prefix = '', out = {}) => {
    for (const [k, v] of Object.entries(o)) typeof v === 'object' && v !== null ? flat(v, prefix + k + '.', out) : (out[prefix + k] = v);
    return out;
};
const gameEnFlat = flat(gameEn), gamePtFlat = flat(gamePt);
const norm = (s) => String(s).trim().replace(/:$/, '').trim();
const gameTerm = new Map(); // lower-case en -> Map(pt -> uses)
for (const [k, v] of Object.entries(gameEnFlat)) {
    if (typeof v !== 'string' || typeof gamePtFlat[k] !== 'string' || v.length > 40) continue;
    const key = norm(v).toLowerCase();
    if (!gameTerm.has(key)) gameTerm.set(key, new Map());
    const uses = gameTerm.get(key);
    uses.set(norm(gamePtFlat[k]), (uses.get(norm(gamePtFlat[k])) ?? 0) + 1);
}
const mostUsed = (en) => {
    const uses = gameTerm.get(en.toLowerCase());
    return uses ? [...uses.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;
};
// Where the game's word does not fit the simulator's sense, with the reason.
const notTheGameWord = {
    'labyAttemptCount:count': 'the game maps "Count" to Quantidade; here it counts attempts (Tentativas)',
    'simulationResults.labyAttemptCount:count': 'the game maps "Count" to Quantidade; here it counts attempts (Tentativas)',
    'simulationResults.dungeonsCompleted:completed': 'Concluído agrees in gender: concluídas',
    'Experiment.dungeonStartWave:start': 'Iniciar is the verb; here it is the adjective inicial',
    'controls.calcSpecialAbilityBenefits:special': 'Especial agrees in number: especiais',
    'controls.specialAbilityResults:special': 'Especial agrees in number: especiais',
    'simulationResults.maxEnrageStack:max': 'Máx is the game\'s abbreviation; the full word máximos is used',
    'simulationResults.maxWaveReached:max': 'Máx is the game\'s abbreviation; the full word máxima is used',
    'simulationResults.maximumTime:maximum': 'kept as máximo',
    'selectAllOrNot:all': 'Tudo/Todos: the game has several; todos is used',
    'simAllZones:all': 'the game has several renderings of "All"',
    'simAllSolos:all': 'the game has several renderings of "All"',
    'simAllLabyrinths:all': 'the game has several renderings of "All"',
    'allZonesData:all': 'the game has several renderings of "All"',
    'simulateAllZonesResults:all': 'the game has several renderings of "All"',
    'simulationResults.damageDoneTotal:damage': 'Dano',
};
let termChecks = 0;
for (const [key, enValue] of Object.entries(flat(JSON.parse(read('locales/en/common.json'))))) {
    const ptValue = flat(JSON.parse(read('locales/pt/common.json')))[key];
    const whole = mostUsed(norm(enValue));
    if (whole !== undefined) {
        termChecks++;
        if (norm(ptValue) !== whole) failures.push(`${key}: the game says "${whole}" for "${norm(enValue)}", pt has "${norm(ptValue)}"`);
        continue;
    }
    for (const word of enValue.split(/[^A-Za-z]+/).filter((w) => w.length >= 3)) {
        const ptWord = mostUsed(word);
        if (ptWord === undefined || ptWord.includes(' ') || notTheGameWord[`${key}:${word.toLowerCase()}`]) continue;
        termChecks++;
        const stem = ptWord.toLowerCase().slice(0, Math.max(3, ptWord.length - 1));
        if (!ptValue.toLowerCase().includes(stem)) failures.push(`${key}: "${word}" is "${ptWord}" in the game, pt has "${ptValue}"`);
    }
}

if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`FAIL ${failures.length}`);
    process.exit(1);
}
console.log(`PASS: pt common.json matches en (${en.size} keys); ${termChecks} game-term checks; ${inEnToo} page game keys resolve in pt; ${names.join(', ')} fully covered`);
