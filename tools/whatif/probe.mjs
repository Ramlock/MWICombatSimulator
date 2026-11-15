// The trigger counter's run (docs/proposals/what-if.md 3.5; triggers.mjs installProbe): one seeded run of the base party with the probe installed, cut to
// percentiles. Pure (static imports only), so a Node run process and a page worker call the same function: the probe lives inside the run, and only the
// summary (plain numbers) comes out. `runParty` is the shell's own run function (opts as engine-pure.mjs runParty takes them, prices in place).
// opts: the run's own options plus `players`, the names whose owners are probed. Resolves { checkpoints, probe } (probe = triggers.mjs summarize).
import Trigger from '../../src/combatsimulator/trigger.js';
import { installProbe, summarize } from './triggers.mjs';

export async function probeRun(runParty, { players, ...opts }) {
    let store;
    const res = await runParty({ ...opts, onPlayers: (pls, names) => { store = installProbe(pls, names, players, Trigger); } });
    return { checkpoints: res.checkpoints, probe: summarize(store) };
}
