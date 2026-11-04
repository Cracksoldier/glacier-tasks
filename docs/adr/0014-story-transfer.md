# ADR 0014 — Story export and import

**Status:** Accepted (after v1.0.2, 2026-11-04)  
**Decisions:** D58; spec DATA-02, DATA-11; threat model T15

## Context

Users want to move or copy one story with its subtasks into another project or workspace.
Until now the only JSON was the export-only workspace/project file (D14), and the only import
was a full restore.

## File format

- One story per file, written by `StoryTransferService.export` (`packages/data`). The default
  name is `<ISSUE-KEY>.story.json`.
- The schema is `storyTransferSchema` (`packages/domain/src/story-transfer.ts`): `format:
  'glacier-tasks-story'`, `formatVersion: 1`, the source project key and name, and lists of
  `statuses`, `labels` and `assignees`. These lists contain only what the tasks use.
- Tasks refer to statuses and assignees by their source id. They refer to labels by name.
  The schema checks that every reference resolves inside the file.
- Field limits are the same as for the IPC inputs. A file may hold at most 500 subtasks and
  10 MiB.
- Only live subtasks are exported, in their order. The file carries no history, attachment
  bytes or descriptors, and no internal fields such as version or sort key.

## Two steps: inspect, then confirm

Inspect works like restore (ADR 0012):

1. `data.inspectStoryImport(projectId)`:
   - Opens the native dialog.
   - `readStoryFile` (`apps/desktop/src/story-import.ts`) checks the size, parses the JSON and
     validates it against the schema.
   - `StoryTransferService.preview` computes the suggestions for the open project.
   - The validated document waits in `PendingStoryImport` under a random token. There is a
     single slot: a new inspect replaces it.
2. `data.importStory({ token, projectId, statusMap, assigneeUserId })` takes the document and
   imports it. After a failure the document is put back, so the user can correct the mapping
   and try again.

The renderer never sends a path or file content, so the IPC surface stays small (T4/T5).

## Mapping rules (D58)

- **Statuses:**
  - A status is matched by name, ignoring case.
  - Without a name match, the suggestion is the first status of the same category, or else
    the project default.
  - The dialog shows the mapping only when a status has no name match.
  - On import, every used source status must map to a status of the target project.
- **Assignee:** one profile, or none, for the story and all subtasks. The suggestion is the
  story's original profile if it exists here and isn't archived. Archived profiles are
  rejected (I09).
- **Labels:** matched by name, ignoring case. Missing labels are created with the exported
  colour through `LabelService.create`, which records `label.created`.

## One transaction through the existing services

`StoryTransferService.import` runs in one `db.transaction`. better-sqlite3 turns the nested
service transactions into savepoints, so any failure rolls back every task and label.

- Tasks are created with `TaskService.create`. Issue numbers (D30), sort keys, label links,
  `task.created` and `task.subtaskCreated` (D12, D27) therefore work as for tasks created in
  the UI.
- `TaskService.create` takes an optional `meta.importedFrom`. Only the main process can set it,
  not IPC. It adds `importedFrom` to the created payload, and the history shows "Created by
  import from KEY-n".
- `activity_log.source` stays `UI`, so no migration is needed.

## Why attachments are excluded

- Embedding them would make the files large and add a second path into the attachment store
  that bypasses the size limit and staging.
- The product owner chose text-only files (D58).
- Descriptions keep their `attachment:` references. These don't resolve in the new task and
  render as unloaded images (MD-05). The preview warns when a description has such references.
