# The runner zip

One Windows zip that holds everything the what-if runner (`whatif-runner.md`) needs, so a user with no Node, git or build tools can run it: unzip, double-click `start-runner.cmd`. The page offers it when no runner answers (`whatif-window.md`, "Two states").

## Build

`powershell -File tools\runner-zip\build-zip.ps1 [-Commit <ref, default HEAD>] [-Out <zip, default .\WhatIfRunner.zip>] [-Cache <folder for node.exe>]`

Needs `git`, `tar.exe` (Windows 10 and later), `npm`, and the network the first time (node.exe, heap-js). Nothing is read from a personal path.

1. The files come from the commit through `git archive` (never the working tree): `src/combatsimulator`, `src/whatif`, `src/marketplace.mjs`, `src/importGuildBuffs.js`, `tools/whatif`, `tools/calibration`, `dist` (without `*.map`) and the launcher `tools/runner-zip/start-runner.cmd`. **`dist/` must be built and committed at that commit** (the publish procedure builds it); the zip serves it.
2. `node.exe`: one pinned version (`$NodeVersion` in the script), fetched from `https://nodejs.org/dist/v<version>/win-x64/node.exe` into the cache folder and checked against a pinned SHA-256 (`$NodeSha256`) on every run; a mismatch deletes the cached file and stops the build. The pin is the `win-x64/node.exe` line of that version's `SHASUMS256.txt`; to bump, change both values from it.
3. `node_modules/heap-js` (the engine's one runtime dependency): `npm ci --omit=dev --ignore-scripts` on the commit's `package.json` and `package-lock.json`, so the version and its integrity are the lock file's.
4. `VERSION.txt` in the zip's `WhatIfRunner` folder: `node v<version>; commit <short sha>`.
5. The zip is written with `tar.exe -a`. Same commit and same pin give the same files; the zip's own bytes may differ (timestamps).

## What is inside

`WhatIfRunner\`: `start-runner.cmd`, `node.exe`, `VERSION.txt`, `node_modules\heap-js`, `src\`, `tools\whatif`, `tools\calibration`, `dist\`. About 100 MB unpacked, about 34 MB zipped.

`start-runner.cmd [port]` (default 8787) starts `tools\whatif\runner\server.mjs --port <port>` with the bundled `node.exe`, opens the default browser on `http://127.0.0.1:<port>/` after a few seconds, and keeps its window open (closing it stops the runner). The runner and its search workers run at the lowest priority on every core (`whatif-runner.md`); the launcher passes no core limit.

## Why a zip with `node.exe` and not one executable

A Node single-executable build (SEA) needs a single CommonJS main, and the optimizer starts its worker processes with `fork(script)`, which in a SEA re-runs the embedded main (a fork loop); the engine is ES modules loaded through custom hooks. The bundled `node.exe` plus the files runs all of it unchanged.

## Not covered by the build

The zip is unsigned, so Windows SmartScreen shows "Windows protected your PC" on a downloaded copy (the page's step 2 says what to click); an antivirus may ask about `node.exe` (the official Node binary). Where the zip is hosted is not decided; the page's link is `RUNNER_DOWNLOAD_URL` in `src/whatif/runnerDownload.mjs`, the one place to change.
