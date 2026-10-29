# Glacier Tasks — Functional & Technical Specification

**Version:** 1.1 (implementation baseline)  
**Date:** 2026-10-29  
**Status:** Ready for implementation; review round 1 decisions applied (see `DECISIONS.md`)  
**Product:** Glacier Tasks

## 0. Decision register and scope convention

- **[CONFIRMED]** means explicitly selected by the product owner. Decisions from review rounds are recorded in `DECISIONS.md` and referenced here as `Dnn`.
- **[ASSUMPTION]** means a proposed implementation default, not yet explicitly approved. These are listed in §16 and must remain configurable or easy to revise where practical.
- **[OUT OF SCOPE]** means excluded from version 1; if the exclusion was not explicitly selected, it is marked as an assumption.
- **[REQUIREMENT]** means a behavior required for a coherent implementation of confirmed choices, and may include implementation-level detail.

The milestone plan lives in the separate file `GLACIER_TASKS_MILESTONES.md`. The sibling application [Glacier Notes](https://github.com/Cracksoldier/glacier-notes) is the reference for visual identity, tooling and release process.

## 1. Vision

**[CONFIRMED]** Glacier Tasks is a completely offline, Jira-inspired desktop task planner made with Electron and Angular/TypeScript for Windows and Linux. It supports multiple projects; each project contains stories, each story can contain one level of subtasks. Users are local assignment profiles (name, optional avatar) with no authentication, and each task has at most one assignee. The app is designed to remain offline permanently: no cloud account, network backend, or future sync requirement.

### 1.1 Design objectives

1. Fast project/task navigation and editing; minimize administrative overhead.
2. Every ordinary action functions without internet connectivity.
3. Safely persist data and attachments locally, with recoverable backups.
4. Make project workflow configurable, while keeping task hierarchy simple.
5. Maintain traceable local history and predictable deletion/recovery semantics.

### 1.2 Explicit exclusions

- **[CONFIRMED]** No sprints in v1; no login/authentication; no synchronization now or planned.
- **[CONFIRMED]** No moving tasks between projects and no story ↔ subtask conversion in v1 (D04). No custom workspace location or portable build (D16). No macOS or ARM builds (D21).
- **[ASSUMPTION / OUT OF SCOPE]** No epics, task types other than story/subtask, nesting beyond a single subtask level, team collaboration/live multiwriter access, hosted service, comments/discussion threads, notifications, worklogs/time tracking, issue dependencies, or public API in v1.

## 2. Technology and security boundaries

| Area             | Requirement / proposed solution                                                                                                  | Status                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Desktop shell    | Electron (version aligned with Glacier Notes, reconfirmed in M0)                                                                 | CONFIRMED                                            |
| UI               | Angular + TypeScript                                                                                                             | CONFIRMED                                            |
| Targets          | Windows and Linux, x64 only                                                                                                      | CONFIRMED (D21)                                      |
| Storage          | One local SQLite workspace database                                                                                              | CONFIRMED (SQLite), ASSUMPTION (single workspace DB) |
| Web server       | None; renderer uses a typed preload/IPC API                                                                                      | ASSUMPTION                                           |
| SQLite driver    | Main-process `better-sqlite3`                                                                                                    | CONFIRMED (D22)                                      |
| Package manager  | npm, single lockfile                                                                                                             | CONFIRMED (D22)                                      |
| UI widgets       | No component library; own SCSS design tokens + Angular CDK (drag & drop, overlays, virtual scroll); Font Awesome bundled locally | CONFIRMED (D22)                                      |
| Theming          | Glacier Notes color tokens; Light / Dark / Follow System; Dark on first launch                                                   | CONFIRMED (D18)                                      |
| Languages        | English and German                                                                                                               | CONFIRMED (D15)                                      |
| Markdown         | `marked` + `DOMPurify`, local only; no remote rendering/CDNs                                                                     | CONFIRMED (D22), REQUIREMENT                         |
| Search           | SQLite FTS5 plus structured filtering                                                                                            | ASSUMPTION                                           |
| Packaging        | electron-builder: Windows NSIS installer; Linux AppImage and deb                                                                 | CONFIRMED (D21)                                      |
| CI / releases    | GitHub Actions on `windows-latest` and `ubuntu-latest`, modeled on Glacier Notes' `release-builds.yml`                           | CONFIRMED (D21)                                      |
| Testing          | Vitest (unit/integration), Playwright for packaged-Electron E2E, Biome formatting                                                | CONFIRMED (D22), REQUIREMENT                         |
| Development host | Windows 11                                                                                                                       | CONFIRMED (D21)                                      |

### 2.1 Application architecture

```text
Angular Renderer (sandboxed, no Node.js APIs)
    ↕ contextBridge typed API, invoke/handle IPC
Electron Main Process
    ├─ Application Services (projects, users, tasks, workflows, labels, history)
    ├─ Domain Validation + Transactions
    ├─ SQLite Repository + Migrations
    ├─ Attachment/Avatar Storage Service
    ├─ Backup/Restore/Export Service (+ opt-in automatic backups)
    └─ OS Dialogs + Device Settings
Local app data directory (standard per-user location only, D16)
    ├─ glacier-tasks.sqlite        # workspace: replaced by restore
    ├─ attachments/<opaque-file-id>
    ├─ avatars/<opaque-file-id>
    ├─ device-settings.json        # NOT part of workspace/backups (D17)
    └─ logs/
```

**[REQUIREMENT]** Run with `contextIsolation: true`, `nodeIntegration: false`, sandbox enabled where supported, a restrictive CSP, and a narrow `contextBridge` surface. Do not expose raw `ipcRenderer`, SQL execution, or arbitrary filesystem access to the renderer. Validate every IPC payload in the main process (e.g., Zod or equivalent). All filesystem paths must be resolved by the main process; protect against `..`, absolute-path escapes, and symlink traversal. Block arbitrary remote navigation and new windows. No analytics, auto-update checks, externally hosted fonts, external Markdown assets, or network requests by default. Treat restored files and attachments as untrusted input.

**[CONFIRMED]** The app runs as a single instance (`requestSingleInstanceLock`); a second launch focuses the existing window (D05).

## 3. Core entities and identifiers

### 3.1 Project

- **[CONFIRMED]** Unlimited logical projects, each with configurable workflow statuses and project-specific custom labels.
- **[ASSUMPTION]** Fields: `id` (UUID), `key`, `name`, `description` (optional), `createdAt`, `updatedAt`, `trashedAt` (nullable).
- **[CONFIRMED]** Project keys match `^[A-Z][A-Z0-9]{1,9}$`, are unique across live and trashed projects, and become reusable after permanent deletion (D08).
- **[ASSUMPTION]** Issue identifier is immutable and human-readable: `<PROJECT_KEY>-<SEQUENCE>`, e.g. `GAME-42`. A project's key becomes immutable once it has issued any task IDs. Stories and subtasks share the same monotonic sequence per project; numbers are never reused.
- Every project owns exactly one workflow configuration. Different projects can have different status values and order.

### 3.2 User (assignee profile)

- **[CONFIRMED]** Globally available across projects; `name` required, `avatar` optional; no credentials, sign-in, roles, or permissions.
- **[ASSUMPTION]** Fields: `id`, `name`, `avatarFileId` (nullable), `createdAt`, `updatedAt`, `archivedAt` (nullable). Names need not be unique; UI disambiguates using avatar and profile ID where necessary.
- **[CONFIRMED]** Profiles are archived, never hard-deleted (D29). Archived profiles cannot be newly assigned but historical snapshots remain. Existing assignments to an archived profile display as archived until explicitly reassigned or unassigned.
- **[CONFIRMED]** Avatars: PNG/JPEG/WebP, max 5 MiB, displayed square-cropped; a replaced avatar file is deleted (D24).

### 3.3 Story and subtask

- **[CONFIRMED]** Only two task types; each subtask belongs to exactly one story. Nested subtasks and orphan subtasks are disallowed; tasks have at most one assignee.
- **[CONFIRMED]** Task fields: title, Markdown description, priority, status, optional start date and due date, labels, assignee; local attachments and activity history.
- **[ASSUMPTION]** Shared fields: `id` (UUID), `issueNumber`, `projectId`, `type` (`STORY`/`SUBTASK`), `parentStoryId` (nullable for stories, required for subtasks), `title`, `descriptionMarkdown`, `priority`, `statusId`, `assigneeUserId` (nullable), `startDate`/`dueDate` (nullable ISO local dates), `sortOrder`, `createdAt`, `updatedAt`, `trashedAt` (nullable).
- **[CONFIRMED]** Additional fields: `version` (integer, incremented on every write, for optimistic concurrency, D05) and `trashCascadeRootId` (nullable; set when the task was trashed as part of a parent story or project, D02).
- **[ASSUMPTION]** Fixed priorities: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, with default `MEDIUM`. Labels are separate project-specific entities, many-to-many with tasks.
- **[REQUIREMENT]** A subtask always lives in its parent's project. Updating a story's status must **not** automatically update its subtasks, and vice versa. Completing all subtasks must **not** automatically complete the parent story.
- **[CONFIRMED]** A subtask can be moved to another live story in the same project; its issue key is unchanged. Moving between projects and type conversion are out of scope (D04).
- **[ASSUMPTION]** Task start date must not exceed its due date when both are present; timestamps are UTC, date-only fields are local calendar dates.
- **[ASSUMPTION]** Task titles required, trimmed, max 255 characters; Markdown description max 100,000 characters; app displays validation feedback.

### 3.4 Workflow status

- **[CONFIRMED]** Statuses are configurable separately for each project. When deleting a status used by tasks, the user must pick another status and affected tasks are migrated before removal.
- **[CONFIRMED]** Status migration includes trashed tasks, so a trashed task never references a removed status (D01).
- **[CONFIRMED]** Every project keeps at least one status in category `DONE` (D07).
- **[ASSUMPTION]** Fields: `id`, `projectId`, `name`, `category` (`TODO`, `IN_PROGRESS`, `DONE`), `position`, `isDefault`, `createdAt`, `updatedAt`.
- **[ASSUMPTION]** Initial statuses on project creation: `To Do`, `In Progress`, `Done`. Exactly one default status is required; each project must retain at least one status. Category `DONE` is used for progress calculations independently of the custom display name. Status changes are unrestricted, including reopening completed tasks.
- **[REQUIREMENT]** Rename and reorder statuses without breaking historical references. A status removal/migration must be an atomic transaction, include affected stories/subtasks (live and trashed), and emit activity records.

### 3.5 Label

- **[CONFIRMED]** Labels are customizable per project; priority options are fixed.
- **[ASSUMPTION]** Fields: `id`, `projectId`, `name`, `color` (optional); unique case-insensitive name within project. Deleting a label removes task-label links, not tasks; record link removal in history.
- **[CONFIRMED]** Label colors come from a fixed palette of light/dark pairs, following Glacier Notes' note-color approach (D25).

### 3.6 Attachment and avatar

- **[CONFIRMED]** Task attachments support files and images, copied into application-managed local storage.
- **[ASSUMPTION]** Metadata: `id`, `taskId`, `originalName`, `mimeType`, `byteSize`, `sha256`, `storageKey`, `addedAt`, `removedAt` (nullable). Files are stored under random opaque names; never use the uploaded filename as the storage path.
- **[ASSUMPTION]** UI supports file picker and drag-and-drop, safe image previews for supported raster formats, open/save-as using OS dialogs, and removal with confirmation. No executable embedding in HTML; images served via a secure custom local protocol or safe IPC-backed method, not unrestricted `file://` access.
- **[ASSUMPTION]** Default per-file size limit 100 MiB (configurable); reject unsupported/unsafe previews, but permit other file types as downloadable/openable attachments with user confirmation.
- **[CONFIRMED]** Removing an attachment requires confirmation, deletes the managed bytes immediately, sets `removedAt` (metadata tombstone) and records a history event. There is no attachment-level trash. Attachments of trashed tasks are kept until the task is permanently deleted (D03).
- **[REQUIREMENT]** Attachment bytes survive source-file deletion/move and are included in backups. Use a staged-copy → metadata transaction → finalize/cleanup pattern; reconcile incomplete operations (including orphaned bytes of removed attachments) on startup.

### 3.7 Activity event

- **[CONFIRMED]** Local change history is required for tasks **and** for projects, workflow statuses, labels and user profiles (D12).
- **[ASSUMPTION]** Immutable event records: `id`, `entityType` (`TASK`, `PROJECT`, `STATUS`, `LABEL`, `USER`), `entityId`, `projectId` (nullable; set for project-scoped entities), `eventType`, `occurredAt`, `payloadJson`, `actor` = `LOCAL_USER` (no login identity), `source` = `UI` / `RESTORE` / `SYSTEM`.
- Task events: creation, title/description edits, priority and date changes, assignment, status changes, label changes, attachment add/remove, subtask create/delete/restore/move (also recorded on the parent story, D27), trash/restore.
- Other entity events: project create/edit/trash/restore; status create/rename/reorder/category/default change/removal with migration; label create/rename/recolor/delete; profile create/edit/avatar change/archive/unarchive.
- **[CONFIRMED]** Title and description changes store the full new text (titles also store the old value), so earlier description versions can be viewed and compared with their predecessor (D11). Other changes store structured before/after values. Never record attachment bytes.
- **[ASSUMPTION]** Activity events are shown newest first with a human-readable summary: on task details, in a project activity view, and in the profile manager. They are not an undo engine.

## 4. Functional requirements

### 4.1 Projects (`PROJ`)

- `PROJ-01` Create project with required name and unique key (format per D08).
- `PROJ-02` List and navigate multiple projects; persist last selected project in device settings.
- `PROJ-03` Edit project name/description and manage project-level statuses and labels.
- `PROJ-04` Trash, restore, and permanently delete projects according to §4.10.
- `PROJ-05` Project management never requires internet or authentication.
- `PROJ-06` Project activity view lists project, status, label and task events for the project (D12).

### 4.2 Assignee profiles (`USER`)

- `USER-01` Create/edit profiles with required name and optional avatar.
- `USER-02` Show avatars or generated initials fallback, and choose assignees across any project.
- `USER-03` Each story/subtask has zero or one assignee.
- `USER-04` Maintain profile references/history without fabricating real authentication identity.
- `USER-05` Archive/unarchive profiles (no hard deletion, D29), and offer explicit bulk unassignment for archived profiles.
- `USER-06` Profile manager shows each profile's activity history (D12).

### 4.3 Task editing (`TASK`)

- `TASK-01` Create, edit, view, trash, restore, and permanently delete stories.
- `TASK-02` Create/edit/trash subtasks only under a story; no nesting.
- `TASK-03` Required title; Markdown description editor with preview; priority, status, dates, project labels, assignee.
- `TASK-04` On task creation, use project's default status; optional fields start empty.
- `TASK-05` Subtask status and parent status are independent.
- `TASK-06` Show story subtask progress (`done / total`) using status category `DONE`, without mutating parent status.
- `TASK-07` Reject invalid references, cross-project labels/statuses, invalid dates, and nonexistent parents.
- `TASK-08` **[ASSUMPTION]** Persist changes with explicit Save/Cancel in full editor; quick Kanban status changes save immediately and report failures.
- `TASK-09` Move a subtask to another live story in the same project (D04).
- `TASK-10` Every task write carries the expected `version`; a stale write is rejected with `CONFLICT` and the UI offers to reload, keeping the user's unsaved input visible (D05).

### 4.4 Markdown (`MD`)

- `MD-01` Edit Markdown text and switch between edit and rendered preview.
- `MD-02` Preserve original Markdown source; do not rewrite formatting when saving.
- `MD-03` Sanitize rendered HTML, strip scripts/unsafe URLs, and do not load remote images or URLs silently. External links require explicit user action and OS/browser handoff.
- `MD-04` **[ASSUMPTION]** Support CommonMark plus GitHub-style tables, checklists, and fenced code blocks; no arbitrary embedded HTML. **[CONFIRMED]** Checklists are read-only in preview (D10).
- `MD-05` **[CONFIRMED]** Inline images may reference attachments of the same task via `attachment:<id>`; any other image source is not loaded. The editor offers inserting such a reference from the task's attachments (D10).

### 4.5 Kanban (`BOARD`)

- `BOARD-01` Project-specific board with one column per configured status, ordered by workflow position.
- `BOARD-02` Display **stories only** as cards. Card includes issue key, title, priority, assignee, labels, due date, and `done/total` subtask summary where present.
- `BOARD-03` Expand card to inspect subtasks and change a subtask's status from the expanded card (D06); subtasks are never standalone top-level cards.
- `BOARD-04` Drag stories across columns to change status; use typed validation and atomic persistence, showing an error and restoring UI state if write fails.
- `BOARD-05` Reorder cards within a column; persist order using fractional sort keys; a card moved to another column is placed at the top (D26).
- `BOARD-06` Apply project filters consistently with the list view; board filters evaluate story fields only (D09).

### 4.6 List view and navigation (`LIST`)

- `LIST-01` Project-specific searchable, sortable, filterable task list.
- `LIST-02` **[ASSUMPTION]** Stories appear as expandable rows with children shown beneath; status, priority, assignee, due date and labels visible as columns.
- `LIST-03` **[ASSUMPTION]** Sorting supports issue key, title, priority, status, assignee, creation/update date, start date and due date; filtering supports status, priority, assignee, labels, dates and task type. Subtasks sort within their parent.
- `LIST-04` Preserve view-specific selection, sorting and filtering per project in device settings **[ASSUMPTION]**.
- `LIST-05` **[CONFIRMED]** A subtask matching a filter/search is shown beneath its parent story; a non-matching parent is shown dimmed as context (D09).

### 4.7 Search (`SEARCH`)

- `SEARCH-01` Full-text search, filtering and sorting.
- `SEARCH-02` Search story/subtask title, Markdown description, and issue key; support filters by project/status/priority/assignee/label/date **[ASSUMPTION]**. Subtask hits are presented per LIST-05.
- `SEARCH-03` Use locally maintained FTS indexes; index updates in same transaction as task writes. Rebuild indexes after restore (D20) and after schema upgrade as necessary.
- `SEARCH-04` **[ASSUMPTION]** Search defaults to current project with an option to search all projects. Trash is excluded from regular search.

### 4.8 Attachments (`FILE`)

- `FILE-01` Attach files/images to stories and subtasks.
- `FILE-02` Copy bytes to managed storage; retain original display name and file metadata.
- `FILE-03` Permit supported image preview and file open/save-as without exposing arbitrary disk paths to renderer.
- `FILE-04` Include all live and trashed-task attachments in complete backups.
- `FILE-05` Attachment removal deletes the bytes immediately after confirmation and is recorded in task history (D03).

### 4.9 History (`AUDIT`)

- `AUDIT-01` Append-only local activity events for the changes described in §3.7.
- `AUDIT-02` Present chronological history on task details; historical assignee names must remain intelligible even if profile later changes.
- `AUDIT-03` **[ASSUMPTION]** Record snapshots of display names at event time rather than requiring joins to the current user or status names.
- `AUDIT-04` **[CONFIRMED]** Description version browser on task details: list versions from history, view any version rendered or as source, and compare it with the previous version (D11).
- `AUDIT-05` **[CONFIRMED]** History for projects, statuses, labels and profiles per §3.7 (D12).

### 4.10 Trash and deletion (`TRASH`)

- `TRASH-01` Deleting a story or project moves it to trash; user can restore or permanently delete it.
- `TRASH-02` Trashing a story includes its subtasks, task history, attachments and labels; trashing a project includes all contained task data. Children trashed by the cascade get `trashCascadeRootId` set to the trashed parent; already-trashed children keep their own trash state (D02).
- `TRASH-03` **[ASSUMPTION]** Project-specific and global trash views; no automatic expiry in v1.
- `TRASH-04` On restore, validate project dependencies; restore parent before child. Restoring a parent restores exactly the children whose `trashCascadeRootId` points to it (D02). No status mapping is needed because status removal migrates trashed tasks (D01).
- `TRASH-05` Permanent deletion requires a strong confirmation and permanently removes dependent records and managed attachment bytes. Warn that only backups can recover such content.
- `TRASH-06` A subtask can be independently trashed/restored, provided its story is not in trash; if parent is trashed, restore parent first.

### 4.11 Backup, restore and JSON export (`DATA`)

- `DATA-01` Full backup and restore, including database, attachment bytes, avatars, and manifest/schema-version metadata.
- `DATA-02` JSON export is **export-only**; **no JSON import** in v1. Only full backup restoration imports application data.
- `DATA-03` Export creates structured JSON containing project/user/story/subtask/status/label/history metadata and attachment descriptors, but **not** binary attachment/avatar data. **[CONFIRMED]** Scope is selectable (whole workspace or one project); trashed items excluded by default with an option to include them (D14). User-facing warning explains that JSON is not a restorable complete backup.
- `DATA-04` **[ASSUMPTION]** Use a versioned `.glaciertasks` archive (ZIP with `manifest.json`, consistent SQLite snapshot, and managed file entries); include checksums and validate archive paths and size limits on restore.
- `DATA-05` Backups are captured from a consistent database snapshot (SQLite backup API or equivalent) while protecting attachment consistency; never ZIP a live WAL database directory without coordination.
- `DATA-06` Before destructive restore, automatically create a safety backup of the current workspace when possible; stage and validate restored data before atomic activation, with rollback on failure.
- `DATA-07` Restore replaces the **entire** workspace, rather than merges with it. Warn user that current data will be replaced and obtain explicit confirmation.
- `DATA-08` Backups/restores work completely offline. Never execute contents of a backup or treat archive members as trusted file paths.
- `DATA-09` **[CONFIRMED]** Opt-in automatic backups, off by default. When enabled: user-chosen folder; run on app launch at most once per configurable interval (default 24 h); keep the newest N automatic backups (default 7) and delete only older automatic backups in that folder. If the folder is unavailable, show a non-blocking warning (D13).
- `DATA-10` **[CONFIRMED]** Restore never touches device settings (D17). Backups from an older schema version are restored then migrated; backups from a newer version are rejected (D28).

### 4.12 UI/settings/accessibility (`UX`)

- `UX-01` Theme setting: `Light`, `Dark`, `Follow System`; **Dark** on first launch (D18).
- `UX-02` **[ASSUMPTION]** Left sidebar for project selection and navigation; central board/list workspace; task details drawer or modal; dialogs for profile/workflow/settings management.
- `UX-03` **[ASSUMPTION]** Keyboard focus, labels and meaningful error messages; keyboard-accessible core CRUD and list editing. Drag-and-drop must have a non-drag fallback for changing status.
- `UX-04` Remember window size, last project, last view, theme and language in device settings (D17).
- `UX-05` No login/logout UI, user permissions, sync state, or server configuration screens.
- `UX-06` **[CONFIRMED]** UI available in English and German, switchable in settings; first launch picks German if the OS language is German, otherwise English. Dates are formatted for the selected UI language. All user-facing strings go through the translation layer from M1 (D15).
- `UX-07` **[CONFIRMED]** Visual identity follows Glacier Notes: its color tokens (cold dark-blue dark theme, cool light theme, ice-blue accent), system font stack, Font Awesome icons. App icon is a Glacier Notes icon variant with a board/checklist motif (D18, D23).

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
      start_date NULL, due_date NULL, sort_order, version,
      created_at, updated_at, trashed_at, trash_cascade_root_id NULL,
      UNIQUE(project_id,issue_number))
