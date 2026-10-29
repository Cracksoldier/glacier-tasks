// The renderer-facing API exposed on `window.glacierTasks` (spec §6, ADR 0004).
//
// Every IPC surface change touches: this file → IPC_CHANNELS → apps/desktop preload
// (invoke mirror) → apps/desktop IPC handler (schema validation) → renderer test stub.
// Methods resolve with the value on success and reject with an AppErrorInfo-shaped error.

import type { EntityType } from './enums.js';
import type {
  ActivityEvent,
  AttachmentMetadata,
  BackupResult,
  DescriptionVersion,
  DeviceSettings,
  ExportResult,
  Label,
  PagedResult,
  PageRequest,
  Project,
  ProjectSummary,
  RestoreResult,
  TaskDetail,
  TaskSummary,
  TrashItem,
  UserProfile,
  WorkflowStatus,
} from './models.js';
import type {
  CreateProjectInput,
  CreateTaskInput,
  CreateUserInput,
  DeviceSettingsPatch,
  ExportOptions,
  LabelInput,
  LabelPatch,
  StatusInput,
  StatusPatch,
  TaskQuery,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateUserInput,
} from './schemas.js';

export interface GlacierTasksAPI {
  app: {
    info(): Promise<{ version: string; schemaVersion: number }>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: string, patch: UpdateProjectInput): Promise<Project>;
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
  };
  users: {
    list(includeArchived?: boolean): Promise<UserProfile[]>;
    create(input: CreateUserInput): Promise<UserProfile>;
    update(id: string, input: UpdateUserInput): Promise<UserProfile>;
    archive(id: string): Promise<void>;
    unarchive(id: string): Promise<void>;
    /** Opens a native file picker in the main process; resolves null when cancelled (D24). */
    chooseAvatar(id: string): Promise<UserProfile | null>;
    removeAvatar(id: string): Promise<UserProfile>;
    /** Clears this profile as assignee on all live and trashed tasks (USER-05). */
    unassignAll(id: string): Promise<{ unassigned: number }>;
  };
  tasks: {
    query(input: TaskQuery): Promise<PagedResult<TaskSummary>>;
    get(id: string): Promise<TaskDetail>;
    create(input: CreateTaskInput): Promise<TaskDetail>;
    update(id: string, expectedVersion: number, patch: UpdateTaskInput): Promise<TaskDetail>;
    move(id: string, expectedVersion: number, statusId: string, sortOrder?: string): Promise<void>;
    moveToStory(subtaskId: string, expectedVersion: number, targetStoryId: string): Promise<void>;
    trash(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    descriptionVersions(id: string): Promise<DescriptionVersion[]>;
  };
  activity: {
    forEntity(entityType: EntityType, entityId: string): Promise<ActivityEvent[]>;
    forProject(projectId: string, page?: PageRequest): Promise<PagedResult<ActivityEvent>>;
  };
  labels: {
    list(projectId: string): Promise<Label[]>;
    create(projectId: string, input: LabelInput): Promise<Label>;
    update(id: string, patch: LabelPatch): Promise<Label>;
    remove(id: string): Promise<void>;
  };
  trash: {
    /** Directly trashed projects and tasks, newest first (D39). */
    list(): Promise<TrashItem[]>;
  };
  workflows: {
    list(projectId: string): Promise<WorkflowStatus[]>;
    create(projectId: string, input: StatusInput): Promise<WorkflowStatus>;
    update(id: string, patch: StatusPatch): Promise<WorkflowStatus>;
    removeAndMigrate(statusId: string, replacementStatusId: string): Promise<void>;
  };
  attachments: {
    add(taskId: string): Promise<AttachmentMetadata[]>;
    list(taskId: string): Promise<AttachmentMetadata[]>;
    open(id: string): Promise<void>;
    saveAs(id: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
  data: {
    backup(): Promise<BackupResult>;
    restore(): Promise<RestoreResult>;
    exportJson(options: ExportOptions): Promise<ExportResult>;
  };
  settings: {
    getDevice(): Promise<DeviceSettings>;
    updateDevice(patch: DeviceSettingsPatch): Promise<DeviceSettings>;
    chooseAutoBackupFolder(): Promise<DeviceSettings>;
  };
}

/** Name of the global the preload script exposes via contextBridge. */
export const API_GLOBAL_NAME = 'glacierTasks';

/**
 * IPC channel name for every API method, derived as `<group>:<method>`.
 * Only channels listed here may be registered or invoked.
 */
export const IPC_CHANNELS = {
  app: ['info'],
  projects: ['list', 'create', 'update', 'trash', 'restore'],
  users: [
    'list',
    'create',
    'update',
    'archive',
    'unarchive',
    'chooseAvatar',
    'removeAvatar',
    'unassignAll',
  ],
  tasks: [
    'query',
    'get',
    'create',
    'update',
    'move',
    'moveToStory',
    'trash',
    'restore',
    'descriptionVersions',
  ],
  activity: ['forEntity', 'forProject'],
  labels: ['list', 'create', 'update', 'remove'],
  trash: ['list'],
  workflows: ['list', 'create', 'update', 'removeAndMigrate'],
  attachments: ['add', 'list', 'open', 'saveAs', 'remove'],
  data: ['backup', 'restore', 'exportJson'],
  settings: ['getDevice', 'updateDevice', 'chooseAutoBackupFolder'],
} as const satisfies { [G in keyof GlacierTasksAPI]: ReadonlyArray<keyof GlacierTasksAPI[G]> };

export type IpcChannel = {
  [G in keyof typeof IPC_CHANNELS]: `${G}:${(typeof IPC_CHANNELS)[G][number]}`;
}[keyof typeof IPC_CHANNELS];

export function ipcChannel<G extends keyof typeof IPC_CHANNELS>(
  group: G,
  method: (typeof IPC_CHANNELS)[G][number],
): IpcChannel {
  return `${group}:${method}` as IpcChannel;
}

export function allIpcChannels(): IpcChannel[] {
  return (Object.keys(IPC_CHANNELS) as Array<keyof typeof IPC_CHANNELS>).flatMap((group) =>
    IPC_CHANNELS[group].map((method) => `${group}:${method}` as IpcChannel),
  );
}
