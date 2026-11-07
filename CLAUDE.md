# MWICombatSimulator (fork) — project notes

How the code works: `docs/codebase/README.md`.

## Publishing

The site is deployed from `main` by `.github/workflows/pages.yml`, which publishes the committed `dist/`. Before every push to `main`:

1. Add an entry for the day to `patchNote.json` (`"fork": "Ramlock"`, plain words for players, no names) and regenerate `patchNote.i18n.json` with `python tools/build-patchnote-i18n.py` (add the Chinese translation of the new entry to `ZH` in that script first).
2. Rebuild `dist/` with `npx webpack`, and check `dist/patchNote.json` has the new entry. The build is cache-busted (GitHub Pages serves `max-age=600`, so fixed names kept a plain reload on old files): `webpack.config.js` gives the bundles and worker chunks a `[contenthash:8]` name, and its `CacheBustIndexHtml` plugin rewrites `dist/index.html` to the new `bundle.<hash>.js` and `js/i18n.js?v=<hash>` (which also versions its `locales/*/common.json` fetch; `patchNote.json` is bundled into `bundle.<hash>.js`, not fetched); keep both if the config changes, and check that `dist/index.html` names a `bundle.<hash>.js` that exists in `dist/`.
3. Name scrub of the staged tree: no owner or party names, no private paths, no Coin figures.
4. One commit with a generic message, then push (fast-forward, no force) and check that the Pages run succeeded.
