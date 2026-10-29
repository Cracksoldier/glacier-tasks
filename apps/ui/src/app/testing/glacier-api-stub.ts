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
  return stub;
}
