# MWICombatSimulator (fork) — project notes

How the code works: `docs/codebase/README.md`.

## Publishing

The site is deployed from `main` by `.github/workflows/pages.yml`, which publishes the committed `dist/`. Before every push to `main`:

1. Add an entry for the day to `patchNote.json` (`"fork": "Ramlock"`, plain words for players, no names) and regenerate `patchNote.i18n.json` with `python tools/build-patchnote-i18n.py` (add the Chinese translation of the new entry to `ZH` in that script first).
2. Rebuild `dist/` with `npx webpack`, and check `dist/patchNote.json` has the new entry.
3. Name scrub of the staged tree: no owner or party names, no private paths, no Coin figures.
4. One commit with a generic message, then push (fast-forward, no force) and check that the Pages run succeeded.
