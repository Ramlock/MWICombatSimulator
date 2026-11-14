# The runner downloads: WhatIfRunner.exe (Windows) and the zip (Linux)

Two downloads hold everything the what-if runner (`whatif-runner.md`) needs, so a user with no Node, git or build tools can run it. The page offers them when no runner answers (`whatif-window.md`, "Two states"); the links are the two constants in `src/whatif/runnerDownload.mjs`.

- **Windows: `WhatIfRunner.exe`**, one file: save it anywhere, double-click it. Built from the zip (below), so both carry the same files.
- **Linux: `WhatIfRunner.zip`**, run with the system's Node 24 or newer (the page's Linux steps: unzip, `node tools/whatif/runner/server.mjs --port 8787`, open the address). The zip still carries `node.exe` and `start-runner.cmd` for Windows; those are unused on Linux. A Linux one-file build was made once by hand and never run, so none is shipped.

## Build

`powershell -File tools\runner-zip\build-exe.ps1 [-Commit <ref, default HEAD>] [-Out <exe, default .\WhatIfRunner.exe>] [-Zip <path: also keep the zip>] [-Cache <folder for node.exe>]`

It runs `build-zip.ps1` on the same commit (the zip alone: `powershell -File tools\runner-zip\build-zip.ps1 [-Commit <ref>] [-Out <zip>] [-Cache <folder>]`), so one run with `-Zip` makes both release files. Needs `git`, `tar.exe` (Windows 10 and later), `npm`/`npx`, and the network the first time (node.exe, heap-js, postject). Nothing is read from a personal path. About one minute.

The zip (`build-zip.ps1`):

1. The files come from the commit through `git archive` (never the working tree): `src/combatsimulator`, `src/whatif`, `src/marketplace.mjs`, `src/importGuildBuffs.js`, `src/guildLevels.mjs`, `tools/whatif`, `tools/calibration`, `dist` (without `*.map`) and the launcher `tools/runner-zip/start-runner.cmd`. **`dist/` must be built and committed at that commit** (the publish procedure builds it); the runner serves it.
2. `node.exe`: one pinned version (`$NodeVersion` in the script), fetched from `https://nodejs.org/dist/v<version>/win-x64/node.exe` into the cache folder and checked against a pinned SHA-256 (`$NodeSha256`) on every run; a mismatch deletes the cached file and stops the build. The pin is the `win-x64/node.exe` line of that version's `SHASUMS256.txt`; to bump, change both values from it.
3. `node_modules/heap-js` (the engine's one runtime dependency): `npm ci --omit=dev --ignore-scripts` on the commit's `package.json` and `package-lock.json`, so the version and its integrity are the lock file's.
4. `VERSION.txt` in the zip's `WhatIfRunner` folder: `node v<version>; commit <short sha>`.
5. The zip is written with `tar.exe -a`. Same commit and same pin give the same files; the zip's own bytes may differ (timestamps).

The exe (`build-exe.ps1`), a Node single executable application (SEA):

1. It unpacks that zip and embeds every file of it except `node.exe` and `start-runner.cmd` as SEA assets (keyed by their path in the zip), plus `build-id`: the first 12 hex digits of a SHA-256 over every embedded file's path and hash and the entry's hash.
2. The main is the commit's `tools/runner-zip/exe-entry.cjs` (a SEA main must be CommonJS and can `require` built-in modules only). `node.exe --experimental-sea-config` (the zip's own pinned `node.exe`) writes the blob; `npx postject@1.0.0-alpha.6` injects it into a copy of that `node.exe`. postject warns "The signature seems corrupted": the injection breaks node.exe's own signature, and the exe ships unsigned.
3. Result: about 100.7 MB (91.7 MB of node.exe plus 13.7 MB of files), 139 embedded files.

## Starting it

`WhatIfRunner.exe [port]` (default 8787) and `start-runner.cmd [port]` do the same thing: start `tools\whatif\runner\server.mjs --port <port> --open` with the bundled Node and keep the window open. `--open` makes the runner itself open the default browser (or `$BROWSER`) on `http://127.0.0.1:<port>/` only once it listens; the Linux way without `--open` just prints the address. A start on a port that is held: by the same version of the runner it says so and opens the page on it (exit 3); by a runner of another version it names both versions, says to close that one and opens nothing (exit 4); by anything else, or any other failure, it prints one line (`EADDRINUSE: port N is used by another program` or `The runner could not start: ...`), opens nothing (exit 1). The launcher prints the same two header lines, turns exits 3 and 4 into its own closing messages and never says "The runner stopped" for them; for any other end it says "The runner stopped" with the other-port hint (`WhatIfRunner.exe 8788` / `start-runner.cmd 8788`). The runner and its search workers run at the lowest priority on every core (`whatif-runner.md`); the launcher passes no core limit.

