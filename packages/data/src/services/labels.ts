// Project labels (spec §3.5, D25): palette colors, case-insensitively unique names,
// label events (D12). Removing a label unlinks it from its tasks and records that on each
// task's history; the tasks' versions change so open editors notice (D05).

import {
  AppError,
  formatIssueKey,
  type Label,
  type LabelColor,
  type LabelCreatedPayload,
  type LabelData,
  LABEL_EVENTS,
  type LabelPatchData,
  type LabelRemovedPayload,
  type LabelUpdatedPayload,
  TASK_EVENTS,
  type TaskRef,
  type TaskUpdatedPayload,
} from '@glacier-tasks/domain';
import { recordEvent } from './activity.js';
import { fieldChange, isUniqueViolation, type ServiceContext } from './context.js';

interface LabelRow {
  id: string;
  project_id: string;
  name: string;
  color: LabelColor | null;
  task_count: number;
}

const SELECT_LABEL = `SELECT l.*, (SELECT count(*) FROM task_labels tl WHERE tl.label_id = l.id) AS task_count
  FROM labels l`;

function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    taskCount: row.task_count,
  };
}

const nameTaken = () => new AppError('CONFLICT', 'errors.labelNameTaken');

export class LabelService {
  constructor(private readonly ctx: ServiceContext) {}

  list(projectId: string): Label[] {
    this.requireLiveProject(projectId);
    return this.ctx.db
      .prepare<[string], LabelRow>(
        `${SELECT_LABEL} WHERE l.project_id = ? ORDER BY l.name COLLATE NOCASE`,
      )
      .all(projectId)
      .map(toLabel);
  }

  create(projectId: string, input: LabelData): Label {
    const id = this.ctx.newId();
    this.mapUnique(() =>
      this.ctx.db.transaction(() => {
        this.requireLiveProject(projectId);
        this.ctx.db
          .prepare(`INSERT INTO labels (id, project_id, name, color) VALUES (?, ?, ?, ?)`)
          .run(id, projectId, input.name, input.color);
        const payload: LabelCreatedPayload = { name: input.name, color: input.color };
        this.record(id, projectId, LABEL_EVENTS.created, payload);
      })(),
    );
    return this.get(id);
  }

  update(id: string, patch: LabelPatchData): Label {
    this.mapUnique(() =>
      this.ctx.db.transaction(() => {
        const row = this.require(id);
        const changes: LabelUpdatedPayload['changes'] = {};
        const name = fieldChange(row.name, patch.name);
        const color = fieldChange(row.color, patch.color);
        if (name) changes.name = name;
        if (color) changes.color = color;
        if (!name && !color) return;
        this.ctx.db
          .prepare(`UPDATE labels SET name = ?, color = ? WHERE id = ?`)
          .run(name?.to ?? row.name, color ? color.to : row.color, id);
        const payload: LabelUpdatedPayload = { name: name?.to ?? row.name, changes };
        this.record(id, row.project_id, LABEL_EVENTS.updated, payload);
      })(),
    );
    return this.get(id);
  }

  remove(id: string): void {
    this.ctx.db.transaction(() => {
      const row = this.require(id);
      const affected = this.ctx.db
        .prepare<[string], TaskRef & { project_key: string; issue_number: number }>(
          `SELECT t.id, t.title, t.issue_number, p.project_key
           FROM task_labels tl
           JOIN tasks t ON t.id = tl.task_id
           JOIN projects p ON p.id = t.project_id
           WHERE tl.label_id = ?
           ORDER BY t.issue_number`,
        )
        .all(id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          issueKey: formatIssueKey(task.project_key, task.issue_number),
        }));

      this.ctx.db.prepare(`DELETE FROM labels WHERE id = ?`).run(id); // cascades task_labels
      const now = this.ctx.now();
      const bump = this.ctx.db.prepare(
        `UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?`,
      );
      const snapshot = { id, name: row.name, color: row.color };
      for (const task of affected) {
        bump.run(now, task.id);
        const payload: TaskUpdatedPayload = {
          issueKey: task.issueKey,
          title: task.title,
          changes: { labels: { added: [], removed: [snapshot] } },
          cause: LABEL_EVENTS.removed,
        };
        recordEvent(this.ctx, {
          entityType: 'TASK',
          entityId: task.id,
          projectId: row.project_id,
          eventType: TASK_EVENTS.updated,
          payload,
        });
      }
      const payload: LabelRemovedPayload = {
        name: row.name,
        color: row.color,
        affectedTasks: affected,
      };
      this.record(id, row.project_id, LABEL_EVENTS.removed, payload);
    })();
  }

  private get(id: string): Label {
    return toLabel(this.require(id));
  }

  private require(id: string): LabelRow {
    const row = this.ctx.db
      .prepare<[string], LabelRow>(
        `${SELECT_LABEL} JOIN projects p ON p.id = l.project_id
         WHERE l.id = ? AND p.trashed_at IS NULL`,
      )
      .get(id);
    if (!row) throw new AppError('NOT_FOUND', 'errors.labelNotFound');
    return row;
  }

  private requireLiveProject(projectId: string): void {
    const live = this.ctx.db
      .prepare<[string], { id: string }>(
        `SELECT id FROM projects WHERE id = ? AND trashed_at IS NULL`,
      )
      .get(projectId);
    if (!live) throw new AppError('NOT_FOUND', 'errors.projectNotFound');
  }

  private record(labelId: string, projectId: string, eventType: string, payload: object): void {
    recordEvent(this.ctx, {
      entityType: 'LABEL',
      entityId: labelId,
      projectId,
      eventType,
      payload,
    });
  }

  private mapUnique<T>(write: () => T): T {
    try {
      return write();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }
}
