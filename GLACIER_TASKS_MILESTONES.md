# Glacier Tasks — Implementation Milestone Plan

**Version:** 1.0  
**Date:** 2026-10-23  
**Companion:** `GLACIER_TASKS_SPEC.md`  
**Status:** Execution-ready plan with assumption-dependent choices identified

## 0. Execution principles

- **Confirmed product scope:** Electron + Angular/TypeScript; Windows/Linux; SQLite; completely offline; multiple projects; story → one-level subtasks; global assignment-only profiles; per-project configurable statuses and labels; fixed priorities; Markdown; Kanban (stories only) and list; start/due dates; attachments; activity history; search/filter/sort; trash/restore; complete backups + JSON export; light/dark/system themes.
- **No sync, network service, sign-in, epics, or sprints.** Do not introduce placeholder APIs or infrastructure for planned synchronization.
- Detailed libraries, UI conventions, backup archive shape, performance thresholds, and lifecycle behaviors labeled **ASSUMPTION** in the specification are defaults subject to adjustment, not user-approved scope.
- Each milestone must leave the application buildable and runnable. Migrations must preserve existing data. Keep tests and docs current.
- Definition of done (DoD): feature implemented, validated at API boundary, accessible from UI if applicable, unit/integration tests passing, no new critical bugs, and manual verification steps recorded.

## M0 — Repository and architecture decisions

**Goal:** Lock choices that otherwise produce painful rework.

**Tasks**
1. Confirm Node/Electron/Angular versions compatible with each other, choose package manager and workspace layout.
2. Choose Angular component library and SQLite driver; verify native-module rebuild/packaging on Windows and Linux.
3. Decide assumptions A02–A05, A09–A12 (issue keys, priorities, workflow categories, files, backups) before schema is frozen.
4. Define TypeScript domain DTOs, error codes, IPC request/response validation, and migration conventions.
5. Document threats: renderer isolation, untrusted Markdown, archive extraction, file-path traversal and remote navigation.

**Deliverables:** ADR(s), repository skeleton, approved domain invariants, architecture diagram.  
**Acceptance:** all platform/library choices documented; no unresolved dependency blocks M1.

## M1 — Electron/Angular foundation and local persistence

**Goal:** Packaged app starts, communicates securely through typed IPC, and opens an initialized SQLite database.

**Tasks**
1. Bootstrap Electron main/preload plus Angular renderer; dev/watch and packaged builds.
2. Set `contextIsolation`, disable Node integration, sandbox renderer, content security policy; prevent unintended external navigation.
3. Implement typed `contextBridge` API, main-process input validation and structured error handling.
4. Create SQLite connection lifecycle, migration runner, schema version tracking, constraints and integration test harness.
5. Add application data directories, safe file operations, app logging, startup error screen, settings storage.
6. Build Windows and Linux smoke packages and verify complete offline start.

**Deliverables:** launchable shell, first migration, settings read/write, smoke tests.  
**Acceptance:** renderer cannot access Node APIs or arbitrary filesystem; startup + restart persist a sample setting; migration tests pass; offline packaged apps launch on both OSs.  
**Dependencies:** M0.

## M2 — Project and global user profile management

**Goal:** Users can manage multiple local projects and shared assignment-only profiles.

**Tasks**
1. Implement project create/list/edit and project key validation; issue sequence generator.
2. Seed project statuses (`To Do`, `In Progress`, `Done`) as **ASSUMPTION** default.
3. Create project sidebar/dashboard, selection and last-project persistence.
4. Implement global profile CRUD/archiving, name validation, avatar import/storage and fallback initials.
5. Cover duplicate project keys, missing avatars, archive behaviors and restart persistence.

**Deliverables:** project switcher, project settings, profile manager, schema and tests.  
**Acceptance:** create two independent projects; same profile appears in both; no login or network; profile avatar remains after moving original file.  
**Dependencies:** M1.

## M3 — Story, subtask and editing core

**Goal:** First complete end-to-end task workflow.

