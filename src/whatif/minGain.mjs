// The smallest gain worth showing (the pick check's floor, tools/whatif/sure.mjs): one setting, a share of the buyer's own profit per day, in %.
// Its unit lives here (the default and the field's parse) and in the field's label (whatIf.minGainPct); the search's flag is --min-gain-pct.
export const MIN_GAIN_PCT = 0.12;
// The field's text -> the share in % (empty = the default), or null when it is not a share (not a number, below 0). A decimal comma is read as a point.
export function parseMinGain(text) {
    const s = String(text ?? '').trim().replace(',', '.');
    if (s === '') return MIN_GAIN_PCT;
    const v = Number(s);
    return Number.isFinite(v) && v >= 0 ? v : null;
}
