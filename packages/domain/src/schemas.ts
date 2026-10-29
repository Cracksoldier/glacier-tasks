// Zod schemas for every IPC input (spec §6, ADR 0004). The main process parses each
// payload with these before calling a service; the renderer may reuse them for forms.

import { z } from 'zod';
import {
  ENTITY_TYPES,
  LABEL_COLORS,
  LANGUAGES,
  PRIORITIES,
  STATUS_CATEGORIES,
  TASK_TYPES,
  THEMES,
} from './enums.js';
import { isDateRangeValid, isValidLocalDate, PROJECT_KEY_PATTERN } from './invariants.js';
import { isValidSortKey } from './sort-key.js';
import {
  DESCRIPTION_MAX_LENGTH,
  LABEL_NAME_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  STATUS_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from './limits.js';

export const idSchema = z.uuid();
export const versionSchema = z.int().nonnegative();

const requiredName = (max: number) => z.string().trim().min(1).max(max);

export const localDateSchema = z.string().refine(isValidLocalDate, 'Invalid date');
export const sortKeySchema = z.string().max(256).refine(isValidSortKey, 'Invalid sort key');
export const projectKeySchema = z.string().trim().toUpperCase().regex(PROJECT_KEY_PATTERN);

export const prioritySchema = z.enum(PRIORITIES);
export const statusCategorySchema = z.enum(STATUS_CATEGORIES);
export const taskTypeSchema = z.enum(TASK_TYPES);
export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const pageRequestSchema = z.object({
  offset: z.int().nonnegative().default(0),
  limit: z.int().min(1).max(500).default(100),
});

// --- Projects ---------------------------------------------------------------

export const createProjectInputSchema = z.strictObject({
  key: projectKeySchema,
  name: requiredName(PROJECT_NAME_MAX_LENGTH),
  description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).default(''),
});

export const updateProjectInputSchema = z
  .strictObject({
    key: projectKeySchema,
    name: requiredName(PROJECT_NAME_MAX_LENGTH),
    description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH),
  })
  .partial();

// --- Users ------------------------------------------------------------------

export const createUserInputSchema = z.strictObject({
  name: requiredName(USER_NAME_MAX_LENGTH),
});

export const updateUserInputSchema = z.strictObject({
  name: requiredName(USER_NAME_MAX_LENGTH),
});

// --- Workflow statuses ------------------------------------------------------

export const statusInputSchema = z.strictObject({
  name: requiredName(STATUS_NAME_MAX_LENGTH),
  category: statusCategorySchema,
});

export const statusPatchSchema = z
  .strictObject({
    name: requiredName(STATUS_NAME_MAX_LENGTH),
    category: statusCategorySchema,
    position: z.int().nonnegative(),
    isDefault: z.literal(true),
  })
  .partial();

// --- Labels -----------------------------------------------------------------

export const labelColorSchema = z.enum(LABEL_COLORS);

export const labelInputSchema = z.strictObject({
  name: requiredName(LABEL_NAME_MAX_LENGTH),
  color: labelColorSchema.nullable().default(null),
});

export const labelPatchSchema = z
  .strictObject({
    name: requiredName(LABEL_NAME_MAX_LENGTH),
    color: labelColorSchema.nullable(),
  })
  .partial();

// --- Tasks ------------------------------------------------------------------

const taskFieldsShape = {
  title: requiredName(TITLE_MAX_LENGTH),
  descriptionMarkdown: z.string().max(DESCRIPTION_MAX_LENGTH),
  priority: prioritySchema,
  statusId: idSchema,
  assigneeUserId: idSchema.nullable(),
  startDate: localDateSchema.nullable(),
  dueDate: localDateSchema.nullable(),
  labelIds: z.array(idSchema).max(100),
};

const dateRangeRefinement = {
  check: (v: { startDate?: string | null; dueDate?: string | null }) =>
    isDateRangeValid(v.startDate, v.dueDate),
  message: 'Start date must not be after due date',
};

