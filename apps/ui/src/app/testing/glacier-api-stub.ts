// In-memory fake of GlacierTasksAPI for renderer unit tests. Methods not implemented yet
// reject like the main process does for channels without a handler.

import {
  type ActivityEvent,
  type AppInfo,
  type ExportOptions,
  type RestorePreview,
  type AppErrorInfo,
  type AttachmentMetadata,
  type DroppedFile,
  type CreateProjectInput,
  type DeviceSettings,
  type DeviceSettingsPatch,
  DEFAULT_STATUSES,
  type GlacierTasksAPI,
  IPC_CHANNELS,
  normalizeProjectKey,
  type ProjectSummary,
  type ProjectView,
  sortKeyBetween,
  type UpdateProjectInput,
  type CreateTaskInput,
  type Label,
  type LabelInput,
  type LabelPatch,
  type TaskDetail,
  type TaskQuery,
  type TaskSummary,
  type UpdateTaskInput,
  type StatusCategory,
  type UserProfile,
  type WorkflowStatus,
} from '@glacier-tasks/domain';

export interface GlacierApiStub {
  api: GlacierTasksAPI;
  settings: DeviceSettings;
  /** Makes the next settings update fail with this error. */
  failNextUpdate: AppErrorInfo | null;
  updates: DeviceSettingsPatch[];
  projects: ProjectSummary[];
  users: UserProfile[];
  /** Avatar file id returned by the next users.chooseAvatar call; null simulates cancel. */
  nextAvatarFileId: string | null;
  labels: Label[];
  statuses: WorkflowStatus[];
  /** All tasks incl. trashed; `descriptionMarkdown` kept alongside the summary. */
  tasks: Array<TaskSummary & { descriptionMarkdown: string }>;
  /** All attachments incl. removed tombstones. */
  attachments: AttachmentMetadata[];
  /** History served by `activity.*` and `tasks.descriptionVersions`; tests seed it. */
  events: ActivityEvent[];
  /** Attachment ids passed to `open` / `saveAs`. */
  opened: string[];
  saved: string[];
  /** Returned by `app.info`. */
  info: AppInfo;
  /** Returned by `data.inspectRestore`; null simulates a cancelled dialog. */
  restorePreview: RestorePreview | null;
  /** Tokens passed to `data.restore`, and export options passed to `data.exportJson`. */
  restored: string[];
  exports: ExportOptions[];
}

export function defaultTestSettings(): DeviceSettings {
  return {
    theme: 'dark',
    language: 'en',
    lastProjectId: null,
    lastView: 'board',
    autoBackup: {
      enabled: false,
      folder: null,
      intervalHours: 24,
      retention: 7,
      lastRunAt: null,
      lastFailure: null,
    },
    projectViews: {},
    attachmentMaxMiB: 100,
  };
}

