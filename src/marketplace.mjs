// The game's public market snapshot (marketplace.json: { marketData, timestamp }), shared by the page's Get Prices
// button (src/main.js fetchPrices) and the What-if window (a search carries the snapshot it was started with).
// The international server first; the CN server only when that fetch throws (as Get Prices always did).
export const MARKETPLACE_URLS = ['https://www.milkywayidle.com/game_data/marketplace.json', 'https://www.milkywayidlecn.com/game_data/marketplace.json'];

// Resolves to the parsed body; throws when neither server answers with a snapshot. fetchFn is injected by the tests.
export async function fetchMarketplace(fetchFn = (...a) => fetch(...a)) {
    let response = null;
    try { response = await fetchFn(MARKETPLACE_URLS[0], { mode: 'cors' }); } catch (error) { console.error(error); }
    if (response == null) response = await fetchFn(MARKETPLACE_URLS[1], { mode: 'cors' });
    if (!response.ok) throw new Error(`marketplace.json: HTTP ${response.status}`);
    const body = await response.json();
    if (!isMarketplace(body)) throw new Error('marketplace.json: no marketData or timestamp');
    return body;
}

export const isMarketplace = (b) => !!b && typeof b === 'object' && !!b.marketData && typeof b.marketData === 'object' && !Array.isArray(b.marketData) && Number.isFinite(b.timestamp);
