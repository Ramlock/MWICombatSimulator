// Display formatting for numbers shown in the simulator UI. Display only: stored data, exports, URLs and the
// import/export formats keep full precision and never go through this module.
//
// Rules: whole numbers with at least 2 significant figures. The largest suffix (k, M, B, T) whose whole-number mantissa
// still has 2 or more digits is used, and a mantissa up to 9999 is allowed: 9,999 stays, 10,000 is 10k, 111,111 is 111k,
// 1,111,111 is 1,111k, 11,111,111 is 11M. Below 10 a value that is not whole shows the fewest decimals that give it 2
// significant figures (5.3, 0.42, 0.042). Values of 10 and up are whole.
// A column of numbers shares one number of decimals (alignNumberColumns), so the points line up; `decimals` renders a value
// with exactly that many. Percentages take the same rules plus a percent sign. ISO mode (the page's ISO toggle) separates the
// percent sign ("1.79 %") and groups thousands with a space ("1 234"); off, it is "1.79%" and "1,234". The ISO gaps are
// no-break spaces (U+00A0), so "100 %" never wraps onto two lines in a narrow column.

const SUFFIXES = [
    { base: 1e3, suffix: "k" },
    { base: 1e6, suffix: "M" },
    { base: 1e9, suffix: "B" },
    { base: 1e12, suffix: "T" },
];

const MAX_WHOLE_MANTISSA = 9999;
const MIN_SIG_FIGS = 2;
export const MAX_COLUMN_DECIMALS = 3;
const PERCENT_MIN_DECIMALS = 1;

// Page-wide settings, set from the UI (the ISO toggle). Pure calls can pass their own options instead:
// { iso } overrides the toggle, { thousandsSeparator } overrides the separator the mode implies,
// { decimals } fixes the decimals of the (mantissa of the) text.
export const numberFormatSettings = {
    iso: false,
};

function isIso(options) {
    return options.iso ?? numberFormatSettings.iso;
}

export function setNumberFormatSettings(settings) {
    Object.assign(numberFormatSettings, settings);
}

function groupThousands(integerText, separator) {
    return integerText.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

// The suffix a magnitude is written with: none while it rounds to at most 9999, else the smallest suffix whose rounded
// mantissa is at most 9999 (the last, T, takes anything).
function pickScale(abs) {
    if (Math.round(abs) <= MAX_WHOLE_MANTISSA) return { base: 1, suffix: "" };
    for (let i = 0; i < SUFFIXES.length; i++) {
        const { base, suffix } = SUFFIXES[i];
        if (i === SUFFIXES.length - 1 || Math.round(abs / base) <= MAX_WHOLE_MANTISSA) return { base, suffix };
    }
}

// Decimals a magnitude needs on its own: none from 10 up (and for whole numbers), else the fewest that give 2 significant figures.
function ownDecimals(abs) {
    if (abs === 0 || abs >= 10 || Number.isInteger(abs) || pickScale(abs).base !== 1) return 0;
    const rounded = Number(abs.toPrecision(MIN_SIG_FIGS));
    if (rounded >= 10) return 0;
    const places = Math.max(0, MIN_SIG_FIGS - 1 - Math.floor(Math.log10(rounded)));
    const text = rounded.toFixed(places);
    return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "").split(".")[1]?.length ?? 0 : 0;
}

// The decimals a value asks of its column: its own, at least `minDecimals`, at most MAX_COLUMN_DECIMALS.
export function decimalsNeeded(value, minDecimals = 0) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return 0;
    return Math.min(MAX_COLUMN_DECIMALS, Math.max(ownDecimals(Math.abs(number)), minDecimals));
}

function mantissaText(abs, decimals, separator) {
    const fixed = abs.toFixed(decimals);
    const [integerText, fraction] = fixed.split(".");
    return groupThousands(integerText, separator) + (fraction === undefined ? "" : "." + fraction);
}

