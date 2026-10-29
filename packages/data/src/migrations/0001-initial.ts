// Migration 0001 — initial workspace schema (spec §5, DECISIONS D01–D35).
//
// Conventions (docs/adr/0005-migrations.md): one TypeScript module per migration exporting
// its SQL; never edit a migration after it has shipped in a release; the runner applies each
// pending migration in its own transaction and records it in `schema_migrations`.
//
// Cross-project integrity is enforced by composite foreign keys: every table that references
// a project-scoped row carries `project_id` and references `(project_id, id)` of that row.

import type { Migration } from '../migrate.js';

const sql = /* sql */ `
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  project_key       TEXT NOT NULL UNIQUE CHECK (
                      length(project_key) BETWEEN 2 AND 10
                      AND substr(project_key, 1, 1) GLOB '[A-Z]'
                      AND project_key NOT GLOB '*[^A-Z0-9]*'),
  name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description       TEXT NOT NULL DEFAULT '',
  next_issue_number INTEGER NOT NULL DEFAULT 1 CHECK (next_issue_number >= 1),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  trashed_at        TEXT
);

CREATE TABLE avatar_files (
  id          TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  sha256      TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size   INTEGER NOT NULL CHECK (byte_size >= 0)
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
  avatar_file_id TEXT REFERENCES avatar_files (id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  archived_at    TEXT
);

CREATE TABLE statuses (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category   TEXT NOT NULL CHECK (category IN ('TODO', 'IN_PROGRESS', 'DONE')),
  position   INTEGER NOT NULL CHECK (position >= 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  UNIQUE (project_id, name COLLATE NOCASE)
);
-- At most one default status per project; "exactly one" and "at least one DONE" (D07)
-- are enforced transactionally by the workflow service.
CREATE UNIQUE INDEX statuses_one_default ON statuses (project_id) WHERE is_default = 1;

CREATE TABLE labels (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  color      TEXT,
  UNIQUE (project_id, id),
  UNIQUE (project_id, name COLLATE NOCASE)
);

-- row_id is an internal, VACUUM-stable integer key used only as the FTS rowid.
-- All joins and APIs use the UUID in id.
CREATE TABLE tasks (
  row_id                INTEGER PRIMARY KEY,
  id                    TEXT NOT NULL UNIQUE,
  project_id            TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  issue_number          INTEGER NOT NULL CHECK (issue_number >= 1),
  type                  TEXT NOT NULL CHECK (type IN ('STORY', 'SUBTASK')),
  parent_story_id       TEXT,
  title                 TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  description_markdown  TEXT NOT NULL DEFAULT '' CHECK (length(description_markdown) <= 100000),
  priority              TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status_id             TEXT NOT NULL,
  assignee_user_id      TEXT REFERENCES users (id),
  start_date            TEXT,
  due_date              TEXT,
  sort_order            TEXT NOT NULL,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  trashed_at            TEXT,
  trash_cascade_root_id TEXT,
  UNIQUE (project_id, id),
  UNIQUE (project_id, issue_number),
  FOREIGN KEY (project_id, status_id) REFERENCES statuses (project_id, id),
  FOREIGN KEY (project_id, parent_story_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  CHECK ((type = 'STORY' AND parent_story_id IS NULL) OR (type = 'SUBTASK' AND parent_story_id IS NOT NULL)),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  CHECK (trash_cascade_root_id IS NULL OR trashed_at IS NOT NULL)
);
CREATE INDEX tasks_board ON tasks (project_id, status_id, sort_order) WHERE trashed_at IS NULL;
CREATE INDEX tasks_parent ON tasks (parent_story_id, sort_order);
CREATE INDEX tasks_assignee ON tasks (assignee_user_id);
CREATE INDEX tasks_cascade_root ON tasks (trash_cascade_root_id) WHERE trash_cascade_root_id IS NOT NULL;

-- A subtask's parent must be a story (no nesting, spec §3.3).
CREATE TRIGGER tasks_parent_is_story_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_story_id IS NOT NULL
  AND (SELECT type FROM tasks WHERE id = NEW.parent_story_id) IS NOT 'STORY'
BEGIN
  SELECT RAISE(ABORT, 'parent must be a story');
END;

CREATE TRIGGER tasks_parent_is_story_update
BEFORE UPDATE OF parent_story_id, type ON tasks
WHEN NEW.parent_story_id IS NOT NULL
  AND (SELECT type FROM tasks WHERE id = NEW.parent_story_id) IS NOT 'STORY'
BEGIN
  SELECT RAISE(ABORT, 'parent must be a story');
END;

CREATE TRIGGER tasks_story_with_subtasks_stays_story
BEFORE UPDATE OF type ON tasks
WHEN NEW.type = 'SUBTASK' AND EXISTS (SELECT 1 FROM tasks WHERE parent_story_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'a story with subtasks cannot become a subtask');
END;

CREATE TABLE task_labels (
  task_id    TEXT NOT NULL,
  label_id   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, label_id) REFERENCES labels (project_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX task_labels_label ON task_labels (label_id);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  original_name TEXT NOT NULL CHECK (length(original_name) > 0),
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_key   TEXT NOT NULL UNIQUE,
  added_at      TEXT NOT NULL,
  removed_at    TEXT
);
CREATE INDEX attachments_task ON attachments (task_id);

-- Append-only history for tasks and project-level entities (D11, D12). entity_id is
-- polymorphic, so it has no foreign key; permanent deletion removes events explicitly.
CREATE TABLE activity_events (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('TASK', 'PROJECT', 'STATUS', 'LABEL', 'USER')),
  entity_id    TEXT NOT NULL,
  project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  source       TEXT NOT NULL CHECK (source IN ('UI', 'RESTORE', 'SYSTEM'))
);
CREATE INDEX activity_events_entity ON activity_events (entity_type, entity_id, occurred_at);
CREATE INDEX activity_events_project ON activity_events (project_id, occurred_at);

CREATE TRIGGER activity_events_immutable
BEFORE UPDATE ON activity_events
BEGIN
  SELECT RAISE(ABORT, 'activity events are append-only');
END;

-- Workspace-level settings only; device settings live outside the database (D17).
CREATE TABLE workspace_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
);

-- Full-text index of live tasks (SEARCH-02/03). rowid = tasks.row_id.
CREATE VIRTUAL TABLE tasks_fts USING fts5 (
  issue_key,
  title,
  description,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE TRIGGER tasks_fts_insert
AFTER INSERT ON tasks
WHEN NEW.trashed_at IS NULL
BEGIN
  INSERT INTO tasks_fts (rowid, issue_key, title, description)
  VALUES (
    NEW.row_id,
    (SELECT project_key FROM projects WHERE id = NEW.project_id) || '-' || NEW.issue_number,
    NEW.title,
    NEW.description_markdown
  );
END;

CREATE TRIGGER tasks_fts_update
AFTER UPDATE OF title, description_markdown, trashed_at, issue_number ON tasks
BEGIN
  DELETE FROM tasks_fts WHERE rowid = OLD.row_id;
  INSERT INTO tasks_fts (rowid, issue_key, title, description)
  SELECT
    NEW.row_id,
    (SELECT project_key FROM projects WHERE id = NEW.project_id) || '-' || NEW.issue_number,
    NEW.title,
    NEW.description_markdown
  WHERE NEW.trashed_at IS NULL;
END;

CREATE TRIGGER tasks_fts_delete
AFTER DELETE ON tasks
BEGIN
  DELETE FROM tasks_fts WHERE rowid = OLD.row_id;
END;
`;

export const migration0001: Migration = {
  version: 1,
  name: 'initial',
  sql,
};
