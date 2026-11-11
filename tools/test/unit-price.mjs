// Test: unitPrice, the one price lookup for drops, consumables and a chest's contents (side with orders, else the other side, else vendor, else -1).
// Usage: node tools/test/unit-price.mjs        Exit code 0 on pass, 1 on fail.
import { unitPrice } from '../../src/unitPrice.mjs';
let failed = 0;
const check = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) failed++; };
const prices = {
    both: { ask: 120, bid: 100, vendor: 5 }, askOnly: { ask: 120, bid: -1, vendor: 5 }, bidOnly: { ask: -1, bid: 100, vendor: 5 }, none: { ask: -1, bid: -1, vendor: 5 }, zeroAsk: { ask: 0, bid: -1, vendor: 5 },
};
check('bid setting reads the bid', unitPrice(prices, 'both', 'bid') === 100);
check('ask setting reads the ask', unitPrice(prices, 'both', 'ask') === 120);
check('bid setting with no bid falls back to the ask', unitPrice(prices, 'askOnly', 'bid') === 120);
check('ask setting with no ask falls back to the bid', unitPrice(prices, 'bidOnly', 'ask') === 100);
check('no orders at all: the vendor price', unitPrice(prices, 'none', 'bid') === 5 && unitPrice(prices, 'none', 'ask') === 5);
check('a price of 0 is a price, not a missing one', unitPrice(prices, 'zeroAsk', 'ask') === 0);
check('an unknown setting reads the vendor price', unitPrice(prices, 'both', 'other') === 5);
check('an item the list does not know: -1', unitPrice(prices, 'missing', 'ask') === -1);
check('no price list loaded: -1', unitPrice(undefined, 'both', 'ask') === -1);
process.exit(failed ? 1 : 0);
