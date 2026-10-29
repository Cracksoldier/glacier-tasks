// Per-project workflow statuses (spec §3.4, D01, D07, D32): create, rename, recategorize,
// default, reorder and the atomic delete-and-migrate (UJ-04). Every change records a status
// event (D12); tasks moved by a removal get their own history entry and a new version (D05).

import {
  AppError,
  checkWorkflow,
  formatIssueKey,
  sortKeyBetween,
  STATUS_EVENTS,
  type StatusCreatedPayload,
  type StatusInputData,
  type StatusPatchData,
  type StatusRemovedPayload,
  type StatusReorderedPayload,
  type StatusSnapshot,
  type StatusUpdatedPayload,
  type StatusUsage,
  TASK_EVENTS,
  type TaskUpdatedPayload,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import type { Database } from 'better-sqlite3';
import { recordEvent } from './activity.js';
import { fieldChange, isUniqueViolation, type ServiceContext } from './context.js';

interface StatusRow {
  id: string;
  project_id: string;
  name: string;
  category: WorkflowStatus['category'];
  position: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function toStatus(row: StatusRow): WorkflowStatus {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    category: row.category,
    position: row.position,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshot(row: StatusRow): StatusSnapshot {
  return { id: row.id, name: row.name, category: row.category };
}

/** Statuses of one project in board order. */
export function listStatuses(db: Database, projectId: string): WorkflowStatus[] {
  return db
    .prepare<[string], StatusRow>(
      `SELECT * FROM statuses WHERE project_id = ? ORDER BY position, created_at`,
    )
    .all(projectId)
    .map(toStatus);
}

const notFound = () => new AppError('NOT_FOUND', 'errors.statusNotFound');
const lastDone = () => new AppError('CONFLICT', 'errors.lastDoneStatus');

export class WorkflowService {
  constructor(private readonly ctx: ServiceContext) {}

  list(projectId: string): WorkflowStatus[] {
    this.requireLiveProject(projectId);
    return listStatuses(this.ctx.db, projectId);
  }

  create(projectId: string, input: StatusInputData): WorkflowStatus {
    const id = this.ctx.newId();
    this.mapUnique(() =>
      this.ctx.db.transaction(() => {
        this.requireLiveProject(projectId);
        const position = listStatuses(this.ctx.db, projectId).length;
        const now = this.ctx.now();
        this.ctx.db
          .prepare(
            `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          )
          .run(id, projectId, input.name, input.category, position, now, now);
        const payload: StatusCreatedPayload = {
          name: input.name,
          category: input.category,
          position,
        };
        this.record(id, projectId, STATUS_EVENTS.created, payload);
      })(),
    );
    return toStatus(this.require(id));
  }

  update(id: string, patch: StatusPatchData): WorkflowStatus {
    this.mapUnique(() =>
      this.ctx.db.transaction(() => {
        const row = this.require(id);
        const statuses = listStatuses(this.ctx.db, row.project_id);
        const changes: StatusUpdatedPayload['changes'] = {};
        const name = fieldChange(row.name, patch.name);
        const category = fieldChange(row.category, patch.category);
        if (name) changes.name = name;
        if (category) {
          // D07: at least one DONE status must remain.
          const next = statuses.map((s) => (s.id === id ? { ...s, category: category.to } : s));
          if (!checkWorkflow(next).ok) throw lastDone();
          changes.category = category;
        }
        if (patch.isDefault && row.is_default === 0) {
          changes.isDefault = { from: false, to: true };
          // The partial unique index allows one default: clear the old one first.
          this.ctx.db
            .prepare(`UPDATE statuses SET is_default = 0 WHERE project_id = ? AND is_default = 1`)
            .run(row.project_id);
        }
        const now = this.ctx.now();
        if (Object.keys(changes).length > 0) {
          this.ctx.db
            .prepare(
              `UPDATE statuses SET name = ?, category = ?, is_default = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              name?.to ?? row.name,
              category?.to ?? row.category,
              changes.isDefault ? 1 : row.is_default,
              now,
              id,
            );
          const payload: StatusUpdatedPayload = { name: name?.to ?? row.name, changes };
          this.record(id, row.project_id, STATUS_EVENTS.updated, payload);
        }

        if (patch.position !== undefined) {
          const from = statuses.findIndex((s) => s.id === id);
          const to = Math.min(patch.position, statuses.length - 1);
          if (from !== to) {
            const ordered = statuses.map((s) => s.id);
            ordered.splice(from, 1);
            ordered.splice(to, 0, id);
            this.renumber(ordered, now);
            const payload: StatusReorderedPayload = { name: name?.to ?? row.name, from, to };
            this.record(id, row.project_id, STATUS_EVENTS.reordered, payload);
          }
        }
      })(),
    );
    return toStatus(this.require(id));
  }

  usage(id: string): StatusUsage {
    this.require(id);
    return this.ctx.db
      .prepare<[string], StatusUsage>(
        `SELECT
           count(CASE WHEN type = 'STORY' AND trashed_at IS NULL THEN 1 END) AS stories,
           count(CASE WHEN type = 'SUBTASK' AND trashed_at IS NULL THEN 1 END) AS subtasks,
           count(CASE WHEN trashed_at IS NOT NULL THEN 1 END) AS trashed
         FROM tasks WHERE status_id = ?`,
      )
      .get(id) as StatusUsage;
  }

  /**
   * Removes a status and moves every task using it, live or trashed (D01), to the replacement
   * in one transaction (UJ-04). The replacement inherits the default flag if needed.
   */
  removeAndMigrate(id: string, replacementId: string): void {
    this.ctx.db.transaction(() => {
      const row = this.require(id);
      const replacement = this.find(replacementId);
      if (!replacement || replacement.id === id || replacement.project_id !== row.project_id) {
        throw new AppError('VALIDATION', 'errors.invalidReplacement');
      }
      const remaining = listStatuses(this.ctx.db, row.project_id).filter((s) => s.id !== id);
      if (!remaining.some((s) => s.category === 'DONE')) throw lastDone();

      const migrated = this.usage(id);
      const now = this.ctx.now();
      const tasks = this.ctx.db
        .prepare<
          [string],
          { id: string; type: string; title: string; issue_number: number; project_key: string }
        >(
          `SELECT t.id, t.type, t.title, t.issue_number, p.project_key
           FROM tasks t JOIN projects p ON p.id = t.project_id
           WHERE t.status_id = ? ORDER BY t.sort_order, t.issue_number`,
        )
        .all(id);
      let lastKey = (
        this.ctx.db
          .prepare(
            `SELECT max(sort_order) AS key FROM tasks
             WHERE project_id = ? AND status_id = ? AND type = 'STORY'`,
          )
          .get(row.project_id, replacementId) as { key: string | null }
      ).key;
      const moveStory = this.ctx.db.prepare(
        `UPDATE tasks SET status_id = ?, sort_order = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      );
      const moveSubtask = this.ctx.db.prepare(
        `UPDATE tasks SET status_id = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      );
      for (const task of tasks) {
        if (task.type === 'STORY') {
          // Appended to the replacement column in their previous relative order.
          lastKey = sortKeyBetween(lastKey, null);
          moveStory.run(replacementId, lastKey, now, task.id);
        } else {
          moveSubtask.run(replacementId, now, task.id);
        }
        const payload: TaskUpdatedPayload = {
          issueKey: formatIssueKey(task.project_key, task.issue_number),
          title: task.title,
          changes: { status: { from: snapshot(row), to: snapshot(replacement) } },
          cause: STATUS_EVENTS.removed,
        };
        recordEvent(this.ctx, {
          entityType: 'TASK',
          entityId: task.id,
          projectId: row.project_id,
          eventType: TASK_EVENTS.updated,
          payload,
        });
      }

      this.ctx.db.prepare(`DELETE FROM statuses WHERE id = ?`).run(id);
      const defaultReassigned = row.is_default === 1;
      if (defaultReassigned) {
        this.ctx.db
          .prepare(`UPDATE statuses SET is_default = 1, updated_at = ? WHERE id = ?`)
          .run(now, replacementId);
      }
      this.renumber(
        remaining.map((s) => s.id),
        now,
      );
      const payload: StatusRemovedPayload = {
        name: row.name,
        category: row.category,
        replacement: snapshot(replacement),
        defaultReassigned,
        migrated,
      };
      this.record(id, row.project_id, STATUS_EVENTS.removed, payload);
    })();
  }

  /** Dense positions 0..n-1 in the given order. */
  private renumber(ids: ReadonlyArray<string>, now: string): void {
    const update = this.ctx.db.prepare(
      `UPDATE statuses SET position = ?, updated_at = ? WHERE id = ? AND position <> ?`,
    );
    ids.forEach((statusId, position) => update.run(position, now, statusId, position));
  }

  private find(id: string): StatusRow | undefined {
    return this.ctx.db
      .prepare<[string], StatusRow>(
        `SELECT s.* FROM statuses s JOIN projects p ON p.id = s.project_id
         WHERE s.id = ? AND p.trashed_at IS NULL`,
      )
      .get(id);
  }

  private require(id: string): StatusRow {
    const row = this.find(id);
    if (!row) throw notFound();
    return row;
  }

  private requireLiveProject(projectId: string): void {
    const live = this.ctx.db
      .prepare(`SELECT 1 FROM projects WHERE id = ? AND trashed_at IS NULL`)
      .get(projectId);
    if (!live) throw new AppError('NOT_FOUND', 'errors.projectNotFound');
  }

  private record(statusId: string, projectId: string, eventType: string, payload: object): void {
    recordEvent(this.ctx, {
      entityType: 'STATUS',
      entityId: statusId,
      projectId,
      eventType,
      payload,
    });
  }

  private mapUnique<T>(write: () => T): T {
    try {
      return write();
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT', 'errors.statusNameTaken');
      throw error;
    }
  }
}
