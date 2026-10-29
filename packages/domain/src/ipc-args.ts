// Argument schemas for every IPC channel (ADR 0004). The main process parses each
// invocation's argument list with the tuple schema of its channel before calling a handler.

import { z } from 'zod';
import type { IpcChannel } from './api.js';
import {
  createProjectInputSchema,
  createTaskInputSchema,
  createUserInputSchema,
  deviceSettingsPatchSchema,
  droppedFilesSchema,
  entityTypeSchema,
  exportOptionsSchema,
  idSchema,
  labelInputSchema,
  labelPatchSchema,
  pageRequestSchema,
  projectViewSchema,
  sortKeySchema,
  statusInputSchema,
  statusPatchSchema,
  taskQuerySchema,
  updateProjectInputSchema,
  updateTaskInputSchema,
  updateUserInputSchema,
  versionSchema,
} from './schemas.js';

const none = z.tuple([]);
const byId = z.tuple([idSchema]);

export const IPC_ARGS = {
  'app:info': none,
  'app:restart': none,

  'projects:list': none,
  'projects:create': z.tuple([createProjectInputSchema]),
  'projects:update': z.tuple([idSchema, updateProjectInputSchema]),
  'projects:trash': byId,
  'projects:restore': byId,

  'users:list': z.tuple([z.boolean().optional()]),
  'users:create': z.tuple([createUserInputSchema]),
  'users:update': z.tuple([idSchema, updateUserInputSchema]),
  'users:archive': byId,
  'users:unarchive': byId,
  'users:chooseAvatar': byId,
  'users:removeAvatar': byId,
  'users:unassignAll': byId,

  'tasks:query': z.tuple([taskQuerySchema]),
  'tasks:list': z.tuple([taskQuerySchema]),
  'tasks:get': byId,
  'tasks:create': z.tuple([createTaskInputSchema]),
  'tasks:update': z.tuple([idSchema, versionSchema, updateTaskInputSchema]),
  'tasks:move': z.tuple([idSchema, versionSchema, idSchema, sortKeySchema.optional()]),
  'tasks:moveToStory': z.tuple([idSchema, versionSchema, idSchema]),
  'tasks:trash': byId,
  'tasks:restore': byId,
  'tasks:descriptionVersions': byId,

  'activity:forEntity': z.tuple([entityTypeSchema, idSchema]),
  'activity:forProject': z.tuple([idSchema, pageRequestSchema.optional()]),

  'labels:list': byId,
  'labels:create': z.tuple([idSchema, labelInputSchema]),
  'labels:update': z.tuple([idSchema, labelPatchSchema]),
  'labels:remove': byId,

  'trash:list': z.tuple([idSchema.nullable().optional()]),
  'trash:purge': z.tuple([z.enum(['PROJECT', 'STORY', 'SUBTASK']), idSchema]),
  'trash:empty': z.tuple([idSchema.nullable()]),

  'workflows:list': byId,
  'workflows:create': z.tuple([idSchema, statusInputSchema]),
  'workflows:update': z.tuple([idSchema, statusPatchSchema]),
  'workflows:usage': byId,
  'workflows:removeAndMigrate': z.tuple([idSchema, idSchema]),

  'attachments:add': byId,
  'attachments:addFiles': z.tuple([idSchema, droppedFilesSchema]),
  'attachments:list': byId,
  'attachments:open': byId,
  'attachments:saveAs': byId,
  'attachments:remove': byId,

  'data:backup': none,
  'data:inspectRestore': none,
  'data:restore': z.tuple([z.string().regex(/^[0-9a-f-]{36}$/)]),
  'data:exportJson': z.tuple([exportOptionsSchema]),

  'settings:getDevice': none,
  'settings:updateDevice': z.tuple([deviceSettingsPatchSchema]),
  'settings:chooseAutoBackupFolder': none,
  'settings:setProjectView': z.tuple([idSchema, projectViewSchema.nullable()]),
} as const satisfies Record<IpcChannel, z.ZodTuple>;

export type IpcArgs<C extends IpcChannel> = z.output<(typeof IPC_ARGS)[C]>;
