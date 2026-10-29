# ADR 0001 — Toolchain and versions

**Status:** Accepted (M0, 2026-10-29)  
**Decisions:** D21, D22

## Context

Glacier Tasks follows the Glacier Notes stack (D22): npm, Angular, Electron, own SCSS tokens,
Vitest, Biome. Versions have to be compatible with each other and with the native SQLite
driver on Windows and Linux x64 (D21).

## Decision

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (LTS) | Local dev and CI (`actions/setup-node`, `node-version: 24`); `engines.node >= 24` |
| npm | 11.12.1 | Pinned via `packageManager`; one root `package-lock.json` |
| Electron | 45.1.0 | Newest stable at M0; verified with better-sqlite3 (ADR 0003) |
| Angular | 22.2.x (`@angular/core` 22.2.3, CLI/build 22.2.5) | Standalone, zoneless, application builder |
| TypeScript | 6.0.3 | Angular 22.2 requires `>=6.0 <6.1`; TypeScript 7 is **not** supported yet |
| Vitest | 5.0.5 | Shared by packages and Angular's unit-test builder |
| Biome | 2.6.4 | Formatter only (linter off), as in Glacier Notes; Markdown and YAML are formatted by hand |
| esbuild | 0.28.2 | Bundles Electron main/preload (ADR 0002) |
| electron-builder | 26.18.0 | NSIS (Windows), AppImage + deb (Linux), x64 only |
| better-sqlite3 | 13.0.3 | ADR 0003 |
| Zod | 4.6.7 | IPC validation (ADR 0004) |

All direct dependencies are pinned to exact versions. Upgrades are deliberate: one tool per
change, with the full CI matrix green before merging.

### Electron binary download

Electron 45 no longer downloads its binary in a `postinstall` script. The binary is fetched
lazily the first time `require('electron')` resolves its path (for example `npx electron .`).
electron-builder downloads its own copy for packaging. No install-script configuration is
needed in CI.

## Consequences

- Angular dictates the TypeScript line; TypeScript upgrades wait for Angular support.
- Playwright (E2E) is added when the first E2E test lands (M1/M3), at the then-current version.
- Upgrading Electron requires re-running the packaged smoke test on both platforms.