task_labels(task_id FK, label_id FK, PRIMARY KEY(task_id,label_id))
attachments(id PK, task_id FK, original_name, mime_type, byte_size,
            sha256, storage_key UNIQUE, added_at, removed_at NULL)
avatar_files(id PK, storage_key UNIQUE, mime_type, sha256, byte_size)
activity_events(id PK, entity_type, entity_id, project_id NULL, event_type,
                occurred_at, payload_json, source)
workspace_settings(key PK, value_json)   -- workspace-level only; device settings live outside the DB
schema_migrations(version PK, applied_at)
```

`trash_cascade_root_id` refers to the task or project whose trashing cascaded to this row; it is not a foreign key because the root may be a project. `project_key` uniqueness covers trashed projects (D08).

### 5.1 Required invariants

- Use `PRAGMA foreign_keys=ON` on every connection, SQLite WAL for day-to-day runtime **[ASSUMPTION]**, and busy timeout where appropriate.
- Story: `parent_story_id IS NULL`. Subtask: `parent_story_id IS NOT NULL` and references a story **in the same project**. Enforce complex cross-row invariants in transactional service logic, optionally with DB triggers.
- Every task's `status_id` must belong to its project, and each `task_labels.label_id` must belong to the same project as the task.
- Exactly one default status and at least one `DONE`-category status per project; never delete the last workflow status.
- `tasks.version` increments on every write; update statements check the expected version.
- All writes affecting multiple tables or event history must be atomic transactions.
- Use schema migrations; never implicitly reconstruct tables or wipe data after a version mismatch.
- SQLite FTS5 `tasks_fts` mirrors live task title/description/key and is maintained reliably with explicit update flows/triggers; restore and migration tests verify search integrity.
- Index `activity_events(entity_type, entity_id, occurred_at)` and `activity_events(project_id, occurred_at)`.
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
    unarchive(id: string): Promise<void>;
    chooseAvatar(id: string): Promise<UserProfile | null>; // native picker in main; null = cancelled
    removeAvatar(id: string): Promise<UserProfile>;
    unassignAll(id: string): Promise<{ unassigned: number }>; // USER-05, live and trashed tasks
  };
  tasks: {
    query(input: TaskQuery): Promise<PagedResult<TaskSummary>>;
    get(id: string): Promise<TaskDetail>;
    create(input: CreateTaskInput): Promise<TaskDetail>;
    update(id: string, expectedVersion: number, patch: UpdateTaskInput): Promise<TaskDetail>;
    move(id: string, expectedVersion: number, statusId: string, sortOrder?: string): Promise<void>;
    moveToStory(subtaskId: string, expectedVersion: number, targetStoryId: string): Promise<void>;
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    descriptionVersions(id: string): Promise<DescriptionVersion[]>;
  };
  activity: {
    forEntity(entityType: EntityType, entityId: string): Promise<ActivityEvent[]>;
    forProject(projectId: string, page?: PageRequest): Promise<PagedResult<ActivityEvent>>;
  };
  labels: {
    list(projectId: string): Promise<Label[]>;
    create(projectId: string, input: LabelInput): Promise<Label>;
    update(id: string, patch: LabelPatch): Promise<Label>;
    remove(id: string): Promise<void>;
  };
  trash: {
    list(): Promise<TrashItem[]>; // directly trashed projects and tasks (D39); purge follows in M7
  };
  workflows: {
    list(projectId: string): Promise<WorkflowStatus[]>;
    create(projectId: string, input: StatusInput): Promise<WorkflowStatus>;
    update(id: string, patch: StatusPatch): Promise<WorkflowStatus>;
    usage(statusId: string): Promise<StatusUsage>; // live stories, live subtasks, trashed (wizard preview)
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
    exportJson(options: ExportOptions): Promise<ExportResult>; // scope + includeTrashed
  };
  settings: {
    getDevice(): Promise<DeviceSettings>;
    updateDevice(patch: Partial<DeviceSettings>): Promise<DeviceSettings>;
    chooseAutoBackupFolder(): Promise<DeviceSettings>; // main-process folder picker
  };
}
```