export const createTaskInputSchema = z
  .strictObject({
    projectId: idSchema,
    type: taskTypeSchema,
    parentStoryId: idSchema.nullable().default(null),
    title: taskFieldsShape.title,
    descriptionMarkdown: taskFieldsShape.descriptionMarkdown.default(''),
    priority: prioritySchema.default('MEDIUM'),
    statusId: idSchema.optional(), // omitted → project default status (TASK-04)
    assigneeUserId: taskFieldsShape.assigneeUserId.default(null),
    startDate: taskFieldsShape.startDate.default(null),
    dueDate: taskFieldsShape.dueDate.default(null),
    labelIds: taskFieldsShape.labelIds.default([]),
  })
  .refine((v) => (v.type === 'STORY') === (v.parentStoryId === null), {
    message: 'Stories have no parent; subtasks require a parent story',
    path: ['parentStoryId'],
  })
  .refine(dateRangeRefinement.check, { message: dateRangeRefinement.message, path: ['dueDate'] });

export const updateTaskInputSchema = z
  .strictObject(taskFieldsShape)
  .partial()
  .refine(dateRangeRefinement.check, { message: dateRangeRefinement.message, path: ['dueDate'] });

export const taskQuerySchema = z.strictObject({
  projectId: idSchema.nullable(), // null → all projects (SEARCH-04)
  text: z.string().trim().max(500).default(''),
  types: z.array(taskTypeSchema).default([]),
  statusIds: z.array(idSchema).default([]),
  priorities: z.array(prioritySchema).default([]),
  assigneeUserIds: z.array(idSchema.nullable()).default([]),
  labelIds: z.array(idSchema).default([]),
  dueFrom: localDateSchema.nullable().default(null),
  dueTo: localDateSchema.nullable().default(null),
  sortBy: z
    .enum([
      'issueKey',
      'title',
      'priority',
      'status',
      'assignee',
      'createdAt',
      'updatedAt',
      'startDate',
      'dueDate',
      'sortOrder',
    ])
    .default('sortOrder'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  page: pageRequestSchema.default({ offset: 0, limit: 100 }),
});

// --- Data / settings --------------------------------------------------------

export const exportOptionsSchema = z.strictObject({
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('workspace') }),
    z.strictObject({ kind: z.literal('project'), projectId: idSchema }),
  ]),
  includeTrashed: z.boolean().default(false), // D14
});

export const deviceSettingsPatchSchema = z
  .strictObject({
    theme: z.enum(THEMES),
    language: z.enum(LANGUAGES),
    lastProjectId: idSchema.nullable(),
    lastView: z.enum(['board', 'list']),
    autoBackup: z
      .strictObject({
        enabled: z.boolean(),
        intervalHours: z
          .int()
          .min(1)
          .max(24 * 30),
        retention: z.int().min(1).max(100),
      })
      .partial(),
  })
  .partial();

export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;
export type CreateUserInput = z.input<typeof createUserInputSchema>;
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;
export type StatusInput = z.input<typeof statusInputSchema>;
export type StatusPatch = z.input<typeof statusPatchSchema>;
export type LabelInput = z.input<typeof labelInputSchema>;
export type LabelPatch = z.input<typeof labelPatchSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type TaskQuery = z.input<typeof taskQuerySchema>;
export type ExportOptions = z.input<typeof exportOptionsSchema>;
export type DeviceSettingsPatch = z.input<typeof deviceSettingsPatchSchema>;

// Parsed (output) shapes: what main-process services receive after validation.
export type CreateTaskData = z.output<typeof createTaskInputSchema>;
export type UpdateTaskData = z.output<typeof updateTaskInputSchema>;
export type TaskQueryData = z.output<typeof taskQuerySchema>;
export type LabelData = z.output<typeof labelInputSchema>;
export type LabelPatchData = z.output<typeof labelPatchSchema>;
