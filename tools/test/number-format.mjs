// Test: the simulator's display number formatter (src/numberFormat.js).
// Usage: node tools/test/number-format.mjs        Exit code 0 on pass, 1 on fail.
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register(pathToFileURL(path.join(root, 'tools/calibration/hooks.mjs')).href);
const { cellValue, setNumberText, setNumberFormatSettings, formatNumber, formatUnit, percentSign, exactUnit, formatPercent, exactNumber, numberHtml, percentHtml, refreshFormattedNumbers, alignNumberColumns } = await import(pathToFileURL(path.join(root, 'src/numberFormat.js')).href);

const cases = [
    [0, '0'],
    [1, '1'],
    [10, '10'],
    [100, '100'],
    [999, '999'],
    [1000, '1,000'],
    [1234, '1,234'],
    [9999, '9,999'],
    [10000, '10k'],
    [12345, '12k'],
    [99999, '100k'],
    [100000, '100k'],
    [111111, '111k'],
    [123456, '123k'],
    [999999, '1,000k'],
    [999499, '999k'],
    [1e6, '1,000k'],
    [1111111, '1,111k'],
    [1234567, '1,235k'],
    [9999499, '9,999k'],
    [9999500, '10M'],
    [11111111, '11M'],
    [99999500, '100M'],
    [1e9, '1,000M'],
    [2.5e9, '2,500M'],
    [1e12, '1,000B'],
    [11e12, '11T'],
    [1.2345e15, '1,235T'],
    [-1234, '-1,234'],
    [-123456, '-123k'],
    [-0.5, '-0.5'],
    [0.1 + 0.2, '0.3'],
    [5.3, '5.3'],
    [0.42, '0.42'],
    [0.042, '0.042'],
    [5.04, '5'],
    [9.96, '10'],
    [3.14159, '3.1'],
    [12.3456, '12'],
    [1234.56, '1,235'],
    [9999.7, '10k'],
    [0.0012346, '0.0012'],
    [0.00001234, '0.000012'],
    ['42.5', '43'],
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
    [() => formatPercent(1.79), '1.8%'],
    [() => formatPercent(1.79, { iso: true }), '1.8 %'],
    [() => formatNumber(1234, { iso: true }), '1 234'],
    [() => /[ ]/.test(formatPercent(1234.5, { iso: true }) + formatNumber(9999, { iso: true })), false], // no breakable space in ISO output
    [() => formatPercent(1234.5, { iso: true }), '1 235 %'],
    [() => formatNumber(123456, { iso: true }), '123 k'],
    [() => formatPercent(12.34567), '12%'],
    [() => formatPercent(100), '100%'],
    [() => formatPercent(0), '0%'],
    [() => exactNumber(1234567.891), '1,234,567.891'],
    [() => numberHtml(123456, 's'), '<span data-num="123456" data-unit="s" title="123,456s">123ks</span>'],
    [() => percentHtml(12.5), '<span data-pct="12.5" data-min="1" title="12.5%">13%</span>'],
    // Units: ISO puts a no-break space between number and unit, like before "%"; off they stay attached.
    [() => formatUnit(2.878, 's'), '2.9s'],
    [() => formatUnit(2.878, 's', { iso: true }), '2.9 s'],
    [() => formatUnit(1.5, 'h', { iso: true }), '1.5 h'],
    [() => formatUnit(123456, 's', { iso: true }), '123 ks'],
    [() => formatUnit(7, '', { iso: true }), '7'],
    [() => formatNumber(301600, { iso: true }), '302 k'],
    [() => formatNumber(1031000, { iso: true }), '1 031 k'],
    [() => formatNumber(1.2e9, { iso: true }), '1 200 M'],
    [() => formatNumber(-1.2e12, { iso: true }), '-1 200 B'],
    [() => formatNumber(1031000), '1,031k'],
    [() => formatUnit(1.2e6, 's', { iso: true }), '1 200 ks'],
    [() => formatUnit(1.2e9, 's', { iso: true }), '1 200 Ms'],
    [() => formatUnit(123456, 's'), '123ks'],
    [() => formatPercent(123456, { iso: true }), '123 k%'],
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
if (/(amountTd|totalTd)\.innerText/.test(tableBody)) failures.push('updateTable reads cell text as data');

// The price tables' Amount and Total cells: shown through numberHtml (whole numbers, k/M/B/T from 10000, exact value on hover,
// the ISO toggle re-formats them), with the exact values kept in data-amount / data-total. The Price cell stays raw (it is typed into).
setNumberFormatSettings({ iso: false });
const priceCases = [[1875400.20696, '1,875k', '1,875,400.20696'], [7.6154702400000005, '7.6', '7.61547024'], [230674225.45608002, '231M', '230,674,225.45608']];
for (const [value, text, exact] of priceCases) {
    const html = numberHtml(value);
    if (!html.includes('>' + text + '<')) failures.push(`price table cell ${value}: expected display ${text}, got ${html}`);
    if (!html.includes('title="' + exact + '"')) failures.push(`price table cell ${value}: expected hover ${exact}, got ${html}`);
    if (!html.includes('data-num="' + value + '"')) failures.push(`price table cell ${value}: exact value not carried, got ${html}`);
}
{
    // The ISO toggle's refresh reaches a number cell written by numberHtml (a fake root with one span built from numberHtml's attributes).
    const span = { dataset: { num: '230674225.45608002', unit: '' }, textContent: '', title: '' };
    const root = { querySelectorAll: (sel) => (sel.includes('data-num') ? [span] : []) };
    setNumberFormatSettings({ iso: true });
    refreshFormattedNumbers(root);
    if (span.textContent.replaceAll(' ', ' ') !== '231 M' || span.title.replaceAll(' ', ' ') !== '230 674 225.45608') failures.push(`ISO refresh of a price table cell: ${span.textContent} / ${span.title}`);
    setNumberFormatSettings({ iso: false });
}
const rowBuilders = mainSource.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('tableRow += '));
if (rowBuilders.some((l) => /^tableRow \+= (dropAmount|amount|price \* dropAmount|price \* amount);$/.test(l))) failures.push('a price table row builder writes a raw Amount or Total');
if (rowBuilders.filter((l) => /numberHtml\(/.test(l)).length !== 6) failures.push('the three row builders do not write Amount and Total through numberHtml');
if (!/totalTd\.innerHTML = numberHtml\(newTotal\)/.test(tableBody) || !/totalTd\.dataset\.total = newTotal/.test(tableBody)) failures.push('updateTable does not write the total through numberHtml and keep data-total');


// The column pass (alignNumberColumns) on a small fake DOM: tables (tr/td) and bootstrap grids (div.row > div).
{
    class El {
        constructor(tagName, className = '') { this.tagName = tagName; this.className = className; this.children = []; this.parentElement = null; this.dataset = {}; this.textContent = ''; this.title = ''; }
        add(child) { child.parentElement = this; this.children.push(child); return child; }
        querySelectorAll(sel) {
            const out = [];
            const walk = (e) => { for (const c of e.children) { if ((c.dataset.num !== undefined || c.dataset.pct !== undefined) && sel.includes('data-num')) out.push(c); walk(c); } };
            walk(this);
            return out;
        }
    }
    const spanFor = (html) => { // build a span from numberHtml / percentHtml output
        const e = new El('SPAN');
        for (const m of html.matchAll(/data-(num|unit|pct|min)="([^"]*)"/g)) e.dataset[m[1]] = m[2];
        e.textContent = html.replace(/<[^>]*>/g, '');
        return e;
    };
    const grid = (container, ...htmls) => { const row = container.add(new El('DIV', 'row')); return htmls.map((h) => row.add(new El('DIV', 'col-md-4')).add(spanFor(h))); };
    const texts = (spans) => spans.map((e) => e.textContent);
    setNumberFormatSettings({ iso: false });

    // A column of [2.4, 130, 7]: one decimal for all (trailing zeros kept), whole numbers outside a table stay whole.
    const table = new El('TABLE'); const body = table.add(new El('TBODY'));
    const cellsOf = (values, mk = numberHtml, col = 0) => values.map((v) => { const tr = body.add(new El('TR')); for (let i = 0; i < col; i++) tr.add(new El('TD')); return tr.add(new El('TD')).add(spanFor(mk(v))); });
    const col1 = cellsOf([2.4, 130, 7]);
    alignNumberColumns(table);
    if (texts(col1).join() !== '2.4,130.0,7.0') failures.push(`column [2.4,130,7]: ${texts(col1)}`);
    if (spanFor(numberHtml(130)).textContent !== '130') failures.push('a number outside a table stays whole');

    // A whole column stays whole; the cap is 3 decimals; a percent column has at least 1 decimal.
    const t2 = new El('TABLE'); const b2 = t2.add(new El('TBODY'));
    const addCol = (values, mk) => values.map((v) => spanFor(mk(v))).map((sp) => { b2.add(new El('TR')).add(new El('TD')).add(sp); return sp; });
    const wholeCol = addCol([5, 12, 1234], numberHtml);
    alignNumberColumns(t2);
    if (texts(wholeCol).join() !== '5,12,1,234') failures.push(`whole column: ${texts(wholeCol)}`);
    const t3 = new El('TABLE'); const b3 = t3.add(new El('TBODY'));
    const put = (b, v, mk) => { const sp = spanFor(mk(v)); b.add(new El('TR')).add(new El('TD')).add(sp); return sp; };
    const capCol = [0.00123, 1500, 3].map((v) => put(b3, v, numberHtml));
    alignNumberColumns(t3);
    if (texts(capCol).join() !== '0.001,1,500.000,3.000') failures.push(`cap at 3 decimals: ${texts(capCol)}`);
    const t4 = new El('TABLE'); const b4 = t4.add(new El('TBODY'));
    const pctCol = [12.4, 5, 100].map((v) => put(b4, v, percentHtml));
    alignNumberColumns(t4);
    if (texts(pctCol).join() !== '12.4%,5.0%,100.0%') failures.push(`percent column: ${texts(pctCol)}`);
    setNumberFormatSettings({ iso: true });
    alignNumberColumns(t4);
    if (texts(pctCol).join().replaceAll('\u00a0', ' ') !== '12.4 %,5.0 %,100.0 %') failures.push(`percent column in ISO: ${texts(pctCol)}`);
    refreshFormattedNumbers(t4);
    if (texts(pctCol).join().replaceAll('\u00a0', ' ') !== '12.4 %,5.0 %,100.0 %') failures.push(`percent column after the ISO refresh: ${texts(pctCol)}`);
    setNumberFormatSettings({ iso: false });
    refreshFormattedNumbers(t4);
    if (texts(pctCol).join() !== '12.4%,5.0%,100.0%') failures.push(`percent column after the refresh, ISO off: ${texts(pctCol)}`);

    // Grid rows (div.row > div): one parent, the same cell position. Kinds are separate groups, so one list holds whole numbers, a percent group and an interval group.
    const list = new El('DIV');
    const plain = [grid(list, numberHtml(120))[0], grid(list, numberHtml(2.4))[0]];
    const pcts = [grid(list, percentHtml(12.4))[0], grid(list, percentHtml(5))[0]];
    const interval = [grid(list, numberHtml(2.878, 's', { minDecimals: 2 }))[0]];
    const hours = [grid(list, numberHtml(1.5, 'h'))[0], grid(list, numberHtml(20, 'h'))[0]];
    alignNumberColumns(list);
    if (texts(plain).join() !== '120.0,2.4') failures.push(`grid plain group: ${texts(plain)}`);
    if (texts(pcts).join() !== '12.4%,5.0%') failures.push(`grid percent group: ${texts(pcts)}`);
    if (texts(interval).join() !== '2.88s') failures.push(`grid interval group: ${texts(interval)}`);
    if (texts(hours).join() !== '1.5h,20.0h') failures.push(`grid hours group: ${texts(hours)}`);
    // Whole values with no fraction anywhere stay whole in a list (the Combat Stats panel's levels and ratings).
    const stats = new El('DIV');
    const levels = [120, 85, 1234].map((v) => grid(stats, numberHtml(v))[0]);
    alignNumberColumns(stats);
    if (texts(levels).join() !== '120,85,1,234') failures.push(`whole stats stay whole: ${texts(levels)}`);
    // Other columns / other containers do not share decimals.
    const two = new El('DIV'); const [a1, b1] = grid(two, numberHtml(1.5), numberHtml(7)); const [a2, b2c] = grid(two, numberHtml(8), numberHtml(9));
    alignNumberColumns(two);
    if ([a1, b1, a2, b2c].map((e) => e.textContent).join() !== '1.5,7,8.0,9') failures.push(`columns are separate: ${[a1, b1, a2, b2c].map((e) => e.textContent)}`);
    // Suffixed cells take the column's decimals on the mantissa.
    const t5 = new El('TABLE'); const b5 = t5.add(new El('TBODY'));
    const sfx = [12345, 2.4].map((v) => put(b5, v, numberHtml));
    alignNumberColumns(t5);
    if (texts(sfx).join() !== '12.3k,2.4') failures.push(`suffixed cell in a decimals column: ${texts(sfx)}`);
}

// The `scale` option (a margin written in a fixed unit, rounded up) and a span carrying it (data-scale, data-dec).
const scaleCases = [
    [[2293000, { scale: 1e3, up: true }], '2,293k'], [[7500, { scale: 1e3, up: true }], '8k'], [[7001, { scale: 1e3, up: true }], '8k'], [[7000, { scale: 1e3, up: true }], '7k'],
    [[300, { scale: 1e3, up: true }], '1k'], [[0, { scale: 1e3, up: true }], '0k'], [[450000, { scale: 1e6, up: true }], '1M'], [[450000000, { scale: 1e9, up: true }], '1B'],
    [[337412, { scale: 1e3, up: true }], '338k'], [[-7500, { scale: 1e3, up: true }], '-8k'], [[120, { scale: 1, up: true }], '120'], [[0.12, { scale: 1, up: true, decimals: 1 }], '0.2'],
    [[0.1, { scale: 1, up: true, decimals: 1 }], '0.1'], [[8200, { scale: 1e3 }], '8k'], [[7500, { scale: 1e3 }], '8k'], [[7400, { scale: 1e3 }], '7k'], [[1234, { scale: 1, up: true }], '1,234'],
    [[1234, { scale: 1e3, up: true, decimals: 1 }], '1.3k'], [[5400000000, { scale: 1e6, up: true }], '5,400M'],
];
for (const [[value, options], expected] of scaleCases) {
    const got = formatNumber(value, { iso: false, ...options });
    if (got !== expected) failures.push(`scale ${value} ${JSON.stringify(options)}: expected ${expected}, got ${got}`);
}
{
    const span = (value, scale, decimals) => { const html = numberHtml(value, '', { scale, decimals }); const e = { dataset: {}, textContent: html.replace(/<[^>]*>/g, ''), title: '' }; for (const m of html.matchAll(/data-(num|unit|scale|dec)="([^"]*)"/g)) e.dataset[m[1]] = m[2]; e.title = html.match(/title="([^"]*)"/)[1]; return e; };
    const e = span(7500, 1e3, 0), small = span(0.12, 1, 1);
    const root = { querySelectorAll: (sel) => (sel.includes('data-num') ? [e, small] : []) };
    if (e.textContent !== '8k' || e.title !== '7,500' || e.dataset.scale !== '1000') failures.push(`scaled span: ${JSON.stringify(e)}`);
    setNumberFormatSettings({ iso: true });
    refreshFormattedNumbers(root);
    if (e.textContent.replaceAll(' ', ' ') !== '8 k' || small.textContent !== '0.2') failures.push(`scaled span after the ISO refresh keeps its unit and its round-up: ${e.textContent} / ${small.textContent}`);
    setNumberFormatSettings({ iso: false });
    refreshFormattedNumbers(root);
    if (e.textContent !== '8k' || e.title !== '7,500' || small.textContent !== '0.2') failures.push(`scaled span after the refresh, ISO off: ${e.textContent} / ${e.title} / ${small.textContent}`);
    alignNumberColumns(root);
    if (small.textContent !== '0.2' || e.textContent !== '8k') failures.push(`the column pass leaves a scaled span alone: ${e.textContent} / ${small.textContent}`);
}

const total = cases.length + optionCases.length + scaleCases.length + 3;
if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`FAIL ${failures.length}/${total}`);
    process.exit(1);
}
console.log(`PASS ${total}/${total}`);