All IPC methods must validate inputs, return structured error codes (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `IO`, `BACKUP_INVALID`, `MIGRATION_REQUIRED`), and avoid leaking system paths or stack traces to the UI. Methods not shown (labels, trash list/purge, avatar selection, card ordering) should follow the same interface style. Pagination is recommended for large task lists.

## 7. Screen inventory

1. **Project switcher/dashboard:** recent projects; create/edit project; counts of open/done stories **[ASSUMPTION]**.
2. **Project Kanban:** status columns, story cards, card expansion with subtask status changes, drag/drop, filters.
3. **Project List:** hierarchical expandable stories/subtasks, sortable/filterable fields, quick navigation.
4. **Story/Subtask editor:** full fields, Markdown edit/preview (incl. attachment images), labels, assignee, attachment browser, history, description version browser, move-to-story for subtasks.
5. **Workflow editor:** add/rename/reorder/configure status categories; delete with mandatory migration.
6. **Label manager:** project label CRUD with palette colors.
7. **Profile manager:** global assignment profiles, avatars and profile history.
8. **Project activity:** project-wide history of project, status, label and task events.
9. **Search:** scoped/global results with filters.
10. **Trash:** view and restore projects/stories/subtasks; permanent delete.
11. **Settings/Data management:** theme, language, backup, restore, automatic backups, JSON export, local storage information.