export function createGlacierApiStub(initial: Partial<DeviceSettings> = {}): GlacierApiStub {
  const notAvailable: AppErrorInfo = { code: 'IO', message: 'errors.notAvailable' };
  const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [group, methods] of Object.entries(IPC_CHANNELS)) {
    api[group] = {};
    for (const method of methods) {
      api[group][method] = () => Promise.reject(notAvailable);
    }
  }

  const stub: GlacierApiStub = {
    api: api as unknown as GlacierTasksAPI,
    settings: { ...defaultTestSettings(), ...initial },
    failNextUpdate: null,
    updates: [],
    projects: [],
    users: [],
    nextAvatarFileId: null,
    labels: [],
    statuses: [],
    tasks: [],
    attachments: [],
    events: [],
    opened: [],
    saved: [],
    info: { version: '1.2.3', schemaVersion: 1, lastRestore: null, restoreFailed: false },
    restorePreview: null,
    restored: [],
    exports: [],
  };
  let nextId = 1;
  const newId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
  const now = () => '2026-10-29T10:00:00.000Z';
  const conflict = (message: string): AppErrorInfo => ({ code: 'CONFLICT', message });
  const findProject = (id: string) => {
    const project = stub.projects.find((p) => p.id === id);
    if (!project) throw { code: 'NOT_FOUND', message: 'errors.projectNotFound' };
    return project;
  };
  const findUser = (id: string) => {
    const user = stub.users.find((u) => u.id === id);
    if (!user) throw { code: 'NOT_FOUND', message: 'errors.userNotFound' };
    return user;
  };

  api['projects']!['list'] = async () =>
    structuredClone([...stub.projects].sort((a, b) => a.name.localeCompare(b.name)));
  api['projects']!['create'] = async (input) => {
    const { key, name, description = '' } = input as CreateProjectInput;
    const normalized = normalizeProjectKey(key);
    if (stub.projects.some((p) => p.key === normalized)) throw conflict('errors.projectKeyTaken');
    const project: ProjectSummary = {
      id: newId(),
      key: normalized,
      name: name.trim(),
      description,
      keyLocked: false,
      createdAt: now(),
      updatedAt: now(),
      trashedAt: null,
      openStoryCount: 0,
      doneStoryCount: 0,
    };
    stub.projects.push(project);
    stub.statuses.push(
      ...DEFAULT_STATUSES.map((status, position) => ({
        id: `${project.id}-status-${position}`,
        projectId: project.id,
        name: status.name,
        category: status.category,
        position,
        isDefault: status.isDefault,
        createdAt: now(),
        updatedAt: now(),
      })),
    );
    return structuredClone(project);
  };
  api['projects']!['update'] = async (id, patch) => {
    const project = findProject(id as string);
    const { key, name, description } = patch as UpdateProjectInput;
    if (key !== undefined && key !== project.key) {
      if (project.keyLocked) throw conflict('errors.projectKeyLocked');
      if (stub.projects.some((p) => p.key === key)) throw conflict('errors.projectKeyTaken');
      project.key = key;
    }
    if (name !== undefined) project.name = name.trim();
    if (description !== undefined) project.description = description;
    return structuredClone(project);
  };
  installWorkflowApi(stub, api, newId, now);

  api['users']!['list'] = async (includeArchived) =>
    structuredClone(stub.users.filter((u) => includeArchived || u.archivedAt === null));
  api['users']!['create'] = async (input) => {
    const user: UserProfile = {
      id: newId(),
      name: (input as { name: string }).name.trim(),
      avatarFileId: null,
      createdAt: now(),
      updatedAt: now(),
      archivedAt: null,
    };
    stub.users.push(user);
    return structuredClone(user);
  };
  api['users']!['update'] = async (id, input) => {
    const user = findUser(id as string);
    user.name = (input as { name: string }).name.trim();
    return structuredClone(user);
  };
  api['users']!['archive'] = async (id) => {
    const user = findUser(id as string);
    if (user.archivedAt) throw conflict('errors.userAlreadyArchived');
    user.archivedAt = now();
  };
  api['users']!['unarchive'] = async (id) => {
    const user = findUser(id as string);
    if (!user.archivedAt) throw conflict('errors.userNotArchived');
    user.archivedAt = null;
  };
  api['users']!['chooseAvatar'] = async (id) => {
    const user = findUser(id as string);
    if (stub.nextAvatarFileId === null) return null;
    user.avatarFileId = stub.nextAvatarFileId;
    return structuredClone(user);
  };
  api['users']!['removeAvatar'] = async (id) => {
    const user = findUser(id as string);
    user.avatarFileId = null;
    return structuredClone(user);
  };

  api['app']!['info'] = async () => structuredClone(stub.info);
  api['data']!['backup'] = async () => ({
    fileName: 'glacier-tasks-2026-10-29.glaciertasks',
    byteSize: 3 * 1024 * 1024,
    createdAt: now(),
  });
  api['data']!['inspectRestore'] = async () => structuredClone(stub.restorePreview);
  api['data']!['restore'] = async (token) => {
    stub.restored.push(token as string);
  };
  api['data']!['exportJson'] = async (options) => {
    stub.exports.push(options as ExportOptions);
    return { fileName: 'glacier-tasks-workspace-2026-10-29.export.json', byteSize: 1000 };
  };
  api['settings']!['chooseAutoBackupFolder'] = async () => {
    stub.settings = {
      ...stub.settings,
      autoBackup: { ...stub.settings.autoBackup, folder: 'D:/Backups' },
    };
    return structuredClone(stub.settings);
  };
  api['settings']!['getDevice'] = async () => structuredClone(stub.settings);
  api['settings']!['updateDevice'] = async (patch) => {
    if (stub.failNextUpdate) {
      const error = stub.failNextUpdate;
      stub.failNextUpdate = null;
      throw error;
    }
    const { autoBackup, ...rest } = patch as DeviceSettingsPatch;
    const { lastProjectId } = patch as DeviceSettingsPatch;
    if (lastProjectId) findProject(lastProjectId);
    stub.updates.push(patch as DeviceSettingsPatch);
    stub.settings = {
      ...stub.settings,
      ...rest,
      autoBackup: { ...stub.settings.autoBackup, ...autoBackup },
    };
    return structuredClone(stub.settings);
  };
  api['settings']!['setProjectView'] = async (projectId, view) => {
    if (stub.failNextUpdate) {
      const error = stub.failNextUpdate;
      stub.failNextUpdate = null;
      throw error;
    }
    findProject(projectId as string);
    const projectViews = { ...stub.settings.projectViews };
    if (view) projectViews[projectId as string] = structuredClone(view as ProjectView);
    else delete projectViews[projectId as string];
    stub.settings = { ...stub.settings, projectViews };
    return structuredClone(stub.settings);
  };
  installTaskApi(stub, api, newId, now);
  installAttachmentApi(stub, api, newId, now);
  return stub;
}

