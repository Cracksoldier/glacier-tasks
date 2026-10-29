# Glacier Tasks — Decision Log

Records product-owner decisions that resolve gaps, contradictions and assumptions in
`GLACIER_TASKS_SPEC.md` and `GLACIER_TASKS_MILESTONES.md`. Every entry here is **[CONFIRMED]**
by the product owner unless marked otherwise. Later changes get a new entry that names the
entry it supersedes; existing entries are not rewritten.

Reference application for visual identity, tooling and release process:
[Glacier Notes](https://github.com/Cracksoldier/glacier-notes).

## 2026-10-29 — Specification review round 1

### Data model and lifecycle

| ID  | Decision                                                                                                                                                                                                                                                  | Spec refs                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| D01 | Deleting a workflow status migrates **all** tasks using it to the chosen replacement, including trashed tasks. Restore therefore never needs a status mapping step.                                                                                       | §3.4, TRASH-04           |
| D02 | Trash tracks cascades: each trashed task/project records whether it was trashed directly or as part of a parent (`trash_cascade_root_id`). Restoring a parent restores only the children it took with it; independently trashed children stay in trash.   | §3.3, TRASH-02, TRASH-06 |
| D03 | Removing an attachment requires confirmation, deletes the managed bytes immediately and keeps a history event plus a metadata tombstone. There is no attachment-level trash. Attachments of trashed tasks are kept until the task is permanently deleted. | §3.6, FILE-05            |
| D04 | A subtask can be moved to another story **in the same project**. Moving tasks between projects and converting story ↔ subtask are out of scope for v1.                                                                                                    | §3.3, TASK-09            |
| D05 | Tasks carry an integer `version` for optimistic concurrency; saving against a stale version fails with `CONFLICT`. The app runs as a single instance (second launch focuses the existing window).                                                         | §3.3, TASK-10, §2.1      |
| D06 | Subtask status can be changed from the expanded story card on the Kanban board.                                                                                                                                                                           | BOARD-03                 |
| D07 | Every project must keep at least one status in category `DONE`.                                                                                                                                                                                           | §3.4, §5.1               |
| D08 | Project keys match `^[A-Z][A-Z0-9]{1,9}$`, are unique across live **and** trashed projects, and become reusable after permanent deletion.                                                                                                                 | §3.1, PROJ-01            |

### Views, Markdown and history

| ID  | Decision                                                                                                                                                                                                                                                  | Spec refs         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D09 | List view/search: a matching subtask is shown beneath its parent story; a non-matching parent is shown dimmed as context. Board filters evaluate story fields only.                                                                                       | LIST-05, BOARD-06 |
| D10 | Markdown may display images of the **same task's** attachments inline via `attachment:<id>` URLs. Checklists are read-only in preview (no source rewriting).                                                                                              | MD-04, MD-05      |
| D11 | Title and description changes store the full new text in history (titles also store the old value). Users can browse earlier description versions and compare each with its predecessor. Supersedes the spec's "avoid redundant full description bodies". | §3.7, AUDIT-04    |
| D12 | Activity history also covers projects, workflow statuses, labels and user profiles. Shown in a project activity view and in the profile manager.                                                                                                          | §3.7, AUDIT-05    |

### Backup, export and settings

| ID  | Decision                                                                                                                                                                                        | Spec refs     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D13 | Automatic backups are **opt-in** (off by default). When enabled: user-chosen folder, run on app launch at most once per 24 h, keep the newest 7; interval and retention count are configurable. | DATA-09       |
| D14 | JSON export scope is selectable: whole workspace or one project. Trashed items are excluded by default, with an option to include them.                                                         | DATA-03       |
| D16 | Workspace data lives only in the standard per-user app data directory. No custom location and no portable build.                                                                                | §2.1          |
| D17 | Device settings (theme, language, window state, last project/view, automatic backup config) are stored outside the workspace database and are not replaced by a restore.                        | §2.1, DATA-10 |

### UI, tooling and delivery

| ID  | Decision                                                                                                                                                                                                                                                                                                                                             | Spec refs         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D15 | UI languages: **English and German** (as in Glacier Notes), switchable in settings. Dates are formatted according to the selected UI language. Supersedes the review answer "English only".                                                                                                                                                          | UX-06             |
| D18 | Theming is built in M1 using Glacier Notes' color tokens (`src/styles/_tokens.scss`). Themes: Light / Dark / Follow System; **Dark** on first launch.                                                                                                                                                                                                | UX-01, UX-07      |
| D19 | Trash fields and the trash/restore service ship in M3; the trash UI and permanent deletion ship in M7.                                                                                                                                                                                                                                               | TASK-01, M3, M7   |
| D20 | FTS indexes are rebuilt after restore; implemented in M7.                                                                                                                                                                                                                                                                                            | SEARCH-03, M5, M7 |
| D21 | Targets: Windows and Linux, **x64 only**. Releases are built by GitHub Actions (`windows-latest`, `ubuntu-latest`), modeled on Glacier Notes' `release-builds.yml`. Development happens on Windows 11. Artifacts: Windows NSIS installer, Linux AppImage and deb.                                                                                    | §2, M8            |
| D22 | Stack matches Glacier Notes: **npm**, Angular, Electron, own SCSS design tokens (**no component library**), Font Awesome (bundled locally), Angular CDK (drag & drop, overlays, virtual scroll), marked + DOMPurify, Vitest, Biome. Plus `better-sqlite3` and Playwright (Electron) for E2E. Supersedes the review answer "pnpm + Angular Material". | §2, A13           |
| D23 | Logo/icon is a variant of the Glacier Notes icon (navy background, ice-blue snowflake style) with a board/checklist motif, drafted as SVG in M1.                                                                                                                                                                                                     | UX-07             |

### Minor defaults adopted without objection

| ID  | Decision                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ |
| D24 | Avatars: PNG/JPEG/WebP, max 5 MiB, displayed square-cropped; replaced avatar files are deleted.              |
| D25 | Label colors come from a fixed palette of light/dark pairs (as Glacier Notes' note colors).                  |
| D26 | Board card ordering uses fractional sort keys; a card moved to another column is placed at the top.          |
| D27 | Subtask create/trash/restore/move events are also recorded on the parent story's history.                    |
| D28 | Backups from older schema versions are restored and then migrated; backups from newer versions are rejected. |
| D29 | User profiles are archived only, never hard-deleted.                                                         |

## 2026-10-29 — M0 planning

| ID  | Decision                                                                                                                                                                                                                                                                               | Spec refs |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D30 | Issue numbering (A02): project key becomes immutable once the project has issued a task ID; stories and subtasks share one monotonic per-project sequence; numbers are never reused.                                                                                                   | §3.1      |
| D31 | Priorities (A04): fixed `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`; default `MEDIUM`.                                                                                                                                                                                                         | §3.3      |
| D32 | Initial statuses (A05): `To Do` (`TODO`, default), `In Progress` (`IN_PROGRESS`), `Done` (`DONE`).                                                                                                                                                                                     | §3.4      |
| D33 | Attachments (A09): 100 MiB per file (configurable); inline previews for PNG, JPEG, GIF and WebP only, never SVG; other types open/save-as only.                                                                                                                                        | §3.6      |
| D34 | Backup format (A11): `.glaciertasks` ZIP archive with `manifest.json` (format version, schema version, timestamp, file inventory, SHA-256 checksums), SQLite snapshot and managed files.                                                                                               | DATA-04   |
| D35 | Repository layout: npm workspaces monorepo — `apps/desktop` (Electron main/preload, bundled with esbuild), `apps/ui` (Angular), `packages/domain` (shared types, Zod schemas, invariants), `packages/data` (SQLite migrations/repositories). See `docs/adr/0002-repository-layout.md`. | §13       |

## 2026-10-29 — M1 planning

| ID | Decision | Spec refs |
|---|---|---|
| D36 | Renderer navigation uses the Angular Router with hash URLs (`index.html#/settings`), so routes work over `file://` and support back/forward and deep links. See `docs/adr/0006-renderer-architecture.md`. | UX-02 |
| D37 | A full Glacier Notes-style release workflow ships from M1: manual dispatch or `v*` tag → version stamping, quality gate, Windows NSIS + Linux AppImage/deb builds with packaged smoke tests, GitHub Release (pre-release for `-` versions). | D21, M8 |
| D38 | No native application menu bar on Windows/Linux. All actions live in the app UI; standard text-editing shortcuts keep working; DevTools only in development. | UX-02 |

## 2026-10-29 — M3 planning

| ID | Decision | Spec refs |
|---|---|---|
| D39 | M3 ships a minimal Trash page: directly trashed projects, stories and subtasks with a Restore action (items trashed by a cascade come back with their parent). Permanent deletion, filters and per-project trash views remain in M7. Refines D19. | TRASH-01..06, D19 |
| D40 | The story/subtask editor is a full-page route (`#/projects/:projectId/tasks/:taskId`) with explicit Save/Cancel. Until the M4 board, the project page lists the project's stories. See `docs/adr/0008-task-service-and-markdown.md`. | TASK-03, TASK-08 |

## 2026-10-29 — M5 planning

| ID | Decision | Spec refs |
|---|---|---|
| D41 | Search: the project list view has a filter bar with a text field for the current project. A sidebar entry **Search** (Ctrl+F) opens a search page that defaults to the last opened project and offers "All projects". Results use the list's story rows plus a project column. Confirms the SEARCH-04 assumption. | SEARCH-01..04 |
| D42 | Per project, device settings remember the list/board sort, filters and visible list columns. Search text and expanded rows are not remembered. | LIST-04, D17 |
| D43 | The board and the list share one filter set per project. The board applies it to story fields only (D09) and ignores the status and type filters, because columns are statuses and cards are stories. | BOARD-06, D09 |
| D44 | List columns: issue key and title are always shown. A "Columns" menu toggles status, priority, assignee, due date and labels (on by default) and type, start date, created, updated and subtasks (off by default). | LIST-02 |

## 2026-10-29 — M6 planning

| ID | Decision | Spec refs |
|---|---|---|
| D45 | The project activity view is a third tab on the project page (Board, List, Activity), remembered as `lastView`. | PROJ-06, D12, D17 |
| D46 | Each profile in the profile manager has a "History" button that opens a dialog with the profile's events. | AUDIT-05, D12 |
| D47 | The attachment size limit (D33) is a device setting on the Settings page: whole MiB from 1 to 2048, default 100, stored outside the workspace (D17). | §3.6, D33 |

## 2026-10-29 — M7 planning

| ID | Decision | Spec refs |
|---|---|---|
| D48 | The `.glaciertasks` archive (D34) is written and read with **yazl** and **yauzl** (streaming, ZIP64), pinned exactly. See `docs/adr/0012-backup-restore-and-trash.md`. | DATA-04, T14 |
| D49 | The global Trash page has a project filter; each project page links to its own trash ("Trash (n)"), which opens the Trash page filtered to that project. | TRASH-03 |
| D50 | Permanent deletion is confirmed by typing the project or issue key; "Empty trash" by typing a localized confirmation word. Both warn that only a backup can bring the data back. | TRASH-05 |
| D51 | The board can be grouped by subtasks (Jira-style swimlanes): every story with subtasks gets a row with the status columns, its subtasks are cards that can be dragged into another status on their own (status only, D06; no reordering within a column), and stories without subtasks follow in an "Other stories" row. The grouping is remembered per project like the other view settings (D42). | BOARD-07 |
