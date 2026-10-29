# Glacier Tasks — Architecture

Companion to `GLACIER_TASKS_SPEC.md` §2. Decisions: `DECISIONS.md`; details: `adr/`.

## 1. Processes and modules

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Renderer process (sandboxed, contextIsolation, no Node)  apps/ui         │
│   Angular 22 standalone/zoneless · signal stores · SCSS tokens           │
│   uses: @glacier-tasks/domain (types, schemas, pure invariants)          │
│   sees only: window.glacierTasks (GlacierTasksAPI)                       │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ contextBridge (frozen object)
┌───────────────────────────────┴──────────────────────────────────────────┐
│ Preload (sandboxed CJS bundle)  apps/desktop/src/preload.ts              │
│   one fixed ipcRenderer.invoke per API method; nothing else              │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ IPC invoke/handle, channels "<group>:<method>"
┌───────────────────────────────┴──────────────────────────────────────────┐
│ Main process (CJS bundle)  apps/desktop/src/main.ts                      │
│   IPC handlers ── Zod parse ──► application services ──► Result<T>       │
│   services: projects · users · tasks · workflows · labels · activity     │
│             attachments/avatars · backup/restore/export · settings       │
│   @glacier-tasks/data: openDatabase · migrate · repositories             │
│   OS integration: dialogs · shell.openExternal (http/s only)             │
│   custom protocol for attachment/avatar images (M6)                      │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │
┌───────────────────────────────┴──────────────────────────────────────────┐
│ userData (per-user app data dir, D16)                                    │
│   glacier-tasks.sqlite (+ -wal/-shm)   workspace: replaced by restore    │
│   attachments/<opaque id>  avatars/<opaque id>                           │
│   device-settings.json                 never in backups (D17)            │
│   logs/                                                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Rules:
- The renderer never touches the file system, SQL or IPC directly.
- All writes that touch several tables or history happen in one SQLite transaction inside a
  service.
- File-system paths are built only in the main process, from opaque IDs, never from renderer
  input.

## 2. Packages

| Package | Runs in | Responsibility |
|---|---|---|
| `@glacier-tasks/domain` | everywhere | enums, DTOs, Zod input schemas, `AppError`/`Result`, IPC contract, pure invariants, sort keys |
| `@glacier-tasks/data` | main | connection settings, migrations, (M2+) repositories |
| `@glacier-tasks/desktop` | main + preload | window/security setup, IPC handlers, services, packaging |
| `@glacier-tasks/ui` | renderer | Angular application |

## 3. Data model

See `packages/data/src/migrations/0001-initial.ts` and ADR 0005. Tables:

- `projects`, `statuses`, `labels`, `tasks`, `task_labels`
- `users`, `avatar_files`
- `attachments`
- `activity_events`
- `workspace_settings`, `schema_migrations`
- `tasks_fts` (FTS5)

## 4. Domain invariants

Enforcement layers: **S** = Zod schema at the IPC boundary, **F** = pure function in
`packages/domain`, **D** = database constraint/trigger, **T** = service logic inside the
write transaction.

| # | Invariant | Source | Enforced by |
|---|---|---|---|
| I01 | Project key matches `^[A-Z][A-Z0-9]{1,9}$`, unique incl. trashed projects | D08 | S, F, D |
| I02 | Project key immutable once a task ID was issued | D30 | T |
| I03 | Issue numbers: one monotonic sequence per project for stories and subtasks, never reused | D30 | T, D (unique) |
| I04 | Story has no parent; subtask has exactly one parent, which is a story in the same project | §3.3 | S, D |
| I05 | No nesting: a subtask cannot be a parent; a story with subtasks cannot become a subtask | §3.3 | D |
| I06 | Subtasks move only to live stories of the same project | D04 | T, D |
| I07 | Task status belongs to the task's project | §5.1 | D |
| I08 | Task labels belong to the task's project | §5.1 | D |
| I09 | At most one assignee; assignee must not be archived for new assignments | §3.2 | D (single column), T |
| I10 | Title trimmed, 1–255 chars; description ≤ 100,000 chars | §3.3 | S, F, D |
| I11 | Dates are real `YYYY-MM-DD` dates; start ≤ due | §3.3 | S, F, D |
| I12 | Exactly one default status per project | §3.4 | D (≤1), T (≥1) |
| I13 | At least one status, and at least one `DONE` status per project | D07 | F, T |
| I14 | Status deletion migrates all referencing tasks, incl. trashed, atomically | D01 | T, D (FK blocks otherwise) |
| I15 | Parent and subtask statuses never change each other | TASK-05 | T |
| I16 | Progress counts subtasks in category `DONE` | TASK-06 | F |
| I17 | Every task write checks and increments `version` | D05 | T, S |
| I18 | Cascade trash sets `trash_cascade_root_id`; restore brings back only those children | D02 | T, D (consistency check) |
| I19 | Activity events are append-only | AUDIT-01 | D |
| I20 | FTS index contains exactly the live tasks; search and list never return trashed tasks or tasks of trashed projects | SEARCH-03 | D (triggers), S |
| I21 | Board/list ordering uses base-62 fractional keys; moved cards go to the top | D26 | F, S |
| I22 | Attachments ≤ 100 MiB (configurable); previews only PNG/JPEG/GIF/WebP | D33 | F, T |
| I23 | Avatars PNG/JPEG/WebP ≤ 5 MiB | D24 | F, D, T |
| I24 | Workspace from a newer schema version is never opened for writing | §11 | T (migrate) |
| I25 | Every task query has a deterministic order: empty values last, ties broken by project key and issue number | LIST-03 | S |
| I26 | A removed attachment keeps its row as a tombstone; its bytes are deleted at once (or by startup reconciliation); every live row owns exactly one file | D03 | S, F (reconcile) |
| I27 | Only PNG/JPEG/GIF/WebP detected by file signature are previewable; the file name never makes a type previewable | D33 | D, F |
| I28 | Markdown loads images only for live, previewable attachments of the same task | D10, MD-05 | UI |
| I29 | Permanent deletion removes the item with all dependent rows (tasks, labels links, attachments, events) and the managed bytes | TRASH-05 | S, F |
| I30 | A restore replaces the whole workspace or nothing: staged, validated, activated before the workspace opens, rolled back on failure; device settings are never touched | DATA-06/07/10 | F |
| I31 | Automatic backup retention deletes only files named like automatic backups | D13 | F |

## 5. Build and packaging

- Build: `npm run build` runs domain → data (tsc) → ui (`ng build`) → desktop (tsc check,
  esbuild, copies the renderer into `apps/desktop/dist/renderer`).
- Package: `electron-builder` in `apps/desktop` (ADR 0003): NSIS on Windows, AppImage + deb
  on Linux, x64 only.
- Verification:
  - `npm test`
  - `npm run verify:offline`: no remote resources in the renderer
  - `npm run smoke`: the packaged app checks SQLite, FTS5, backup, renderer isolation and
    zero network requests
- CI: `.github/workflows/ci.yml` runs all of the above on `windows-latest` and `ubuntu-latest`.
