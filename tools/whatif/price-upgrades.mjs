// His first example, priced: each equipped slot of a player +1, +2, +3 ..., the cost of the upgrade after 4%
// market tax, the cheaper of the market (buy +N, sell the current item) and the Mirror path (prices.mjs).
// Usage: node tools/whatif/price-upgrades.mjs [--player Ramlock] [--max-up 3] [--prices <marketplace.json>] [--setups <dir>]
import { readParty } from './variants.mjs';
import { makePricer, TAX_LABEL } from './prices.mjs';
import { loadMarket } from './node-shell.mjs';
import { DEFAULT_PRICES } from './engine.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const player = arg('player', 'Ramlock'), maxUp = Number(arg('max-up', 3)), file = arg('prices', DEFAULT_PRICES);
const pricer = makePricer(loadMarket(file));
const s = readParty(arg('setups', undefined), [player])[0];
const fmt = (x) => (Number.isFinite(x) ? (x / 1e6).toFixed(1) + 'M' : 'no seller');
console.log(`${player}, prices ${file}, costs ${TAX_LABEL} on the sale of the replaced item. Mirror ask ${fmt(pricer.mirrorAsk)}.\n`);
console.log('| Slot | Item | ' + Array.from({ length: maxUp }, (_, i) => `+${i + 1}`).join(' | ') + ' |');
console.log('|---|---|' + '---|'.repeat(maxUp));
for (const e of s.player.equipment) {
    const slot = e.itemLocationHrid.split('/').pop(), name = e.itemHrid.split('/').pop(), L = e.enhancementLevel;
    const cells = Array.from({ length: maxUp }, (_, i) => {
        const c = pricer.upgrade(e.itemHrid, L, L + i + 1);
        return `${fmt(c.cost)} to +${L + i + 1}${c.known ? ' (' + c.path + ')' : ''}${c.note && c.known ? ' [' + c.note + ']' : ''}`;
    });
    console.log(`| ${slot} | ${name} +${L} | ${cells.join(' | ')} |`);
}