/** In-memory attachments and history; previews by file extension (enough for UI tests). */
function installAttachmentApi(
  stub: GlacierApiStub,
  api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>,
  newId: () => string,
  now: () => string,
): void {
  const fail = (code: string, message: string): AppErrorInfo => ({ code, message }) as AppErrorInfo;
  const find = (id: string) => {
    const attachment = stub.attachments.find((a) => a.id === id && !a.removedAt);
    if (!attachment) throw fail('NOT_FOUND', 'errors.attachmentNotFound');
    return attachment;
  };
  const record = (taskId: string, eventType: string, attachment: AttachmentMetadata) => {
    const task = stub.tasks.find((t) => t.id === taskId);
    stub.events.push({
      id: newId(),
      entityType: 'TASK',
      entityId: taskId,
      projectId: task?.projectId ?? null,
      eventType,
      occurredAt: now(),
      source: 'UI',
      payload: {
        issueKey: task?.issueKey,
        title: task?.title,
        attachment: { id: attachment.id, name: attachment.originalName },
      },
    });
  };
  const add = (taskId: string, name: string, byteSize: number): AttachmentMetadata => {
    if (byteSize > stub.settings.attachmentMaxMiB * 1024 * 1024) {
      throw fail('VALIDATION', 'errors.attachmentTooLarge');
    }
    const previewable = /\.(png|jpe?g|gif|webp)$/i.test(name);
    const attachment: AttachmentMetadata = {
      id: newId(),
      taskId,
      originalName: name,
      mimeType: previewable ? 'image/png' : 'application/octet-stream',
      byteSize,
      sha256: '0'.repeat(64),
      addedAt: now(),
      removedAt: null,
      previewable,
    };
    stub.attachments.push(attachment);
    record(taskId, 'task.attachmentAdded', attachment);
    return attachment;
  };
  api['attachments']!['add'] = async (taskId) => [add(taskId as string, 'picked.txt', 10)];
  api['attachments']!['addFiles'] = async (taskId, files) =>
    (files as DroppedFile[]).map((file) => add(taskId as string, file.name, file.bytes.length));
  api['attachments']!['list'] = async (taskId) =>
    stub.attachments.filter((a) => a.taskId === taskId && !a.removedAt).reverse();
  api['attachments']!['open'] = async (id) => {
    stub.opened.push(find(id as string).id);
  };
  api['attachments']!['saveAs'] = async (id) => {
    stub.saved.push(find(id as string).id);
    return true;
  };
  api['attachments']!['remove'] = async (id) => {
    const attachment = find(id as string);
    attachment.removedAt = now();
    record(attachment.taskId, 'task.attachmentRemoved', attachment);
  };

  const newestFirst = (events: ActivityEvent[]) => [...events].reverse();
  api['activity']!['forEntity'] = async (entityType, entityId) =>
    newestFirst(stub.events.filter((e) => e.entityType === entityType && e.entityId === entityId));
  api['activity']!['forProject'] = async (projectId, page) => {
    const { offset = 0, limit = 100 } = (page as { offset?: number; limit?: number }) ?? {};
    const items = newestFirst(stub.events.filter((e) => e.projectId === projectId));
    return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
  };
  api['tasks']!['descriptionVersions'] = async (taskId) =>
    newestFirst(stub.events.filter((e) => e.entityId === taskId))
      .map((event) => {
        const payload = event.payload as {
          descriptionMarkdown?: string;
          changes?: { descriptionMarkdown?: { to: string } };
        };
        const markdown =
          event.eventType === 'task.created'
            ? payload.descriptionMarkdown
            : payload.changes?.descriptionMarkdown?.to;
        return markdown === undefined
          ? null
          : { eventId: event.id, occurredAt: event.occurredAt, markdown };
      })
      .filter((version) => version !== null);
}

