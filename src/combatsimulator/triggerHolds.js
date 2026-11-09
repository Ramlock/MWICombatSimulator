// "Held by trigger": the summary the results panel reads from a sim result (recorded by SimResult.updateTriggerHolds
// and updateSkipHold). A sim result crosses the worker boundary as plain data, so the summary reads plain fields only.

// Per ability of the player, in slot order: per trigger condition, the share of sim time it held the ability (0..1,
// an open hold counted to the end of the sim), and `skip`, the share of sim time a previous skill out of mana kept
// the ready ability from being reached (null when it never did). Abilities and conditions with no hold are left out.
export function summarizeTriggerHolds(simResult, hrid) {
    const simulatedTime = simResult.simulatedTime;
    const share = (r) => (simulatedTime > 0 ? (r.total + (r.held ? simulatedTime - r.start : 0)) / simulatedTime : 0);
    const byCondition = simResult.triggerHolds?.[hrid] ?? {};
    const bySkip = simResult.skipHolds?.[hrid] ?? {};
    const order = [...(simResult.abilityOrder?.[hrid] ?? []), ...Object.keys(byCondition), ...Object.keys(bySkip)];
    const abilities = [];
    for (const abilityHrid of new Set(order)) {
        const conditions = (byCondition[abilityHrid] ?? [])
            .filter((r) => r.count > 0)
            .map((r) => ({ dependencyHrid: r.dependencyHrid, conditionHrid: r.conditionHrid, comparatorHrid: r.comparatorHrid, value: r.value, share: share(r) }));
        const s = bySkip[abilityHrid];
        const skip = s && s.count > 0 ? share(s) : null;
        if (conditions.length > 0 || skip !== null) abilities.push({ abilityHrid, conditions, skip });
    }
    return { abilities };
}
