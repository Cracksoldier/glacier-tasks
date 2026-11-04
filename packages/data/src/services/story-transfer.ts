// Story export/import (DATA-11, D58, ADR 0014). Export writes one live story with its live
// subtasks; import recreates them in a project through TaskService/LabelService, so issue
// numbers, sort keys and history follow the usual rules. The whole import is one transaction.

import {
  AppError,
  ATTACHMENT_REF_PATTERN,
  STORY_EXPORT_FORMAT,
  STORY_EXPORT_FORMAT_VERSION,
  type StatusCategory,
  type StoryImportData,
  type StoryImportPreview,
  type StoryTransfer,
  type StoryTransferTask,
  type TaskDetail,
} from '@glacier-tasks/domain';
import type { ServiceContext } from './context.js';
import type { LabelService } from './labels.js';
import type { ProjectService } from './projects.js';
import type { TaskService } from './tasks.js';

interface StatusRow {
  id: string;
  name: string;
  category: StatusCategory;
  is_default: number;
}

/** What the preview reports besides the pending-file token and name. */
export type StoryImportPlan = Omit<StoryImportPreview, 'token' | 'fileName'>;

const lower = (name: string) => name.toLocaleLowerCase();

export class StoryTransferService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly projects: ProjectService,
    private readonly tasks: TaskService,
    private readonly labels: LabelService,
  ) {}

  /** A live story with its live subtasks in their order; subtasks can't be exported alone. */
  export(storyId: string, appVersion: string): StoryTransfer {
    const story = this.tasks.get(storyId);
    if (story.type !== 'STORY') throw new AppError('VALIDATION', 'errors.exportStoriesOnly');
    const project = this.projects.get(story.projectId);
    const subtasks = story.subtasks.map((subtask) => this.tasks.get(subtask.id));
    const all = [story, ...subtasks];

    const statuses = new Map(this.statuses(project.id).map((s) => [s.id, s]));
    const labels = new Map(
      this.labels
        .list(project.id)
        .map((label) => [label.id, { name: label.name, color: label.color }]),
    );
    const userName = this.ctx.db.prepare<[string], { name: string }>(
      `SELECT name FROM users WHERE id = ?`,
    );
    const usedStatusIds = [...new Set(all.map((task) => task.statusId))];
    const usedLabelIds = [...new Set(all.flatMap((task) => task.labelIds))];
    const assigneeIds = [
      ...new Set(all.flatMap((task) => (task.assigneeUserId ? [task.assigneeUserId] : []))),
    ];

    const toTask = (task: TaskDetail): StoryTransferTask => ({
      issueKey: task.issueKey,
      title: task.title,
      descriptionMarkdown: task.descriptionMarkdown,
      priority: task.priority,
      statusId: task.statusId,
      assigneeId: task.assigneeUserId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      labels: task.labelIds.flatMap((id) => {
        const label = labels.get(id);
        return label ? [label.name] : [];
      }),
    });

    return {
      format: STORY_EXPORT_FORMAT,
      formatVersion: STORY_EXPORT_FORMAT_VERSION,
      exportedAt: this.ctx.now(),
      appVersion,
      source: { projectKey: project.key, projectName: project.name },
      statuses: usedStatusIds.flatMap((id) => {
        const status = statuses.get(id);
        return status ? [{ id, name: status.name, category: status.category }] : [];
      }),
      labels: usedLabelIds.flatMap((id) => {
        const label = labels.get(id);
        return label ? [label] : [];
      }),
      assignees: assigneeIds.map((id) => ({ id, name: userName.get(id)?.name ?? '?' })),
      story: { ...toTask(story), subtasks: subtasks.map(toTask) },
    };
  }

  /**
   * Suggestions for importing `doc` into a project (D58): statuses by name (ignoring case),
   * then by category, then the default; the story's assignee if it can be assigned here.
   */
  preview(projectId: string, doc: StoryTransfer): StoryImportPlan {
    this.requireLiveProject(projectId);
    const targets = this.statuses(projectId);
    const tasks = allTasks(doc);
    const statuses = usedStatuses(doc).map((source) => {
      const byName = targets.find((t) => lower(t.name) === lower(source.name));
      const suggested =
        byName ??
        targets.find((t) => t.category === source.category) ??
        (targets.find((t) => t.is_default === 1) as StatusRow);
      return {
        sourceId: source.id,
        name: source.name,
        category: source.category,
        taskCount: tasks.filter((task) => task.statusId === source.id).length,
        matchedByName: byName !== undefined,
        suggestedStatusId: suggested.id,
      };
    });

    const existing = new Set(this.labels.list(projectId).map((label) => lower(label.name)));
    const used = usedLabels(doc);
    const original = doc.story.assigneeId
      ? doc.assignees.find((a) => a.id === doc.story.assigneeId)
      : undefined;
    const assignable = original
      ? this.ctx.db
          .prepare<[string], { id: string }>(
            `SELECT id FROM users WHERE id = ? AND archived_at IS NULL`,
          )
          .get(original.id)
      : undefined;

    return {
      source: doc.source,
      story: { issueKey: doc.story.issueKey, title: doc.story.title },
      subtaskCount: doc.story.subtasks.length,
      statuses,
      needsMapping: statuses.some((s) => !s.matchedByName),
      assignee: original ? { name: original.name, suggestedUserId: assignable?.id ?? null } : null,
      labels: {
        reused: used.filter((l) => existing.has(lower(l.name))).map((l) => l.name),
        created: used.filter((l) => !existing.has(lower(l.name))).map((l) => l.name),
      },
      hasAttachmentRefs: tasks.some((task) =>
        ATTACHMENT_REF_PATTERN.test(task.descriptionMarkdown),
      ),
    };
  }

  /** Creates the story, its subtasks and missing labels in one transaction (D58, D12). */
  import(doc: StoryTransfer, input: StoryImportData): TaskDetail {
    const { projectId } = input;
    const storyId = this.ctx.db.transaction(() => {
      this.requireLiveProject(projectId);
      const targets = new Set(this.statuses(projectId).map((s) => s.id));
      const statusFor = new Map<string, string>();
      for (const source of usedStatuses(doc)) {
        const target = Object.hasOwn(input.statusMap, source.id)
          ? input.statusMap[source.id]
          : undefined;
        if (target === undefined) throw new AppError('VALIDATION', 'errors.importStatusUnmapped');
        if (!targets.has(target)) throw new AppError('VALIDATION', 'errors.crossProjectReference');
        statusFor.set(source.id, target);
      }

      const labelIds = new Map(this.labels.list(projectId).map((l) => [lower(l.name), l.id]));
      for (const label of usedLabels(doc)) {
        if (!labelIds.has(lower(label.name))) {
          labelIds.set(lower(label.name), this.labels.create(projectId, label).id);
        }
      }

      const create = (task: StoryTransferTask, parentStoryId: string | null) =>
        this.tasks.create(
          {
            projectId,
            type: parentStoryId ? 'SUBTASK' : 'STORY',
            parentStoryId,
            title: task.title,
            descriptionMarkdown: task.descriptionMarkdown,
            priority: task.priority,
            statusId: statusFor.get(task.statusId) as string,
            assigneeUserId: input.assigneeUserId,
            startDate: task.startDate,
            dueDate: task.dueDate,
            labelIds: [...new Set(task.labels.map((name) => labelIds.get(lower(name)) as string))],
          },
          task.issueKey ? { importedFrom: task.issueKey } : {},
        );
      const story = create(doc.story, null);
      for (const subtask of doc.story.subtasks) create(subtask, story.id);
      return story.id;
    })();
    return this.tasks.get(storyId);
  }

  private statuses(projectId: string): StatusRow[] {
    return this.ctx.db
      .prepare<[string], StatusRow>(
        `SELECT id, name, category, is_default FROM statuses WHERE project_id = ? ORDER BY position`,
      )
      .all(projectId);
  }

  private requireLiveProject(projectId: string): void {
    if (!this.projects.isLive(projectId)) {
      throw new AppError('NOT_FOUND', 'errors.projectNotFound');
    }
  }
}

function allTasks(doc: StoryTransfer): StoryTransferTask[] {
  return [doc.story, ...doc.story.subtasks];
}

/** Source statuses some task uses, in file order. */
function usedStatuses(doc: StoryTransfer): StoryTransfer['statuses'] {
  const used = new Set(allTasks(doc).map((task) => task.statusId));
  return doc.statuses.filter((status) => used.has(status.id));
}

/** File labels some task carries, in file order. */
function usedLabels(doc: StoryTransfer): StoryTransfer['labels'] {
  const used = new Set(allTasks(doc).flatMap((task) => task.labels.map(lower)));
  return doc.labels.filter((label) => used.has(lower(label.name)));
}
