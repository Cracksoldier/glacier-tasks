# ADR 0008 — Task service, trash cascade and Markdown rendering

**Status:** Accepted (M3, 2026-10-29)  
**Decisions:** D02, D04, D05, D10, D11, D19, D26, D27, D30, D39, D40; threat model T2, T4

## Task writes (`packages/data/src/services/tasks.ts`)

- **One transaction per write.** A transaction covers the reference checks, the row change, the
  label links and every activity event. The data services never touch the file system.
- **References (TASK-07).** The status, labels and parent must belong to the task's project;
  anything else is rejected with `VALIDATION errors.crossProjectReference`. The composite foreign
  keys `(project_id, id)` from migration 0001 back this check up.
- **Subtask parents.** A subtask's parent must be a live `STORY`; otherwise the result is
  `errors.invalidParent`. The schema trigger also forbids nesting.
- **Assignees (I09).** An assignee must exist and must not be archived. An archived assignee who
  is already set may stay; the UI shows it marked as archived.
- **Issue numbers (D30).** `ProjectService.allocateIssueNumber` runs inside the create
  transaction, so a rejected create consumes no number.
- **Optimistic concurrency (D05).** Every update, move, trash and restore increments `version`.
  `update` and `moveToStory` compare it with the caller's expected version and fail with
  `CONFLICT errors.staleTask`. Label removal and bulk unassignment also increment the version of
  each affected task, so an editor that is still open notices.
- **History (D11, D12, D27).** Each change writes one `task.updated` event that holds only the
  changed fields, together with display snapshots (status name and category, assignee name,
  label name and color).
  - A title change stores the old and the new title.
  - A description change stores the full new text. The previous text is in the preceding event,
    which is where M6's version browser will read it from.
  - Subtask create, trash, restore and move events are also recorded on the parent story.
- **Sort keys (D26).** Keys are fractional (`sortKeyBetween`).
  - A new story goes to the end of its status column.
  - A story whose status changes goes to the top of the new column.
  - A new subtask goes to the end of its parent's subtasks.
  - Trashed rows count when computing these keys, so a restored task never shares a key with a
    newer one.

## Trash cascade (D02, D19)

| Action | Effect |
|---|---|
| Trash story | Story gets `trashed_at`. Its **live** subtasks get `trashed_at` and `trash_cascade_root_id = story.id`. Subtasks that were already in the trash keep their own state. |
| Trash subtask | Only the subtask. |
| Trash project | Its live tasks get `trash_cascade_root_id = project.id`. The key stays reserved (D08). |
| Restore story or project | The root plus exactly the rows whose `trash_cascade_root_id` points to it. |
| Restore a cascaded row directly | `errors.restoreParentFirst` |
| Restore a subtask whose parent is in the trash | `errors.restoreParentFirst` (TRASH-06) |
| Restore a task inside a trashed project | `errors.projectTrashed` |

The trash list (D39) shows only rows that were trashed directly; rows trashed as part of a
cascade return with their root. Permanent deletion follows in M7. The FTS triggers already follow
`trashed_at`, so trashed tasks drop out of the search index and come back when restored.

## Editor (D40)

- The editor is a full page at `#/projects/:projectId/tasks/:taskId` with explicit Save and Cancel
  (TASK-08). Only the changed fields are sent.
- A `CanDeactivate` guard asks before unsaved changes are discarded.
- **Conflict (UJ-09).** When a save is rejected as stale, the editor shows a banner and a
  read-only "your unsaved changes" panel with the title and description. **Reload** loads the
  current version into the form; the panel stays until it is dismissed.
- Subtask status changes save immediately (TASK-08). If one fails, the select returns to the
  stored value (an unchanged `[selected]` binding is not re-applied by Angular).

## Markdown (MD-01..05, T2)

- `MarkdownService` renders with `marked` (GFM: tables, task lists, fenced code). Raw HTML tokens
  are escaped and shown as text (MD-04).
- `DOMPurify` then applies a strict allow-list:
  - no `style`, `form`, `iframe`, `svg` or `math`
  - no event handlers or `data-*` attributes
  - the URI pattern allows `http(s)://` and `attachment:` only
  - plain attributes (`type`, `checked`, …) are marked URI-safe, so DOMPurify does not test them
    against that pattern
- After sanitizing:
  - **Links:** links other than http(s) lose their `href`. http(s) links get
    `target="_blank" rel="noopener noreferrer"`. The main process's `setWindowOpenHandler` hands
    them to the OS browser only when clicked (MD-03).
  - **Checkboxes:** inputs other than checkboxes are removed, and checkboxes are disabled
    (read-only checklists, D10).
  - **Images:** every `<img>` is replaced by a text placeholder, so nothing is fetched. A
    placeholder for `attachment:<uuid>` keeps the id for M6, which will render it through the
    media protocol (ADR 0007).
- `<app-markdown-view>` is the only place where HTML is marked trusted
  (`bypassSecurityTrustHtml`). Angular's sanitizer would remove the read-only checkboxes, and
  DOMPurify is the sanitizer of record. The CSP (`script-src 'self'`, `img-src` without remote
  origins) and the network blocker remain as backstops.
- The view uses unencapsulated styles confined to `app-markdown-view .markdown`, because
  rendered HTML carries no Angular scoping attributes.
- The source text is stored and re-edited exactly as typed (MD-02).
