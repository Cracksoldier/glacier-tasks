// Workspace maintenance used by restore (D20, ADR 0012).

import type { Database } from 'better-sqlite3';

/**
 * Rebuilds the full-text index from the live tasks (D20, SEARCH-03, I20). Restore runs it
 * after activation so search never depends on the archived index.
 */
export function rebuildSearchIndex(db: Database): void {
  db.transaction(() => {
    db.exec(`DELETE FROM tasks_fts`);
    db.exec(
      `INSERT INTO tasks_fts (rowid, issue_key, title, description)
       SELECT t.row_id, p.project_key || '-' || t.issue_number, t.title, t.description_markdown
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.trashed_at IS NULL`,
    );
  })();
}

export interface WorkspaceCounts {
  projects: number;
  users: number;
  tasks: number;
  attachments: number;
  avatars: number;
}

/** Row counts for the restore preview; includes trashed items. */
export function workspaceCounts(db: Database): WorkspaceCounts {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    projects: count(`SELECT count(*) AS n FROM projects`),
    users: count(`SELECT count(*) AS n FROM users`),
    tasks: count(`SELECT count(*) AS n FROM tasks`),
    attachments: count(`SELECT count(*) AS n FROM attachments WHERE removed_at IS NULL`),
    avatars: count(`SELECT count(*) AS n FROM avatar_files`),
  };
}

/** Storage keys of every managed file the database references (backup inventory). */
export function managedFileKeys(db: Database): { attachments: string[]; avatars: string[] } {
  const keys = (sql: string) =>
    (db.prepare(sql).all() as { storage_key: string }[]).map((row) => row.storage_key);
  return {
    attachments: keys(`SELECT storage_key FROM attachments WHERE removed_at IS NULL`),
    avatars: keys(`SELECT storage_key FROM avatar_files`),
  };
}
