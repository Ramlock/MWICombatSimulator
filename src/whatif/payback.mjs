// The buyer's payback, in one place: the report window (src/whatif/panel.mjs) and the search (tools/whatif/optimize.mjs,
// tools/whatif/sure.mjs) both read it from here, so the figure shown and the figure the limit is checked on are the same.

// The payback in days: the cost over the buyer's gain per day. null unless both are above 0 (a free change has nothing to pay back,
// a change with no positive buyer's gain never does).
export const paybackDays = (cost, buyerNet) => (Number.isFinite(cost) && cost > 0 && Number.isFinite(buyerNet) && buyerNet > 0 ? cost / buyerNet : null);

// Whether a change pays back too slowly for the limit (days; 0, null or undefined = no limit). A free change (cost 0) always passes;
// a change with a cost and no positive buyer's gain has no payback and is over the limit.
export function overPaybackLimit(cost, buyerNet, limit) {
    if (!(limit > 0) || !(cost > 0)) return false;
    const days = paybackDays(cost, buyerNet);
    return days === null || days > limit;
}
