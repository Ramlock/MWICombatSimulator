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
    'whatIf.apply': 'the game maps Apply to Candidatar-se (apply for a guild); here it writes a change into the setup (Aplicar)',
    'whatIf.apply:apply': 'the same, word by word',
    'whatIf.applyTo:apply': 'the game maps Apply to Candidatar-se (apply for a guild); here it writes changes into the setup (Aplicar)',
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
    'whatIf.result.playerLine:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.playerLineNoChange:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.gainLegend:change': '"a mudança" is the noun (a change in the loot), not the verb Alterar of the game',
    'whatIf.progress.skippedNoPick:change': '"nenhuma mudança" is the noun (no change was picked), not the verb Alterar of the game',
    'whatIf.result.overPayback:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.overPaybackNote:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.overPaybackShow:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.overPaybackHide:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.overPaybackDays:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.result.overPaybackNever:back': '"pays back" is the verb phrase (retorno), not the Back equipment slot (Costas)',
    'whatIf.rounds.status.pausedTip:back': '"comes back by itself" is the verb phrase (volta sozinha), not the Back equipment slot (Costas)',
    'whatIf.rounds.status.bestTip:items': 'the word is the placeholder name {{items}}; the text names the candidate, no game Items label is meant',
    'whatIf.result.bestGainExp:party': 'the placeholder is named party; the text is "gain {{value}}", no game party (grupo) is meant',
    'controls.equipmentSets:equipment': 'renamed on purpose to the short Conjuntos so the three buttons fit on one row; the game\'s Equipamento is left out',
    'whatIf.get.linuxStep2:install': 'Instale is the imperative of Instalar; the English "nvm install 24" is a shell command kept as written',
    'whatIf.get.linuxStep3:tools': 'the word is the folder name tools/ in the command, not the game\'s Ferramentas',
    'simulationResults.heldByTriggerOverlap:add': '"do not add up" is a sum, not the Add button; pt says não somam',
    'whatIf.get.step1:save': "Salve is the imperative of the game's Salvar",
    'whatIf.get.step2:time': "\"the first time\" is primeira vez, not the game's Tempo (a duration)",
    'whatIf.progress.partStepsShort:time': "\"one at a time\" is uma a uma, not the game's Tempo (a duration)",
    'whatIf.progress.partSteps:time': "\"one at a time\" is uma a uma, not the game's Tempo (a duration)",
    'whatIf.progress.partConfirmationWaiting:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.progress.partScreen:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.progress.partStep:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.progress.partPicks:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.rounds.status.zero:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.rounds.status.zeroTip:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.result.otherStyleOne:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.rounds.col.candidate:change': '"mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.rounds.col.candidate': '"Mudança" is the noun (a change to a setup), not the verb Alterar of the game (its button "Change creator code")',
    'whatIf.result.running:change': "\"podem mudar\" (the lists may still change) is the plain verb, not the game's button Alterar",
    'whatIf.result.running:report': "\"relatório\" is the noun (this report), not the game's verb Reportar (report a player)",
    'whatIf.rounds.slotEmpty': "lower case on purpose: it stands mid-line (\"Pés vazio → ...\") like the en \"empty\"; the game's Vazio is a label",
    'whatIf.rounds.pausedTip:back': '"come back by themselves" is the verb phrase (voltam sozinhas), not the Back equipment slot (Costas)',
    'whatIf.rounds.poolCounts:paused': 'the word is the placeholder name {{paused}}; the text says "set aside" (deixadas de lado), no game Pausado is meant',
    'whatIf.result.paysBackIn:back': '"pays back" is the verb phrase (se paga), not the Back equipment slot (Costas)',
    'whatIf.result.answer:all': "Todas agrees in gender and number with \"as mudanças\"; the game's Tudo is \"everything\"",
    'whatIf.price.mirrorChain:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
    'whatIf.price.mirrorChainOne:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
    'whatIf.price.mirrorCheaper:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
    'whatIf.price.mirrorCheaperOne:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
    'whatIf.price.mirrorOwn:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
    'whatIf.price.mirrorOwnOne:philosopher': "Filosofais is from the game's own item name Espelho Filosofal; the game's Filósofo is from an achievement name",
};
let termChecks = 0;
for (const [key, enValue] of Object.entries(flat(JSON.parse(read('locales/en/common.json'))))) {
    const ptValue = flat(JSON.parse(read('locales/pt/common.json')))[key];
    const whole = mostUsed(norm(enValue));
    if (whole !== undefined && !notTheGameWord[key]) {
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

// Every whatIf string of pt and zh is translated: a value equal to the en one fails, except where the text is rightly the
// same in that language (the reason beside each).
const sameAsEn = {
    'pt:whatIf.days': '"d" is the pt abbreviation of dias too',
    'pt:whatIf.rounds.col.status': "Status is the game's own pt word (marketplacePanel.status and others)",
    'pt:whatIf.result.noCost': 'N/A is the usual pt abbreviation too (não se aplica)',
};
const enFlat = flat(JSON.parse(read('locales/en/common.json')));
let sameChecks = 0;
for (const lang of ['pt', 'zh']) {
    const other = flat(JSON.parse(read(`locales/${lang}/common.json`)));
    for (const [key, enValue] of Object.entries(enFlat)) {
        if (!key.startsWith('whatIf.') || other[key] === undefined) continue;
        sameChecks++;
        if (other[key] === enValue && !sameAsEn[`${lang}:${key}`]) failures.push(`${lang} ${key} is the en text "${enValue}"`);
    }
}
for (const k of Object.keys(sameAsEn)) { const [lang, key] = [k.slice(0, 2), k.slice(3)]; if (flat(JSON.parse(read(`locales/${lang}/common.json`)))[key] !== enFlat[key]) failures.push(`sameAsEn ${k} is no longer the en text: remove it from the list`); }

if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`FAIL ${failures.length}`);
    process.exit(1);
}
console.log(`PASS: pt common.json matches en (${en.size} keys); ${termChecks} game-term checks; ${sameChecks} whatIf pt/zh strings translated; ${inEnToo} page game keys resolve in pt; ${names.join(', ')} fully covered`);
