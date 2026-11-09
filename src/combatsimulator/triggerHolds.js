// "Held by trigger" and "Held for mana": the pure parts shared by SimResult (recording) and the results panel
// (summary). A sim result crosses the worker boundary as plain data, so the summary reads plain fields only.

const OWN_MP_CONDITIONS = new Set(["/combat_trigger_conditions/current_mp", "/combat_trigger_conditions/missing_mp"]);

// A condition on the player's own MP: dependency "self" with "Current Mp" or "Missing Mp".
export function isOwnMpTrigger(trigger) {
    return trigger.dependencyHrid == "/combat_trigger_dependencies/self" && OWN_MP_CONDITIONS.has(trigger.conditionHrid);
}

const ONE_HOUR = 3600 * 1e9;

// Per ability of the player, per condition: share of sim time held (0..1, an open hold counted to the end of the
// sim) and holds per hour. Plus "Held for mana" for the player. Abilities and conditions with no hold are left out.
export function summarizeTriggerHolds(simResult, hrid) {
    const simulatedTime = simResult.simulatedTime;
    const hours = simulatedTime / ONE_HOUR;
    const closedTotal = (r) => r.total + (r.held ? simulatedTime - r.start : 0);
    const abilities = [];
    for (const [abilityHrid, records] of Object.entries(simResult.triggerHolds?.[hrid] ?? {})) {
        const conditions = records
            .filter((r) => r.count > 0)
            .map((r) => ({
                dependencyHrid: r.dependencyHrid, conditionHrid: r.conditionHrid, comparatorHrid: r.comparatorHrid, value: r.value, ownMp: r.ownMp,
                share: simulatedTime > 0 ? closedTotal(r) / simulatedTime : 0,
                perHour: hours > 0 ? r.count / hours : 0,
                count: r.count,
            }));
        if (conditions.length > 0) abilities.push({ abilityHrid, conditions });
    }
    const m = simResult.manaHolds?.[hrid];
    const mana = m && m.count > 0
        ? { share: simulatedTime > 0 ? closedTotal(m) / simulatedTime : 0, perHour: hours > 0 ? m.count / hours : 0, count: m.count }
        : null;
    return { abilities, mana };
}
