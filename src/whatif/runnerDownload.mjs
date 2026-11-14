// Where the page sends a visitor who has no what-if runner: the one place that names the downloads.
// Both are assets of the fork's latest release, with fixed names (docs/codebase/runner-zip.md, "Release").
// Windows: the one-file runner (tools/runner-zip/build-exe.ps1). Linux: the zip, run with the system's Node (tools/runner-zip/build-zip.ps1).
export const RUNNER_DOWNLOAD_URL = 'https://github.com/Ramlock/MWICombatSimulator/releases/latest/download/WhatIfRunner.exe';
export const RUNNER_ZIP_URL = 'https://github.com/Ramlock/MWICombatSimulator/releases/latest/download/WhatIfRunner.zip';