## 8. Canonical user journeys and acceptance criteria

### UJ-01: New project and story

**Given** no projects exist, **when** user creates `Game Dev` (`GAME`), **then** the project appears in switcher with default statuses and an empty board. **When** user creates a story titled `Implement inventory`, **then** it receives a unique key like `GAME-1`, status `To Do`, and appears in its board column and list view. It survives app restart.

### UJ-02: Independent subtask completion

**Given** story `GAME-1` has two subtasks, **when** one subtask is moved to category `DONE` from the expanded board card, **then** card progress reads `1/2`. The parent story status remains unchanged. Moving second subtask to `DONE` yields `2/2` without auto-completing the story.

### UJ-03: One assignee, globally available

**Given** profile `Alex` exists, **when** editing tasks in two separate projects, **then** both can be assigned to Alex, and a task cannot have two simultaneous assignees. No login screen appears.

### UJ-04: Status migration

**Given** multiple live and trashed tasks use custom project status `Review`, **when** user deletes `Review`, **then** UI requires another status in the same project; status removal and migration of all affected tasks succeed atomically with activity records. If canceled or transaction fails, nothing changes. Deleting the last `DONE` status is refused.

### UJ-05: Attachments retained locally

**Given** a task attachment is added from a source file, **when** original file is deleted and app restarted, **then** the managed attachment remains available. **When** a full backup is restored into a clean installation, **then** the attachment remains available there.