**Tasks**
1. Implement story/subtask database tables and invariants, stable issue numbers, transactional writes.
2. Build create/edit/view flows, title, priority, status, assignee, start/due dates, project labels.
3. Build Markdown edit/preview using local safe renderer/sanitizer.
4. Implement task labels and project label manager; validate project-scoped references.
5. Implement one-level subtask hierarchy and `done/total` progress without auto-parent completion.
6. Begin append-only local activity history on create/update (complete coverage in M6).
7. Add tests for invalid parent type, cross-project reference, assignment cardinality and date rules.

**Deliverables:** working task editor, CRUD IPC, domain validation, initial history.  
**Acceptance:** user can create story and two subtasks, assign each independently, edit Markdown, restart without data loss; finishing subtasks never changes parent status.  
**Dependencies:** M2.

## M4 — Project workflows and Kanban board

**Goal:** Manage stories visually against per-project status configurations.

**Tasks**
1. Add workflow status CRUD, ordering, category and default-status behavior.
2. Add atomic delete-and-migrate wizard with preview of affected stories/subtasks.
3. Build Kanban columns and story-only cards with expandable subtask progress.
4. Implement drag/drop transitions and optional within-column ordering (**ASSUMPTION**), with transactional persistence and rollback UI.
5. Add non-drag status-change action for keyboard access.
6. Test deleting active statuses, cross-project status rejection and project-level workflow isolation.

**Deliverables:** usable Kanban planner, workflow editor, end-to-end scenario.  
**Acceptance:** status changes persist; moving a story does not alter subtasks; deleting used status requires destination and migrates atomically; no subtasks displayed as top-level board cards.  
**Dependencies:** M3.

**First usable MVP checkpoint:** M4, with project/story/subtask editing and basic board functionality. This is **not** yet v1-complete without backups and attachments.

## M5 — List view, full-text search, sorting and filters

**Goal:** Provide efficient navigation for larger workspaces.

**Tasks**
1. Build expandable story/subtask list and configured visible columns.
2. Add SQLite FTS5 indexes for title, Markdown and issue identifier.
3. Implement project/global search (global scope **ASSUMPTION**), status/assignee/priority/label/date filters and relevant sorting.
4. Exclude trashed items from normal results; maintain FTS indexes on writes/migrations/restore.
5. Add pagination or virtualization and keyboard navigation for large result sets.
6. Verify filter and sort interactions with hierarchical rows and project status categories.

**Deliverables:** searchable project list, unified query service, index tests.  
**Acceptance:** search finds titles, descriptions and task keys including subtasks; filters/sorts produce deterministic results; no trashed tasks leak into normal results.  
**Dependencies:** M3–M4.

## M6 — Attachments and complete task activity history

**Goal:** Make tasks useful for local project artifacts and auditable edits.

**Tasks**
1. Implement attachment picker/drag/drop, managed copy, metadata and safe storage keys.
2. Support image previews and open/save-as operations through main process; prevent path traversal and unsafe renderer URLs.
3. Implement add/remove attachment events; cleanup/reconciliation for failed copies.
4. Complete activity events for title, description, priority, dates, assignee, status, labels, attachments, creation, and trash/restore.
5. Add task details history timeline, human-readable event formatting and profile/status display snapshots.
6. Validate binary integrity and behavior when source files are removed.

**Deliverables:** task attachment UI and full history tab, storage tests.  
**Acceptance:** attached file remains available after source deletion; history shows meaningful before/after edits; malicious attachment path/Markdown cannot escape security boundary.  
**Dependencies:** M3–M5.

## M7 — Trash, complete backup/restore and JSON export

**Goal:** Ensure predictable recovery and portable archives for fully local data.

