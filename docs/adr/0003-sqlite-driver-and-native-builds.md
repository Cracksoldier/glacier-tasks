# ADR 0003 — SQLite driver and native builds

**Status:** Accepted (M0, 2026-10-29)  
**Decisions:** D22

## Context

`better-sqlite3` is a native addon. Native addons usually need a rebuild for Electron's
Node ABI, a C++ toolchain on every build machine, and care when packaging into asar. M0
had to show that this works on the Windows 11 dev machine and in GitHub Actions for
Windows and Linux.

## Findings

- better-sqlite3 13 is built on **N-API** (`node-addon-api`) and ships prebuilt binaries for
  `win32-x64`, `linux-x64` and others inside the npm package (`prebuilds/<platform>-<arch>.node`).
  It has no install script and needs no download or compile step.
- The **same binary** loads in Node 24.15 and in Electron 45.1 (verified with
  `ELECTRON_RUN_AS_NODE`): SQLite 3.53.4 with FTS5, JSON functions and the online backup API.
- By default, electron-builder runs `@electron/rebuild`, which silently **compiled**
  better-sqlite3 from source with Visual Studio. That is unnecessary and would make CI depend
  on C++ toolchains.

## Decision

1. Use better-sqlite3's bundled N-API prebuilds everywhere: development, unit/integration
   tests under plain Node (Vitest) and the packaged app.
2. Disable all native rebuilding in `apps/desktop/electron-builder.yml`: `npmRebuild: false`,
   `nodeGypRebuild: false`, `buildDependenciesFromSource: false`.
3. Unpack `prebuilds/*.node` from asar (`asarUnpack`). Each platform package ships only its own
   x64 prebuild; better-sqlite3's C++ sources are excluded.
4. Keep better-sqlite3 external to the esbuild bundle. It is the only runtime `dependency` of
   `@glacier-tasks/desktop`.
5. The packaged smoke test (`npm run smoke`) is the proof on each platform. It opens a
   workspace, migrates it, runs an FTS5 query, takes a backup-API snapshot and checks
   `integrity_check`.

## Consequences

- No C++ toolchain is required to develop, test or package. Python/Visual Studio are optional.
- Tests run against the same SQLite build as production.
- If a future better-sqlite3 release drops a needed prebuild, the fallback order is:
  (a) pin the previous version, (b) re-enable `npmRebuild` with toolchains in CI. Switching
  drivers (for example to `node:sqlite`) needs a product-owner decision (D22).