### UJ-06: Trash and restoration

**Given** a story has subtasks A and B and attachments, and A was trashed on its own earlier, **when** the story is trashed, **then** it disappears from regular board/list/search and appears in trash. **When** the story is restored, **then** B, the attachments and history are restored with it, and A remains in trash. Permanent deletion requires explicit confirmation.

### UJ-07: Backup versus JSON

**Given** a workspace has two projects, profiles, attachments and histories, **when** complete backup is made and restored, **then** all of these are preserved, including IDs and project workflows, while theme and language stay as they were on the device. **When** a JSON export is made, **then** it is clearly labeled informational/non-restorable and must not silently replace backup functionality.

### UJ-08: Offline/security

**Given** network is disabled, **when** user performs all standard CRUD, search, attachment, theme, backup/export actions, **then** they work. **Given** Markdown contains scripts, `javascript:` URLs or remote images, **when** previewing, **then** code does not execute and nothing is fetched.

### UJ-09: Stale edit

**Given** a story is open in the editor with unsaved changes, **when** the same story is dragged to another column and the editor is then saved, **then** the save is rejected with a conflict message, nothing is overwritten, and the user can reload without losing the typed text.

### UJ-10: Description history

**Given** a story description was edited three times, **when** the user opens the description version browser, **then** all versions are listed, each can be viewed, and each can be compared with its predecessor.