/** In-memory statuses with the D07/D01 rules the UI reacts to. */
function installWorkflowApi(
  stub: GlacierApiStub,
  api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>,
  newId: () => string,
  now: () => string,
): void {
  const fail = (code: string, message: string) => ({ code, message });
  const ofProject = (projectId: string) =>
    stub.statuses.filter((s) => s.projectId === projectId).sort((a, b) => a.position - b.position);
  const find = (id: string) => {
    const status = stub.statuses.find((s) => s.id === id);
    if (!status) throw fail('NOT_FOUND', 'errors.statusNotFound');
    return status;
  };
  const renumber = (projectId: string, ids: string[]) =>
    ids.forEach((id, position) => {
      find(id).position = position;
    });

  api['workflows']!['list'] = async (projectId) => {
    if (!stub.projects.some((p) => p.id === projectId)) {
      throw fail('NOT_FOUND', 'errors.projectNotFound');
    }
    return structuredClone(ofProject(projectId as string));
  };
  api['workflows']!['create'] = async (projectId, input) => {
    const { name, category } = input as { name: string; category: StatusCategory };
    const statuses = ofProject(projectId as string);
    if (statuses.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw fail('CONFLICT', 'errors.statusNameTaken');
    }
    const status: WorkflowStatus = {
      id: newId(),
      projectId: projectId as string,
      name,
      category,
      position: statuses.length,
      isDefault: false,
      createdAt: now(),
      updatedAt: now(),
    };
    stub.statuses.push(status);
    return structuredClone(status);
  };
  api['workflows']!['update'] = async (id, patch) => {
    const status = find(id as string);
    const { name, category, isDefault, position } = patch as Partial<WorkflowStatus>;
    const statuses = ofProject(status.projectId);
    if (
      category &&
      category !== 'DONE' &&
      !statuses.some((s) => s.id !== status.id && s.category === 'DONE')
    ) {
      throw fail('CONFLICT', 'errors.lastDoneStatus');
    }
    if (name) status.name = name;
    if (category) status.category = category;
    if (isDefault) {
      for (const s of statuses) s.isDefault = s.id === status.id;
    }
    if (position !== undefined) {
      const ids = statuses.map((s) => s.id).filter((x) => x !== status.id);
      ids.splice(Math.min(position, ids.length), 0, status.id);
      renumber(status.projectId, ids);
    }
    return structuredClone(status);
  };
  api['workflows']!['usage'] = async (id) => {
    find(id as string);
    const using = stub.tasks.filter((t) => t.statusId === id);
    return {
      stories: using.filter((t) => t.type === 'STORY' && !t.trashedAt).length,
      subtasks: using.filter((t) => t.type === 'SUBTASK' && !t.trashedAt).length,
      trashed: using.filter((t) => t.trashedAt).length,
    };
  };
  api['workflows']!['removeAndMigrate'] = async (id, replacementId) => {
    const status = find(id as string);
    const replacement = stub.statuses.find((s) => s.id === replacementId);
    if (
      !replacement ||
      replacement.id === status.id ||
      replacement.projectId !== status.projectId
    ) {
      throw fail('VALIDATION', 'errors.invalidReplacement');
    }
    const remaining = ofProject(status.projectId).filter((s) => s.id !== status.id);
    if (!remaining.some((s) => s.category === 'DONE'))
      throw fail('CONFLICT', 'errors.lastDoneStatus');
    for (const task of stub.tasks.filter((t) => t.statusId === status.id)) {
      task.statusId = replacement.id;
      task.version++;
    }
    if (status.isDefault) replacement.isDefault = true;
    stub.statuses = stub.statuses.filter((s) => s.id !== status.id);
    renumber(
      status.projectId,
      remaining.map((s) => s.id),
    );
  };
}

