// Activity event types and payload shapes for project-level entities (spec §3.7, D12).
// Payloads carry display snapshots so history stays readable after renames (AUDIT-03).

export const PROJECT_EVENTS = {
  created: 'project.created',
  updated: 'project.updated',
} as const;

export const USER_EVENTS = {
  created: 'user.created',
  updated: 'user.updated',
  avatarChanged: 'user.avatarChanged',
  archived: 'user.archived',
  unarchived: 'user.unarchived',
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
