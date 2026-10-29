// Stories and subtasks (spec §3.3, TASK-01..10): issue numbers (D30), reference checks
// within one project (TASK-07), optimistic concurrency (D05), trash with cascade tracking
// (D02, D19), subtask moves (D04) and task history (D11, D27). All writes run in one
// transaction together with their activity events.

import {
  AppError,
  type CreateTaskData,
  formatIssueKey,
  isDateRangeValid,
  type LabelSnapshot,
  type PagedResult,
  type RefSnapshot,
  sortKeyBetween,
  type StatusSnapshot,
  type SubtaskEventPayload,
  TASK_EVENTS,
  type TaskChanges,
  type TaskCreatedPayload,
  type TaskDetail,
  type TaskMovedToStoryPayload,
  type TaskQueryData,
  type TaskRef,
  type TaskSummary,
  type TaskTrashTogglePayload,
  type TaskUpdatedPayload,
  type UpdateTaskData,
  USER_EVENTS,
  type UserBulkUnassignedPayload,
} from '@glacier-tasks/domain';
import { recordEvent } from './activity.js';
import type { ServiceContext } from './context.js';
import type { ProjectService } from './projects.js';

interface TaskRow {
  id: string;
  project_id: string;
  project_key: string;
  project_trashed_at: string | null;
  issue_number: number;
  type: 'STORY' | 'SUBTASK';
  parent_story_id: string | null;
  title: string;
  description_markdown: string;
  priority: TaskSummary['priority'];
  status_id: string;
  assignee_user_id: string | null;
  assignee_archived: number;
  start_date: string | null;
  due_date: string | null;
  sort_order: string;
  version: number;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  trash_cascade_root_id: string | null;
  label_ids: string | null;
  subtask_total: number;
  subtask_done: number;
}

const SELECT_TASK = `
  SELECT t.*,
    p.project_key,
    p.trashed_at AS project_trashed_at,
    coalesce(u.archived_at IS NOT NULL, 0) AS assignee_archived,
    (SELECT group_concat(label_id) FROM task_labels tl WHERE tl.task_id = t.id) AS label_ids,
    (SELECT count(*) FROM tasks c
      WHERE c.parent_story_id = t.id AND c.trashed_at IS NULL) AS subtask_total,
    (SELECT count(*) FROM tasks c
      JOIN statuses cs ON cs.project_id = c.project_id AND cs.id = c.status_id
      WHERE c.parent_story_id = t.id AND c.trashed_at IS NULL AND cs.category = 'DONE')
      AS subtask_done
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_user_id`;

function issueKey(row: TaskRow): string {
  return formatIssueKey(row.project_key, row.issue_number);
}

function toRef(row: TaskRow): TaskRef {
  return { id: row.id, issueKey: issueKey(row), title: row.title };
}

function toSummary(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    issueNumber: row.issue_number,
    issueKey: issueKey(row),
    type: row.type,
    parentStoryId: row.parent_story_id,
    title: row.title,
    priority: row.priority,
    statusId: row.status_id,
    assigneeUserId: row.assignee_user_id,
    assigneeArchived: row.assignee_archived === 1,
    startDate: row.start_date,
    dueDate: row.due_date,
    labelIds: row.label_ids ? row.label_ids.split(',').sort() : [],
    sortOrder: row.sort_order,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    subtaskProgress:
      row.type === 'STORY' ? { done: row.subtask_done, total: row.subtask_total } : null,
  };
}

const taskNotFound = () => new AppError('NOT_FOUND', 'errors.taskNotFound');
const invalidReference = () => new AppError('VALIDATION', 'errors.crossProjectReference');

