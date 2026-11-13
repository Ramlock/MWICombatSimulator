// The Node side of the engine run (the run itself is engine-pure.mjs, which a bundler loads too): the loader hooks that let the engine under
// src/ load in plain Node, `root`, and the prices file. One seeded engine run of the party, with metrics read at several sim-hour
// checkpoints of the same run; the run is the one tools/calibration/run.mjs makes (same DTOs, buffs, seeding and prices).
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

register('../calibration/hooks.mjs', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');

// Imported after the hooks are registered (an import above would run first).
const pure = await import('./engine-pure.mjs');
export const { ONE_HOUR, MARKET_TAX, seedRandom, metrics, buildDtos } = pure;
export const DEFAULT_PRICES = path.join(root, 'tools', 'calibration', 'marketplace-2026-11-03.json');

// The price table of a marketplace file (engine-pure.mjs buildPrices), read once per file.
const priceCache = new Map();
export function loadPrices(file = DEFAULT_PRICES) {
    if (priceCache.has(file)) return priceCache.get(file);
    const prices = pure.buildPrices(JSON.parse(readFileSync(file, 'utf8')).marketData);
    priceCache.set(file, prices);
    return prices;
}

// opts: engine-pure.mjs runParty's, except that `prices` is a marketplace file path (default DEFAULT_PRICES) instead of the table.
export function runParty(opts) {
    return pure.runParty({ ...opts, priceTable: loadPrices(opts.prices || DEFAULT_PRICES) });
}

// opts: engine-pure.mjs measureNeed's, with `prices` a file path as above.
export function measureNeed(opts) {
    return pure.measureNeed({ ...opts, priceTable: loadPrices(opts.prices || DEFAULT_PRICES) });
}
