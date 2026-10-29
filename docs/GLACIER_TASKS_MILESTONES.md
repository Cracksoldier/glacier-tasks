# Glacier Tasks — Implementation Milestone Plan

**Version:** 1.1  
**Date:** 2026-10-29  
**Companion:** `GLACIER_TASKS_SPEC.md`, `DECISIONS.md`  
**Status:** Execution-ready plan; review round 1 decisions applied

## 0. Execution principles

- **Confirmed product scope:** Electron + Angular/TypeScript; Windows/Linux x64; SQLite; completely offline; multiple projects; story → one-level subtasks; global assignment-only profiles; per-project configurable statuses and labels; fixed priorities; Markdown; Kanban (stories only) and list; start/due dates; attachments; activity history (tasks and project-level entities, with description versions); search/filter/sort; trash/restore with cascade tracking; complete backups, opt-in automatic backups + JSON export; light/dark/system themes; English/German UI.
- **No sync, network service, sign-in, epics, or sprints.** Do not introduce placeholder APIs or infrastructure for planned synchronization.
- **Reference app:** [Glacier Notes](https://github.com/Cracksoldier/glacier-notes) for colors, icon style, tooling (npm, Vitest, Biome) and the GitHub Actions release workflow.
- Detailed libraries, UI conventions, backup archive shape, performance thresholds, and lifecycle behaviors labeled **ASSUMPTION** in the specification are defaults subject to adjustment, not user-approved scope. Confirmed decisions are listed in `DECISIONS.md`.
- Each milestone must leave the application buildable and runnable. Migrations must preserve existing data. Keep tests and docs current.
- Definition of done (DoD): feature implemented, validated at API boundary, accessible from UI if applicable, all user-facing strings translated (EN/DE), unit/integration tests passing, no new critical bugs, and manual verification steps recorded.

## M0 — Repository and architecture decisions

**Goal:** Lock choices that otherwise produce painful rework.

**Status:** Done (2026-10-29); CI green on Windows and Linux. See `docs/adr/`, `docs/architecture.md`, `docs/threat-model.md`.

**Tasks**
1. Confirm Node/Electron/Angular versions compatible with each other (starting from Glacier Notes' current versions); npm workspaces vs. Glacier Notes' single-package layout.
2. Verify `better-sqlite3` native rebuild for Electron on the Windows 11 dev machine (build tools or prebuilt binaries) and in GitHub Actions for Windows and Linux; pick migration tooling.
3. Confirm the remaining assumptions that affect the schema: A02 (issue numbering), A04 (priorities), A05 (default statuses), A09 (size cap, preview formats), A11 (archive format). Decisions D01–D08 are already fixed.
4. Define TypeScript domain DTOs, error codes, IPC request/response validation, and migration conventions; include `version`, `trash_cascade_root_id` and entity-scoped activity events in the initial schema design.
5. Document threats: renderer isolation, untrusted Markdown, archive extraction, file-path traversal and remote navigation.

**Deliverables:** ADR(s), repository skeleton, approved domain invariants, architecture diagram.  
**Acceptance:** all platform/library choices documented; no unresolved dependency blocks M1.

## M1 — Electron/Angular foundation, persistence and visual foundation

**Goal:** Packaged app starts, communicates securely through typed IPC, opens an initialized SQLite database, and already has its final look and translation layer.

**Status:** Done locally (2026-10-29); see `docs/adr/0006-renderer-architecture.md`. CI run pending.

**Tasks**
1. Bootstrap Electron main/preload plus Angular renderer; dev/watch and packaged builds; Biome formatting; Vitest.
2. Set `contextIsolation`, disable Node integration, sandbox renderer, content security policy; prevent unintended external navigation; single-instance lock.
3. Implement typed `contextBridge` API, main-process input validation and structured error handling.
4. Create SQLite connection lifecycle, migration runner, schema version tracking, constraints and integration test harness.
5. Add application data directories, safe file operations, app logging, startup error screen; device settings stored outside the workspace DB (D17).
6. Port Glacier Notes color tokens; implement Light/Dark/Follow System with Dark as first-launch default (D18); bundle Font Awesome locally.
7. Set up EN/DE translation layer and language switch; first launch follows OS language (D15).
8. Draft the app icon as a Glacier Notes variant (SVG → PNG/ICO sizes) (D23).
9. Add GitHub Actions workflow (adapted from Glacier Notes) that builds Windows and Linux x64 smoke packages; verify complete offline start.

**Deliverables:** launchable shell with theme and language switch, first migration, device settings read/write, CI smoke packages, smoke tests.  
**Acceptance:** renderer cannot access Node APIs or arbitrary filesystem; startup + restart persist theme and language; a second launch focuses the first window; migration tests pass; offline packaged apps from CI launch on both OSs.  
**Dependencies:** M0.

## M2 — Project and global user profile management

**Goal:** Users can manage multiple local projects and shared assignment-only profiles.

**Tasks**
1. Implement project create/list/edit and project key validation (D08); issue sequence generator.
2. Seed project statuses (`To Do`, `In Progress`, `Done`) as **ASSUMPTION** default.
3. Create project sidebar/dashboard, selection and last-project persistence.
4. Implement global profile CRUD/archiving (no hard delete, D29), name validation, avatar import/storage (D24) and fallback initials.
5. Record activity events for project and profile changes (D12) from the start.
6. Cover duplicate project keys (incl. trashed), missing avatars, archive behaviors and restart persistence.

**Deliverables:** project switcher, project settings, profile manager, schema and tests.  
**Acceptance:** create two independent projects; same profile appears in both; no login or network; profile avatar remains after moving original file; project/profile events are stored.  
**Dependencies:** M1.

## M3 — Story, subtask and editing core

**Goal:** First complete end-to-end task workflow.

**Tasks**
1. Implement story/subtask tables and invariants, stable issue numbers, `version`-checked transactional writes (D05).
2. Build create/edit/view flows, title, priority, status, assignee, start/due dates, project labels; conflict handling UI for stale saves.
3. Build Markdown edit/preview using `marked` + `DOMPurify`; read-only checklists (D10).
4. Implement task labels and project label manager with palette colors (D25); validate project-scoped references.
5. Implement one-level subtask hierarchy, move subtask to another story (D04), and `done/total` progress without auto-parent completion.
6. Implement trash fields and trash/restore service with cascade tracking (D02, D19); trashed tasks hidden from views. Trash UI and permanent deletion follow in M7.
7. Begin append-only activity history on create/update, storing full title/description text (D11); label events (D12). Complete coverage in M6.
8. Add tests for invalid parent type, cross-project reference, assignment cardinality, date rules, stale-version rejection and cascade restore.

**Deliverables:** working task editor, CRUD IPC, domain validation, trash service, initial history.  
**Acceptance:** user can create story and two subtasks, assign each independently, edit Markdown, move a subtask to another story, trash and restore a story (independently trashed subtask stays trashed), restart without data loss; finishing subtasks never changes parent status.  
**Dependencies:** M2.

## M4 — Project workflows and Kanban board

**Goal:** Manage stories visually against per-project status configurations.

**Tasks**
1. Add workflow status CRUD, ordering, category and default-status behavior; enforce at least one `DONE` status (D07); status activity events.
2. Add atomic delete-and-migrate wizard with preview of affected stories/subtasks, including trashed tasks (D01).
3. Build Kanban columns and story-only cards with expandable subtasks and subtask status change (D06), using Angular CDK drag & drop.
4. Implement drag/drop transitions and within-column ordering with fractional sort keys (D26), with transactional persistence and rollback UI.
5. Add non-drag status-change action for keyboard access.
6. Test deleting active statuses (live and trashed tasks), last-DONE protection, cross-project status rejection and project-level workflow isolation.

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
4. Show matching subtasks under dimmed non-matching parents in list/search; board filters on story fields only (D09).
5. Exclude trashed items from normal results; maintain FTS indexes on writes and migrations (restore rebuild in M7, D20).
6. Add pagination or virtualization (Angular CDK virtual scroll) and keyboard navigation for large result sets.
7. Verify filter and sort interactions with hierarchical rows and project status categories.

**Deliverables:** searchable project list, unified query service, index tests.  
**Acceptance:** search finds titles, descriptions and task keys including subtasks; filters/sorts produce deterministic results; no trashed tasks leak into normal results.  
**Dependencies:** M3–M4.

## M6 — Attachments and complete activity history

**Goal:** Make tasks useful for local project artifacts and auditable edits.

**Tasks**
1. Implement attachment picker/drag/drop, managed copy, metadata and safe storage keys.
2. Support image previews and open/save-as operations through main process; prevent path traversal and unsafe renderer URLs.
3. Support inline Markdown images via `attachment:<id>` for the same task, with an insert action in the editor (D10).
4. Implement attachment removal: confirmation, immediate byte deletion, tombstone, history event (D03); cleanup/reconciliation for failed copies and orphaned bytes.
5. Complete activity events for tasks (incl. parent-story subtask events, D27) and for projects, statuses, labels and profiles (D12).
6. Add task history timeline, description version browser with compare-to-previous (D11), project activity view and profile history; human-readable formatting with display snapshots (EN/DE).
7. Validate binary integrity and behavior when source files are removed.

**Deliverables:** task attachment UI, full history views, storage tests.  
**Acceptance:** attached file remains available after source deletion; inline attachment images render and other image sources are not loaded; history shows meaningful before/after edits and all description versions; malicious attachment path/Markdown cannot escape security boundary.  
**Dependencies:** M3–M5.

## M7 — Trash UI, complete backup/restore and JSON export

**Goal:** Ensure predictable recovery and portable archives for fully local data.

**Tasks**
1. Implement project-specific and global trash views and explicit permanent-delete confirmation (service exists since M3, D19), including attachment byte removal.
2. Create consistent SQLite snapshot + attachment/avatar inventory under a versioned complete backup archive (**ASSUMPTION** format).
3. Validate restore manifest, schema compatibility (older → migrate, newer → reject, D28), checksums, traversal/size limits; stage and activate with rollback; create pre-restore safety backup where possible; never touch device settings (D17).
4. Rebuild FTS indexes after restore (D20).
5. Implement opt-in automatic backups: folder picker, launch-time check against interval, retention of newest N, non-blocking warning if folder unavailable (D13).
6. Provide user-facing backup/restore dialogs and detailed success/failure messages.
7. Implement **export-only** structured JSON with workspace/project scope and optional trashed items (D14). Explicitly label it as non-restorable; no binary data.
8. Test corruption, disk-full handling, failed restore rollback, restore into a clean installation, search integrity after restore, and automatic backup retention.

**Deliverables:** trash manager, reliable full backup/restore, automatic backups, JSON exporter, test fixtures.  
**Acceptance:** complete backup/restore preserves two projects, profiles, statuses, stories, subtasks, history, avatars and attachment bytes; search works immediately after restore; failed restore leaves original data intact; automatic backups keep only the configured number; JSON cannot be mistaken for a full backup.  
**Dependencies:** M2–M6.

## M8 — UX polish, reliability and v1 packaging

**Goal:** Release reliable Windows/Linux desktop builds.

**Tasks**
1. Review theme consistency (all three modes) and EN/DE translation completeness across all screens.
2. Add empty/loading/error states, confirmations, keyboard-friendly CRUD/status actions and focus/accessibility review.
3. Optimize board and search for target dataset; verify FTS consistency and migration/restore recovery.
4. Finalize GitHub Actions release workflow: Windows NSIS installer, Linux AppImage and deb, x64 only (D21); version stamping and GitHub Release publishing as in Glacier Notes.
5. Run full offline E2E test matrix (Playwright) on both systems in CI, including fresh install, upgrade from previous schema, app restart, corrupt archive, trash/restore.
6. Document data directories, backup recommendations, manual migration, installation, troubleshooting, limitations and known assumptions.
7. Run final security review for Electron configuration, Markdown sanitization, protocol handling, IPC inputs and archive extraction.

**Deliverables:** installable v1 packages, user guide, technical README, release notes, tested acceptance matrix.  
**Acceptance:** all §14 spec Definition-of-Done requirements pass; no known blocker to offline CRUD or data recovery; Windows/Linux packages built by CI function without connectivity.  
**Dependencies:** M1–M7.

## Cross-milestone traceability

| Confirmed requirement                                             | Main milestone(s)                          |
| ----------------------------------------------------------------- | ------------------------------------------ |
| Electron, Angular, SQLite, offline Windows/Linux x64              | M0, M1, M8                                 |
| Themes (Glacier Notes tokens), EN/DE, app icon                    | M1, M8                                     |
| GitHub Actions release builds                                     | M1 (smoke), M8 (release)                   |
| Multiple projects and global profiles                             | M2                                         |
| Stories, one-level subtasks, one assignee, move subtask           | M3                                         |
| Task properties, dates, Markdown, fixed priorities, labels        | M3                                         |
| Optimistic concurrency, single instance                           | M1, M3                                     |
| Trash service with cascade tracking                               | M3 (service), M7 (UI, permanent delete)    |
| Per-project statuses and status deletion migration                | M4                                         |
| Story-only Kanban with subtask progress and subtask status change | M4                                         |
| List, full-text search, filtering, sorting                        | M5                                         |
| Managed attachments, inline attachment images                     | M6                                         |
| Activity history incl. description versions and non-task entities | M2–M6                                      |
| Complete backup/restore, automatic backups, JSON export only      | M7                                         |
| Independent parent/subtask statuses                               | M3, M4                                     |
| Offline-only, no sync, no authentication, no sprints              | Architectural guardrail in every milestone |

## Recommended development workflow

- Complete one vertical slice at a time: schema + service + IPC + UI + tests.
- Use a migration for every schema change. Treat test data as disposable, user data as irreplaceable.
- Each PR or coding-agent task should reference a requirement ID (e.g., `TASK-05`, `BOARD-02`, `DATA-06`) and add a test.
- Keep `DECISIONS.md` updated for changes to the assumption register and architecture decisions; do not silently promote assumptions to product-owner confirmations.
- After each milestone, run a short offline smoke test and create a backup of the development fixture workspace.

## Implementation ticket template

```markdown
### [M#-T##] Short description

Requirement references: TASK-05, BOARD-02
Decisions: D##, if any
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

- **MVP gate (end M4):** local project/task management + customizable Kanban works, with persistence, validation, safe IPC, themes and EN/DE.
- **Feature-complete gate (end M7):** all core business features, search, attachments, history, and tested recovery are present.
- **v1 release gate (end M8):** full spec acceptance, security review, CI packaging, offline validation, and user documentation pass.
