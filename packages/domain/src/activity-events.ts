// Activity event types and payload shapes for project-level entities (spec §3.7, D12).
// Payloads carry display snapshots so history stays readable after renames (AUDIT-03).

export const PROJECT_EVENTS = {
  created: 'project.created',
  updated: 'project.updated',
  trashed: 'project.trashed',
  restored: 'project.restored',
} as const;

export const USER_EVENTS = {
  created: 'user.created',
  updated: 'user.updated',
  avatarChanged: 'user.avatarChanged',
  archived: 'user.archived',
  unarchived: 'user.unarchived',
  bulkUnassigned: 'user.bulkUnassigned',
} as const;

export const TASK_EVENTS = {
  created: 'task.created',
  updated: 'task.updated',
  trashed: 'task.trashed',
  restored: 'task.restored',
  movedToStory: 'task.movedToStory',
  // Recorded on the parent story (D27).
  subtaskCreated: 'task.subtaskCreated',
  subtaskTrashed: 'task.subtaskTrashed',
  subtaskRestored: 'task.subtaskRestored',
  subtaskMovedIn: 'task.subtaskMovedIn',
  subtaskMovedOut: 'task.subtaskMovedOut',
} as const;

export const STATUS_EVENTS = {
  created: 'status.created',
  updated: 'status.updated',
  reordered: 'status.reordered',
  removed: 'status.removed',
} as const;

export const LABEL_EVENTS = {
  created: 'label.created',
  updated: 'label.updated',
  removed: 'label.removed',
} as const;

export interface FieldChange<T> {
  from: T;
  to: T;
}

export interface ProjectCreatedPayload {
  key: string;
  name: string;
  description: string;
  statuses: Array<{ id: string; name: string; category: string; isDefault: boolean }>;
}

export interface ProjectUpdatedPayload {
  /** Snapshot of the project name after the change, for display. */
  name: string;
  changes: Partial<{
    key: FieldChange<string>;
    name: FieldChange<string>;
    description: FieldChange<string>;
  }>;
}

export interface UserCreatedPayload {
  name: string;
}

export interface UserUpdatedPayload {
  name: string;
  changes: Partial<{ name: FieldChange<string> }>;
}

export interface UserAvatarChangedPayload {
  name: string;
  from: string | null;
  to: string | null;
}

export interface UserArchiveTogglePayload {
  name: string;
}

export interface UserBulkUnassignedPayload {
  name: string;
  count: number;
}

// --- Tasks ------------------------------------------------------------------

/** Display snapshot of a referenced entity at event time (AUDIT-03). */
export interface RefSnapshot {
  id: string;
  name: string;
}

export interface StatusSnapshot extends RefSnapshot {
  category: string;
}

export interface LabelSnapshot extends RefSnapshot {
  color: string | null;
}

/** Identifies a task in payloads, also on events recorded for its parent. */
export interface TaskRef {
  id: string;
  issueKey: string;
  title: string;
}

export interface TaskCreatedPayload {
  issueKey: string;
  type: string;
  title: string;
  /** Full text (D11): the first description version. */
  descriptionMarkdown: string;
  priority: string;
  status: StatusSnapshot;
  assignee: RefSnapshot | null;
  startDate: string | null;
  dueDate: string | null;
  labels: LabelSnapshot[];
  parent: TaskRef | null;
}

export interface TaskChanges {
  title: FieldChange<string>;
  /** Only the new full text is stored; the previous one is in the prior event (D11). */
  descriptionMarkdown: { to: string };
  priority: FieldChange<string>;
  status: FieldChange<StatusSnapshot>;
  assignee: FieldChange<RefSnapshot | null>;
  startDate: FieldChange<string | null>;
  dueDate: FieldChange<string | null>;
  labels: { added: LabelSnapshot[]; removed: LabelSnapshot[] };
}

export interface TaskUpdatedPayload {
  issueKey: string;
  title: string;
  changes: Partial<TaskChanges>;
  /** Set when the change was a side effect, e.g. 'label.removed' or 'user.bulkUnassigned'. */
  cause?: string;
}

export interface TaskTrashTogglePayload {
  issueKey: string;
  title: string;
  /** Subtasks taken along by the cascade (D02). */
  cascaded: TaskRef[];
}

export interface TaskMovedToStoryPayload {
  issueKey: string;
  title: string;
  from: TaskRef;
  to: TaskRef;
}

/** Event on a parent story about one of its subtasks (D27). */
export interface SubtaskEventPayload {
  subtask: TaskRef;
  /** For moves: the other story involved. */
  otherStory?: TaskRef;
}

export interface ProjectTrashTogglePayload {
  key: string;
  name: string;
  cascadedTaskCount: number;
}

// --- Labels -----------------------------------------------------------------

export interface LabelCreatedPayload {
  name: string;
  color: string | null;
}

export interface LabelUpdatedPayload {
  name: string;
  changes: Partial<{ name: FieldChange<string>; color: FieldChange<string | null> }>;
}

export interface LabelRemovedPayload {
  name: string;
  color: string | null;
  affectedTasks: TaskRef[];
}

// --- Workflow statuses ------------------------------------------------------

export interface StatusCreatedPayload {
  name: string;
  category: string;
  position: number;
}

export interface StatusUpdatedPayload {
  name: string;
  changes: Partial<{
    name: FieldChange<string>;
    category: FieldChange<string>;
    isDefault: FieldChange<boolean>;
  }>;
}

export interface StatusReorderedPayload {
  name: string;
  from: number;
  to: number;
}

export interface StatusRemovedPayload {
  name: string;
  category: string;
  replacement: StatusSnapshot;
  /** The replacement became the default because the removed status was it. */
  defaultReassigned: boolean;
  migrated: { stories: number; subtasks: number; trashed: number };
}
