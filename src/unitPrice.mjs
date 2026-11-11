// The unit price of an item for a price setting ('bid' or 'ask'): that side if it has orders, else the other side, else the vendor price.
// -1 when the price list is missing or does not know the item. Every price lookup (drops, consumables, chest contents) goes through here.
export function unitPrice(prices, name, setting) {
    const item = prices?.[name];
    if (!item) return -1;
    const first = setting == 'bid' ? 'bid' : setting == 'ask' ? 'ask' : null;
    const second = first == 'bid' ? 'ask' : first == 'ask' ? 'bid' : null;
    if (first && item[first] !== -1) return item[first];
    if (second && item[second] !== -1) return item[second];
    return item['vendor'];
}
