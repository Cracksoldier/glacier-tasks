// Trash (D39, D49, TRASH-01..06): directly trashed projects and tasks, newest first. Tasks
// that went to the trash with their story or project come back with it and are not listed.
// Permanent deletion (TRASH-05) removes an item with everything it contains in one
// transaction and returns the attachment storage keys whose bytes the caller deletes; avatars
// belong to profiles and are never touched.

import { AppError, formatIssueKey, type TrashItem } from '@glacier-tasks/domain';
import type { ServiceContext } from './context.js';

interface TrashRow {
  kind: TrashItem['kind'];
  id: string;
  project_id: string;
  project_key: string;
  issue_number: number | null;
  title: string;
  trashed_at: string;
}

export class TrashService {
  constructor(private readonly ctx: ServiceContext) {}

  list(projectId: string | null = null): TrashItem[] {
    return this.ctx.db
      .prepare<[string | null, string | null], TrashRow>(
        `SELECT * FROM (
           SELECT 'PROJECT' AS kind, id, id AS project_id, project_key, NULL AS issue_number,
             name AS title, trashed_at
           FROM projects WHERE trashed_at IS NOT NULL
           UNION ALL
           SELECT t.type, t.id, t.project_id, p.project_key, t.issue_number, t.title, t.trashed_at
           FROM tasks t JOIN projects p ON p.id = t.project_id
           WHERE t.trashed_at IS NOT NULL AND t.trash_cascade_root_id IS NULL
             AND p.trashed_at IS NULL
         )
         WHERE ? IS NULL OR project_id = ?
         ORDER BY trashed_at DESC, title`,
      )
      .all(projectId, projectId)
      .map((row) => ({
        kind: row.kind,
        id: row.id,
        projectId: row.project_id,
        projectKey: row.project_key,
        issueKey:
          row.issue_number === null ? null : formatIssueKey(row.project_key, row.issue_number),
        title: row.title,
        trashedAt: row.trashed_at,
      }));
  }

  /**
   * Permanently deletes a directly trashed item (TRASH-05): a project with all its tasks,
   * statuses, labels and history; a story with all its subtasks (also independently trashed
   * ones); a subtask. Returns the storage keys of the deleted attachment rows.
   */
  purge(kind: TrashItem['kind'], id: string): string[] {
    return this.ctx.db.transaction(() => {
      const item = this.list().find((entry) => entry.kind === kind && entry.id === id);
      if (!item) throw new AppError('NOT_FOUND', 'errors.notInTrash');
      return kind === 'PROJECT' ? this.purgeProject(id) : this.purgeTasks(this.taskTree(id));
    })();
  }

  /** Purges every directly trashed item of one project, or of the whole workspace. */
  empty(projectId: string | null): { deleted: number; storageKeys: string[] } {
    return this.ctx.db.transaction(() => {
      const items = this.list(projectId);
      const storageKeys: string[] = [];
      for (const item of items) {
        // An independently trashed subtask is already gone when its story was purged first.
        if (!this.list(projectId).some((entry) => entry.id === item.id)) continue;
        storageKeys.push(...this.purge(item.kind, item.id));
      }
      return { deleted: items.length, storageKeys };
    })();
  }

  /** The task and, for a story, all of its subtasks; subtasks first. */
  private taskTree(id: string): string[] {
    const subtasks = this.ctx.db
      .prepare<[string], { id: string }>(`SELECT id FROM tasks WHERE parent_story_id = ?`)
      .all(id)
      .map((row) => row.id);
    return [...subtasks, id];
  }

  private purgeTasks(ids: string[]): string[] {
    const keys = this.storageKeys(`task_id IN (${ids.map(() => '?').join(', ')})`, ids);
    const deleteEvents = this.ctx.db.prepare(
      `DELETE FROM activity_events WHERE entity_type = 'TASK' AND entity_id = ?`,
    );
    const deleteTask = this.ctx.db.prepare(`DELETE FROM tasks WHERE id = ?`);
    for (const id of ids) {
      deleteEvents.run(id);
      // task_labels, attachments and the search index follow by cascade and trigger.
      deleteTask.run(id);
    }
    return keys;
  }

  private purgeProject(projectId: string): string[] {
    const keys = this.storageKeys(`task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [
      projectId,
    ]);
    // Subtasks before stories, then the project: statuses, labels and project-scoped events
    // (including every task event) follow by cascade.
    this.ctx.db
      .prepare(`DELETE FROM tasks WHERE project_id = ? AND parent_story_id IS NOT NULL`)
      .run(projectId);
    this.ctx.db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(projectId);
    this.ctx.db.prepare(`DELETE FROM activity_events WHERE project_id = ?`).run(projectId);
    this.ctx.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    return keys;
  }

  private storageKeys(where: string, params: unknown[]): string[] {
    return this.ctx.db
      .prepare<unknown[], { storage_key: string }>(
        `SELECT storage_key FROM attachments WHERE ${where}`,
      )
      .all(...params)
      .map((row) => row.storage_key);
  }
}
