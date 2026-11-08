// Test: the simulator's display number formatter (src/numberFormat.js).
// Usage: node tools/test/number-format.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const { cellValue, setNumberText, setNumberFormatSettings, formatNumber, formatUnit, percentSign, exactUnit, formatPercent, exactNumber, numberHtml, percentHtml } = await import(pathToFileURL(path.join(root, 'src/numberFormat.js')).href);

const cases = [
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [1234, '1,234'],
    [9999, '9,999'],
    [10000, '10k'],
    [12345, '12.35k'],
    [99999, '100k'],
    [100000, '100k'],
    [123456, '123.5k'],
    [999999, '1M'],
    [999949, '999.9k'],
    [1e6, '1M'],
    [1234567, '1.235M'],
    [1e9, '1B'],
    [2.5e9, '2.5B'],
    [1e12, '1T'],
    [1.2345e15, '1235T'],
    [-1234, '-1,234'],
    [-123456, '-123.5k'],
    [-0.5, '-0.5'],
    [0.1 + 0.2, '0.3'],
    [3.14159, '3.142'],
    [12.3456, '12.35'],
    [1234.56, '1,235'],
    [9999.7, '10k'],
    [0.0012346, '0.001235'],
    [0.00001234, '0.00001234'],
    ['42.5', '42.5'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    ['abc', 'abc'],
];

const failures = [];
for (const [input, expected] of cases) {
    const got = formatNumber(input);
    if (got !== expected) failures.push(`formatNumber(${String(input)}) = ${got}, expected ${expected}`);
}

const optionCases = [
    [() => formatNumber(1234, { thousandsSeparator: ' ' }), '1 234'],
    [() => formatNumber(1234, { thousandsSeparator: '' }), '1234'],
    [() => formatPercent(1.79), '1.79%'],
    [() => formatPercent(1.79, { iso: true }), '1.79 %'],
    [() => formatNumber(1234, { iso: true }), '1 234'],
    [() => /[ ]/.test(formatPercent(1234.5, { iso: true }) + formatNumber(9999, { iso: true })), false], // no breakable space in ISO output
    [() => formatPercent(1234.5, { iso: true }), '1 235 %'],
    [() => formatNumber(123456, { iso: true }), '123.5 k'],
    [() => formatPercent(12.34567), '12.35%'],
    [() => formatPercent(100), '100%'],
    [() => formatPercent(0), '0%'],
    [() => exactNumber(1234567.891), '1,234,567.891'],
    [() => numberHtml(123456, 's'), '<span data-num="123456" data-unit="s" title="123,456s">123.5ks</span>'],
    [() => percentHtml(12.5), '<span data-pct="12.5" title="12.5%">12.5%</span>'],
    // Units: ISO puts a no-break space between number and unit, like before "%"; off they stay attached.
    [() => formatUnit(2.878, 's'), '2.878s'],
    [() => formatUnit(2.878, 's', { iso: true }), '2.878 s'],
    [() => formatUnit(1.5, 'h', { iso: true }), '1.5 h'],
    [() => formatUnit(123456, 's', { iso: true }), '123.5 ks'],
    [() => formatUnit(7, '', { iso: true }), '7'],
    [() => formatNumber(301600, { iso: true }), '301.6 k'],
    [() => formatNumber(1031000, { iso: true }), '1.031 M'],
    [() => formatNumber(1.2e9, { iso: true }), '1.2 B'],
    [() => formatNumber(-1.2e12, { iso: true }), '-1.2 T'],
    [() => formatNumber(1031000), '1.031M'],
    [() => formatUnit(1.2e6, 's', { iso: true }), '1.2 Ms'],
    [() => formatUnit(1.2e9, 's', { iso: true }), '1.2 Bs'],
    [() => formatUnit(123456, 's'), '123.5ks'],
    [() => formatPercent(123456, { iso: true }), '123.5 k%'],
    [() => percentSign(), '%'],
    [() => percentSign({ iso: true }), ' %'],
    // Hover (exact value) follows the mode: off as before, ISO grouped with no-break spaces and a no-break space before the unit.
    [() => exactNumber(1234567.891, { iso: true }), '1 234 567.891'],
    [() => exactUnit(2.87769784172662, 's'), '2.87769784172662s'],
    [() => exactUnit(2.87769784172662, 's', { iso: true }), '2.87769784172662 s'],
    [() => exactUnit(1234.5, 'h', { iso: true }), '1 234.5 h'],
];
for (const [fn, expected] of optionCases) {
    const got = fn();
    if (got !== expected) failures.push(`${fn.toString()} = ${got}, expected ${expected}`);
}

// The all-zones table: highlight, labyrinth check and sort read the stored exact value, not "12.3k" / "1 234" text.
// Formatting is the same in every language (en, pt, zh), so the ISO switch is the only axis.
for (const iso of [false, true]) {
    setNumberFormatSettings({ iso });
    const cells = [950, 12300, 1234, 29.5, 1500000].map((v) => { const c = { dataset: {} }; setNumberText(c, v); c.dataset.sortValue = v; return c; });
    const values = cells.map(cellValue);
    const best = values.indexOf(Math.max(...values));
    if (best !== 4) failures.push(`iso=${iso}: highlight picks ${cells[best].textContent}, expected the 1.5M cell`);
    if (cellValue(cells[3]) >= 30 || cellValue(cells[0]) < 30) failures.push(`iso=${iso}: labyrinth >= 30 check`);
    const sorted = [...cells].sort((a, b) => cellValue(b) - cellValue(a)).map((c) => Number(c.dataset.num));
    if (sorted.join() !== '1500000,12300,1234,950,29.5') failures.push(`iso=${iso}: sort ${sorted.join()}`);
    if (!/k|M| /.test(cells.map((c) => c.textContent).join(''))) failures.push(`iso=${iso}: the check did not exercise formatted text`);
}
setNumberFormatSettings({ iso: false });
// A cell with no exact value is a bug in how it was built: cellValue fails loudly and never reads the text.
for (const bad of [{ dataset: {}, textContent: '1,234' }, { dataset: {}, textContent: '1 234' }, { dataset: { sortValue: '' }, textContent: '5' }, { textContent: '7' }]) {
    let threw = false;
    try { cellValue(bad); } catch (e) { threw = /no exact value/.test(e.message); }
    if (!threw) failures.push(`cellValue did not throw for a cell with no exact value (text "${bad.textContent}")`);
}
if (cellValue({ dataset: { sortValue: '0' } }) !== 0 || cellValue({ dataset: { num: '1234.5678' } }) !== 1234.5678) failures.push('cellValue exact values');

// The table code in src/main.js reads no display text as data: sortTable goes through cellValue, the tier cell carries its exact value,
// and the price table keeps its amounts and totals in data-amount / data-total.
const mainSource = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const sortBody = mainSource.slice(mainSource.indexOf('function sortTable('), mainSource.indexOf('function updateSortIndicators('));
if (/textContent|innerText/.test(sortBody)) failures.push('sortTable reads display text');
if (!/cellValue\(rowA/.test(sortBody)) failures.push('sortTable does not use cellValue');
const simsBody = mainSource.slice(mainSource.indexOf('function updateAllSimsModal('), mainSource.indexOf('let currentSortColumn'));
if (!/typeof item\[key\] === 'number'\) cell\.dataset\.sortValue/.test(simsBody)) failures.push('the DifficultyTier cell has no sortValue');
if (/cell\.textContent\.(startsWith|includes)/.test(simsBody)) failures.push('updateAllSimsModal reads cell text as data');
const tableBody = mainSource.slice(mainSource.indexOf('function updateTable('), mainSource.indexOf('// #endregion', mainSource.indexOf('function updateTable(')));
if (/(amountTd|totalTd)\.innerText/.test(tableBody.replace(/totalTd\.innerText = newTotal;/, ''))) failures.push('updateTable reads cell text as data');

const total = cases.length + optionCases.length;
if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`FAIL ${failures.length}/${total}`);
    process.exit(1);
}
console.log(`PASS ${total}/${total}`);