export class TaskService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
  ) {}

  // --- Reads -----------------------------------------------------------------

  /** A live task with its live subtasks; trashed tasks and projects are NOT_FOUND. */
  get(id: string): TaskDetail {
    const row = this.requireLive(id);
    const subtasks =
      row.type === 'STORY'
        ? this.ctx.db
            .prepare<[string], TaskRow>(
              `${SELECT_TASK} WHERE t.parent_story_id = ? AND t.trashed_at IS NULL
               ORDER BY t.sort_order`,
            )
            .all(id)
            .map(toSummary)
        : [];
    return {
      ...toSummary(row),
      descriptionMarkdown: row.description_markdown,
      subtasks,
      attachments: [],
    };
  }

  /**
   * M3 subset of the task query (filters and full-text search follow in M5): live tasks of
   * one project, optionally by type and status, in board order or by issue number.
   */
  query(input: TaskQueryData): PagedResult<TaskSummary> {
    // Refuse what M5 adds instead of silently returning unfiltered or unsorted results.
    if (
      input.projectId === null ||
      input.text !== '' ||
      input.priorities.length > 0 ||
      input.assigneeUserIds.length > 0 ||
      input.labelIds.length > 0 ||
      input.dueFrom !== null ||
      input.dueTo !== null ||
      (input.sortBy !== 'sortOrder' && input.sortBy !== 'issueKey')
    ) {
      throw new AppError('VALIDATION', 'errors.notAvailable');
    }
    this.requireLiveProject(input.projectId);
    const where = ['t.project_id = ?', 't.trashed_at IS NULL'];
    const params: unknown[] = [input.projectId];
    if (input.types.length > 0) {
      where.push(`t.type IN (${input.types.map(() => '?').join(', ')})`);
      params.push(...input.types);
    }
    if (input.statusIds.length > 0) {
      where.push(`t.status_id IN (${input.statusIds.map(() => '?').join(', ')})`);
      params.push(...input.statusIds);
    }
    const direction = input.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const order =
      input.sortBy === 'issueKey'
        ? `t.issue_number ${direction}`
        : `s.position ${direction}, t.sort_order ${direction}, t.issue_number ${direction}`;
    const filter = where.join(' AND ');
    const { total } = this.ctx.db
      .prepare(`SELECT count(*) AS total FROM tasks t WHERE ${filter}`)
      .get(...params) as { total: number };
    const items = this.ctx.db
      .prepare<unknown[], TaskRow>(
        `${SELECT_TASK}
         JOIN statuses s ON s.project_id = t.project_id AND s.id = t.status_id
         WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, input.page.limit, input.page.offset)
      .map(toSummary);
    return { items, total, offset: input.page.offset, limit: input.page.limit };
  }

  // --- Writes ----------------------------------------------------------------

  create(input: CreateTaskData): TaskDetail {
    const id = this.ctx.newId();
    this.ctx.db.transaction(() => {
      const projectId = input.projectId;
      this.requireLiveProject(projectId);
      const parent = input.parentStoryId
        ? this.requireParentStory(projectId, input.parentStoryId)
        : null;
      const statusId = input.statusId ?? this.defaultStatusId(projectId);
      const status = this.statusSnapshot(projectId, statusId);
      const labels = this.labelSnapshots(projectId, input.labelIds);
      const assignee = this.assignableUser(input.assigneeUserId, null);
      if (!isDateRangeValid(input.startDate, input.dueDate)) throw invalidDateRange();

      const issueNumber = this.projects.allocateIssueNumber(projectId);
      const sortOrder = parent
        ? sortKeyBetween(this.lastSubtaskKey(parent.id), null)
        : sortKeyBetween(this.lastStoryKeyInStatus(projectId, statusId), null);
      const now = this.ctx.now();
      this.ctx.db
        .prepare(
          `INSERT INTO tasks (id, project_id, issue_number, type, parent_story_id, title,
             description_markdown, priority, status_id, assignee_user_id, start_date, due_date,
             sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          projectId,
          issueNumber,
          input.type,
          parent?.id ?? null,
          input.title,
          input.descriptionMarkdown,
          input.priority,
          statusId,
          assignee?.id ?? null,
          input.startDate,
          input.dueDate,
          sortOrder,
          now,
          now,
        );
      this.linkLabels(
        projectId,
        id,
        labels.map((label) => label.id),
      );

      const row = this.requireRow(id);
      const payload: TaskCreatedPayload = {
        issueKey: issueKey(row),
        type: input.type,
        title: input.title,
        descriptionMarkdown: input.descriptionMarkdown,
        priority: input.priority,
        status,
        assignee,
        startDate: input.startDate,
        dueDate: input.dueDate,
        labels,
        parent: parent ? toRef(parent) : null,
      };
      this.record(row, TASK_EVENTS.created, payload);
      if (parent) this.recordOnParent(parent, TASK_EVENTS.subtaskCreated, { subtask: toRef(row) });
    })();
    return this.get(id);
  }

  update(id: string, expectedVersion: number, patch: UpdateTaskData): TaskDetail {
    this.ctx.db.transaction(() => {
      const row = this.requireLive(id);
      assertVersion(row, expectedVersion);
      const changes: Partial<TaskChanges> = {};

      if (patch.title !== undefined && patch.title !== row.title) {
        changes.title = { from: row.title, to: patch.title };
      }
      if (
        patch.descriptionMarkdown !== undefined &&
        patch.descriptionMarkdown !== row.description_markdown
      ) {
        changes.descriptionMarkdown = { to: patch.descriptionMarkdown };
      }
      if (patch.priority !== undefined && patch.priority !== row.priority) {
        changes.priority = { from: row.priority, to: patch.priority };
      }
      if (patch.statusId !== undefined && patch.statusId !== row.status_id) {
        changes.status = {
          from: this.statusSnapshot(row.project_id, row.status_id),
          to: this.statusSnapshot(row.project_id, patch.statusId),
        };
      }
      if (patch.assigneeUserId !== undefined && patch.assigneeUserId !== row.assignee_user_id) {
        changes.assignee = {
          from: this.userSnapshot(row.assignee_user_id),
          to: this.assignableUser(patch.assigneeUserId, row.assignee_user_id),
        };
      }
      const startDate = patch.startDate === undefined ? row.start_date : patch.startDate;
      const dueDate = patch.dueDate === undefined ? row.due_date : patch.dueDate;
      if (!isDateRangeValid(startDate, dueDate)) throw invalidDateRange();
      if (startDate !== row.start_date) changes.startDate = { from: row.start_date, to: startDate };
      if (dueDate !== row.due_date) changes.dueDate = { from: row.due_date, to: dueDate };

      const currentLabels = row.label_ids ? row.label_ids.split(',') : [];
      if (patch.labelIds !== undefined) {
        const next = [...new Set(patch.labelIds)];
        const added = next.filter((labelId) => !currentLabels.includes(labelId));
        const removed = currentLabels.filter((labelId) => !next.includes(labelId));
        if (added.length > 0 || removed.length > 0) {
          changes.labels = {
            added: this.labelSnapshots(row.project_id, added),
            removed: this.labelSnapshots(row.project_id, removed),
          };
        }
      }
      if (Object.keys(changes).length === 0) return;

      // D26: a story that changes column goes to the top of the new column.
      const sortOrder =
        changes.status && row.type === 'STORY'
          ? sortKeyBetween(
              null,
              this.firstStoryKeyInStatus(row.project_id, changes.status.to.id, id),
            )
          : row.sort_order;
      const result = this.ctx.db
        .prepare(
          `UPDATE tasks SET title = ?, description_markdown = ?, priority = ?, status_id = ?,
             assignee_user_id = ?, start_date = ?, due_date = ?, sort_order = ?,
             version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          changes.title?.to ?? row.title,
          changes.descriptionMarkdown?.to ?? row.description_markdown,
          changes.priority?.to ?? row.priority,
          changes.status?.to.id ?? row.status_id,
          changes.assignee ? (changes.assignee.to?.id ?? null) : row.assignee_user_id,
          startDate,
          dueDate,
          sortOrder,
          this.ctx.now(),
          id,
          expectedVersion,
        );
      if (result.changes !== 1) throw stale();
      if (changes.labels) {
        const unlink = this.ctx.db.prepare(
          `DELETE FROM task_labels WHERE task_id = ? AND label_id = ?`,
        );
        for (const label of changes.labels.removed) unlink.run(id, label.id);
        this.linkLabels(
          row.project_id,
          id,
          changes.labels.added.map((label) => label.id),
        );
      }
      const payload: TaskUpdatedPayload = {
        issueKey: issueKey(row),
        title: changes.title?.to ?? row.title,
        changes,
      };
      this.record(row, TASK_EVENTS.updated, payload);
    })();
    return this.get(id);
  }

  /**
   * Board move of a story (BOARD-04/05): to another column it goes to the top (D26); within
   * its column it takes the given sort key. Only a column change is recorded in history.
   */
  move(id: string, expectedVersion: number, statusId: string, sortOrder?: string): void {
    this.ctx.db.transaction(() => {
      const row = this.requireLive(id);
      if (row.type !== 'STORY') throw new AppError('VALIDATION', 'errors.moveStoriesOnly');
      assertVersion(row, expectedVersion);
      const to = this.statusSnapshot(row.project_id, statusId);
      const columnChanged = statusId !== row.status_id;
      const key =
        columnChanged || sortOrder === undefined
          ? sortKeyBetween(null, this.firstStoryKeyInStatus(row.project_id, statusId, id))
          : sortOrder;
      const result = this.ctx.db
        .prepare(
          `UPDATE tasks SET status_id = ?, sort_order = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(statusId, key, this.ctx.now(), id, expectedVersion);
      if (result.changes !== 1) throw stale();
      if (columnChanged) {
        const payload: TaskUpdatedPayload = {
          issueKey: issueKey(row),
          title: row.title,
          changes: { status: { from: this.statusSnapshot(row.project_id, row.status_id), to } },
        };
        this.record(row, TASK_EVENTS.updated, payload);
      }
    })();
  }

  /** D04: a subtask moves to another live story of the same project; its key stays. */
  moveToStory(subtaskId: string, expectedVersion: number, targetStoryId: string): void {
    this.ctx.db.transaction(() => {
      const row = this.requireLive(subtaskId);
      assertVersion(row, expectedVersion);
      if (row.type !== 'SUBTASK' || row.parent_story_id === null) {
        throw new AppError('VALIDATION', 'errors.invalidParent');
      }
      if (row.parent_story_id === targetStoryId) return;
      const from = this.requireRow(row.parent_story_id);
      const to = this.requireParentStory(row.project_id, targetStoryId);
      this.ctx.db
        .prepare(
          `UPDATE tasks SET parent_story_id = ?, sort_order = ?, version = version + 1,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(to.id, sortKeyBetween(this.lastSubtaskKey(to.id), null), this.ctx.now(), subtaskId);

      const payload: TaskMovedToStoryPayload = {
        issueKey: issueKey(row),
        title: row.title,
        from: toRef(from),
        to: toRef(to),
      };
      this.record(row, TASK_EVENTS.movedToStory, payload);
      this.recordOnParent(from, TASK_EVENTS.subtaskMovedOut, {
        subtask: toRef(row),
        otherStory: toRef(to),
      });
      this.recordOnParent(to, TASK_EVENTS.subtaskMovedIn, {
        subtask: toRef(row),
        otherStory: toRef(from),
      });
    })();
  }

  /**
   * Moves a task to the trash (D02). A story takes its live subtasks along and marks them
   * with itself as cascade root; subtasks already in the trash keep their own state.
   */
  trash(id: string): void {
    this.ctx.db.transaction(() => {
      const row = this.requireRow(id);
      if (row.project_trashed_at !== null) throw taskNotFound();
      if (row.trashed_at !== null) throw new AppError('CONFLICT', 'errors.alreadyTrashed');
      const now = this.ctx.now();
      const cascaded =
        row.type === 'STORY'
          ? this.ctx.db
              .prepare<[string], TaskRow>(
                `${SELECT_TASK} WHERE t.parent_story_id = ? AND t.trashed_at IS NULL
                 ORDER BY t.sort_order`,
              )
              .all(id)
          : [];
      this.ctx.db
        .prepare(
          `UPDATE tasks SET trashed_at = ?, trash_cascade_root_id = ?, version = version + 1,
             updated_at = ?
           WHERE parent_story_id = ? AND trashed_at IS NULL`,
        )
        .run(now, id, now, id);
      this.ctx.db
        .prepare(
          `UPDATE tasks SET trashed_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, id);

      const payload: TaskTrashTogglePayload = {
        issueKey: issueKey(row),
        title: row.title,
        cascaded: cascaded.map(toRef),
      };
      this.record(row, TASK_EVENTS.trashed, payload);
      if (row.parent_story_id) {
        this.recordOnParent(this.requireRow(row.parent_story_id), TASK_EVENTS.subtaskTrashed, {
          subtask: toRef(row),
        });
      }
    })();
  }

  /**
   * Restores a directly trashed task (D02, TRASH-04/06). A story brings back exactly the
   * subtasks it took along; a subtask needs a live parent.
   */
  restore(id: string): void {
    this.ctx.db.transaction(() => {
      const row = this.requireRow(id);
      if (row.trashed_at === null) throw new AppError('CONFLICT', 'errors.notTrashed');
      if (row.project_trashed_at !== null) throw new AppError('CONFLICT', 'errors.projectTrashed');
      if (row.trash_cascade_root_id !== null) {
        throw new AppError('CONFLICT', 'errors.restoreParentFirst');
      }
      const parent = row.parent_story_id ? this.requireRow(row.parent_story_id) : null;
      if (parent && parent.trashed_at !== null) {
        throw new AppError('CONFLICT', 'errors.restoreParentFirst');
      }

      const now = this.ctx.now();
      const cascaded = this.ctx.db
        .prepare<[string], TaskRow>(
          `${SELECT_TASK} WHERE t.trash_cascade_root_id = ? ORDER BY t.sort_order`,
        )
        .all(id);
      this.ctx.db
        .prepare(
          `UPDATE tasks SET trashed_at = NULL, trash_cascade_root_id = NULL,
             version = version + 1, updated_at = ?
           WHERE id = ? OR trash_cascade_root_id = ?`,
        )
        .run(now, id, id);

      const payload: TaskTrashTogglePayload = {
        issueKey: issueKey(row),
        title: row.title,
        cascaded: cascaded.map(toRef),
      };
      this.record(row, TASK_EVENTS.restored, payload);
      if (parent) this.recordOnParent(parent, TASK_EVENTS.subtaskRestored, { subtask: toRef(row) });
    })();
  }

  /** USER-05: clears the profile as assignee on all live and trashed tasks. */
  unassignAll(userId: string): { unassigned: number } {
    return this.ctx.db.transaction(() => {
      const user = this.userSnapshot(userId);
      if (!user) throw new AppError('NOT_FOUND', 'errors.userNotFound');
      const rows = this.ctx.db
        .prepare<[string], TaskRow>(`${SELECT_TASK} WHERE t.assignee_user_id = ?`)
        .all(userId);
      const now = this.ctx.now();
      const clear = this.ctx.db.prepare(
        `UPDATE tasks SET assignee_user_id = NULL, version = version + 1, updated_at = ?
         WHERE id = ?`,
      );
      for (const row of rows) {
        clear.run(now, row.id);
        const payload: TaskUpdatedPayload = {
          issueKey: issueKey(row),
          title: row.title,
          changes: { assignee: { from: user, to: null } },
          cause: USER_EVENTS.bulkUnassigned,
        };
        this.record(row, TASK_EVENTS.updated, payload);
      }
      const payload: UserBulkUnassignedPayload = { name: user.name, count: rows.length };
      recordEvent(this.ctx, {
        entityType: 'USER',
        entityId: userId,
        projectId: null,
        eventType: USER_EVENTS.bulkUnassigned,
        payload,
      });
      return { unassigned: rows.length };
    })();
  }

  // --- Lookups and checks ------------------------------------------------------

  private findRow(id: string): TaskRow | undefined {
    return this.ctx.db.prepare<[string], TaskRow>(`${SELECT_TASK} WHERE t.id = ?`).get(id);
  }

  private requireRow(id: string): TaskRow {
    const row = this.findRow(id);
    if (!row) throw taskNotFound();
    return row;
  }

  private requireLive(id: string): TaskRow {
    const row = this.findRow(id);
    if (!row || row.trashed_at !== null || row.project_trashed_at !== null) throw taskNotFound();
    return row;
  }

  private requireLiveProject(projectId: string): void {
    if (!this.projects.isLive(projectId)) {
      throw new AppError('NOT_FOUND', 'errors.projectNotFound');
    }
  }

  /** TASK-07: the parent must be a live story of the same project; no nesting. */
  private requireParentStory(projectId: string, parentId: string): TaskRow {
    const parent = this.findRow(parentId);
    if (!parent) throw new AppError('VALIDATION', 'errors.invalidParent');
    if (parent.project_id !== projectId) throw invalidReference();
    if (parent.type !== 'STORY' || parent.trashed_at !== null) {
      throw new AppError('VALIDATION', 'errors.invalidParent');
    }
    return parent;
  }

  private defaultStatusId(projectId: string): string {
    const row = this.ctx.db
      .prepare<[string], { id: string }>(
        `SELECT id FROM statuses WHERE project_id = ? AND is_default = 1`,
      )
      .get(projectId);
    if (!row) throw new Error(`Project ${projectId} has no default status`);
    return row.id;
  }

  private statusSnapshot(projectId: string, statusId: string): StatusSnapshot {
    const row = this.ctx.db
      .prepare<[string, string], StatusSnapshot>(
        `SELECT id, name, category FROM statuses WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, statusId);
    if (!row) throw invalidReference();
    return { id: row.id, name: row.name, category: row.category };
  }

  private labelSnapshots(projectId: string, labelIds: ReadonlyArray<string>): LabelSnapshot[] {
    const unique = [...new Set(labelIds)];
    if (unique.length === 0) return [];
    const rows = this.ctx.db
      .prepare<string[], LabelSnapshot>(
        `SELECT id, name, color FROM labels
         WHERE project_id = ? AND id IN (${unique.map(() => '?').join(', ')})
         ORDER BY name COLLATE NOCASE`,
      )
      .all(projectId, ...unique);
    if (rows.length !== unique.length) throw invalidReference();
    return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }));
  }

  private userSnapshot(userId: string | null): RefSnapshot | null {
    if (userId === null) return null;
    const row = this.ctx.db
      .prepare<[string], RefSnapshot>(`SELECT id, name FROM users WHERE id = ?`)
      .get(userId);
    return row ? { id: row.id, name: row.name } : null;
  }

  /** I09: archived profiles cannot be newly assigned; keeping the current one is fine. */
  private assignableUser(userId: string | null, currentUserId: string | null): RefSnapshot | null {
    if (userId === null) return null;
    const row = this.ctx.db
      .prepare<[string], RefSnapshot & { archived_at: string | null }>(
        `SELECT id, name, archived_at FROM users WHERE id = ?`,
      )
      .get(userId);
    if (!row) throw new AppError('NOT_FOUND', 'errors.userNotFound');
    if (row.archived_at !== null && userId !== currentUserId) {
      throw new AppError('VALIDATION', 'errors.assigneeArchived');
    }
    return { id: row.id, name: row.name };
  }

  private linkLabels(projectId: string, taskId: string, labelIds: ReadonlyArray<string>): void {
    const link = this.ctx.db.prepare(
      `INSERT INTO task_labels (task_id, label_id, project_id) VALUES (?, ?, ?)`,
    );
    for (const labelId of labelIds) link.run(taskId, labelId, projectId);
  }

  // Sort keys consider trashed rows too, so a restored task never ties with a newer one.
  private lastStoryKeyInStatus(projectId: string, statusId: string): string | null {
    return this.scalarKey(
      `SELECT max(sort_order) AS key FROM tasks
       WHERE project_id = ? AND status_id = ? AND type = 'STORY'`,
      projectId,
      statusId,
    );
  }

  private firstStoryKeyInStatus(projectId: string, statusId: string, exceptId: string) {
    return this.scalarKey(
      `SELECT min(sort_order) AS key FROM tasks
       WHERE project_id = ? AND status_id = ? AND type = 'STORY' AND id <> ?`,
      projectId,
      statusId,
      exceptId,
    );
  }

  private lastSubtaskKey(storyId: string): string | null {
    return this.scalarKey(
      `SELECT max(sort_order) AS key FROM tasks WHERE parent_story_id = ?`,
      storyId,
    );
  }

  private scalarKey(sql: string, ...params: string[]): string | null {
    const row = this.ctx.db.prepare(sql).get(...params) as { key: string | null };
    return row.key;
  }

  private record(row: TaskRow, eventType: string, payload: object): void {
    recordEvent(this.ctx, {
      entityType: 'TASK',
      entityId: row.id,
      projectId: row.project_id,
      eventType,
      payload,
    });
  }

  /** D27: subtask lifecycle events also appear in the parent story's history. */
  private recordOnParent(parent: TaskRow, eventType: string, payload: SubtaskEventPayload): void {
    this.record(parent, eventType, payload);
  }
}

function assertVersion(row: TaskRow, expectedVersion: number): void {
  if (row.version !== expectedVersion) throw stale();
}

function stale(): AppError {
  return new AppError('CONFLICT', 'errors.staleTask');
}

function invalidDateRange(): AppError {
  return new AppError('VALIDATION', 'errors.invalidDateRange');
}
