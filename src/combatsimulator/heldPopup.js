// "Held by trigger" pop-up body: built only from the summary (summarizeTriggerHolds), never from the page.
// `fmt` supplies the page's formatting: abilityName(hrid) and conditionHtml(condition) return HTML, percentHtml(n) formats a percentage.
export const HELD_OVERLAP_LINE = "Share of the whole simulation time each reason kept the skill from casting while it was ready; reasons can overlap, so they do not add up.";

export function hasHold(summary) {
    return summary.abilities.some((a) => a.conditions.length > 0 || a.skip !== null);
}

export function heldPopupHtml(summary, fmt) {
    // Levels: a group heading (no indent), a skill under it (ps-3), a condition under a skill (ps-5).
    const line = (left, share, level) =>
        `<div class="row held-line ${level}"><div class="col-9">${left}</div><div class="col-3 text-end">${fmt.percentHtml(share * 100)}</div></div>`;
    const skillName = (a) => `<span data-ability="${a.abilityHrid}">${fmt.abilityName(a.abilityHrid)}</span>`;
    const triggers = summary.abilities.filter((a) => a.conditions.length > 0);
    const skips = summary.abilities.filter((a) => a.skip !== null);
    let html = "";
    if (triggers.length > 0) {
        html += `<div id="heldTriggerGroup" class="mb-3"><h6 class="held-group" data-i18n="common:simulationResults.heldByTrigger">Held by trigger</h6>`;
        for (const a of triggers) {
            html += `<div class="held-block mb-2"><div class="held-ability ps-3 fw-bold">${skillName(a)}</div>`;
            for (const c of a.conditions) html += line(fmt.conditionHtml(c), c.share, "held-condition ps-5");
            html += `</div>`;
        }
        html += `</div>`;
    }
    if (skips.length > 0) {
        html += `<div id="heldSkipGroup" class="mb-3"><h6 class="held-group" data-i18n="common:simulationResults.previousSkillOutOfMana">A previous skill was out of mana</h6>`;
        for (const a of skips) html += line(skillName(a), a.skip, "held-skill ps-3");
        html += `</div>`;
    }
    html += `<p id="heldOverlapLine" class="text-muted mb-0" data-i18n="common:simulationResults.heldByTriggerOverlap">${HELD_OVERLAP_LINE}</p>`;
    return html;
}
