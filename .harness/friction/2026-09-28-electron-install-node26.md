# Electron binary missing after install on Node 26 / npm 12

## Evidence

- Request: run the app on another laptop (Homebrew `node`, v26.10.0, npm 12.1.0).
- Baseline: `npm install` finished, then `npx electron --version` threw
  `Electron failed to install correctly`. npm 12 blocks dependency install
  scripts by default (`npm warn install-scripts ... electron@33.4.11 (postinstall:
  node install.js)`), so the Electron binary was never downloaded.
- Reproduction: `node node_modules/electron/install.js` exits 0 on Node 26 but
  leaves `dist/` half-extracted with no `dist/version` and no `path.txt`.
- Recurrence: first observation. Every teammate on Homebrew's current `node`
  hits it; `better-sqlite3`'s `postinstall` rebuild still ran because it is the
  root package's own script.

## Root cause

Environment drift, not a harness gap: npm 12 changed the default for dependency
install scripts, and Electron 33's `extract-zip` path stops early under Node 26
without reporting failure. `.harness/rules/electron.md` intentionally declares no
Node version floor.

## Pruning

- Canonical owner: none yet. A Node floor or an `allowScripts` entry is a
  project decision, and the Electron rule forbids inventing a version floor.
- Smallest change: record only. No rule, Skill, or package change.

## Approval

Approved by the requester on 2026-09-28 as a friction record only.

## RED

`npx electron --version` → `Error: Electron failed to install correctly, please
delete node_modules/electron and try installing again`.

## GREEN

Workaround: `unzip` the cached
`~/Library/Caches/electron/<hash>/electron-v33.4.11-darwin-arm64.zip` into
`node_modules/electron/dist` and write `path.txt`
(`Electron.app/Contents/MacOS/Electron`); `npx electron --version` → `v33.4.11`.
Using `node@22` (npm 10, scripts not blocked) is the untested alternative.

## Contract verification

`bash .harness/tests/verify-contract.sh` → `Contract verification passed.`

## CHANGELOG.md

Recorded under `Unreleased / Added`.

## Completion

Recorded. Open gap: decide on a Node floor or an npm `allowScripts` entry for
`electron`, `better-sqlite3`, and `esbuild` if this recurs.
