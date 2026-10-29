// Data transfer objects returned by the main process (spec §3, §6).
// Timestamps are UTC ISO-8601 strings; date-only fields are local `YYYY-MM-DD` strings.

import type {
  ActivitySource,
  EntityType,
  LabelColor,
  Language,
  Priority,
  StatusCategory,
  TaskType,
  Theme,
} from './enums.js';

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  /** True once the project has issued a task ID; the key is then immutable (D30). */
  keyLocked: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface ProjectSummary extends Project {
  openStoryCount: number;
  doneStoryCount: number;
}

export interface UserProfile {
  id: string;
  name: string;
  avatarFileId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkflowStatus {
  id: string;
  projectId: string;
  name: string;
  category: StatusCategory;
  position: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  /** Palette color id (D25), not a free-form CSS color. */
  color: LabelColor | null;
  /** Live and trashed tasks carrying the label. */
  taskCount: number;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  issueNumber: number;
  issueKey: string;
  type: TaskType;
  parentStoryId: string | null;
  title: string;
  priority: Priority;
  statusId: string;
  assigneeUserId: string | null;
  /** The assignee is archived; it stays until explicitly changed (spec §3.2). */
  assigneeArchived: boolean;
  startDate: string | null;
  dueDate: string | null;
  labelIds: string[];
  sortOrder: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  /** Stories only: subtask progress by status category DONE (TASK-06). */
  subtaskProgress: { done: number; total: number } | null;
}

export interface TrashItem {
  kind: 'PROJECT' | 'STORY' | 'SUBTASK';
  id: string;
  projectId: string;
  projectKey: string;
  /** Tasks only. */
  issueKey: string | null;
  /** Project name or task title. */
  title: string;
  trashedAt: string;
}

export interface AttachmentMetadata {
  id: string;
  taskId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  addedAt: string;
  removedAt: string | null;
  previewable: boolean;
}

export interface TaskDetail extends TaskSummary {
  descriptionMarkdown: string;
  subtasks: TaskSummary[];
  attachments: AttachmentMetadata[];
}

export interface ActivityEvent {
  id: string;
  entityType: EntityType;
  entityId: string;
  projectId: string | null;
  eventType: string;
  occurredAt: string;
  source: ActivitySource;
  /** Structured before/after values with display-name snapshots (AUDIT-03). */
  payload: Record<string, unknown>;
}

export interface DescriptionVersion {
  eventId: string;
  occurredAt: string;
  markdown: string;
}

export interface PageRequest {
  offset: number;
  limit: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface AutoBackupSettings {
  enabled: boolean;
  folder: string | null;
  intervalHours: number;
  retention: number;
  lastRunAt: string | null;
}

/** Stored outside the workspace database; never replaced by restore (D17). */
export interface DeviceSettings {
  theme: Theme;
  language: Language;
  lastProjectId: string | null;
  lastView: 'board' | 'list';
  autoBackup: AutoBackupSettings;
}

export interface BackupResult {
  fileName: string;
  byteSize: number;
  createdAt: string;
}

export interface RestoreResult {
  restoredAt: string;
  schemaVersion: number;
  safetyBackupFileName: string | null;
}

export interface ExportResult {
  fileName: string;
  byteSize: number;
}
