// The guard every what-if test file (tools/test/whatif-*.mjs) imports first, before anything else: a what-if test can take minutes on
// every core, so it runs only through the test loop (tools/test/run-tests.mjs), which starts it under HeavyRun and sets the marker
// MWI_UNDER_HEAVYRUN for every file it runs. Without the marker this module ends the process at once, exit 3, with one line naming the
// command to use. A caller that is itself under HeavyRun (tools/release/release.ps1) sets the marker for its call. Docs: docs/codebase/test-loop.md.
import path from 'node:path';

export const MARKER = 'MWI_UNDER_HEAVYRUN';
export const GUARD_EXIT = 3;
export const guardLine = (file) => `${file} runs only through the test loop: node tools/test/run-tests.mjs ${file}`;

if (!process.env[MARKER]) {
    console.error(guardLine(path.basename(process.argv[1] || 'whatif-<name>.mjs')));
    process.exit(GUARD_EXIT);
}
