# The test loop

`tools/test/run-tests.mjs` is the one way to run the test files: the named ones, or all of them (`tools/test/*.mjs` and `userscript/test/*`).

```
node tools/test/run-tests.mjs                          # every file
node tools/test/run-tests.mjs talismans top-bar-page   # named files: a name, a file name or a path
```

- It runs one file at a time, with `BROWSER` set to a no-op, and never passes a core limit.
- Each file's output goes to its own log, `.test-logs/<stamp>/<file>.log` (gitignored). Every line in the log has a timestamp.
- It prints one line per file: exit code, the count of `ok` / `PASS` / `✔` lines, the count of `FAIL` / `not ok` / `✖` lines, and the seconds it took. Lines starting `SKIPPED` are counted too (`skipped=N` per file and in the last line); each file's line also has its memory peak (`peak=+N.NGB`, the machine's used memory over the file's start). It exits 0 only when every file exits 0; with `--strict`, a skip in any file makes it exit 1. A release candidate's run uses `--strict` with the private setups copied in, so a skipped scan (`no-party-names.mjs` without setups) cannot read as a pass.
- When it is not already under HeavyRun (`MWI_UNDER_HEAVYRUN` unset) and `D:\Apps\HeavyRun\HeavyRun.exe` exists, it starts itself again through one HeavyRun call for the whole loop, with `--wait` and the memory floor `MEMORY_FLOOR_GB` (3), or `WHATIF_FLOOR_GB` (6) when a what-if file is among the files: the highest peak measured through the loop was +4.3 GB (`whatif-presses.mjs`), plus about 1 GB. The minutes are the sum of each file's own: the long files are listed in `LONG_MINUTES`, every other file counts `DEFAULT_MINUTES` (1); the long ones are about twice their measured time. Over 60 minutes the loop says so in one line, names how to split the run, and exits 2; it never cuts the figure. Where HeavyRun does not exist, it runs plainly.
- Its own test, `tools/test/run-tests-self.mjs`, covers the count parsing, the relaunch decision (`shouldRelaunch`), the minutes and the name resolution.