## 9. Nonfunctional requirements (proposed quantitative targets)

These figures are **[ASSUMPTIONS]**, not product-owner commitments; benchmark on a representative mid-range Windows PC and Linux machine (x64).

- Supports at least 20 projects, 10,000 total tasks, 100 users, and 1,000 labels across projects without correctness degradation.
- Typical board load for up to 500 visible stories: target under 1 second after DB ready; common task search: target under 300 ms warm cache.
- No data loss on ordinary app close/restart; transactions rollback on failure; recovered workspace passes `PRAGMA integrity_check` and reference/file checksum tests.
- Offline install and execution (packaged assets only), no tracking/network calls.
- Accessibility: keyboard operation for CRUD and status changes; visible focus indicators and screen-reader labels for essential controls.
- Packaging includes signed Windows binaries if signing credentials are available; signing is not a prerequisite for local development or CI release builds.

## 10. Testing strategy

- **Unit (Vitest):** validators, task/subtask invariants, progress calculations, key allocation, date validation, history descriptions, safe Markdown rendering, status migration rules, translation key completeness (EN/DE).
- **SQLite integration (Vitest):** foreign-key behavior, transactions, migrations, search index consistency, status removal incl. trashed tasks, cascade trash/restore, optimistic concurrency, assignment archiving.
- **Storage integration:** file copy integrity, safe paths, interrupted copy recovery, backup snapshot consistency, archive validation, restore rollback, duplicate/corrupt backup failures, automatic backup retention.
- **UI/component:** Markdown preview, Kanban drag/drop and keyboard fallback, filter/sort states, error reporting, modal confirmations, theme modes, language switching.
- **E2E (Playwright, packaged Electron):** new install onboarding → project → story/subtasks → assignment → workflow → attachment → restart → backup/restore → trash/recovery, run on Windows and Linux packages in GitHub Actions.
- **Security:** malicious Markdown, unsafe IPC arguments, path traversal, crafted archive entries/zip bombs, attachment protocol restrictions, remote navigation attempts.

