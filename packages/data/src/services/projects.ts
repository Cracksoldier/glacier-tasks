// Projects (spec §3.1, PROJ-01..03): key rules (D08, D30), default workflow (D32) and
// project activity events (D12), trash/restore with task cascade (D02, TRASH-02/04).

import {
  AppError,
  type CreateProjectInput,
  DEFAULT_STATUSES,
  normalizeProjectKey,
  type Project,
  PROJECT_EVENTS,
  type ProjectCreatedPayload,
  type ProjectSummary,
  type ProjectTrashTogglePayload,
  type ProjectUpdatedPayload,
  type UpdateProjectInput,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { recordEvent } from './activity.js';
import { fieldChange, isUniqueViolation, type ServiceContext } from './context.js';

interface ProjectRow {
  id: string;
  project_key: string;
  name: string;
  description: string;
  next_issue_number: number;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

interface SummaryRow extends ProjectRow {
  open_story_count: number;
  done_story_count: number;
}

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

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    key: row.project_key,
    name: row.name,
    description: row.description,
    keyLocked: row.next_issue_number > 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
  };
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

const keyTaken = () => new AppError('CONFLICT', 'errors.projectKeyTaken');
const notFound = () => new AppError('NOT_FOUND', 'errors.projectNotFound');

export class ProjectService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Live projects with story counts by status category, sorted by name. */
  list(): ProjectSummary[] {
    return this.ctx.db
      .prepare<[], SummaryRow>(
        `SELECT p.*,
           count(CASE WHEN s.category <> 'DONE' THEN 1 END) AS open_story_count,
           count(CASE WHEN s.category = 'DONE' THEN 1 END) AS done_story_count
         FROM projects p
         LEFT JOIN tasks t
           ON t.project_id = p.id AND t.type = 'STORY' AND t.trashed_at IS NULL
         LEFT JOIN statuses s ON s.project_id = t.project_id AND s.id = t.status_id
         WHERE p.trashed_at IS NULL
         GROUP BY p.id
         ORDER BY p.name COLLATE NOCASE, p.created_at`,
      )
      .all()
      .map((row) => ({
        ...toProject(row),
        openStoryCount: row.open_story_count,
        doneStoryCount: row.done_story_count,
      }));
  }

  /** A live project; trashed or unknown ids are NOT_FOUND. */
  get(id: string): Project {
    return toProject(this.requireLive(id));
  }

  isLive(id: string): boolean {
    const row = this.findRow(id);
    return row !== undefined && row.trashed_at === null;
  }

  create(input: CreateProjectInput): Project {
    const key = normalizeProjectKey(input.key);
    const name = input.name.trim();
    const description = input.description ?? '';
    const create = this.ctx.db.transaction((): string => {
      this.assertKeyAvailable(key);
      const id = this.ctx.newId();
      const now = this.ctx.now();
      this.ctx.db
        .prepare(
          `INSERT INTO projects (id, project_key, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, key, name, description, now, now);

      const insertStatus = this.ctx.db.prepare(
        `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const statuses = DEFAULT_STATUSES.map((status, position) => {
        const statusId = this.ctx.newId();
        insertStatus.run(
          statusId,
          id,
          status.name,
          status.category,
          position,
          status.isDefault ? 1 : 0,
          now,
          now,
        );
        return { id: statusId, ...status };
      });

      const payload: ProjectCreatedPayload = { key, name, description, statuses };
      recordEvent(this.ctx, {
        entityType: 'PROJECT',
        entityId: id,
        projectId: id,
        eventType: PROJECT_EVENTS.created,
        payload,
      });
      return id;
    });
    return this.get(this.mapUnique(() => create()));
  }

  update(id: string, patch: UpdateProjectInput): Project {
    const update = this.ctx.db.transaction((): void => {
      const row = this.requireLive(id);
      const changes: ProjectUpdatedPayload['changes'] = {};
      const key = fieldChange(row.project_key, patch.key && normalizeProjectKey(patch.key));
      const name = fieldChange(row.name, patch.name?.trim());
      const description = fieldChange(row.description, patch.description);
      if (key) {
        // D30: the key is part of every issued task id and is frozen once one exists.
        if (row.next_issue_number > 1) throw new AppError('CONFLICT', 'errors.projectKeyLocked');
        this.assertKeyAvailable(key.to, id);
        changes.key = key;
      }
      if (name) changes.name = name;
      if (description) changes.description = description;
      if (Object.keys(changes).length === 0) return;

      this.ctx.db
        .prepare(
          `UPDATE projects SET project_key = ?, name = ?, description = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          key?.to ?? row.project_key,
          name?.to ?? row.name,
          description?.to ?? row.description,
          this.ctx.now(),
          id,
        );
      const payload: ProjectUpdatedPayload = { name: name?.to ?? row.name, changes };
      recordEvent(this.ctx, {
        entityType: 'PROJECT',
        entityId: id,
        projectId: id,
        eventType: PROJECT_EVENTS.updated,
        payload,
      });
    });
    this.mapUnique(() => update());
    return this.get(id);
  }

  /**
   * Moves a project to the trash (D02): its live tasks follow with the project as cascade
   * root; tasks already in the trash keep their own state. The key stays reserved (D08).
   */
  trash(id: string): void {
    this.ctx.db.transaction(() => {
      const row = this.requireLive(id);
      const now = this.ctx.now();
      const { changes } = this.ctx.db
        .prepare(
          `UPDATE tasks SET trashed_at = ?, trash_cascade_root_id = ?, version = version + 1,
             updated_at = ?
           WHERE project_id = ? AND trashed_at IS NULL`,
        )
        .run(now, id, now, id);
      this.ctx.db
        .prepare(`UPDATE projects SET trashed_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, id);
      this.recordTrashToggle(row, PROJECT_EVENTS.trashed, changes);
    })();
  }

  /** Restores a project and exactly the tasks it took into the trash (D02, TRASH-04). */
  restore(id: string): Project {
    this.ctx.db.transaction(() => {
      const row = this.findRow(id);
      if (!row) throw notFound();
      if (row.trashed_at === null) throw new AppError('CONFLICT', 'errors.notTrashed');
      const now = this.ctx.now();
      const { changes } = this.ctx.db
        .prepare(
          `UPDATE tasks SET trashed_at = NULL, trash_cascade_root_id = NULL,
             version = version + 1, updated_at = ?
           WHERE trash_cascade_root_id = ?`,
        )
        .run(now, id);
      this.ctx.db
        .prepare(`UPDATE projects SET trashed_at = NULL, updated_at = ? WHERE id = ?`)
        .run(now, id);
      this.recordTrashToggle(row, PROJECT_EVENTS.restored, changes);
    })();
    return this.get(id);
  }

  /** Workflow statuses of a live project in board order. */
  statuses(projectId: string): WorkflowStatus[] {
    this.requireLive(projectId);
    return this.ctx.db
      .prepare<[string], StatusRow>(
        `SELECT * FROM statuses WHERE project_id = ? ORDER BY position, created_at`,
      )
      .all(projectId)
      .map(toStatus);
  }

  /**
   * Reserves the next issue number of a project (D30, I03): one monotonic sequence for
   * stories and subtasks, never reused. Must run inside the caller's write transaction.
   */
  allocateIssueNumber(projectId: string): number {
    if (!this.ctx.db.inTransaction) {
      throw new Error('allocateIssueNumber must run inside a transaction');
    }
    const row = this.ctx.db
      .prepare<[string], { issue_number: number }>(
        `UPDATE projects SET next_issue_number = next_issue_number + 1
         WHERE id = ? AND trashed_at IS NULL
         RETURNING next_issue_number - 1 AS issue_number`,
      )
      .get(projectId);
    if (!row) throw notFound();
    return row.issue_number;
  }

  private recordTrashToggle(row: ProjectRow, eventType: string, cascadedTaskCount: number): void {
    const payload: ProjectTrashTogglePayload = {
      key: row.project_key,
      name: row.name,
      cascadedTaskCount,
    };
    recordEvent(this.ctx, {
      entityType: 'PROJECT',
      entityId: row.id,
      projectId: row.id,
      eventType,
      payload,
    });
  }

  private findRow(id: string): ProjectRow | undefined {
    return this.ctx.db.prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE id = ?`).get(id);
  }

  private requireLive(id: string): ProjectRow {
    const row = this.findRow(id);
    if (!row || row.trashed_at !== null) throw notFound();
    return row;
  }

  /** D08: keys are unique across live and trashed projects. */
  private assertKeyAvailable(key: string, exceptId?: string): void {
    const owner = this.ctx.db
      .prepare<[string], { id: string }>(`SELECT id FROM projects WHERE project_key = ?`)
      .get(key);
    if (owner && owner.id !== exceptId) throw keyTaken();
  }

  /** Backstop for a key race: the UNIQUE constraint maps to the same CONFLICT. */
  private mapUnique<T>(write: () => T): T {
    try {
      return write();
    } catch (error) {
      if (isUniqueViolation(error)) throw keyTaken();
      throw error;
    }
  }
}
