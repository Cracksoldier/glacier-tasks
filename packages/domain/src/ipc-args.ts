// Argument schemas for every IPC channel (ADR 0004). The main process parses each
// invocation's argument list with the tuple schema of its channel before calling a handler.

import { z } from 'zod';
import type { IpcChannel } from './api.js';
import {
  createProjectInputSchema,
  createTaskInputSchema,
  createUserInputSchema,
  deviceSettingsPatchSchema,
  entityTypeSchema,
  exportOptionsSchema,
  idSchema,
  pageRequestSchema,
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

  'tasks:query': z.tuple([taskQuerySchema]),
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

  'workflows:list': byId,
  'workflows:create': z.tuple([idSchema, statusInputSchema]),
  'workflows:update': z.tuple([idSchema, statusPatchSchema]),
  'workflows:removeAndMigrate': z.tuple([idSchema, idSchema]),

  'attachments:add': byId,
  'attachments:list': byId,
  'attachments:open': byId,
  'attachments:saveAs': byId,
  'attachments:remove': byId,

  'data:backup': none,
  'data:restore': none,
  'data:exportJson': z.tuple([exportOptionsSchema]),

  'settings:getDevice': none,
  'settings:updateDevice': z.tuple([deviceSettingsPatchSchema]),
  'settings:chooseAutoBackupFolder': none,
} as const satisfies Record<IpcChannel, z.ZodTuple>;

export type IpcArgs<C extends IpcChannel> = z.output<(typeof IPC_ARGS)[C]>;