## 11. Data migration and compatibility policy

**[ASSUMPTION]** Increment database schema version sequentially. On startup, detect version, back up prior to migration where viable, migrate transactionally, and fail safely with a clear recovery message if migration cannot complete. Never open a database created by a newer incompatible application version for writing. Backup manifest stores format version, database schema version, export timestamp, file inventory and checksums. Restore compatibility follows D28.

## 12. Error handling and recoverability

**[REQUIREMENT]** Provide actionable errors for disk full, access denied, invalid attachment, missing data file, corrupt DB, restore/backup failure, automatic backup folder unavailable and stale task edits. No partial task writes. Display which action failed, whether data was saved, and a safe next step. Log technical details locally while avoiding copying attachment contents or task descriptions into routine logs.

## 13. Suggested repository structure

```text
glacier-tasks/
  apps/
    desktop/                 # Electron main, preload, packager
    ui/                      # Angular renderer
  packages/
    domain/                  # shared types, enums, validation contracts
    data/                    # migrations, repositories, SQLite adapters
  build/                     # icons (Glacier Notes-style variant)
  docs/
    GLACIER_TASKS_SPEC.md
    GLACIER_TASKS_MILESTONES.md
    DECISIONS.md
  tests/
    fixtures/
    e2e/
  .github/workflows/         # release builds (Windows + Linux x64)
```

