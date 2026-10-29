// IPC dispatch (ADR 0004): sender check → argument validation → handler → Result<T>.
// Free of Electron imports so it can be unit-tested; `main.ts` wires it to ipcMain.

import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import {
  AppError,
  type AppErrorInfo,
  type GlacierTasksAPI,
  IPC_ARGS,
  type IpcArgs,
  type IpcChannel,
  isAppError,
  type Result,
} from '@glacier-tasks/domain';
import type { Logger } from './logger.js';

type ApiGroup = keyof GlacierTasksAPI;
type ChannelOf<G extends ApiGroup, M> = `${G}:${M & string}` extends IpcChannel
  ? `${G}:${M & string}`
  : never;
type HandlerResult<F> = F extends (...args: never[]) => infer R ? R | Awaited<R> : never;

/** Handlers mirror GlacierTasksAPI and receive the *validated* arguments. */
export type IpcHandlers = {
  [G in ApiGroup]?: {
    [M in keyof GlacierTasksAPI[G]]?: (
      ...args: IpcArgs<ChannelOf<G, M>>
    ) => HandlerResult<GlacierTasksAPI[G][M]>;
  };
};

export interface DispatcherOptions {
  handlers: IpcHandlers;
  isTrustedSender: (url: string) => boolean;
  logger: Logger;
}

export type Dispatcher = (
  channel: IpcChannel,
  senderUrl: string,
  args: unknown[],
) => Promise<Result<unknown>>;

function toErrorInfo(error: unknown, channel: IpcChannel, logger: Logger): AppErrorInfo {
  if (isAppError(error)) return error.toInfo();
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION',
      message: 'errors.validation',
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String),
          code: issue.code,
          message: issue.message,
        })),
      },
    };
  }
  // Unexpected: full details stay in the local log; the renderer gets a generic error.
  logger.error('unexpected IPC failure', { channel, error });
  return { code: 'IO', message: 'errors.unexpected' };
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  return async (channel, senderUrl, args) => {
    try {
      if (!options.isTrustedSender(senderUrl)) {
        options.logger.warn('IPC from untrusted sender rejected', { channel });
        throw new AppError('VALIDATION', 'errors.untrustedSender');
      }
      // Validate before looking up the handler: malformed input is rejected uniformly,
      // whether or not the feature is implemented yet.
      const parsed = IPC_ARGS[channel].parse(args) as unknown[];

      const [group, method] = channel.split(':') as [string, string];
      const handler = (
        options.handlers as Record<string, Record<string, (...a: unknown[]) => unknown>>
      )[group]?.[method];
      if (!handler) throw new AppError('IO', 'errors.notAvailable');

      const value = await handler(...parsed);
      return { ok: true, value: value === undefined ? null : value };
    } catch (error) {
      return { ok: false, error: toErrorInfo(error, channel, options.logger) };
    }
  };
}

/**
 * Only the bundled renderer (file:// below `rendererDir`) or, in development, the Angular
 * dev server may call the API.
 */
export function createSenderCheck(options: {
  rendererDir: string;
  devUrl?: string;
}): (url: string) => boolean {
  return (url) => {
    if (options.devUrl) {
      return url === options.devUrl || url.startsWith(`${options.devUrl}/`);
    }
    if (!url.startsWith('file:')) return false;
    try {
      const rel = relative(options.rendererDir, fileURLToPath(url));
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    } catch {
      return false;
    }
  };
}