// The display text of a number. Non-numbers and non-finite values pass through as text.
// ISO mode spaces the magnitude letter like a unit ("301 k", "1 031 k", "12 B"; no-break space). B and T stay the
// game's letters rather than SI G and T.
export function formatNumber(value, options = {}) {
    const text = formatNumberAttached(value, options);
    return isIso(options) ? text.replace(/(\d)([kMBT])$/, "$1 $2") : text;
}

// The unit another number is written in to match this one as displayed: { base, decimals } (the suffix's base, 1 for none, and the
// decimals the value shows on its own). Used with the `scale` option.
export function unitOf(value) {
    const abs = Math.abs(Number(value));
    return { base: pickScale(abs).base, decimals: ownDecimals(abs) };
}

// `scale` option: write the number in a given unit (base 1, 1e3, 1e6, 1e9, 1e12) with `decimals` decimals (default 0), rounded UP when
// `up` is set (a margin is never written smaller than it is), else to nearest. A whole unit stays (7000 in k is 7k).
function scaledText(number, abs, options, separator) {
    const { suffix } = SUFFIXES.find((s) => s.base === options.scale) ?? { suffix: "" };
    const decimals = options.decimals ?? 0;
    const scaled = abs / options.scale;
    const factor = 10 ** decimals;
    const mantissa = (options.up ? Math.ceil(Math.round(scaled * factor * 1e6) / 1e6) : Math.round(scaled * factor)) / factor;
    return (number < 0 && mantissa !== 0 ? "-" : "") + mantissaText(mantissa, decimals, separator) + suffix;
}

function formatNumberAttached(value, options) {
    const separator = options.thousandsSeparator ?? (isIso(options) ? " " : ",");
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return String(value);

    const abs = Math.abs(number);
    if (options.scale !== undefined) return scaledText(number, abs, options, separator);
    const { base, suffix } = pickScale(abs);
    const decimals = options.decimals ?? ownDecimals(abs);
    let shown;
    if (base === 1 && options.decimals === undefined && decimals > 0) {
        // Under 10 with a fraction: 2 significant figures, trailing zeros dropped (5.04 is 5).
        shown = mantissaText(Number(abs.toPrecision(MIN_SIG_FIGS)), decimals, separator);
    } else {
        shown = mantissaText(abs / base, decimals, separator);
    }
    const isZero = Number(shown.replaceAll(separator, "")) === 0;
    return (number < 0 && !isZero ? "-" : "") + shown + suffix;
}

// The inverse of formatNumber, for text a person types. Spaces (plain, no-break U+00A0, narrow no-break U+202F) and commas are thousands
// separators, dropped between digits; a period is the decimal point (the page never writes one as a thousands separator); a suffix
// k, M, B, T (also k K m b t, with or without a space before it) multiplies. Leading and trailing spaces are ignored.
// Returns the number (exact, not rounded), null for empty text (no value) and NaN for anything else (two suffixes, letters, two periods, a
// minus sign): never a silent 0.
const PARSE_SEPARATORS = " ,  ";
const PARSE_PATTERN = new RegExp("^(\\d+(?:[" + PARSE_SEPARATORS + "]\\d+)*)?(\\.\\d*)?[ \\u00a0\\u202f]*([kKmMbBtT])?$");
const PARSE_BASES = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
export function parseNumber(text) {
    const trimmed = String(text ?? "").replace(/^[   \t]+|[   \t]+$/g, "");
    if (trimmed === "") return null;
    const match = PARSE_PATTERN.exec(trimmed);
    if (!match) return NaN;
    const [, whole = "", fraction = "", suffix] = match;
    if (whole === "" && fraction.length < 2) return NaN;
    const mantissa = Number((whole.replace(/[ ,  ]/g, "") || "0") + (fraction.length > 1 ? fraction : ""));
    return Number((mantissa * (suffix ? PARSE_BASES[suffix.toLowerCase()] : 1)).toPrecision(15));
}

// A value already in percent units (12.5 for 12.5%).
export function formatPercent(value, options = {}) {
    const text = formatNumber(value, options);
    return / [kMBT]$/.test(text) ? text + "%" : text + percentSign(options);
}

