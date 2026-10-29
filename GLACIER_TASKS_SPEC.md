# Glacier Tasks — Functional & Technical Specification

**Version:** 1.0 (implementation baseline)  
**Date:** 2026-10-23  
**Status:** Draft ready for implementation, with explicitly marked assumptions  
**Product:** Glacier Tasks

## 0. Decision register and scope convention

- **[CONFIRMED]** means explicitly selected by the product owner in this conversation.
- **[ASSUMPTION]** means a proposed implementation default, not yet explicitly approved. These are listed in §16 and must remain configurable or easy to revise where practical.
- **[OUT OF SCOPE]** means excluded from version 1; if the exclusion was not explicitly selected, it is marked as an assumption.
- **[REQUIREMENT]** means a behavior required for a coherent implementation of confirmed choices, and may include implementation-level detail.

The milestone plan lives in the separate file `GLACIER_TASKS_MILESTONES.md`.

## 1. Vision

**[CONFIRMED]** Glacier Tasks is a completely offline, Jira-inspired desktop task planner made with Electron and Angular/TypeScript for Windows and Linux. It supports multiple projects; each project contains stories, each story can contain one level of subtasks. Users are local assignment profiles (name, optional avatar) with no authentication, and each task has at most one assignee. The app is designed to remain offline permanently: no cloud account, network backend, or future sync requirement.

### 1.1 Design objectives

1. Fast project/task navigation and editing; minimize administrative overhead.
2. Every ordinary action functions without internet connectivity.
3. Safely persist data and attachments locally, with recoverable backups.
4. Make project workflow configurable, while keeping task hierarchy simple.
5. Maintain traceable local task history and predictable deletion/recovery semantics.

### 1.2 Explicit exclusions

- **[CONFIRMED]** No sprints in v1; no login/authentication; no synchronization now or planned.
- **[ASSUMPTION / OUT OF SCOPE]** No epics, task types other than story/subtask, nesting beyond a single subtask level, team collaboration/live multiwriter access, hosted service, comments/discussion threads, notifications, worklogs/time tracking, issue dependencies, or public API in v1.

## 2. Technology and security boundaries

| Area | Requirement / proposed solution | Status |
|---|---|---|
| Desktop shell | Electron | CONFIRMED |
| UI | Angular + TypeScript | CONFIRMED |
| Targets | Windows and Linux | CONFIRMED |
| Storage | One local SQLite workspace database | CONFIRMED (SQLite), ASSUMPTION (single workspace DB) |
| Web server | None; renderer uses a typed preload/IPC API | ASSUMPTION |
| SQLite driver | Main-process `better-sqlite3` or an equivalent supported native SQLite implementation | ASSUMPTION |
| UI widgets | Angular Material or PrimeNG, choose one consistently | ASSUMPTION |
| Markdown | Local parsing and sanitization; no remote rendering/CDNs | REQUIREMENT |
| Search | SQLite FTS5 plus structured filtering | ASSUMPTION |
| Packaging | electron-builder, Windows installer and Linux AppImage/deb | ASSUMPTION |
| Testing | Unit, integration, and packaged-Electron E2E tests | REQUIREMENT |

### 2.1 Application architecture

```text
Angular Renderer (sandboxed, no Node.js APIs)
    ↕ contextBridge typed API, invoke/handle IPC
Electron Main Process
    ├─ Application Services (projects, users, tasks, workflows, history)
    ├─ Domain Validation + Transactions
    ├─ SQLite Repository + Migrations
    ├─ Attachment/Avatar Storage Service
    ├─ Backup/Restore/Export Service
    └─ OS Dialogs + App Settings
Local app data directory
    ├─ glacier-tasks.sqlite
    ├─ attachments/<opaque-file-id>
    ├─ avatars/<opaque-file-id>
    └─ other app-managed metadata
```

**[REQUIREMENT]** Run with `contextIsolation: true`, `nodeIntegration: false`, sandbox enabled where supported, a restrictive CSP, and a narrow `contextBridge` surface. Do not expose raw `ipcRenderer`, SQL execution, or arbitrary filesystem access to the renderer. Validate every IPC payload in the main process (e.g., Zod or equivalent). All filesystem paths must be resolved by the main process; protect against `..`, absolute-path escapes, and symlink traversal. Block arbitrary remote navigation and new windows. No analytics, auto-update checks, externally hosted fonts, external Markdown assets, or network requests by default. Treat restored files and attachments as untrusted input.