**[CONFIRMED]** TypeScript monorepo using **npm workspaces** with one lockfile and a single supported Node/Electron toolchain (D22, D35). Avoid a web server runtime in production. Architecture decision records live in `docs/adr/`.

## 14. Definition of done for v1

The product is v1-ready only when every confirmed requirement has a passing acceptance test: projects; story/subtask hierarchy; assignments; configurable workflows; board/list; task fields; local attachments; activity history incl. description versions and non-task entities; Markdown preview; search/filter/sort; per-project labels; trash/restore with cascade semantics; full backup/restore, opt-in automatic backups plus JSON export; light/dark/system themes; English/German UI; Windows/Linux packaging via GitHub Actions; and reliable offline operation. Assumptions can be changed before implementation without silently overriding confirmed requirements.

## 15. Open technical decisions

Resolved in review round 1:

1. ~~Angular component library~~ — none; own SCSS tokens + Angular CDK (D22).
2. SQLite driver is `better-sqlite3` (D22); native build pipeline and migration conventions in `docs/adr/0003` and `docs/adr/0005`.
3. Issue keys: immutable after first task (D30); key format per D08.
4. ~~Attachment size cap and preview formats~~ — D33.
5. ~~Subtasks in search/filtered hierarchies~~ — D09.
6. ~~Description history granularity~~ — full text versions (D11).
7. ~~Restore semantics~~ — full replacement; merging excluded.

## 16. Consolidated assumption register

**A01** One workspace SQLite DB for all projects.  
**A02** ~~Project keys and stable issue numbering.~~ _Confirmed, D08/D30._  
**A03** ~~Archive profiles rather than hard delete them.~~ _Confirmed, D29._  
**A04** ~~Four fixed priorities: low/medium/high/critical.~~ _Confirmed, D31._  
**A05** ~~Default statuses and `TODO`/`IN_PROGRESS`/`DONE` categories.~~ _Confirmed, D07/D32._  
**A06** Markdown GFM subset and explicit Save/Cancel task editor. _(Checklist/attachment-image behavior confirmed, D10.)_  
**A07** Board card ordering and per-project view state persistence. _(Ordering confirmed, D26.)_  
**A08** Scoped/global FTS5 search behavior and exact search fields.  
**A09** ~~Managed file naming, 100 MiB cap, preview support, staged operations.~~ _Confirmed, D03/D33._  
**A10** No automatic trash expiry; project/global trash. _(Cascade restoration confirmed, D02.)_  
**A11** ~~Full-replacement backup restore; `.glaciertasks` archive with manifest/checksums.~~ _Confirmed, DATA-07/D34._  
**A12** ~~JSON export contents~~ _Confirmed, D14._  
**A13** ~~Main-process SQLite driver, Angular component library, packager, test tooling.~~ _Confirmed, D21/D22._  
**A14** Quantitative scale/performance targets.  
**A15** No comments, dependencies, epics, sprints, time tracking, public API, sync or collaboration in v1.  
**A16** Initial navigation/window layouts and actor designation in history. _(Device-settings storage confirmed, D17.)_

Where a proposal conflicts with future product-owner direction, the confirmed requirements take precedence.
