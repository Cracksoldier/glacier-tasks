# ADR 0005 — Schema and migrations

**Status:** Accepted (M0, 2026-10-29)  
**Spec:** §5, §11, DATA-10

## Decision

### Migrations

- Each migration is a TypeScript module in `packages/data/src/migrations/NNNN-name.ts` that
  exports `{ version, name, sql }`. TypeScript instead of `.sql` files means the bundler
  needs no extra loader and files can't go missing in a package.
- `MIGRATIONS` in `packages/data/src/index.ts` lists them in order. Versions are sequential
  from 1 with no gaps, which `assertMigrationsWellFormed` checks.
- **Never edit a migration that has shipped in a release.** Fix forward with a new migration.
- `migrate(db, MIGRATIONS)`:
  - creates `schema_migrations(version, name, applied_at)`
  - refuses databases with a higher version than the app knows (`MIGRATION_REQUIRED`), so a
    workspace from a newer app is never written
  - applies each pending migration in its own transaction
  - runs `PRAGMA foreign_key_check` afterwards
- Before migrating an existing workspace, the caller takes a safety backup (spec §11). This
  is wired up in M1 together with the startup flow.
- Restored backups go through the same runner: older schema → migrate, newer → reject (D28).

### Connection settings

`openDatabase` sets `foreign_keys = ON` (and verifies it), `busy_timeout = 5000`, and WAL for
the live workspace. Consistent snapshots use the SQLite online backup API (`snapshotDatabase`).

### Schema design rules (migration 0001)

- **UUID `id`** for every entity; joins and APIs use UUIDs. `tasks` also has an internal
  `row_id INTEGER PRIMARY KEY`. It stays the same across `VACUUM` and is used only as the
  FTS rowid.
- **Cross-project integrity via composite foreign keys:** tables referencing project-scoped
  rows carry `project_id` and reference `(project_id, id)`:
  - `tasks → statuses`
  - `tasks → parent tasks`
  - `task_labels → tasks/labels`

  A task can therefore never point at another project's status, label or parent.
- **CHECK constraints** cover enum values, title/description length, project key format
  (D08), story/subtask parent consistency, `start_date <= due_date`, and `trash_cascade_root_id`
  only being set while the task is trashed.
- **Triggers:**
  - a subtask's parent must be a story
  - a story with subtasks can't become a subtask
  - `activity_events` are append-only
  - `tasks_fts` follows inserts, edits, trash/restore and deletes of tasks
- **Partial unique index:** at most one default status per project. "Exactly one default"
  and "at least one DONE status" (D07) need multi-row logic and are enforced by the workflow
  service inside its transaction.
- Deleting a status referenced by any task, trashed or not, fails on the foreign key, so
  status removal must migrate tasks first (D01).
- Permanently deleting a project cascades to statuses, labels, tasks, task labels,
  attachments metadata, project activity and FTS rows.

## Consequences

- The draft schema is covered by `packages/data/src/schema.spec.ts`.
- Migration 0001 may still change until the first release; after that it is frozen.
