# The test loop

`tools/test/run-tests.mjs` is the one way to run the test files: the named ones, or all of them (`tools/test/*.mjs` and `userscript/test/*`).

```
node tools/test/run-tests.mjs                          # every file
node tools/test/run-tests.mjs talismans top-bar-page   # named files: a name, a file name or a path
```

- It runs one file at a time, with `BROWSER` set to a no-op, and never passes a core limit.
- Each file's output goes to its own log, `.test-logs/<stamp>/<file>.log` (gitignored). Every line in the log has a timestamp.
- It prints one line per file: exit code, the count of `ok` / `PASS` / `✔` lines, the count of `FAIL` / `not ok` / `✖` lines, and the seconds it took. It exits 0 only when every file exits 0.
- When it is not already under HeavyRun (`MWI_UNDER_HEAVYRUN` unset) and `D:\Apps\HeavyRun\HeavyRun.exe` exists, it starts itself again through one HeavyRun call for the whole loop, with `--memory-gb 3` and `--wait`. The minutes are the sum of each file's own: the long files are listed in `LONG_MINUTES`, every other file counts `DEFAULT_MINUTES`, and the total is capped at 60. Where HeavyRun does not exist, it runs plainly.
- Its own test, `tools/test/run-tests-self.mjs`, covers the count parsing, the relaunch decision (`shouldRelaunch`), the minutes and the name resolution.
