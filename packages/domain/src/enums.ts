// Fixed enumerations shared by main process, data layer and renderer.
// Values are persisted in SQLite; never rename an existing value without a migration.

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const; // D31
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = 'MEDIUM';

export const STATUS_CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const TASK_TYPES = ['STORY', 'SUBTASK'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const ENTITY_TYPES = ['TASK', 'PROJECT', 'STATUS', 'LABEL', 'USER'] as const; // D12
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ACTIVITY_SOURCES = ['UI', 'RESTORE', 'SYSTEM'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** Label palette (D25); each id maps to a light/dark color pair in the UI tokens. */
export const LABEL_COLORS = [
  'slate',
  'blue',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'dark'; // D18

export const LANGUAGES = ['en', 'de'] as const; // D15
export type Language = (typeof LANGUAGES)[number];

/** Initial workflow seeded for every new project (D32). Order = board column order. */
export const DEFAULT_STATUSES: ReadonlyArray<{
  name: string;
  category: StatusCategory;
  isDefault: boolean;
}> = [
  { name: 'To Do', category: 'TODO', isDefault: true },
  { name: 'In Progress', category: 'IN_PROGRESS', isDefault: false },
  { name: 'Done', category: 'DONE', isDefault: false },
];
