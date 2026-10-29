// In-memory fake of GlacierTasksAPI for renderer unit tests. Methods not implemented yet
// reject like the main process does for channels without a handler.

import {
  type AppErrorInfo,
  type CreateProjectInput,
  type DeviceSettings,
  type DeviceSettingsPatch,
  DEFAULT_STATUSES,
  type GlacierTasksAPI,
  IPC_CHANNELS,
  normalizeProjectKey,
  type ProjectSummary,
  type UpdateProjectInput,
  type CreateTaskInput,
  type Label,
  type LabelInput,
  type LabelPatch,
  type TaskDetail,
  type TaskQuery,
  type TaskSummary,
  type UpdateTaskInput,
  type UserProfile,
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
  /** All tasks incl. trashed; `descriptionMarkdown` kept alongside the summary. */
  tasks: Array<TaskSummary & { descriptionMarkdown: string }>;
}

export function defaultTestSettings(): DeviceSettings {
  return {
    theme: 'dark',
    language: 'en',
    lastProjectId: null,
    lastView: 'board',
    autoBackup: { enabled: false, folder: null, intervalHours: 24, retention: 7, lastRunAt: null },
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
    tasks: [],
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
  api['workflows']!['list'] = async (projectId) => {
    findProject(projectId as string);
    return DEFAULT_STATUSES.map((status, position) => ({
      id: `${projectId}-status-${position}`,
      projectId,
      name: status.name,
      category: status.category,
      position,
      isDefault: status.isDefault,
      createdAt: now(),
      updatedAt: now(),
    }));
  };

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

  api['app']!['info'] = async () => ({ version: '1.2.3', schemaVersion: 1 });
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
  installTaskApi(stub, api, newId, now);
  return stub;
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
      attachments: [],
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

  api['tasks']!['query'] = async (input) => {
    const query = input as TaskQuery;
    const items = stub.tasks
      .filter((t) => t.projectId === query.projectId && !t.trashedAt)
      .filter((t) => !query.types?.length || query.types.includes(t.type))
      .map((t) => summary(t));
    return { items, total: items.length, offset: 0, limit: 500 };
  };
  api['tasks']!['get'] = async (id) => detail(id as string);
  api['tasks']!['create'] = async (input) => {
    const data = input as CreateTaskInput;
    const project = stub.projects.find((p) => p.id === data.projectId);
    if (!project) throw fail('NOT_FOUND', 'errors.projectNotFound');
    const number = stub.tasks.filter((t) => t.projectId === project.id).length + 1;
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
      sortOrder: String(number),
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
  api['trash']!['list'] = async () =>
    stub.tasks
      .filter((t) => t.trashedAt)
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