// The percent sign as the mode writes it: "%" off, a no-break space and "%" in ISO mode.
export function percentSign(options = {}) {
    return isIso(options) ? " %" : "%";
}

// A number followed by a unit ("2.878s"): ISO mode puts a no-break space between them ("2.878 s"), as it does before "%".
export function formatUnit(value, unit = "", options = {}) {
    const text = formatNumber(value, options);
    if (!unit) return text;
    if (!isIso(options)) return text + unit;
    // ISO: a magnitude letter joins the unit as its prefix ("123.5 ks", "1.2 Ms"); otherwise a no-break space ("2.878 s").
    return / [kMBT]$/.test(text) ? text + unit : text + " " + unit;
}

// The exact value, for the hover title. It follows the mode like the display text: off "1,234,567.891",
// ISO "1 234 567.891" (no-break spaces).
export function exactNumber(value, options = {}) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return String(value);
    const text = number.toLocaleString("en-US", { maximumSignificantDigits: 15 });
    return isIso(options) ? text.replace(/,/g, " ") : text;
}

// The exact value with its unit, spaced like formatUnit: off "2.87769784172662s", ISO "2.87769784172662 s".
export function exactUnit(value, unit = "", options = {}) {
    if (!unit) return exactNumber(value, options);
    return exactNumber(value, options) + (isIso(options) ? " " : "") + unit;
}

