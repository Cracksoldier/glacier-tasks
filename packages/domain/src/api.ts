// The renderer-facing API exposed on `window.glacierTasks` (spec §6, ADR 0004).
//
// Every IPC surface change touches: this file → IPC_CHANNELS → apps/desktop preload
// (invoke mirror) → apps/desktop IPC handler (schema validation) → renderer test stub.
// Methods resolve with the value on success and reject with an AppErrorInfo-shaped error.

import type { EntityType } from './enums.js';
import type {
  ActivityEvent,
  AppInfo,
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
  RestorePreview,
  StatusUsage,
  TaskDetail,
  TaskListRow,
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
  DroppedFile,
  ExportOptions,
  LabelInput,
  LabelPatch,
  ProjectView,
  StatusInput,
  StatusPatch,
  TaskQuery,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateUserInput,
} from './schemas.js';

export interface GlacierTasksAPI {
  app: {
    info(): Promise<AppInfo>;
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
    /** Flat: tasks matching on their own fields (board, pickers). */
    query(input: TaskQuery): Promise<PagedResult<TaskSummary>>;
    /** Hierarchical story rows with matching subtasks; pages count rows (LIST-05, D09). */
    list(input: TaskQuery): Promise<PagedResult<TaskListRow>>;
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
    /** Directly trashed projects and tasks, newest first (D39); optionally one project (D49). */
    list(projectId?: string | null): Promise<TrashItem[]>;
    /** Permanently deletes a directly trashed item with everything it contains (TRASH-05). */
    purge(kind: TrashItem['kind'], id: string): Promise<void>;
    /** Purges every directly trashed item, of one project or all. */
    empty(projectId: string | null): Promise<{ deleted: number }>;
  };
  workflows: {
    list(projectId: string): Promise<WorkflowStatus[]>;
    create(projectId: string, input: StatusInput): Promise<WorkflowStatus>;
    update(id: string, patch: StatusPatch): Promise<WorkflowStatus>;
    /** Tasks that a removal would migrate, for the delete wizard (D01). */
    usage(statusId: string): Promise<StatusUsage>;
    removeAndMigrate(statusId: string, replacementStatusId: string): Promise<void>;
  };
  attachments: {
    /** Native multi-file picker in the main process; resolves [] when cancelled (T5). */
    add(taskId: string): Promise<AttachmentMetadata[]>;
    /** Drag & drop: the dropped files' bytes, never paths (T5, ADR 0011). */
    addFiles(taskId: string, files: DroppedFile[]): Promise<AttachmentMetadata[]>;
    /** Live (not removed) attachments, newest first. */
    list(taskId: string): Promise<AttachmentMetadata[]>;
    /** Opens a temporary copy with the OS handler; the renderer confirms first (T11). */
    open(id: string): Promise<void>;
    /** Native save dialog; resolves false when cancelled. */
    saveAs(id: string): Promise<boolean>;
    /** Deletes the bytes and keeps a tombstone plus a history event (D03). */
    remove(id: string): Promise<void>;
  };
  data: {
    /** Save dialog, then a complete `.glaciertasks` backup; null when cancelled (DATA-01). */
    backup(): Promise<BackupResult | null>;
    /** Open dialog, then validation and staging; null when cancelled (DATA-04/08). */
    inspectRestore(): Promise<RestorePreview | null>;
    /** Replaces the workspace with a staged backup: safety backup, then restart (DATA-06/07). */
    restore(token: string): Promise<void>;
    /** Export-only JSON (DATA-02/03, D14); null when cancelled. */
    exportJson(options: ExportOptions): Promise<ExportResult | null>;
  };
  settings: {
    getDevice(): Promise<DeviceSettings>;
    updateDevice(patch: DeviceSettingsPatch): Promise<DeviceSettings>;
    /** Folder picker for automatic backups; unchanged settings when cancelled (D13). */
    chooseAutoBackupFolder(): Promise<DeviceSettings>;
    /** Stores (or with `null` forgets) a project's sort, filters and columns (D42). */
    setProjectView(projectId: string, view: ProjectView | null): Promise<DeviceSettings>;
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
    'list',
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
  trash: ['list', 'purge', 'empty'],
  workflows: ['list', 'create', 'update', 'usage', 'removeAndMigrate'],
  attachments: ['add', 'addFiles', 'list', 'open', 'saveAs', 'remove'],
  data: ['backup', 'inspectRestore', 'restore', 'exportJson'],
  settings: ['getDevice', 'updateDevice', 'chooseAutoBackupFolder', 'setProjectView'],
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
