# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project

Glacier Tasks — an offline, Jira-inspired desktop task planner (Electron 45 + Angular 22,
SQLite via better-sqlite3) for Windows and Linux x64. Strictly local: no backend, no CDN, no
network requests; all assets are bundled. The sibling app
[Glacier Notes](https://github.com/Cracksoldier/glacier-notes) is the reference for look,
tooling and release process.

Development is milestone-driven. Authoritative documents:
- `docs/GLACIER_TASKS_SPEC.md`: requirements, with IDs such as `TASK-05`
- `docs/GLACIER_TASKS_MILESTONES.md`: M0–M8
- `docs/DECISIONS.md`: confirmed product decisions `Dnn`
- `docs/adr/`
- `docs/architecture.md`: domain invariants I01–I24
- `docs/threat-model.md`

Don't promote an assumption to a confirmed decision without the product owner. Commit or
push only when the user asks.

## Commands

- `npm run build`: domain → data → ui → desktop (order of the `workspaces` array)
- `npm test`: Vitest in all workspaces (UI via `ng test`)
- `npm run format` / `npm run format:check`: Biome; Markdown and YAML are formatted by hand
- `npm run verify:offline`: fails if the renderer build references remote resources
- `npm run package:dir --workspace @glacier-tasks/desktop`: unpacked package in `apps/desktop/release`
- `npm run smoke [-- win32|linux]`: runs the packaged app in smoke mode (needs `package:dir` first)
- Unpackaged smoke run: `cd apps/desktop && GLACIER_SMOKE=1 npx electron .` (prints a `[smoke] {...}` line)
- Single test file: `npx vitest run src/sort-key.spec.ts` inside a package

## Layout (ADR 0002)

- `packages/domain`: pure TS shared by all processes:
  - enums, DTOs (`models.ts`)
  - Zod IPC input schemas (`schemas.ts`)
  - `AppError`/`Result` (`errors.ts`)
  - IPC contract (`api.ts`)
  - pure invariants and sort keys
- `packages/data`: main process only: `openDatabase`, `migrate`, migrations in
  `src/migrations/NNNN-name.ts` (never edit a released migration).
- `apps/desktop`: Electron main + preload, bundled by esbuild into CJS (`scripts/build.mjs`);
  `electron-builder.yml`.
- `apps/ui`: Angular renderer (standalone, zoneless, OnPush).

Packages compile to `dist/` with `tsc -b`. Rebuild `domain` after changes before the UI or
desktop picks them up.

## Rules that are easy to break

- **IPC surface change** (ADR 0004): `api.ts` + `IPC_CHANNELS` → Zod schema → preload mirror
  → main handler (parse with schema) → renderer stub. Never expose `ipcRenderer` or a generic
  invoke.
- **Native module:** better-sqlite3 uses its bundled N-API prebuilds. Native rebuilds are
  disabled in electron-builder on purpose (ADR 0003); don't re-enable them.
- **Schema:** cross-project integrity relies on composite FKs `(project_id, id)`. New
  project-scoped references must follow that pattern. Write multi-table changes in one
  transaction.
- **Renderer:** no Node APIs, no remote URLs, no inline scripts (CSP in `apps/ui/src/index.html`).
- All user-facing strings go through the EN/DE translation layer (from M1).

## Commit style

Imperative subject describing the milestone or feature, a short body explaining what's
included, and requirement/decision IDs where relevant.