## 3. Core entities and identifiers

### 3.1 Project

- **[CONFIRMED]** Unlimited logical projects, each with configurable workflow statuses and project-specific custom labels.
- **[ASSUMPTION]** Fields: `id` (UUID), `key` (uppercase human-readable unique short code), `name`, `description` (optional), `createdAt`, `updatedAt`, `trashedAt` (nullable).
- **[ASSUMPTION]** Issue identifier is immutable and human-readable: `<PROJECT_KEY>-<SEQUENCE>`, e.g. `GAME-42`. A project's key becomes immutable once it has issued any task IDs. Stories and subtasks share the same monotonic sequence per project to avoid collisions.
- Every project owns exactly one workflow configuration. Different projects can have different status values and order.

### 3.2 User (assignee profile)

- **[CONFIRMED]** Globally available across projects; `name` required, `avatar` optional; no credentials, sign-in, roles, or permissions.
- **[ASSUMPTION]** Fields: `id`, `name`, `avatarFileId` (nullable), `createdAt`, `updatedAt`, `archivedAt` (nullable). Names need not be unique; UI disambiguates using avatar and profile ID where necessary.
- **[ASSUMPTION]** Archive profile rather than destructive hard deletion by default; archived profiles cannot be newly assigned but historical snapshots remain. Existing assignments to an archived profile display as archived until explicitly reassigned or unassigned.

### 3.3 Story and subtask

- **[CONFIRMED]** Only two task types; each subtask belongs to exactly one story. Nested subtasks and orphan subtasks are disallowed; tasks have at most one assignee.
- **[CONFIRMED]** Task fields: title, Markdown description, priority, status, optional start date and due date, labels, assignee; local attachments and activity history.
- **[ASSUMPTION]** Shared fields: `id` (UUID), `issueNumber`, `projectId`, `type` (`STORY`/`SUBTASK`), `parentStoryId` (nullable for stories, required for subtasks), `title`, `descriptionMarkdown`, `priority`, `statusId`, `assigneeUserId` (nullable), `startDate`/`dueDate` (nullable ISO local dates), `sortOrder`, `createdAt`, `updatedAt`, `trashedAt` (nullable).
- **[ASSUMPTION]** Fixed priorities: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, with default `MEDIUM`. Labels are separate project-specific entities, many-to-many with tasks.
- **[REQUIREMENT]** Prevent a subtask from being assigned to another project independently of its parent. Updating a story's status must **not** automatically update its subtasks, and vice versa. Completing all subtasks must **not** automatically complete the parent story.
- **[ASSUMPTION]** Task start date must not exceed its due date when both are present; timestamps are UTC, date-only fields are local calendar dates.
- **[ASSUMPTION]** Task titles required, trimmed, max 255 characters; Markdown description max 100,000 characters; app displays validation feedback.

### 3.4 Workflow status

- **[CONFIRMED]** Statuses are configurable separately for each project. When deleting a status used by tasks, the user must pick another status and affected tasks are migrated before removal.
- **[ASSUMPTION]** Fields: `id`, `projectId`, `name`, `category` (`TODO`, `IN_PROGRESS`, `DONE`), `position`, `isDefault`, `createdAt`, `updatedAt`.
- **[ASSUMPTION]** Initial statuses on project creation: `To Do`, `In Progress`, `Done`. Exactly one default status is required; each project must retain at least one status. Category `DONE` is used for progress calculations independently of the custom display name. Status changes are unrestricted, including reopening completed tasks.
- **[REQUIREMENT]** Rename and reorder statuses without breaking historical references. A status removal/migration must be an atomic transaction, include affected stories/subtasks, and emit activity records.

### 3.5 Label

- **[CONFIRMED]** Labels are customizable per project; priority options are fixed.
- **[ASSUMPTION]** Fields: `id`, `projectId`, `name`, `color` (optional); unique case-insensitive name within project. Deleting a label removes task-label links, not tasks; record link removal in history.

### 3.6 Attachment and avatar

