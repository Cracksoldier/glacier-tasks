# ADR 0012 — Backup, restore, JSON export and permanent deletion

**Status:** Accepted (M7, 2026-10-29)  
**Decisions:** D02, D13, D14, D17, D19, D20, D28, D34, D48, D49, D50; spec DATA-01..10,
TRASH-01..06; threat model T8, T9, T14

## Archive format (`packages/domain/src/backup-format.ts`)

- **Contents:** a `.glaciertasks` file is a ZIP archive (D34). It is written with **yazl** and read
  with **yauzl** (D48, exact pins, ZIP64 and streaming; both have one tiny dependency).
  - `manifest.json`: `format: "glacier-tasks-backup"`, `formatVersion: 1`, app version, schema
    version, creation time, kind (`manual`, `automatic`, `safety`), and every other entry with
    its size and SHA-256.
  - `workspace.sqlite`: a consistent snapshot through the SQLite backup API (DATA-05), switched
    to `journal_mode = DELETE` so it needs no WAL sidecar.
  - `attachments/<key>` and `avatars/<key>`: the managed files that **the snapshot** references,
    stored uncompressed.
- **Changes during a backup:** if a referenced file disappears between the snapshot and the copy
  (for example, it was removed), the backup fails with `errors.backupChanged` instead of
  producing an incomplete archive.
- **Writing:** the archive goes to `<target>.partial`, then fsync, then a rename. Any failure
  (disk full, unwritable folder) deletes the partial file and reports `errors.backupFailed`.
- **Restore sources:** restore accepts only this format. A JSON export or any other file is
  `errors.backupInvalid`.

## Validation and staging (`apps/desktop/src/backup.ts`, `inspectArchive`)

- **Entries (T8):**
  - Only `manifest.json`, `workspace.sqlite`, `attachments/<key>` and `avatars/<key>` are
    allowed, where a key is `[A-Za-z0-9-]{1,64}`.
  - yauzl's `strictFileNames` and `validateEntrySizes` are on.
  - Rejected: link entries (Unix mode in the external attributes), encrypted entries,
    duplicates, a compression ratio over 200:1 for entries over 1 MiB, more than 200,000
    entries, and a manifest over 64 MiB.
- **Manifest:** must parse with the strict zod schema and list exactly the archive's entries.
  - Every entry's size must match.
  - While extracting through `resolveInside` into `restore-staging/<token>/`, the SHA-256 is
    checked and writing stops as soon as an entry exceeds its declared size.
- **Database:** the staged SQLite file is opened read-only.
  - `integrity_check` and `foreign_key_check` must pass.
  - `schema_migrations` must match the manifest.
  - A newer schema is `errors.backupFromNewerVersion` (D28).
  - Every attachment and avatar the database references must exist in the staging folder.
- **Preview:** the user sees the file, date, versions and row counts, and the warning that
  everything will be replaced (DATA-07). Nothing in the archive is ever executed (DATA-08).
- **Failure:** any failure deletes the staging folder; the live data was never touched.

## Activation (`activatePendingRestore`)

- **On confirmation:**
  1. A complete **safety backup** of the current data is written to
     `<userData>/backups/pre-restore-<time>.glaciertasks` (DATA-06).
  2. `restore-pending.json` names the staged token.
  3. The app restarts.
- **Why a restart:** the swap happens before any database handle exists, so no live connection
  or WAL file is replaced underneath the app.
- **At startup, before `openWorkspace`:**
  1. The current database (with `-wal`/`-shm`), `attachments/` and `avatars/` move to
     `restore-rollback/`.
  2. The staged files move into place.
  3. `openWorkspace` migrates older backups (D28).
  4. `rebuildSearchIndex` recreates the FTS index from the live tasks (D20).
  5. `integrity_check` runs.
- **On failure (T9):** the moved-aside data goes back and the app starts normally; the shell
  shows that the previous data was kept. On success it shows the name of the safety backup.
- **Untouched:** device settings are never part of this (D17). Views of projects that no longer
  exist are pruned at startup as before.
- **Leftovers:** a staged archive without a confirmation is deleted on the next start.

## Automatic backups (D13)

- **When:** after the window opens, without blocking startup. When enabled, a folder is chosen
  (only through the main-process folder picker) and the interval has passed, the app writes
  `glacier-tasks-auto-YYYYMMDD-HHMMSS.glaciertasks`.
- **Retention:** keeps the newest N files of **exactly that name pattern**; nothing else in the
  folder is ever deleted.
- **Failures:** an unavailable folder or a failed run stores `lastFailure` in the device
  settings, and the shell shows a dismissible warning.

## JSON export (D14)

- **Contents:** the whole workspace or one project, with trashed items optional.
  - Projects with statuses, labels, stories, subtasks, attachment descriptors (name, type,
    size, SHA-256; never bytes) and history.
  - Profiles (the whole workspace) or the profiles the project references.
- **Not a backup:** `format: "glacier-tasks-export"` and a `notice` say it is not a backup. The
  default name ends in `.export.json`, the Settings page says so next to the button, and
  restore rejects the file.

## Permanent deletion (`TrashService.purge` / `empty`)

- **What can be deleted:** only directly trashed items (TRASH-05); items trashed by a cascade go
  with their root.
- **Each kind:**
  - A **story** goes with all its subtasks, including independently trashed ones, their label
    links, attachment rows and task events.
  - A **subtask** goes alone; its story's D27 events keep their snapshots.
  - A **project** goes with all its tasks, statuses, labels and every event of the project. Its
    key becomes free.
- **Bytes and avatars:** the service returns the attachment storage keys; the desktop deletes
  those bytes, and reconciliation catches leftovers. Avatars belong to profiles and are not
  affected.
- **"Empty trash":** purges every direct item in the current filter.
- **Confirmation (D50):** typing the key, or the localized confirmation word for "Empty trash".

## Testing

- **Native dialogs:** they can't be automated. When `GLACIER_USER_DATA` is set,
  `GLACIER_TEST_DIALOG_PATH` replaces the save/open dialogs, and a confirmed restore exits
  instead of relaunching, so the end-to-end test can start the app again itself.
- **Packaged smoke test:** writes and validates a complete archive, which proves yazl/yauzl are
  bundled.
