# ADR 0011 — Attachments and the activity history UI

**Status:** Accepted (M6, 2026-10-29)  
**Decisions:** D03, D10, D11, D12, D27, D33, D45, D46, D47; spec §3.6, §3.7, FILE-01..05,
MD-05, AUDIT-01..05, PROJ-06; threat model T2, T5, T10, T11

## Storage (`apps/desktop/src/attachment-store.ts`, `packages/data/src/services/attachments.ts`)

- **Who does what:**
  - `AttachmentService` (DB only) writes rows and history events.
  - `AttachmentStore` (Electron-free, unit-tested) owns `<userData>/attachments/`.
  - `main.ts` provides the dialogs and the OS handler.
- **Import:** staged copy, then the metadata transaction, then finalize.
  1. The file is stream-copied to `attachments/.staging/<key>` while being hashed (SHA-256).
     The size is checked before and during the copy. Drag & drop writes the received bytes
     there instead.
  2. `AttachmentService.insert` stores the row and a `task.attachmentAdded` event in one
     transaction.
  3. The staged file is renamed to `attachments/<key>`. If the insert fails, the staged file is
     deleted.
- **Keys:** a fresh random UUID per file. The original name is display metadata only and never
  part of a storage path (T5).
- **Type:**
  - A preview type comes only from the file signature (PNG, JPEG, GIF, WebP).
  - Other files get a MIME type from a small extension table, purely for display.
  - The table may never claim a previewable type: a renamed SVG called `.png` becomes
    `application/octet-stream` (I27).
- **Size limit:** the device setting `attachmentMaxMiB` (D47, 1–2048, default 100), read on every
  import.
- **Removal (D03):** one transaction sets `removed_at` (the tombstone) and records
  `task.attachmentRemoved`. The bytes are deleted right after. If that delete fails, startup
  reconciliation removes the file.
- **Trashed tasks** keep their attachments; adding or removing needs a live task.
- **Version:** attachment changes record task history but don't bump the task's `version`, so an
  open editor never gets a conflict from its own attachment changes (D05 covers task fields).
- **Startup reconciliation:**
  - finishes staged files whose row was committed, and deletes other staged files
  - deletes files without a live row, including bytes of removed attachments
  - logs rows whose file is missing
  - one bad entry never blocks startup
  - also clears temporary open copies from earlier sessions

## Getting files in and out

- **Picker:** `attachments.add(taskId)` opens a multi-select dialog in the main process and
  imports by path.
- **Drag & drop:** `attachments.addFiles(taskId, files)` receives the dropped files' **bytes**
  (at most 20 per call), never paths.
  - This keeps the rule that the renderer never sends a path (T5), so a compromised renderer
    can't import arbitrary files from disk.
  - The cost is copying bytes over IPC, which is fine within the size limit.
- **Open:** `attachments.open(id)` copies the file to `<temp>/glacier-tasks-open/<uuid>/<sanitized
  name>` and calls `shell.openPath` on the copy.
  - The OS picks the app by extension.
  - Nothing the app does reaches the managed bytes.
  - The renderer asks for confirmation for every file without an in-app preview (T11).
  - Previewable images open in an in-app dialog first.
- **Save as:** `attachments.saveAs(id)` uses the native save dialog, with the sanitized original
  name as the default.
- **`sanitizeFileName`** (domain) removes path components, control and reserved characters,
  trailing dots and Windows device names, and caps the name at 255 characters while keeping the
  extension.

## Previews and inline images

- `glacier-media://attachment/<uuid>` serves only **live, previewable** attachments of a live task
  (`AttachmentStore.read`).
  - Responses carry the detected MIME type, `nosniff` and `no-store`.
  - Anything else, including SVG, answers 404.
  - The smoke test checks the 404 for an unknown id.
- **`MarkdownService.render(source, attachments)`:** `![alt](attachment:<id>)` becomes an image
  only when `<id>` is a live, previewable attachment of the task being shown (D10, I28).
  - Any other reference stays a placeholder, including another task's, a removed or an SVG
    attachment.
  - Remote or `data:` images are still never loaded.
- **"Insert"** next to a previewable attachment writes the reference at the cursor of the
  description. The user then saves it like any other edit.

## History UI

- **`ActivityFormatter`** (`apps/ui/src/app/core/activity`) turns every event type into a summary
  plus detail lines in the UI language.
  - It uses only the event's own snapshots, so renamed or archived profiles, statuses and labels
    stay readable (AUDIT-02/03).
  - Unknown event types show their raw type.
- **`<app-activity-timeline>`** shows the history newest first:
  - in the task editor
  - in the project page's Activity tab (D45), paged by 50, with links to tasks
  - in each profile's history dialog (D46)
- **Duplicate entries:** the project feed leaves out the copies of subtask events that D27
  records on the parent story (`task.subtask*`), because the subtask's own event already
  describes the change. The copies stay in the story's history.
- **Description versions (D11):** `tasks.descriptionVersions` reads the text from `task.created`
  and from every `task.updated` that changed the description.
  - The browser shows each version rendered or as source, or compared with its predecessor.
  - The comparison is a line diff by longest common subsequence, written in-house (T14). Above
    four million line pairs it falls back to "all removed, all added".
- **Dialogs:** `<app-dialog>` gained a `wide` variant for previews, version comparison and
  history lists.
