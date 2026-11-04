// Story export/import file (DATA-11, D58, ADR 0014): one story with its live subtasks as
// JSON. Statuses, labels and assignees are carried by name so the story can be imported
// into another project or workspace; attachments are never part of the file.

import { z } from 'zod';
import { isDateRangeValid } from './invariants.js';
import { MIB, TITLE_MAX_LENGTH, USER_NAME_MAX_LENGTH } from './limits.js';
import {
  idSchema,
  labelColorSchema,
  labelInputSchema,
  localDateSchema,
  prioritySchema,
  statusInputSchema,
  taskFieldsShape,
} from './schemas.js';

export const STORY_EXPORT_FORMAT = 'glacier-tasks-story';
export const STORY_EXPORT_FORMAT_VERSION = 1;
export const STORY_EXPORT_EXTENSION = 'story.json';
/** The import reads at most this many bytes (threat model T15, ADR 0014). */
export const STORY_IMPORT_MAX_BYTES = 10 * MIB;
export const STORY_IMPORT_MAX_SUBTASKS = 500;

/** `attachment:<uuid>` references in a description; they don't survive an import (D58). */
export const ATTACHMENT_REF_PATTERN = /attachment:[0-9a-f]{8}-[0-9a-f]{4}-/i;

const transferTaskShape = {
  issueKey: z.string().max(32),
  title: taskFieldsShape.title,
  descriptionMarkdown: taskFieldsShape.descriptionMarkdown,
  priority: prioritySchema,
  /** Refers to an entry of `statuses`. */
  statusId: idSchema,
  /** Refers to an entry of `assignees`. */
  assigneeId: idSchema.nullable(),
  startDate: localDateSchema.nullable(),
  dueDate: localDateSchema.nullable(),
  /** Label names; each refers to an entry of `labels` (case-insensitive). */
  labels: z.array(labelInputSchema.shape.name).max(100),
};

const dateRange = (task: { startDate: string | null; dueDate: string | null }) =>
  isDateRangeValid(task.startDate, task.dueDate);

const transferTaskSchema = z
  .strictObject(transferTaskShape)
  .refine(dateRange, { message: 'Start date must not be after due date', path: ['dueDate'] });

export const storyTransferSchema = z
  .strictObject({
    format: z.literal(STORY_EXPORT_FORMAT),
    formatVersion: z.literal(STORY_EXPORT_FORMAT_VERSION),
    exportedAt: z.iso.datetime(),
    appVersion: z.string().max(64),
    source: z.strictObject({
      projectKey: z.string().max(32),
      projectName: z.string().max(TITLE_MAX_LENGTH),
    }),
    statuses: z
      .array(z.strictObject({ id: idSchema, ...statusInputSchema.shape }))
      .min(1)
      .max(100),
    labels: z
      .array(
        z.strictObject({ name: labelInputSchema.shape.name, color: labelColorSchema.nullable() }),
      )
      .max(1000),
    assignees: z
      .array(
        z.strictObject({ id: idSchema, name: z.string().trim().min(1).max(USER_NAME_MAX_LENGTH) }),
      )
      .max(STORY_IMPORT_MAX_SUBTASKS + 1),
    story: z
      .strictObject({
        ...transferTaskShape,
        subtasks: z.array(transferTaskSchema).max(STORY_IMPORT_MAX_SUBTASKS),
      })
      .refine(dateRange, { message: 'Start date must not be after due date', path: ['dueDate'] }),
  })
  .superRefine((doc, ctx) => {
    const statusIds = new Set(doc.statuses.map((s) => s.id));
    const assigneeIds = new Set(doc.assignees.map((a) => a.id));
    const labelNames = new Set(doc.labels.map((l) => l.name.toLocaleLowerCase()));
    if (labelNames.size !== doc.labels.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate label', path: ['labels'] });
    }
    const tasks = [doc.story, ...doc.story.subtasks];
    tasks.forEach((task, index) => {
      const path = index === 0 ? ['story'] : ['story', 'subtasks', index - 1];
      if (!statusIds.has(task.statusId)) {
        ctx.addIssue({ code: 'custom', message: 'Unknown status', path: [...path, 'statusId'] });
      }
      if (task.assigneeId !== null && !assigneeIds.has(task.assigneeId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown assignee',
          path: [...path, 'assigneeId'],
        });
      }
      if (task.labels.some((name) => !labelNames.has(name.toLocaleLowerCase()))) {
        ctx.addIssue({ code: 'custom', message: 'Unknown label', path: [...path, 'labels'] });
      }
    });
  });

export type StoryTransfer = z.output<typeof storyTransferSchema>;
export type StoryTransferTask = Omit<StoryTransfer['story'], 'subtasks'>;

/** Confirms a previewed import (DATA-11): status mapping and one assignee for all tasks. */
export const storyImportInputSchema = z.strictObject({
  token: idSchema,
  projectId: idSchema,
  /** Source status id → status of the target project; every source status must be mapped. */
  statusMap: z
    .record(idSchema, idSchema)
    .refine((map) => Object.keys(map).length <= STORY_IMPORT_MAX_SUBTASKS + 1, 'Too many statuses'),
  assigneeUserId: idSchema.nullable(),
});

export type StoryImportInput = z.input<typeof storyImportInputSchema>;
export type StoryImportData = z.output<typeof storyImportInputSchema>;