type ApiRecord = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

/** Simplified task, label and trash behaviour mirroring the main-process rules used by UI tests. */
function installTaskApi(
  stub: GlacierApiStub,
  api: ApiRecord,
  newId: () => string,
  now: () => string,
): void {
  const fail = (code: string, message: string) => ({ code, message });
  const statusIds = (projectId: string) => [0, 1, 2].map((i) => `${projectId}-status-${i}`);
  const findTask = (id: string) => {
    const task = stub.tasks.find((t) => t.id === id);
    if (!task) throw fail('NOT_FOUND', 'errors.taskNotFound');
    return task;
  };
  const summary = (task: TaskSummary & { descriptionMarkdown: string }): TaskSummary => {
    const { descriptionMarkdown: _, ...rest } = task;
    if (task.type !== 'STORY') return structuredClone(rest);
    const children = stub.tasks.filter((t) => t.parentStoryId === task.id && !t.trashedAt);
    const done = children.filter((t) => t.statusId.endsWith('-status-2')).length;
    return { ...structuredClone(rest), subtaskProgress: { done, total: children.length } };
  };
  const detail = (id: string): TaskDetail => {
    const task = findTask(id);
    if (task.trashedAt) throw fail('NOT_FOUND', 'errors.taskNotFound');
    return {
      ...summary(task),
      descriptionMarkdown: task.descriptionMarkdown,
      subtasks: stub.tasks
        .filter((t) => t.parentStoryId === id && !t.trashedAt)
        .map((t) => summary(t)),
      attachments: stub.attachments.filter((a) => a.taskId === id && !a.removedAt).reverse(),
    };
  };

  api['labels']!['list'] = async (projectId) =>
    structuredClone(stub.labels.filter((l) => l.projectId === projectId));
  api['labels']!['create'] = async (projectId, input) => {
    const { name, color = null } = input as LabelInput;
    const label: Label = { id: newId(), projectId: projectId as string, name, color, taskCount: 0 };
    stub.labels.push(label);
    return structuredClone(label);
  };
  api['labels']!['update'] = async (id, patch) => {
    const label = stub.labels.find((l) => l.id === id);
    if (!label) throw fail('NOT_FOUND', 'errors.labelNotFound');
    Object.assign(label, patch as LabelPatch);
    return structuredClone(label);
  };
  api['labels']!['remove'] = async (id) => {
    stub.labels = stub.labels.filter((l) => l.id !== id);
  };

  // Enough of ADR 0010 for component tests: substring text match, every filter, a few sorts.
  const matches = (t: GlacierApiStub['tasks'][number], q: TaskQuery): boolean => {
    const text = (q.text ?? '').trim().toLowerCase();
    const has = <T>(list: ReadonlyArray<T> | undefined, value: T) =>
      !list?.length || list.includes(value);
    return (
      !t.trashedAt &&
      (q.projectId === null || t.projectId === q.projectId) &&
      (!text || `${t.issueKey} ${t.title} ${t.descriptionMarkdown}`.toLowerCase().includes(text)) &&
      has(q.types, t.type) &&
      has(q.statusIds, t.statusId) &&
      has(q.priorities, t.priority) &&
      has(q.assigneeUserIds, t.assigneeUserId) &&
      (!q.labelIds?.length || t.labelIds.some((id) => q.labelIds?.includes(id))) &&
      (!q.dueFrom || (t.dueDate !== null && t.dueDate >= q.dueFrom)) &&
      (!q.dueTo || (t.dueDate !== null && t.dueDate <= q.dueTo))
    );
  };
  const compare = (q: TaskQuery) => (a: TaskSummary, b: TaskSummary) => {
    const value = (t: TaskSummary): string | number =>
      q.sortBy === 'title'
        ? t.title.toLowerCase()
        : q.sortBy === 'issueKey'
          ? t.issueNumber
          : q.sortBy === 'priority'
            ? ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(t.priority)
            : t.sortOrder;
    const order =
      value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : a.issueNumber - b.issueNumber;
    return q.sortDirection === 'desc' ? -order : order;
  };
  const page = <T>(items: T[], q: TaskQuery) => {
    const { offset = 0, limit = 100 } = q.page ?? {};
    return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
  };
  api['tasks']!['query'] = async (input) => {
    const query = input as TaskQuery;
    return page(
      stub.tasks
        .filter((t) => matches(t, query))
        .map(summary)
        .sort(compare(query)),
      query,
    );
  };
  api['tasks']!['list'] = async (input) => {
    const query = input as TaskQuery;
    const hits = new Set(stub.tasks.filter((t) => matches(t, query)).map((t) => t.id));
    const rows = stub.tasks
      .filter((t) => t.type === 'STORY' && !t.trashedAt)
      .filter(
        (story) =>
          hits.has(story.id) ||
          stub.tasks.some((t) => t.parentStoryId === story.id && hits.has(t.id)),
      )
      .map((story) => ({
        story: summary(story),
        storyMatches: hits.has(story.id),
        subtasks: stub.tasks
          .filter((t) => t.parentStoryId === story.id && hits.has(t.id))
          .map(summary)
          .sort(compare(query)),
      }))
      .sort((a, b) => compare(query)(a.story, b.story));
    return page(rows, query);
  };
  api['tasks']!['get'] = async (id) => detail(id as string);
  api['tasks']!['create'] = async (input) => {
    const data = input as CreateTaskInput;
    const project = stub.projects.find((p) => p.id === data.projectId);
    if (!project) throw fail('NOT_FOUND', 'errors.projectNotFound');
    const siblings = stub.tasks.filter((t) => t.projectId === project.id);
    const number = siblings.length + 1;
    const lastKey =
      siblings
        .map((t) => t.sortOrder)
        .sort()
        .at(-1) ?? null;
    stub.tasks.push({
      id: newId(),
      projectId: project.id,
      issueNumber: number,
      issueKey: `${project.key}-${number}`,
      type: data.type,
      parentStoryId: data.parentStoryId ?? null,
      title: data.title.trim(),
      descriptionMarkdown: data.descriptionMarkdown ?? '',
      priority: data.priority ?? 'MEDIUM',
      statusId: data.statusId ?? (statusIds(project.id)[0] as string),
      assigneeUserId: data.assigneeUserId ?? null,
      assigneeArchived: false,
      startDate: data.startDate ?? null,
      dueDate: data.dueDate ?? null,
      labelIds: data.labelIds ?? [],
      sortOrder: sortKeyBetween(lastKey, null),
      version: 1,
      createdAt: now(),
      updatedAt: now(),
      trashedAt: null,
      subtaskProgress: data.type === 'STORY' ? { done: 0, total: 0 } : null,
    });
    return detail(stub.tasks[stub.tasks.length - 1]!.id);
  };
  api['tasks']!['update'] = async (id, version, patch) => {
    const task = findTask(id as string);
    if (task.version !== version) throw fail('CONFLICT', 'errors.staleTask');
    Object.assign(task, patch as UpdateTaskInput, { version: task.version + 1 });
    return detail(task.id);
  };
  api['tasks']!['move'] = async (id, version, statusId, sortOrder) => {
    const task = findTask(id as string);
    if (task.type !== 'STORY') throw fail('VALIDATION', 'errors.moveStoriesOnly');
    if (task.version !== version) throw fail('CONFLICT', 'errors.staleTask');
    const columnChanged = task.statusId !== statusId;
    const column = stub.tasks.filter((t) => t.statusId === statusId && t.id !== task.id);
    const top = column.map((t) => t.sortOrder).sort()[0];
    Object.assign(task, {
      statusId,
      sortOrder: !columnChanged && sortOrder ? sortOrder : sortKeyBetween(null, top ?? null),
      version: task.version + 1,
    });
  };
  api['tasks']!['moveToStory'] = async (id, version, target) => {
    const task = findTask(id as string);
    if (task.version !== version) throw fail('CONFLICT', 'errors.staleTask');
    Object.assign(task, { parentStoryId: target, version: task.version + 1 });
  };
  api['tasks']!['trash'] = async (id) => {
    const task = findTask(id as string);
    task.trashedAt = now();
    task.version++;
  };
  api['tasks']!['restore'] = async (id) => {
    const task = findTask(id as string);
    const parent = task.parentStoryId ? findTask(task.parentStoryId) : null;
    if (parent?.trashedAt) throw fail('CONFLICT', 'errors.restoreParentFirst');
    task.trashedAt = null;
    task.version++;
  };

  api['projects']!['trash'] = async (id) => {
    stub.projects = stub.projects.filter((p) => p.id !== id);
    if (stub.settings.lastProjectId === id) stub.settings.lastProjectId = null;
  };
  const purgeTask = (id: string) => {
    stub.tasks = stub.tasks.filter((t) => t.id !== id && t.parentStoryId !== id);
  };
  api['trash']!['purge'] = async (_kind, id) => {
    if (!stub.tasks.some((t) => t.id === id && t.trashedAt)) {
      throw { code: 'NOT_FOUND', message: 'errors.notInTrash' };
    }
    purgeTask(id as string);
  };
  api['trash']!['empty'] = async (projectId) => {
    const trashed = stub.tasks.filter(
      (t) => t.trashedAt && (!projectId || t.projectId === projectId),
    );
    for (const task of trashed) purgeTask(task.id);
    return { deleted: trashed.length };
  };
  api['trash']!['list'] = async (projectId) =>
    stub.tasks
      .filter((t) => t.trashedAt && (!projectId || t.projectId === projectId))
      .map((t) => ({
        kind: t.type,
        id: t.id,
        projectId: t.projectId,
        projectKey: t.issueKey.split('-')[0] as string,
        issueKey: t.issueKey,
        title: t.title,
        trashedAt: t.trashedAt as string,
      }));
  api['users']!['unassignAll'] = async (id) => {
    const assigned = stub.tasks.filter((t) => t.assigneeUserId === id);
    for (const task of assigned) task.assigneeUserId = null;
    return { unassigned: assigned.length };
  };
}
