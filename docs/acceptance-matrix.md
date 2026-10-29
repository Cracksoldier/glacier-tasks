# v1 acceptance matrix

Each item of the Definition of Done (`docs/GLACIER_TASKS_SPEC.md` §14) and the tests that prove
it. CI runs all of them on Windows and Linux.
- **E2E:** `tests/e2e`, Playwright against the built app.
- **Unit:** Vitest specs in the workspace named in the table.
- **Smoke:** the packaged self-test (`npm run smoke`).

Status as of v1.0.0: **all items pass.**

| §14 item | Main tests |
| --- | --- |
| Projects | E2E `projects-profiles.spec.ts`: projects, profiles and avatars persist locally · E2E `keyboard.spec.ts` · Unit `packages/data/src/services/services.spec.ts` |
| Story/subtask hierarchy | E2E `tasks.spec.ts`: stories, subtasks, Markdown and moves persist · Unit `packages/data/src/services/tasks.spec.ts` |
| Assignments | E2E `projects-profiles.spec.ts` · Unit `tasks.spec.ts` (bulk unassignment, archived assignee) |
| Configurable workflows | E2E `board.spec.ts`: deleting a status migrates live and trashed tasks · Unit `packages/data/src/services/workflows.spec.ts` |
| Board | E2E `board.spec.ts`: stories move by drag and keyboard…; grouped by subtasks… · Unit `apps/ui/src/app/pages/projects/board*.spec.ts` |
| List | E2E `list-search.spec.ts`: list view filters, sorts and remembers its state · Unit `apps/ui/src/app/shared/task-list.spec.ts` |
| Task fields | E2E `tasks.spec.ts`; `keyboard.spec.ts` · Unit `apps/ui/src/app/pages/task/task-editor-page.spec.ts` |
| Local attachments | E2E `attachments-history.spec.ts`: attachments render inline for their own task… · Unit `apps/desktop/src/attachment-store.spec.ts` (survives source deletion, staging, reconciliation) |
| Activity history incl. description versions and non-task entities | E2E `attachments-history.spec.ts` (versions compare; project activity and profile history) · Unit `apps/ui/src/app/core/activity/activity-format.spec.ts` (every event type) |
| Markdown preview | E2E `tasks.spec.ts`, `attachments-history.spec.ts` · Unit `apps/ui/src/app/core/markdown/markdown.service.spec.ts` |
| Search/filter/sort | E2E `list-search.spec.ts` (both tests) · Unit `packages/data/src/services/task-query.spec.ts` (filters, sorting, FTS, 10,000-task timing) |
| Per-project labels | Unit `packages/data/src/services/tasks.spec.ts` (labels), `apps/ui/src/app/pages/trash/trash-page.spec.ts` (label manager) · E2E `list-search.spec.ts` (label column) |
| Trash/restore with cascade semantics | E2E `tasks.spec.ts`: trash keeps independently trashed subtasks…; `backup-trash.spec.ts`: permanent deletion… · Unit `packages/data/src/services/trash-export.spec.ts` |
| Full backup/restore | E2E `backup-trash.spec.ts`: a complete backup restores everything…; a damaged archive is rejected… · Unit `apps/desktop/src/backup.spec.ts` (round trip, older schema, rollback, clean install, archive attacks) · Smoke (archive written and validated) |
| Opt-in automatic backups | Unit `apps/desktop/src/backup.spec.ts` (automatic backups: due/skip, retention, unavailable folder) · Unit `apps/ui/src/app/pages/data-and-trash.spec.ts` |
| JSON export | E2E `backup-trash.spec.ts`: the JSON export is clearly not a backup… · Unit `trash-export.spec.ts` (exportWorkspace) |
| Light/dark/system themes | E2E `foundation.spec.ts`: a fresh profile starts dark…; `a11y.spec.ts` (light and dark) · Unit `apps/ui/src/app/core/theme/theme.service.spec.ts` |
| English/German UI | E2E `foundation.spec.ts` (language survives restart); `upgrade-locale.spec.ts`: date fields switch… · Unit `npm run check:i18n`, compile-time key check in `de.ts` |
| Windows/Linux packaging via GitHub Actions | CI `ci.yml` (package + Smoke on both systems) · `release-builds.yml` (NSIS, AppImage, deb, checksums) |
| Reliable offline operation | Smoke (zero network requests) · `npm run verify:offline` · E2E `foundation.spec.ts` (T1) · E2E `upgrade-locale.spec.ts`: a workspace from schema version 1 is upgraded… |

## Additional checks in M8

- **Accessibility:** no serious or critical axe-core violations on any screen in light or dark
  mode (`a11y.spec.ts`).
- **Keyboard:** the core create, edit, status and trash flows work by keyboard
  (`keyboard.spec.ts`).
- **Performance:**
  - list and search over 10,000 tasks take about 31 ms
  - a board with 2,000 stories renders in about 80–130 ms with 100 cards per column
- **Security review:** see `docs/security-review.md`.
