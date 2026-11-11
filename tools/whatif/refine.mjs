// A trigger step is shown final (his go 2026-11-11: "trigger steps are merged as the chain builds, not at the end"). When the greedy
// step picks a trigger change, the owner's trigger is refined first, before the pick is checked and joins: the owner's local
// candidates (coordinate-wise rounds, triggers.mjs localCands) are measured against the chain with the trigger as it stands, the best
// accepted one is taken, and again, until none is accepted. The row is then one step, the owner's trigger from its value in the chain
// to its final value (a trigger op carries the owner's whole list, so the last op is the whole change). Pure: the runs are the
// caller's (`judge`).
//
// first: the picked candidate (its est set). Callbacks:
//   locals(cur)       the candidates to try around cur, already kept to states not visited ([] ends the refinement)
//   judge(cur, list)  sets list[i].est against the chain with cur applied; returns the list, or null when a stop ended the runs
//   rank(a, b)        the search's order of two candidates (best first)
//   join(cur, next)   the candidate that is cur then next as one change (desc joined, next's ops), est not measured yet
// Returns the final candidate (first itself when nothing improved it), or null when a stop ended the runs.
export async function refineTrigger(first, { locals, judge, rank, join }) {
    let cur = first;
    for (;;) {
        const list = locals(cur);
        if (!list.length) return cur;
        if (await judge(cur, list) === null) return null;
        const next = list.filter((c) => c.est.accepted).sort(rank)[0];
        if (!next) return cur;
        cur = join(cur, next);
    }
}
