// Display formatting for numbers shown in the simulator UI. Display only: stored data, exports, URLs and the
// import/export formats keep full precision and never go through this module.
//
// Rules: at most 4 significant figures (trailing zeros dropped). From 10000 up, suffixes k, M, B, T (123.5k, 1.235M).
// Below 10000, whole numbers show in full with a thousands separator (1,234); decimals show at 4 significant figures.
// Percentages take the same rules plus a percent sign. ISO mode (the page's ISO toggle) separates the percent sign
// ("1.79 %") and groups thousands with a space ("1 234"); off, it is "1.79%" and "1,234". The ISO gaps are
// no-break spaces (U+00A0), so "100 %" never wraps onto two lines in a narrow column.

const SUFFIXES = [
    { base: 1e12, suffix: "T" },
    { base: 1e9, suffix: "B" },
    { base: 1e6, suffix: "M" },
    { base: 1e3, suffix: "k" },
];

const SIG_FIGS = 4;
const SUFFIX_FROM = 10000;

// Page-wide settings, set from the UI (the ISO toggle). Pure calls can pass their own options instead:
// { iso } overrides the toggle, { thousandsSeparator } overrides the separator the mode implies.
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

function roundSig(abs) {
    return Number(abs.toPrecision(SIG_FIGS));
}

function withSuffix(abs) {
    for (let i = 0; i < SUFFIXES.length; i++) {
        const { base, suffix } = SUFFIXES[i];
        if (abs < base) continue;
        const scaled = roundSig(abs / base);
        // Rounding can carry into the next suffix (999950 -> 1000k -> 1M).
        if (scaled >= 1000 && i > 0) {
            return String(roundSig(abs / SUFFIXES[i - 1].base)) + SUFFIXES[i - 1].suffix;
        }
        return String(scaled) + suffix;
    }
    return String(roundSig(abs));
}

// The display text of a number. Non-numbers and non-finite values pass through as text.
// ISO mode spaces the magnitude letter like a unit ("301.6 k", "1.031 M", "1.2 B"; no-break space). B and T stay the
// game's letters rather than SI G and T.
export function formatNumber(value, options = {}) {
    const text = formatNumberAttached(value, options);
    return isIso(options) ? text.replace(/(\d)([kMBT])$/, "$1 $2") : text;
}

function formatNumberAttached(value, options) {
    const separator = options.thousandsSeparator ?? (isIso(options) ? " " : ",");
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return String(value);
    if (number === 0) return "0";

    const sign = number < 0 ? "-" : "";
    const abs = Math.abs(number);

    if (abs >= SUFFIX_FROM) return sign + withSuffix(abs);
    if (Number.isInteger(abs)) return sign + groupThousands(String(abs), separator);

    const rounded = roundSig(abs);
    if (rounded >= SUFFIX_FROM) return sign + withSuffix(rounded);
    if (rounded === 0) return "0";
    if (rounded >= 1000) return sign + groupThousands(String(rounded), separator);
    return sign + String(rounded);
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
export function numberHtml(value, unit = "") {
    return '<span data-num="' + escapeAttribute(String(value)) + '" data-unit="' + escapeAttribute(unit) + '" title="' +
        escapeAttribute(exactUnit(value, unit)) + '">' + formatUnit(value, unit) + "</span>";
}

// A percentage with exactly two decimals ("94.10%"), for rows that must line up; the raw value rides along (data-pct2).
export function percentFixedHtml(value) {
    return '<span data-pct2="' + escapeAttribute(String(value)) + '" title="' + escapeAttribute(exactNumber(value) + percentSign()) + '">' +
        Number(value).toFixed(2) + percentSign() + "</span>";
}

export function percentHtml(value) {
    return '<span data-pct="' + escapeAttribute(String(value)) + '" title="' + escapeAttribute(exactNumber(value) + percentSign()) + '">' +
        formatPercent(value) + "</span>";
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

// Re-formats every number this module rendered under `root`, after the settings change.
export function refreshFormattedNumbers(root) {
    root.querySelectorAll("[data-num]").forEach((element) => {
        element.textContent = formatUnit(element.dataset.num, element.dataset.unit ?? "");
        element.title = exactUnit(element.dataset.num, element.dataset.unit ?? "");
    });
    root.querySelectorAll("[data-pct2]").forEach((element) => {
        element.textContent = Number(element.dataset.pct2).toFixed(2) + percentSign();
        element.title = exactNumber(element.dataset.pct2) + percentSign();
    });
    root.querySelectorAll("[data-pct]").forEach((element) => {
        element.textContent = formatPercent(element.dataset.pct);
        element.title = exactNumber(element.dataset.pct) + percentSign();
    });
}