- **[CONFIRMED]** Task attachments support files and images, copied into application-managed local storage.
- **[ASSUMPTION]** Metadata: `id`, `taskId`, `originalName`, `mimeType`, `byteSize`, `sha256`, `storageKey`, `addedAt`. Files are stored under random opaque names; never use the uploaded filename as the storage path.
- **[ASSUMPTION]** UI supports file picker and drag-and-drop, safe image previews for supported raster formats, open/save-as using OS dialogs, and removal with confirmation. No executable embedding in HTML; images served via a secure custom local protocol or safe IPC-backed method, not unrestricted `file://` access.
- **[ASSUMPTION]** Default per-file size limit 100 MiB (configurable); reject unsupported/unsafe previews, but permit other file types as downloadable/openable attachments with user confirmation.
- **[REQUIREMENT]** Attachment bytes survive source-file deletion/move and are included in backups. Use a staged-copy → metadata transaction → finalize/cleanup pattern; reconcile incomplete operations on startup.

### 3.7 Activity event

- **[CONFIRMED]** Local change history is required.
- **[ASSUMPTION]** Immutable event records: `id`, `taskId`, `eventType`, `occurredAt`, `payloadJson`, `actor` = `LOCAL_USER` (no login identity), optional `source` = `UI` / `RESTORE` / `SYSTEM`.
- Capture creation, title/description edits, priority and date changes, assignment, status changes, label changes, attachment add/remove, subtask create/delete/restore, trash/restore. Store safe structured before/after values where appropriate; avoid recording full attachment bytes or redundant full description bodies.
- **[ASSUMPTION]** Activity events are visible on the task details screen, newest first, with a human-readable summary. They are not an undo engine.

## 4. Functional requirements

### 4.1 Projects (`PROJ`)

- `PROJ-01` Create project with required name and unique key.
- `PROJ-02` List and navigate multiple projects; persist last selected project locally.
- `PROJ-03` Edit project name/description and manage project-level statuses and labels.
- `PROJ-04` Trash, restore, and permanently delete projects according to §4.10.
- `PROJ-05` Project management never requires internet or authentication.

### 4.2 Assignee profiles (`USER`)

- `USER-01` Create/edit profiles with required name and optional avatar.
- `USER-02` Show avatars or generated initials fallback, and choose assignees across any project.
- `USER-03` Each story/subtask has zero or one assignee.
- `USER-04` Maintain profile references/history without fabricating real authentication identity.
- `USER-05` **[ASSUMPTION]** Archive/unarchive profiles, and offer explicit bulk unassignment for archived profiles.

### 4.3 Task editing (`TASK`)

- `TASK-01` Create, edit, view, trash, restore, and permanently delete stories.
- `TASK-02` Create/edit/trash subtasks only under a story; no nesting.
- `TASK-03` Required title; Markdown description editor with preview; priority, status, dates, project labels, assignee.
- `TASK-04` On task creation, use project's default status; optional fields start empty.
- `TASK-05` Subtask status and parent status are independent.
- `TASK-06` Show story subtask progress (`done / total`) using status category `DONE`, without mutating parent status.
- `TASK-07` Reject invalid references, cross-project labels/statuses, invalid dates, and nonexistent parents.
- `TASK-08` **[ASSUMPTION]** Persist changes with explicit Save/Cancel in full editor; quick Kanban status changes save immediately and report failures.

### 4.4 Markdown (`MD`)

- `MD-01` Edit Markdown text and switch between edit and rendered preview.
- `MD-02` Preserve original Markdown source; do not rewrite formatting when saving.
- `MD-03` Sanitize rendered HTML, strip scripts/unsafe URLs, and do not load remote images or URLs silently. External links require explicit user action and OS/browser handoff.
- `MD-04` **[ASSUMPTION]** Support CommonMark plus GitHub-style tables, checklists, and fenced code blocks; no arbitrary embedded HTML.

### 4.5 Kanban (`BOARD`)

- `BOARD-01` Project-specific board with one column per configured status, ordered by workflow position.
- `BOARD-02` Display **stories only** as cards. Card includes issue key, title, priority, assignee, labels, due date, and `done/total` subtask summary where present.
- `BOARD-03` Expand card to inspect subtask progress/details, but do not place subtasks as standalone top-level cards.
- `BOARD-04` Drag stories across columns to change status; use typed validation and atomic persistence, showing an error and restoring UI state if write fails.
- `BOARD-05` Reorder cards within a column; persist order **[ASSUMPTION]**.
- `BOARD-06` Apply project filters consistently with the list view.

### 4.6 List view and navigation (`LIST`)