**Tasks**
1. Implement story/subtask/project trash views, cascading semantics and explicit permanent-delete confirmation.
2. Implement restore dependency validation/mapping for removed workflow statuses.
3. Create consistent SQLite snapshot + attachment/avatar inventory under a versioned complete backup archive (**ASSUMPTION** format).
4. Validate restore manifest, schema compatibility, checksums, traversal/size limits; stage and activate with rollback; create pre-restore safety backup where possible.
5. Provide user-facing backup/restore dialogs and detailed success/failure messages.
6. Implement **export-only** structured JSON. Explicitly label it as non-restorable and omit binary data by default (**ASSUMPTION**).
7. Test corruption, disk-full handling, failed restore rollback, and restore into a clean installation.

**Deliverables:** trash manager, reliable full backup/restore, JSON exporter, test fixtures.  
**Acceptance:** complete backup/restore preserves two projects, profiles, statuses, stories, subtasks, history, avatars and attachment bytes; failed restore leaves original data intact; JSON cannot be mistaken for a full backup.  
**Dependencies:** M2–M6.

## M8 — UX polish, reliability and v1 packaging

**Goal:** Release reliable Windows/Linux desktop builds.

**Tasks**
1. Implement Light/Dark/Follow System and persist settings.
2. Add empty/loading/error states, confirmations, keyboard-friendly CRUD/status actions and focus/accessibility review.
3. Optimize board and search for target dataset; verify FTS consistency and migration/restore recovery.
4. Create packaged Windows installer and Linux AppImage/deb (**ASSUMPTION** formats).
5. Run full offline E2E test matrix on both systems, including fresh install, upgrade from previous schema, app restart, corrupt archive, trash/restore.
6. Document data directories, backup recommendations, manual migration, installation, troubleshooting, limitations and known assumptions.
7. Run final security review for Electron configuration, Markdown sanitization, protocol handling, IPC inputs and archive extraction.

**Deliverables:** installable v1 packages, user guide, technical README, release notes, tested acceptance matrix.  
**Acceptance:** all §14 spec Definition-of-Done requirements pass; no known blocker to offline CRUD or data recovery; Windows/Linux packages function without connectivity.  
**Dependencies:** M1–M7.

## Cross-milestone traceability

| Confirmed requirement | Main milestone(s) |
|---|---|
| Electron, Angular, SQLite, offline Windows/Linux | M0, M1, M8 |
| Multiple projects and global profiles | M2 |
| Stories, one-level subtasks, one assignee | M3 |
| Task properties, dates, Markdown, fixed priorities, labels | M3 |
| Per-project statuses and status deletion migration | M4 |
| Story-only Kanban with subtask progress | M4 |
| List, full-text search, filtering, sorting | M5 |
| Managed attachments and activity history | M6 |
| Trash, complete backup/restore, JSON export only | M7 |
| Light/dark/system theme | M8 |
| Independent parent/subtask statuses | M3, M4 |
| Offline-only, no sync, no authentication, no sprints | Architectural guardrail in every milestone |

## Recommended development workflow

- Complete one vertical slice at a time: schema + service + IPC + UI + tests.
- Use a migration for every schema change. Treat test data as disposable, user data as irreplaceable.
- Each PR or coding-agent task should reference a requirement ID (e.g., `TASK-05`, `BOARD-02`, `DATA-06`) and add a test.
- Keep a `DECISIONS.md` for changes to assumption register and architecture decisions; do not silently promote assumptions to product-owner confirmations.
- After each milestone, run a short offline smoke test and create a backup of the development fixture workspace.

## Implementation ticket template

```markdown
### [M#-T##] Short description
Requirement references: TASK-05, BOARD-02
Scope: what changes and what is explicitly excluded
Implementation notes: affected schema/services/IPC/UI
Tests: unit/integration/E2E and manual verification steps
Acceptance criteria:
- [ ] Observable behavior 1
- [ ] Observable behavior 2
Dependencies: ticket IDs
Assumptions: A## references, if any
```

## Release gates

- **MVP gate (end M4):** local project/task management + customizable Kanban works, with persistence, validation and safe IPC.
- **Feature-complete gate (end M7):** all core business features, search, attachments, history, and tested recovery are present.
- **v1 release gate (end M8):** full spec acceptance, security review, packaging, offline validation, and user documentation pass.
