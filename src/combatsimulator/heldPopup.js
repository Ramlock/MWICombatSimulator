// "Held by trigger" pop-up body: built only from the summary (summarizeTriggerHolds), never from the page.
// `fmt` supplies the page's formatting: abilityName(hrid) and conditionHtml(condition) return HTML, percentHtml(n) formats a percentage.
export const HELD_OVERLAP_LINE = "Share of the whole simulation time each reason kept the skill from casting while it was ready; reasons can overlap, so they do not add up.";

export function hasHold(summary) {
    return summary.abilities.some((a) => a.conditions.length > 0 || a.skip !== null);
}

export function heldPopupHtml(summary, fmt) {
    const line = (left, share, extraClass = "") =>
        `<div class="row held-line ${extraClass}"><div class="col-9">${left}</div><div class="col-3 text-end">${fmt.percentHtml(share * 100)}</div></div>`;
    const name = (a) => `<div class="held-ability fw-bold" data-ability="${a.abilityHrid}">${fmt.abilityName(a.abilityHrid)}</div>`;
    const triggers = summary.abilities.filter((a) => a.conditions.length > 0);
    const skips = summary.abilities.filter((a) => a.skip !== null);
    let html = "";
    if (triggers.length > 0) {
        html += `<div id="heldTriggerGroup" class="mb-3"><h6 data-i18n="common:simulationResults.heldByTrigger">Held By Trigger</h6>`;
        for (const a of triggers) {
            html += `<div class="held-block mb-2">${name(a)}`;
            for (const c of a.conditions) html += line(fmt.conditionHtml(c), c.share, "ps-3");
            html += `</div>`;
        }
        html += `</div>`;
    }
    if (skips.length > 0) {
        html += `<div id="heldSkipGroup" class="mb-3"><h6 data-i18n="common:simulationResults.previousSkillOutOfMana">A previous skill was out of mana</h6>`;
        for (const a of skips) html += `<div class="held-block mb-2">${name(a)}${line("", a.skip, "ps-3")}</div>`;
        html += `</div>`;
    }
    html += `<p id="heldOverlapLine" class="text-muted mb-0" data-i18n="common:simulationResults.heldByTriggerOverlap">${HELD_OVERLAP_LINE}</p>`;
    return html;
}