- `LIST-01` Project-specific searchable, sortable, filterable task list.
- `LIST-02` **[ASSUMPTION]** Stories appear as expandable rows with children shown beneath; status, priority, assignee, due date and labels visible as columns.
- `LIST-03` **[ASSUMPTION]** Sorting supports issue key, title, priority, status, assignee, creation/update date, start date and due date; filtering supports status, priority, assignee, labels, dates and task type.
- `LIST-04` Preserve view-specific selection, sorting and filtering per project **[ASSUMPTION]**.

### 4.7 Search (`SEARCH`)

- `SEARCH-01` Full-text search, filtering and sorting.
- `SEARCH-02` Search story/subtask title, Markdown description, and issue key; support filters by project/status/priority/assignee/label/date **[ASSUMPTION]**.
- `SEARCH-03` Use locally maintained FTS indexes; index updates in same transaction as task writes. Rebuild indexes after restore or schema upgrade as necessary.
- `SEARCH-04` **[ASSUMPTION]** Search defaults to current project with an option to search all projects. Trash is excluded from regular search.

### 4.8 Attachments (`FILE`)

- `FILE-01` Attach files/images to stories and subtasks.
- `FILE-02` Copy bytes to managed storage; retain original display name and file metadata.
- `FILE-03` Permit supported image preview and file open/save-as without exposing arbitrary disk paths to renderer.
- `FILE-04` Include all live and trashed-task attachments in complete backups.
- `FILE-05` Attachment deletion is recorded in task history; physical removal follows trash/retention lifecycle **[ASSUMPTION]**.

### 4.9 History (`AUDIT`)

- `AUDIT-01` Append-only local activity events for the task changes described in §3.7.
- `AUDIT-02` Present chronological history on task details; historical assignee names must remain intelligible even if profile later changes.
- `AUDIT-03` **[ASSUMPTION]** Record snapshots of display names at event time rather than requiring joins to the current user or status names.

### 4.10 Trash and deletion (`TRASH`)

- `TRASH-01` Deleting a story or project moves it to trash; user can restore or permanently delete it.
- `TRASH-02` **[ASSUMPTION]** Trashing a story includes its subtasks, task history, attachments and labels; trashing a project includes all contained task data. Their parent/child relationships remain intact while in trash.
- `TRASH-03` **[ASSUMPTION]** Project-specific and global trash views; no automatic expiry in v1.
- `TRASH-04` On restore, validate project and status dependencies. Restore parent before child; if a previously referenced status was removed, require the user to map it to an existing status before restore.
- `TRASH-05` Permanent deletion requires a strong confirmation and permanently removes dependent records and managed attachment bytes. Warn that only backups can recover such content.
- `TRASH-06` **[ASSUMPTION]** A subtask can be independently trashed/restored, provided its story is not in trash; if parent is trashed, restore parent first.

### 4.11 Backup, restore and JSON export (`DATA`)

- `DATA-01` Full backup and restore, including database, attachment bytes, avatars, and manifest/schema-version metadata.
- `DATA-02` JSON export is **export-only**; **no JSON import** in v1. Only full backup restoration imports application data.
- `DATA-03` **[ASSUMPTION]** Export creates structured JSON containing project/user/story/subtask/status/label/history metadata and attachment descriptors, but **not** binary attachment/avatar data. User-facing warning explains that JSON is not a restorable complete backup.
- `DATA-04` **[ASSUMPTION]** Use a versioned `.glaciertasks` archive (ZIP with `manifest.json`, consistent SQLite snapshot, and managed file entries); include checksums and validate archive paths and size limits on restore.
- `DATA-05` Backups are captured from a consistent database snapshot (SQLite backup API or equivalent) while protecting attachment consistency; never ZIP a live WAL database directory without coordination.
- `DATA-06` Before destructive restore, automatically create a safety backup of the current workspace when possible; stage and validate restored data before atomic activation, with rollback on failure.
- `DATA-07` Restore replaces the **entire** local workspace, rather than merges with it **[ASSUMPTION]**. Warn user that current data will be replaced and obtain explicit confirmation.
- `DATA-08` Backups/restores work completely offline. Never execute contents of a backup or treat archive members as trusted file paths.

### 4.12 UI/settings/accessibility (`UX`)

- `UX-01` Theme setting: `Light`, `Dark`, `Follow System`.
- `UX-02` **[ASSUMPTION]** Left sidebar for project selection and navigation; central board/list workspace; task details drawer or modal; dialogs for profile/workflow/settings management.
- `UX-03` **[ASSUMPTION]** Keyboard focus, labels and meaningful error messages; keyboard-accessible core CRUD and list editing. Drag-and-drop must have a non-drag fallback for changing status.
- `UX-04` **[ASSUMPTION]** Remember window size, last project, last view and theme locally.
- `UX-05` No login/logout UI, user permissions, sync state, or server configuration screens.

