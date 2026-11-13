// When a what-if figure is drawn. A figure (the party gain or the buyer's gain of a candidate) rests on a number of runs (seeds); with fewer than
// FIGURE_MIN_SEEDS its range is too wide to mean anything, so the window draws no figure and no ± for it, and the search's rounds table keeps the
// rows in the order the candidates were built until some row of the pool has that many. Shared by the window (panel.mjs) and the search core
// (tools/whatif/core.mjs), so the two read the same rule from one place. Display only: no choice of the search reads either.
export const FIGURE_MIN_SEEDS = 4;

// The runs a rounds-table row's figure rests on: the first look's rows (status 'first') rest on the search's own seeds, any other row on its fresh
// reading seeds; a row with no reading has none.
export const figureSeeds = (row) => (row.tooFew ? 0 : row.status === 'first' ? row.seeds : row.readingSeeds);

// True when the row's figure has enough runs to be drawn (a row with an unknown count, from an older result, counts as drawn).
export const hasFigure = (row) => { const n = figureSeeds(row); return !(Number.isFinite(n) && n < FIGURE_MIN_SEEDS); };
