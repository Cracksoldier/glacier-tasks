// Export-only JSON (DATA-02/03, D14, ADR 0012): structured project, task, profile and history
// metadata with attachment descriptors, never binary data. The `format` and `notice` fields
// make clear that the file is not a backup; restore never accepts it.

import {
  type ActivityEvent,
  EXPORT_FORMAT,
  EXPORT_NOTICE,
  type ExportOptionsData,
  formatIssueKey,
} from '@glacier-tasks/domain';
import { currentSchemaVersion } from '../migrate.js';
import { ActivityService } from './activity.js';
import type { ServiceContext } from './context.js';

interface ProjectRow {
  id: string;
  project_key: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  issue_number: number;
  type: string;
  parent_story_id: string | null;
  title: string;
  description_markdown: string;
  priority: string;
  status_id: string;
  assignee_user_id: string | null;
  start_date: string | null;
  due_date: string | null;
  sort_order: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

export interface WorkspaceExport {
  format: typeof EXPORT_FORMAT;
  notice: string;
  exportedAt: string;
  appVersion: string;
  schemaVersion: number;
  scope: ExportOptionsData['scope'];
  includeTrashed: boolean;
  users: unknown[];
  projects: unknown[];
}

/** Builds the export document; the caller writes it to the file the user chose. */
export function exportWorkspace(
  ctx: ServiceContext,
  options: ExportOptionsData,
  appVersion: string,
): WorkspaceExport {
  const db = ctx.db;
  const activity = new ActivityService(ctx);
  const history = (entityType: ActivityEvent['entityType'], id: string) =>
    activity
      .forEntity(entityType, id)
      .map(({ entityType: _t, entityId: _e, projectId: _p, ...event }) => event);
  const live = options.includeTrashed ? '' : 'AND trashed_at IS NULL';

  const projects = db
    .prepare<unknown[], ProjectRow>(
      `SELECT * FROM projects WHERE (? IS NULL OR id = ?) ${live} ORDER BY project_key`,
    )
    .all(
      ...(options.scope.kind === 'project'
        ? [options.scope.projectId, options.scope.projectId]
        : [null, null]),
    );

  const assigneeIds = new Set<string>();
  const exportedProjects = projects.map((project) => {
    const statuses = db
      .prepare(
        `SELECT id, name, category, position, is_default FROM statuses WHERE project_id = ? ORDER BY position`,
      )
      .all(project.id) as Array<{
      id: string;
      name: string;
      category: string;
      position: number;
      is_default: number;
    }>;
    const labels = db
      .prepare(
        `SELECT id, name, color FROM labels WHERE project_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(project.id) as Array<{ id: string; name: string; color: string | null }>;
    const statusName = new Map(statuses.map((s) => [s.id, s.name]));
    const labelName = new Map(labels.map((l) => [l.id, l.name]));
    const tasks = db
      .prepare<[string], TaskRow>(
        `SELECT * FROM tasks WHERE project_id = ? ${live}
         ORDER BY parent_story_id IS NOT NULL, sort_order, issue_number`,
      )
      .all(project.id);
    const labelIds = db.prepare<[string], { label_id: string }>(
      `SELECT label_id FROM task_labels WHERE task_id = ?`,
    );
    const attachments = db.prepare(
      `SELECT id, original_name, mime_type, byte_size, sha256, added_at, removed_at
       FROM attachments WHERE task_id = ? ORDER BY added_at`,
    );
    const toTask = (task: TaskRow) => {
      if (task.assignee_user_id) assigneeIds.add(task.assignee_user_id);
      return {
        id: task.id,
        issueKey: formatIssueKey(project.project_key, task.issue_number),
        type: task.type,
        title: task.title,
        descriptionMarkdown: task.description_markdown,
        priority: task.priority,
        status: { id: task.status_id, name: statusName.get(task.status_id) ?? '' },
        assigneeUserId: task.assignee_user_id,
        startDate: task.start_date,
        dueDate: task.due_date,
        labels: labelIds
          .all(task.id)
          .map(({ label_id }) => ({ id: label_id, name: labelName.get(label_id) ?? '' })),
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        trashedAt: task.trashed_at,
        // Descriptors only: never attachment bytes (§3.7, DATA-03).
        attachments: (attachments.all(task.id) as Array<Record<string, unknown>>).map((a) => ({
          id: a['id'],
          name: a['original_name'],
          mimeType: a['mime_type'],
          byteSize: a['byte_size'],
          sha256: a['sha256'],
          addedAt: a['added_at'],
          removedAt: a['removed_at'],
        })),
        history: history('TASK', task.id),
      };
    };
    const stories = tasks.filter((task) => task.parent_story_id === null);
    return {
      id: project.id,
      key: project.project_key,
      name: project.name,
      description: project.description,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      trashedAt: project.trashed_at,
      statuses: statuses.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        position: s.position,
        isDefault: s.is_default === 1,
      })),
      labels,
      history: [
        ...history('PROJECT', project.id),
        ...statuses.flatMap((s) => history('STATUS', s.id)),
        ...labels.flatMap((l) => history('LABEL', l.id)),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      stories: stories.map((story) => ({
        ...toTask(story),
        subtasks: tasks.filter((task) => task.parent_story_id === story.id).map(toTask),
      })),
    };
  });

  // The whole workspace exports every profile; one project only the profiles it references.
  const users = (
    db
      .prepare(
        `SELECT id, name, avatar_file_id, created_at, updated_at, archived_at FROM users ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      name: string;
      avatar_file_id: string | null;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
    }>
  )
    .filter((user) => options.scope.kind === 'workspace' || assigneeIds.has(user.id))
    .map((user) => ({
      id: user.id,
      name: user.name,
      hasAvatar: user.avatar_file_id !== null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      archivedAt: user.archived_at,
      history: options.scope.kind === 'workspace' ? history('USER', user.id) : [],
    }));

  return {
    format: EXPORT_FORMAT,
    notice: EXPORT_NOTICE,
    exportedAt: ctx.now(),
    appVersion,
    schemaVersion: currentSchemaVersion(db),
    scope: options.scope,
    includeTrashed: options.includeTrashed,
    users,
    projects: exportedProjects,
  };
}