## 5. Data model and database constraints

**Proposed logical schema [ASSUMPTION unless implementing a confirmed relationship]:**

```text
projects(id PK, project_key UNIQUE, name, description, next_issue_number,
         created_at, updated_at, trashed_at)
users(id PK, name, avatar_file_id NULL, created_at, updated_at, archived_at)
statuses(id PK, project_id FK, name, category, position, is_default, UNIQUE(project_id,name))
labels(id PK, project_id FK, name, color, UNIQUE(project_id,name COLLATE NOCASE))
tasks(id PK, project_id FK, issue_number, type, parent_story_id NULL FK tasks,
      title, description_markdown, priority, status_id FK, assignee_user_id NULL FK users,
      start_date NULL, due_date NULL, sort_order, created_at, updated_at, trashed_at,
      UNIQUE(project_id,issue_number))
task_labels(task_id FK, label_id FK, PRIMARY KEY(task_id,label_id))
attachments(id PK, task_id FK, original_name, mime_type, byte_size,
            sha256, storage_key UNIQUE, added_at, removed_at NULL)
avatar_files(id PK, storage_key UNIQUE, mime_type, sha256, byte_size)
activity_events(id PK, task_id FK, event_type, occurred_at, payload_json, source)
settings(key PK, value_json)
schema_migrations(version PK, applied_at)
```

### 5.1 Required invariants

- Use `PRAGMA foreign_keys=ON` on every connection, SQLite WAL for day-to-day runtime **[ASSUMPTION]**, and busy timeout where appropriate.
- Story: `parent_story_id IS NULL`. Subtask: `parent_story_id IS NOT NULL` and references a story **in the same project**. Enforce complex cross-row invariants in transactional service logic, optionally with DB triggers.
- Every task's `status_id` must belong to its project, and each `task_labels.label_id` must belong to the same project as the task.
- Exactly one default status per non-trashed project; avoid deleting the last workflow status.
- All writes affecting multiple tables or event history must be atomic transactions.
- Use schema migrations; never implicitly reconstruct tables or wipe data after a version mismatch.
- SQLite FTS5 `tasks_fts` mirrors live task title/description/key and is maintained reliably with explicit update flows/triggers; restore and migration tests verify search integrity.
- Use immutable IDs for joins, while human-readable issue keys remain stable within the project.

## 6. Main-process API contract (proposed)

Expose grouped, typed functions on `window.glacierTasks` (names illustrative):

```typescript
interface GlacierTasksAPI {
  projects: {
    list(): Promise<ProjectSummary[]>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: string, patch: UpdateProjectInput): Promise<Project>;
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
  };
  users: {
    list(includeArchived?: boolean): Promise<UserProfile[]>;
    create(input: CreateUserInput): Promise<UserProfile>;
    update(id: string, input: UpdateUserInput): Promise<UserProfile>;
    archive(id: string): Promise<void>;
  };
  tasks: {
    query(input: TaskQuery): Promise<PagedResult<TaskSummary>>;
    get(id: string): Promise<TaskDetail>;
    create(input: CreateTaskInput): Promise<TaskDetail>;
    update(id: string, patch: UpdateTaskInput): Promise<TaskDetail>;
    move(id: string, statusId: string, sortOrder?: number): Promise<void>;
    trash(id: string): Promise<void>;
    restore(id: string, mapping?: RestoreMapping): Promise<void>;
    history(id: string): Promise<ActivityEvent[]>;
  };
  workflows: {
    list(projectId: string): Promise<WorkflowStatus[]>;
    create(projectId: string, input: StatusInput): Promise<WorkflowStatus>;
    update(id: string, patch: StatusPatch): Promise<WorkflowStatus>;
    removeAndMigrate(statusId: string, replacementStatusId: string): Promise<void>;
  };
  attachments: {
    add(taskId: string): Promise<AttachmentMetadata[]>; // main-process file picker
    list(taskId: string): Promise<AttachmentMetadata[]>;
    open(id: string): Promise<void>;
    saveAs(id: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
  data: {
    backup(): Promise<BackupResult>;
    restore(): Promise<RestoreResult>;
    exportJson(): Promise<ExportResult>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
}
```