The exe's entry (`exe-entry.cjs`) dispatches on its arguments. Inside a SEA `process.argv` is `[exe, exe, ...args]`, and `child_process.fork(script)` starts `process.execPath` (the exe) with the script first. So:

- **A child** (the server the launcher starts, the optimizer `server.mjs` forks, the run workers `node-shell.mjs` forks with `--child`): the first argument is a `.mjs` inside the unpack folder, and the entry imports it with `process.argv = [exe, script, ...rest]`, as Node would run it. The modules are unchanged.
- **The user's start** (anything else, the optional first argument a port): it sets the window title, unpacks, removes old builds, prints the header, starts `server.mjs --port <port> --open` as a child with the console shared, and when that child exits by itself prints the closing lines and, in a console, waits for a key ("Press any key to close this window"), since a double-clicked exe's console closes on exit. Without a console (a hidden or piped start) it exits at once. Its exit code is the server's (3, 4, 1). Ctrl+C or closing the window stops both.

Unpack folder: `<home>\MWI-WhatIf\runner-<build id>\`, next to the runner's default results folder (`<home>\MWI-WhatIf\results`), never `%TEMP%` (temp cleaners would remove it under a running runner). The first start of a build writes all files into `runner-<id>.part-<pid>`, then renames it, so a half-written folder is never used; two first starts at once both finish, and the one that loses the rename uses the winner's folder. The rename is retried for up to 5 s, because an antivirus scan of the new files can hold the folder. Later starts find `.done` and skip it (the first start took 4.3 s here, unpacking included). Each user start marks its folder with `.in-use-<pid>` (removed when it ends). It then removes every other `runner-*` folder (older builds, and `.part-<pid>` left by a start that died) unless a live process still marks it, so a runner of another version that is still running keeps its files. If the folder cannot be written, it prints one line, `The runner could not unpack its files into <folder> (<code>). It needs write access to <home>\MWI-WhatIf.`, and exits 1.

Tests: `tools/test/runner-zip-files.mjs` (reads the `git archive` list from `build-zip.ps1` and fails when a file the runner imports, followed from `server.mjs`, `optimize.mjs` and `batch.mjs`, is not in it); `tools/test/whatif-runner-start.mjs` (the server's start cases, as both launchers run it); `tools/test/whatif-runner-exe.mjs --exe <WhatIfRunner.exe> [--commit <short sha>]` (the built exe, every start hidden, from a path with spaces, with a temporary home folder: a first start with old-build cleanup and the page opened after listening, a second start, another version on the port, another program on the port, no write access, and a short real search through the exe's own forked optimizer and workers).

## Release

What the publishing session does, after a publish that changes `src/combatsimulator`, `src/whatif`, `tools/whatif`, `tools/calibration`, `dist/` or `tools/runner-zip/` (this replaces "the zip, the one asset"):

1. **Build both** from the pushed commit, under HeavyRun: `powershell -File tools\runner-zip\build-exe.ps1 -Commit <sha> -Out WhatIfRunner.exe -Zip WhatIfRunner.zip`. Its last line names the exe's size, the commit and the build id.
2. **Attach two assets** to the one release tagged `runner-<short sha>`, marked latest: `WhatIfRunner.exe` and `WhatIfRunner.zip`, under exactly those names (the page's links are `releases/latest/download/WhatIfRunner.exe` and `.../WhatIfRunner.zip`). The exe is about 101 MB, under GitHub's 2 GB asset limit; upload it with `Content-Type: application/octet-stream`.
3. **Version info:** the exe has no `VERSION.txt` beside it. The same `VERSION.txt` (`node v<version>; commit <short sha>`) is embedded and unpacked into `<home>\MWI-WhatIf\runner-<build id>\VERSION.txt`; `whatif-runner-exe.mjs --commit <short sha>` checks it. The release text can name the commit and the build id.
4. **Check the real effect:** download both `releases/latest/download/` files over the network and byte-compare them with the local build. Then run `node tools/test/whatif-runner-exe.mjs --exe <downloaded exe> --commit <short sha>` under HeavyRun: every start is hidden, and it covers the page's `/api/version` and one short search. For the zip, the old zip checks stand.
5. **The page and the latest version:** the page learns nothing about the latest runner version and needs no change per release. It links to `releases/latest/download/<fixed name>`, and a running runner serves its own page from its own `dist/`. A user on an old runner gets a new one by downloading again. A new exe starting while an old one runs on the port says "another version" (exit 4) and opens nothing.

## Not covered by the build

Both files are unsigned. What Windows SmartScreen or an antivirus shows on the first start of a downloaded `WhatIfRunner.exe` has not been tested (a file built here has no Mark-of-the-Web). The page's step 2 names both Windows prompts ("Open File - Security Warning" and "Windows protected your PC").
