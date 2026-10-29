# ADR 0009 — Workflows and the Kanban board

**Status:** Accepted (M4, 2026-10-29)  
**Decisions:** D01, D05, D06, D07, D17, D26; spec §3.4, BOARD-01..05

## Workflow statuses (`packages/data/src/services/workflows.ts`)

- **Invariants:**
  - every project keeps at least one status, exactly one default and at least one `DONE`
    status (D07)
  - names are unique per project, ignoring case (DB `UNIQUE … NOCASE`; CONFLICT
    `errors.statusNameTaken`)
  - positions are dense, `0..n-1`

  `checkWorkflow` (domain) guards category changes. Removal checks that a `DONE` status remains.
- **Default:** setting a new default clears the old one first, in the same transaction, because
  the partial unique index allows a single default.
- **Reorder:** `workflows.update(id, { position })` moves the status to that index and renumbers
  all positions. The UI reorders by drag (CDK) or with up/down buttons for the keyboard.
- **Delete and migrate (D01, UJ-04).** `removeAndMigrate(statusId, replacementId)` is one
  transaction:
  1. The replacement must be a different status of the same project, otherwise
     `errors.invalidReplacement`. Removing the last `DONE` status fails with
     `errors.lastDoneStatus`.
  2. Every task using the status, live or trashed, moves to the replacement and gets
     `version + 1` (D05) and a `task.updated` event with `cause: 'status.removed'`. Stories are
     appended to the end of the replacement column in their previous order.
  3. A removed default makes the replacement the new default.
  4. The status is deleted, positions are renumbered and `status.removed` is recorded with the
     migrated counts.

  Any failure rolls back everything. `workflows.usage` gives the wizard its preview: live
  stories, live subtasks and trashed tasks.
- **History:** `status.created`, `status.updated` (name, category, default), `status.reordered`
  and `status.removed` (D12). Task events keep status snapshots, so renames never break earlier
  history entries.

## Board moves (`TaskService.move`)

- `tasks.move(id, expectedVersion, statusId, sortOrder?)` moves **stories only**; subtask status
  changes go through `tasks.update` (D06).
- **Another column:** the card goes to the **top** of the target column (D26). The given key is
  ignored, and a `task.updated` status change is recorded.
- **Same column:** the client sends `sortKeyBetween(prev, next)` from its current neighbours. The
  server validates the key format and stores it. Reordering alone records no history event, but
  still increments `version`.
- Board queries order by `position, sort_order, issue_number`, so equal keys still give a stable
  order.

## Sort key format (`packages/domain/src/sort-key.ts`, migration 0002)

Added after the M0–M4 code review. The M3 keys were fractions only, so every move to the top
of a column and every append to its end added a character about every six operations. Long
before a busy Done column reached thousands of finished stories, the top key would have passed
the 256-character limit of `sortKeySchema` and reordering next to it would have failed.

- **Format:** the rocicorp `fractional-indexing` design (CC0), implemented in-house with the
  same base-62 alphabet, so SQLite BINARY collation and JavaScript comparison still agree. A key
  is an integer part plus an optional fraction that never ends in `0`. The integer part's head
  character encodes its length: `a`–`z` for 2–27 characters, `Z`–`A` for negative integers.
  The first key is `a0`.
- **Growth:** moving a card to the start or end of a list decrements or increments the integer
  part, so the key length grows logarithmically there. Fractions appear only between two
  neighbours. The public API (`sortKeyBetween`, `isValidSortKey`) is unchanged.
- **Migration 0002** rewrites every existing key in its current order (`sort_order`, then
  `issue_number`). It covers stories per project and status and subtasks per story, trashed
  rows included, and produces fixed five-character keys `d` + four digits. It changes the
  storage format only, so `version`, timestamps and history stay untouched.

## Board UI (`apps/ui/src/app/pages/projects/board.ts`)

- One `tasks.query` loads all live tasks of the project. Stories become cards in their status
  column; subtasks appear only inside the expanded card (BOARD-02/03).
- **Drag & drop:** Angular CDK, one `cdkDropList` per column in a `cdkDropListGroup`. The move is
  shown immediately (a linked signal of columns) and then persisted. After every write the board
  reloads from the server: fresh versions after success, the true state after a failure, with an
  error banner (BOARD-04).
- **Keyboard (M4 task 5):** every card has a "Move to status" select that calls `tasks.move`
  without a key, so the card lands at the top of the new column. A failed change restores the
  select explicitly, because an unchanged `[selected]` binding is not re-applied (the same
  pattern as in the editor).
- **Expanded card:** each subtask has a status select that saves immediately (D06, TASK-08) and
  never changes the story (TASK-05).
- **Views:** the project page shows Board | List tabs. The choice is stored in the device setting
  `lastView` (D17). Since M5 the list view and the board filters follow ADR 0010.

## Subtask swimlanes (BOARD-07, D51; added in M7)

- **Toggle:** a "Group: Stories | Subtasks" toggle above the board switches the view. The
  choice is `boardGroup` in the project's view in the device settings (D42); views stored
  earlier default to `stories`.
- **Lanes:** grouped by subtasks, every story that passes the board filters (story fields only,
  D43) and has subtasks becomes a lane, in board order.
  - A lane has the story's key and title, its status select and assignee, the done/total count
    and a collapse toggle. Collapsed lanes are not remembered.
  - Below it are the project's status columns with that story's subtasks.
  - Columns scroll on their own above 360 px.
  - Stories without subtasks follow in an "Other stories" lane.
- **Dropping:**
  - **A subtask** dropped into another column changes only its status through `tasks.update`
    (version-checked, history, D06). The story keeps its status.
  - **A story** in "Other stories" moves through `tasks.move`, to the top of the column (D26).
  - **Inside one column** a drop does nothing: the order follows the story's subtask order and,
    in the "Other stories" lane, the column shows only part of the board.
  - Each lane has its own `cdkDropListGroup`, so cards never change lanes.
- **Keyboard:** every card keeps a status select as the alternative to dragging.