All IPC methods must validate inputs, return structured error codes (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `IO`, `BACKUP_INVALID`, `MIGRATION_REQUIRED`), and avoid leaking system paths or stack traces to the UI. Methods not shown (labels, trash list/purge, avatar selection, card ordering) should follow the same interface style. Pagination is recommended for large task lists.

## 7. Screen inventory

1. **Project switcher/dashboard:** recent projects; create/edit project; counts of open/done stories **[ASSUMPTION]**.
2. **Project Kanban:** status columns, story cards, optional card expansion for subtasks, drag/drop, filters.
3. **Project List:** hierarchical expandable stories/subtasks, sortable/filterable fields, quick navigation.
4. **Story/Subtask editor:** full fields, Markdown edit/preview, labels, assignee, attachment browser, history.
5. **Workflow editor:** add/rename/reorder/configure status categories; delete with mandatory migration.
6. **Label manager:** project label CRUD.
7. **Profile manager:** global assignment profiles and avatars.
8. **Search:** scoped/global results with filters.
9. **Trash:** view and restore projects/stories/subtasks; permanent delete.
10. **Settings/Data management:** theme, backup, restore, JSON export, local storage information.

## 8. Canonical user journeys and acceptance criteria

### UJ-01: New project and story

**Given** no projects exist, **when** user creates `Game Dev` (`GAME`), **then** the project appears in switcher with default statuses and an empty board. **When** user creates a story titled `Implement inventory`, **then** it receives a unique key like `GAME-1`, status `To Do`, and appears in its board column and list view. It survives app restart.

### UJ-02: Independent subtask completion

**Given** story `GAME-1` has two subtasks, **when** one subtask is moved to category `DONE`, **then** card progress reads `1/2`. The parent story status remains unchanged. Moving second subtask to `DONE` yields `2/2` without auto-completing the story.

### UJ-03: One assignee, globally available

**Given** profile `Alex` exists, **when** editing tasks in two separate projects, **then** both can be assigned to Alex, and a task cannot have two simultaneous assignees. No login screen appears.

### UJ-04: Status migration

**Given** multiple tasks use custom project status `Review`, **when** user deletes `Review`, **then** UI requires another status in the same project; status removal and task migration succeed atomically with activity records. If canceled or transaction fails, nothing changes.

### UJ-05: Attachments retained locally

**Given** a task attachment is added from a source file, **when** original file is deleted and app restarted, **then** the managed attachment remains available. **When** a full backup is restored into a clean installation, **then** the attachment remains available there.

### UJ-06: Trash and restoration

**Given** a story has subtasks and attachments, **when** trashed, **then** it disappears from regular board/list/search and appears in trash. **When** restored, **then** its subtasks/attachments/history are restored with it. Permanent deletion requires explicit confirmation.

### UJ-07: Backup versus JSON

**Given** a workspace has two projects, profiles, attachments and histories, **when** complete backup is made and restored, **then** all of these are preserved, including IDs and project workflows. **When** a JSON export is made, **then** it is clearly labeled informational/non-restorable and must not silently replace backup functionality.

### UJ-08: Offline/security

**Given** network is disabled, **when** user performs all standard CRUD, search, attachment, theme, backup/export actions, **then** they work. **Given** Markdown contains scripts or `javascript:` URLs, **when** previewing, **then** code does not execute.

## 9. Nonfunctional requirements (proposed quantitative targets)

These figures are **[ASSUMPTIONS]**, not product-owner commitments; benchmark on a representative mid-range Windows PC and Linux machine.

- Supports at least 20 projects, 10,000 total tasks, 100 users, and 1,000 labels across projects without correctness degradation.
- Typical board load for up to 500 visible stories: target under 1 second after DB ready; common task search: target under 300 ms warm cache.
- No data loss on ordinary app close/restart; transactions rollback on failure; recovered workspace passes `PRAGMA integrity_check` and reference/file checksum tests.
- Offline install and execution (packaged assets only), no tracking/network calls.
- Accessibility: keyboard operation for CRUD and status changes; visible focus indicators and screen-reader labels for essential controls.
- Packaging includes signed Windows binaries if signing credentials are available; signing is not a prerequisite for local development.

## 10. Testing strategy

