import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@glacier-tasks/domain';
import { createDispatcher, createSenderCheck, type IpcHandlers } from './ipc.js';
import { silentLogger } from './logger.js';

const TRUSTED = 'trusted';
const ID = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';

function dispatcher(handlers: IpcHandlers, logger = silentLogger) {
  return createDispatcher({ handlers, isTrustedSender: (url) => url === TRUSTED, logger });
}

describe('createDispatcher (ADR 0004)', () => {
  it('passes validated arguments and wraps the value', async () => {
    const value = { version: '1.0.0', schemaVersion: 1, lastRestore: null, restoreFailed: false };
    const info = vi.fn(() => value);
    const result = await dispatcher({ app: { info } })('app:info', TRUSTED, []);
    expect(result).toEqual({ ok: true, value });
    expect(info).toHaveBeenCalledWith();
  });

  it('applies schema defaults before calling the handler', async () => {
    const create = vi.fn(async () => ({}) as never);
    await dispatcher({ projects: { create } })('projects:create', TRUSTED, [
      { key: ' game ', name: 'Game Dev' },
    ]);
    expect(create).toHaveBeenCalledWith({ key: 'GAME', name: 'Game Dev', description: '' });
  });

  it('maps invalid arguments to VALIDATION with field paths and skips the handler', async () => {
    const get = vi.fn();
    const result = await dispatcher({ tasks: { get } })('tasks:get', TRUSTED, ['../secret']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(result.error.details?.['issues']).toEqual([expect.objectContaining({ path: ['0'] })]);
    expect(get).not.toHaveBeenCalled();
  });

  it('passes AppError information through', async () => {
    const get = () => {
      throw new AppError('NOT_FOUND', 'errors.taskNotFound', { id: ID });
    };
    const result = await dispatcher({ tasks: { get } })('tasks:get', TRUSTED, [ID]);
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'errors.taskNotFound', details: { id: ID } },
    });
  });

  it('hides unexpected errors behind a generic IO error and logs them', async () => {
    const error = vi.fn();
    const get = () => {
      throw new Error('SQLITE_IOERR at C:\\Users\\someone\\secret.sqlite');
    };
    const result = await dispatcher({ tasks: { get } }, { ...silentLogger, error })(
      'tasks:get',
      TRUSTED,
      [ID],
    );
    expect(result).toEqual({ ok: false, error: { code: 'IO', message: 'errors.unexpected' } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(error).toHaveBeenCalledOnce();
  });

  it('reports channels without a handler as not available', async () => {
    const result = await dispatcher({})('data:backup', TRUSTED, []);
    expect(result).toEqual({ ok: false, error: { code: 'IO', message: 'errors.notAvailable' } });
  });

  it('rejects untrusted senders before validating or calling anything', async () => {
    const info = vi.fn();
    const result = await dispatcher({ app: { info } })('app:info', 'https://evil.example', []);
    expect(result.ok).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('turns undefined into null so void methods survive structured cloning', async () => {
    const trash = vi.fn(async () => undefined);
    expect(await dispatcher({ tasks: { trash } })('tasks:trash', TRUSTED, [ID])).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe('createSenderCheck', () => {
  const rendererDir = join(process.cwd(), 'dist', 'renderer');
  const fileUrl = (path: string) => pathToFileURL(path).href;

  it('trusts only files inside the bundled renderer', () => {
    const check = createSenderCheck({ rendererDir });
    expect(check(fileUrl(join(rendererDir, 'index.html')))).toBe(true);
    expect(check(`${fileUrl(join(rendererDir, 'index.html'))}#/settings`)).toBe(true);
    expect(check(fileUrl(join(rendererDir, '..', 'main.cjs')))).toBe(false);
    expect(check(fileUrl(join(process.cwd(), 'evil.html')))).toBe(false);
    expect(check('https://example.com/')).toBe(false);
    expect(check('http://localhost:4200/')).toBe(false);
    expect(check('')).toBe(false);
  });

  it('trusts only the dev server in development', () => {
    const check = createSenderCheck({ rendererDir, devUrl: 'http://localhost:4200' });
    expect(check('http://localhost:4200/')).toBe(true);
    expect(check('http://localhost:4200/#/settings')).toBe(true);
    expect(check('http://localhost:42001/')).toBe(false);
    expect(check(fileUrl(join(rendererDir, 'index.html')))).toBe(false);
  });
});
