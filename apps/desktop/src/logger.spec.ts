import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-logs-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createLogger', () => {
  it('writes JSON lines with serialized errors', () => {
    const logger = createLogger(dir, { now: () => new Date('2026-10-29T10:00:00Z') });
    logger.error('workspace could not be opened', { code: 'IO', error: new Error('boom') });
    const entry = JSON.parse(readFileSync(join(dir, 'main.log'), 'utf-8').trim());
    expect(entry).toMatchObject({
      ts: '2026-10-29T10:00:00.000Z',
      level: 'error',
      message: 'workspace could not be opened',
      code: 'IO',
      error: { name: 'Error', message: 'boom' },
    });
  });

  it('rotates by size and keeps a bounded number of files', () => {
    const logger = createLogger(dir, { maxBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 50; i++) logger.info(`entry ${i}`, { padding: 'x'.repeat(50) });
    expect(readdirSync(dir).sort()).toEqual(['main.log', 'main.log.1', 'main.log.2']);
    expect(readFileSync(join(dir, 'main.log'), 'utf-8')).toContain('entry 49');
  });
});