- **Unit:** validators, task/subtask invariants, progress calculations, key allocation, date validation, history descriptions, safe Markdown rendering, status migration rules.
- **SQLite integration:** foreign-key behavior, transactions, migrations, search index consistency, status removal, project trash/restore, assignment archiving.
- **Storage integration:** file copy integrity, safe paths, interrupted copy recovery, backup snapshot consistency, archive validation, restore rollback, duplicate/corrupt backup failures.
- **UI/component:** Markdown preview, Kanban drag/drop and keyboard fallback, filter/sort states, error reporting, modal confirmations, theme modes.
- **E2E:** new install onboarding → project → story/subtasks → assignment → workflow → attachment → restart → backup/restore → trash/recovery, run on Windows and Linux packages.
- **Security:** malicious Markdown, unsafe IPC arguments, path traversal, crafted archive entries/zip bombs, attachment protocol restrictions, remote navigation attempts.

## 11. Data migration and compatibility policy

**[ASSUMPTION]** Increment database schema version sequentially. On startup, detect version, back up prior to migration where viable, migrate transactionally, and fail safely with a clear recovery message if migration cannot complete. Never open a database created by a newer incompatible application version for writing. Backup manifest stores format version, database schema version, export timestamp, file inventory and checksums.

## 12. Error handling and recoverability

**[REQUIREMENT]** Provide actionable errors for disk full, access denied, invalid attachment, missing data file, corrupt DB, restore/backup failure and stale task edits. No partial task writes. Display which action failed, whether data was saved, and a safe next step. Log technical details locally while avoiding copying attachment contents or task descriptions into routine logs.

## 13. Suggested repository structure

```text
glacier-tasks/
  apps/
    desktop/                 # Electron main, preload, packager
    ui/                      # Angular renderer
  packages/
    domain/                  # shared types, enums, validation contracts
    data/                    # migrations, repositories, SQLite adapters
  docs/
    GLACIER_TASKS_SPEC.md
    GLACIER_TASKS_MILESTONES.md
  tests/
    fixtures/
    e2e/
```

**[ASSUMPTION]** TypeScript monorepo; choose npm/pnpm workspace and a single supported Node/Electron toolchain, with reproducible lockfile. Avoid a web server runtime in production.

## 14. Definition of done for v1

The product is v1-ready only when every confirmed requirement has a passing acceptance test: projects; story/subtask hierarchy; assignments; configurable workflows; board/list; task fields; local attachments; activity history; Markdown preview; search/filter/sort; per-project labels; trash/restore; full backup/restore plus JSON export; light/dark/system themes; Windows/Linux packaging; and reliable offline operation. Assumptions can be changed before implementation without silently overriding confirmed requirements.

## 15. Open technical decisions (non-blocking if defaults are adopted)

1. Angular component library (Angular Material vs PrimeNG) and specific version compatibility.
2. SQLite driver/native Electron rebuild pipeline and selected migration tooling.
3. Exact issue key behavior if project keys can change (current proposal: immutable after first task).
4. Exact attachment size cap and which previews are supported.
5. Whether to support list subtasks as individual search results, and how to represent them in filtered hierarchies.
6. Whether activity history should preserve full old/new descriptions or only a summarized change event.
7. Restore-from-backup semantics: full replacement is proposed; merging is intentionally excluded.

## 16. Consolidated assumption register

**A01** One workspace SQLite DB for all projects.  
**A02** Project keys and stable issue numbering.  
**A03** Archive profiles rather than hard delete them.  
**A04** Four fixed priorities: low/medium/high/critical.  
**A05** Default statuses and `TODO`/`IN_PROGRESS`/`DONE` categories.  
**A06** Markdown GFM subset and explicit Save/Cancel task editor.  
**A07** Board card ordering and per-project view state persistence.  
**A08** Scoped/global FTS5 search behavior and exact search fields.  
**A09** Managed file naming, 100 MiB cap, preview support, staged operations.  
**A10** No automatic trash expiry; project/global trash and cascading restoration.  
**A11** Full-replacement backup restore; `.glaciertasks` archive with manifest/checksums.  
**A12** JSON export contains metadata, not attachment bytes; informational/non-restorable.  
**A13** Main-process SQLite driver, Angular component library, packager, test tooling.  
**A14** Quantitative scale/performance targets.  
**A15** No comments, dependencies, epics, sprints, time tracking, public API, sync or collaboration in v1.  
**A16** Initial navigation/window layouts, local preferences, and actor designation in history.

Where a proposal conflicts with future product-owner direction, the confirmed requirements take precedence.
