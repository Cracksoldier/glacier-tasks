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

- `npm start`: dev mode with three parallel processes:
  - `tsc -b -w` for the packages
  - `ng serve` on :4200
  - Electron with `GLACIER_DEV=1` via `apps/desktop/scripts/dev.mjs`

  Renderer warnings and errors are echoed to the terminal; F12 opens DevTools. Main/preload
  changes need an app restart.
- `npm run build`: domain → data → ui → desktop (order of the `workspaces` array)
- `npm test`: Vitest in all workspaces (UI via `ng test`)
- `npm run e2e`: Playwright drives the built, unpackaged app (`tests/e2e`); run `npm run build` first
- `node scripts/generate-icons.mjs`: re-render icons after changing `apps/desktop/build/icon.svg`
- `npm run format` / `npm run format:check`: Biome; Markdown and YAML are formatted by hand
- `npm run verify:offline`: fails if the renderer build references remote resources
- `npm run package:dir --workspace @glacier-tasks/desktop`: unpacked package in `apps/desktop/release`
- `npm run smoke [-- win32|linux]`: runs the packaged app in smoke mode (needs `package:dir` first)
- Unpackaged smoke run: `cd apps/desktop && GLACIER_SMOKE=1 GLACIER_USER_DATA=<tmp dir> npx electron .`
  (prints a `[smoke] {...}` line)
- `GLACIER_USER_DATA=<dir>` points any run at a separate app data directory; never test
  against the real profile.
- Single test file: `npx vitest run src/sort-key.spec.ts` inside a package

## Layout (ADR 0002)

- `packages/domain`: pure TS shared by all processes:
  - enums, DTOs (`models.ts`)
  - Zod IPC input schemas (`schemas.ts`)
  - `AppError`/`Result` (`errors.ts`)
  - IPC contract (`api.ts`)
  - pure invariants and sort keys
  - activity event types and payloads (`activity-events.ts`), media URLs (`media.ts`)
- `packages/data`: main process only: `openDatabase`, `migrate`, migrations in
  `src/migrations/NNNN-name.ts` (never edit a released migration).
  - `src/services/`: DB-only services (`ProjectService`, `UserService`, `ActivityService`,
    `TaskService`, `LabelService`, `TrashService`, `WorkflowService`) taking a `ServiceContext` (db, clock, id
    generator). Task writes check `version` (D05) and bump it on every change; see ADR 0008.
    Status rules and board moves: ADR 0009. Each write is one transaction that
    also records its activity event (D12). Services never touch the file system.
  - Services throw `AppError` with an `errors.*` message key; every key needs EN/DE text.
- `apps/desktop`: Electron main + preload, bundled by esbuild into CJS (`scripts/build.mjs`);
  `electron-builder.yml`.
- `apps/desktop/src`: `main.ts` is wiring only. The logic lives in Electron-free modules
  with unit tests:
  - `ipc.ts`: dispatcher and sender check
  - `device-settings.ts`
  - `workspace.ts`: open, safety backup, migrate
  - `fs-safe.ts`
  - `logger.ts`
  - `paths.ts`
  - `avatar-store.ts`: avatar import, read and startup reconciliation (ADR 0007)

  Electron glue lives in `security.ts`, `window.ts`, `startup-error.ts`, `media-protocol.ts`
  (`glacier-media://avatar/<uuid>`) and `smoke.ts`.
- `apps/ui`: Angular renderer (standalone, zoneless, OnPush, signals; ADR 0006):
  - `core/api`: `GLACIER_API` token
  - `core/settings`, `core/theme`, `core/i18n`, `core/projects`, `core/users`: signal stores
  - `core/markdown`: `MarkdownService` (marked + DOMPurify, ADR 0008); `core/tasks`: display keys
  - `shared/`: `<app-avatar>`, `<app-dialog>` (native `<dialog>`), `<app-label-chip>`,
    `<app-markdown-view>`; global building blocks
    (`.btn`, `.field`, `.card`, …) in `styles/_components.scss`
  - `shell/`, `pages/` (`pages/projects/board.ts`: Kanban with CDK drag & drop;
    `workflow-editor.ts`: statuses and the delete-and-migrate wizard)
  - `testing/`: API stub (in-memory projects/users) and providers

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
  Don't add a `<base>` element to `index.html` (ADR 0006: it breaks hash URLs and the IPC
  sender check).
- **Text:** every user-facing string needs an entry in `core/i18n/en.ts` *and* `de.ts`.
  Use `i18n.t(key)`, never literal text in templates.
- **Markdown:** render only through `<app-markdown-view>` / `MarkdownService`. Never bind other
  HTML with `[innerHTML]` or `bypassSecurityTrust*`; never let rendered Markdown load images.
- **Styles:** use the CSS custom properties from `styles/_tokens.scss`, never literal colours.
- **E2E:** the UI language follows the OS on first launch (D15), so E2E tests select by
  `data-testid`, not by visible text.
- **Network:** the main process cancels every http/ws request except the dev server. Don't
  add anything that fetches remotely.

## Commit style

Imperative subject describing the milestone or feature, a short body explaining what's
included, and requirement/decision IDs where relevant.