function escapeAttribute(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// HTML for innerHTML sites: the display text with the exact value on hover. `unit` is appended to both.
// The raw value rides along (data-num / data-pct) so refreshFormattedNumbers can re-format after a toggle.
// `minDecimals` (data-min) is the least decimals the column pass gives this kind of number (attack interval: 2).
// `scale` (+ `decimals`) writes it in a fixed unit rounded up (data-scale, data-dec; see scaledText): a margin beside a value, the column pass leaves it be.
export function numberHtml(value, unit = "", options = {}) {
    const scaleAttributes = options.scale === undefined ? "" : ' data-scale="' + options.scale + '" data-dec="' + (options.decimals ?? 0) + '"';
    return '<span data-num="' + escapeAttribute(String(value)) + '" data-unit="' + escapeAttribute(unit) + '"' + minAttribute(options.minDecimals) + scaleAttributes +
        ' title="' + escapeAttribute(exactUnit(value, unit)) + '">' + formatUnit(value, unit, options.scale === undefined ? {} : { scale: options.scale, up: true, decimals: options.decimals ?? 0 }) + "</span>";
}

function minAttribute(minDecimals) {
    return minDecimals > 0 ? ' data-min="' + minDecimals + '"' : "";
}

// A percentage with exactly two decimals ("94.10%"), for rows that must line up; the raw value rides along (data-pct2).
export function percentFixedHtml(value) {
    return '<span data-pct2="' + escapeAttribute(String(value)) + '" title="' + escapeAttribute(exactNumber(value) + percentSign()) + '">' +
        Number(value).toFixed(2) + percentSign() + "</span>";
}

// A percentage column shows at least one decimal (the column pass honours `minDecimals`, default 1).
export function percentHtml(value, options = {}) {
    return '<span data-pct="' + escapeAttribute(String(value)) + '"' + minAttribute(options.minDecimals ?? PERCENT_MIN_DECIMALS) +
        ' title="' + escapeAttribute(exactNumber(value) + percentSign()) + '">' + formatPercent(value) + "</span>";
}

// For textContent sites: sets the display text and the hover title on an element.
export function setNumberText(element, value, unit = "") {
    element.textContent = formatUnit(value, unit);
    element.title = exactUnit(value, unit);
    element.dataset.num = String(value);
    element.dataset.unit = unit;
}

// The number a cell holds, for comparisons and exports: the exact value this module stored (data-num, or a table's
// data-sort-value), never the display text, which can read "12.3k" or "1 234". A cell with no exact value is a bug in how it was built, so this throws rather than reading its text.
export function cellValue(cell) {
    const raw = cell.dataset?.num ?? cell.dataset?.sortValue;
    if (raw === undefined || raw === "") throw new Error("cellValue: the cell carries no exact value (data-num / data-sort-value)");
    return Number(raw);
}

const NUMBER_SELECTOR = "[data-num], [data-pct]";

function renderSpan(element, decimals) {
    // A span with a fixed unit (data-scale) keeps it, rounded up, and its own decimals: the column pass does not touch it.
    if (element.dataset.scale !== undefined) {
        element.textContent = formatUnit(element.dataset.num, element.dataset.unit ?? "", { scale: Number(element.dataset.scale), up: true, decimals: Number(element.dataset.dec ?? 0) });
        return;
    }
    const options = decimals === undefined ? {} : { decimals };
    if (element.dataset.pct !== undefined) element.textContent = formatPercent(element.dataset.pct, options);
    else element.textContent = formatUnit(element.dataset.num, element.dataset.unit ?? "", options);
}

function indexIn(parent, child) {
    return Array.prototype.indexOf.call(parent.children, child);
}

// Where a rendered number sits: the cell (a table cell, or a direct child of a `.row`), its container (the table, or the
// parent of the rows) and the cell's index in its row. A number outside both has no column.
function columnOf(element) {
    for (let cell = element; cell.parentElement; cell = cell.parentElement) {
        const parent = cell.parentElement;
        if (parent.tagName === "TR") {
            let container = parent.parentElement;
            while (container && container.tagName !== "TABLE") container = container.parentElement;
            return { cell, container: container ?? parent.parentElement, index: indexIn(parent, cell) };
        }
        if (String(parent.className ?? "").split(/\s+/).includes("row")) return { cell, container: parent.parentElement, index: indexIn(parent, cell) };
    }
    return null;
}

// Every column of numbers under `root` shares one number of decimals, so the points line up: the most any cell of the
// column needs (its own for a value under 10, the kind's minimum), at most MAX_COLUMN_DECIMALS. A column is the same
// position in the rows of one table (or of the `.row`s under one parent); plain numbers, percentages and each unit are
// groups of their own, and a second number in one cell is its own group. Run it after a table renders and after the ISO toggle.
export function alignNumberColumns(root) {
    const groups = new Map();
    const perCell = new Map();
    root.querySelectorAll(NUMBER_SELECTOR).forEach((element) => {
        if (element.dataset.scale !== undefined) return;
        const column = columnOf(element);
        if (!column) return;
        const inCell = perCell.get(column.cell) ?? 0;
        perCell.set(column.cell, inCell + 1);
        const kind = element.dataset.pct !== undefined ? "%" : "n" + (element.dataset.unit ?? "");
        const byKey = groups.get(column.container) ?? new Map();
        groups.set(column.container, byKey);
        const key = column.index + "/" + inCell + "/" + kind;
        const members = byKey.get(key) ?? [];
        byKey.set(key, members);
        members.push(element);
    });
    for (const byKey of groups.values()) {
        for (const members of byKey.values()) {
            const decimals = Math.max(...members.map((e) => decimalsNeeded(e.dataset.pct ?? e.dataset.num, Number(e.dataset.min ?? 0))));
            members.forEach((element) => renderSpan(element, decimals));
        }
    }
}

// Re-formats every number this module rendered under `root`, after the settings change, then lines the columns up.
export function refreshFormattedNumbers(root) {
    root.querySelectorAll("[data-num]").forEach((element) => {
        element.title = exactUnit(element.dataset.num, element.dataset.unit ?? "");
    });
    root.querySelectorAll("[data-pct2]").forEach((element) => {
        element.textContent = Number(element.dataset.pct2).toFixed(2) + percentSign();
        element.title = exactNumber(element.dataset.pct2) + percentSign();
    });
    root.querySelectorAll("[data-pct]").forEach((element) => {
        element.title = exactNumber(element.dataset.pct) + percentSign();
    });
    root.querySelectorAll(NUMBER_SELECTOR).forEach((element) => renderSpan(element));
    alignNumberColumns(root);
}
