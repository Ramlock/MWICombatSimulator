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
export function formatNumber(value, options = {}) {
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
    return formatNumber(value, options) + percentSign(options);
}

// The percent sign as the mode writes it: "%" off, a no-break space and "%" in ISO mode.
export function percentSign(options = {}) {
    return isIso(options) ? " %" : "%";
}

// A number followed by a unit ("2.878s"): ISO mode puts a no-break space between them ("2.878 s"), as it does before "%".
// Magnitude suffixes (k, M, B, T) are part of the number and stay attached ("1.302M s").
export function formatUnit(value, unit = "", options = {}) {
    if (!unit) return formatNumber(value, options);
    return formatNumber(value, options) + (isIso(options) ? " " : "") + unit;
}

// The exact value, for the hover title.
export function exactNumber(value) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return String(value);
    return number.toLocaleString("en-US", { maximumSignificantDigits: 15 });
}

function escapeAttribute(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// HTML for innerHTML sites: the display text with the exact value on hover. `unit` is appended to both.
// The raw value rides along (data-num / data-pct) so refreshFormattedNumbers can re-format after a toggle.
export function numberHtml(value, unit = "") {
    return '<span data-num="' + escapeAttribute(String(value)) + '" data-unit="' + escapeAttribute(unit) + '" title="' +
        escapeAttribute(exactNumber(value) + unit) + '">' + formatUnit(value, unit) + "</span>";
}

export function percentHtml(value) {
    return '<span data-pct="' + escapeAttribute(String(value)) + '" title="' + escapeAttribute(exactNumber(value) + "%") + '">' +
        formatPercent(value) + "</span>";
}

// For textContent sites: sets the display text and the hover title on an element.
export function setNumberText(element, value, unit = "") {
    element.textContent = formatUnit(value, unit);
    element.title = exactNumber(value) + unit;
    element.dataset.num = String(value);
    element.dataset.unit = unit;
}

// Re-formats every number this module rendered under `root`, after the settings change.
export function refreshFormattedNumbers(root) {
    root.querySelectorAll("[data-num]").forEach((element) => {
        element.textContent = formatUnit(element.dataset.num, element.dataset.unit ?? "");
    });
    root.querySelectorAll("[data-pct]").forEach((element) => {
        element.textContent = formatPercent(element.dataset.pct);
    });
}
