# The release script

`tools/release/release.ps1` runs the fixed steps of a runner release (the exe and the zip, `runner-zip.md`) for one commit, so a release is one command and one result block.

## Run it

From a worktree checked out at the commit, under HeavyRun (the builds and the searches are heavy):

```
D:\Apps\HeavyRun\HeavyRun.exe --label "<what it loads>" --minutes 60 --wait -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\release\release.ps1 -Commit <full sha> [-DryRun]
```

- `-Commit <full sha>` (required): the commit to release; it must be on the remote, a fast-forward of `origin/main`, and the worktree must be at it and clean (untracked files are ignored).
- `-DryRun`: the same flow; every outward call (create the release, upload or delete an asset, push `main`, rerun Pages) is skipped and logged as `SKIPPED (dry run)`, and so are the steps that only check an outward effect (6, 7, 9, 10).

It stops at the first failed step, logs `DONE:` and `NOT DONE:` lists and exits 1. A second run with the same commit carries on: the build and the tests of the built files are kept (marker files in `%TEMP%\mwi-release-<short sha>`), an existing release with the tag, an asset of the same name and size, `main` already at the commit and a successful Pages run are found and not redone. Every log line has a timestamp; the owner's token (`gh auth token --user <owner of the repo slug>`) is read at run time and never logged.

## Steps

1. Checks: the commit is on a remote branch; `origin/main` is its ancestor; the worktree is at it and clean.
2. Builds `WhatIfRunner.exe` and `WhatIfRunner.zip` (`build-exe.ps1 -Zip`), with `C:\Windows\System32` first on PATH.
3. Tests both by a real search: the exe with `tools/test/whatif-runner-exe.mjs`, the zip with `tools/release/zip-search.mjs` (the zip's own node.exe and server, the search of `tools/test/runner-search.mjs`).
4. Creates the release `runner-<short sha>`, latest (`gh api POST releases` with the owner's token).
5. Uploads the two assets (`uploads.github.com`); an asset of the same name and another size is deleted first.
6. Waits until `releases/latest/download/<name>` redirects to the new tag (up to 10 min), downloads both into a new temp folder and byte-compares them with the builds.
7. Tests the downloaded exe by a real search.
8. Pushes the commit to `main`, fast-forward, never forced.
9. Waits for the Pages run of the commit (up to 30 min); on a failure whose log has "Found 0 artifact(s)" it reruns the whole run once.
10. Fetches `https://ramlock.github.io/MWICombatSimulator/` and `/dist/` (up to 15 min each) until each names the bundle of the commit's `dist/index.html`.
11. Prints the result block: commit, release id and tag, asset sizes, live bundle, each step's time.

Any runner it starts is hidden, on a free port (never 8787), with `BROWSER` set to a no-op. The download folder is removed at the end.

## Native calls

The script runs under `$ErrorActionPreference = 'Stop'`. On Windows PowerShell 5.1 each stderr line of a native call whose stderr is redirected inside PowerShell (`2>&1`, `2>$null`) becomes an error record, and `Stop` makes it terminating before the exit code is read. Such a call goes through `Invoke-Native <exe> <args>`, which sets the preference to `Continue` in its own scope only and returns `Code`, `Out` (stdout lines) and `Err` (stderr lines); the caller decides from `Code`. A missing command still throws. `Invoke-Api` (`gh api`) and `Test-CommitOnRemote` (`git branch -r --contains`) use it: a 404 returns `$null`, a commit git does not know is on no remote, any other failure throws with the command's own message. The other native calls leave stderr alone (it goes to the console), so they cannot throw this way.

## By hand

- Before: his word "publish" on the exact commit.
- After: the live pictures.

## Test

`tools/test/release-script.mjs`: no network, no build. The seam is `MWI_RELEASE_SEAM`: a `.ps1` the script dot-sources after its own functions, which replaces the outward and heavy ones with fakes. It checks the step order, a failure at each of steps 1 to 10, a second run after a failed push, and that `-DryRun` makes no outward call.

Those fakes replace `Invoke-Api` too, so a fifth part runs the real functions: a second seam replaces only `Get-Token`, puts a fake `gh` and `git` (`.cmd` files calling a node script) first on PATH, calls the script's own `Invoke-Api` and `Test-CommitOnRemote` under Windows PowerShell 5.1, writes what each returned or threw to a file, and ends the process with `[Environment]::Exit(0)` before the flow (a plain `exit` in a dot-sourced file returns only from that file). It checks a 404 (`$null`), another failure (throws with gh's message), a success (parsed JSON, also with a line on stderr), a body by `--input`, an empty success (empty table), a commit git does not know (not on a remote) and one an origin branch contains, and that every `gh` call carried the fake token.
