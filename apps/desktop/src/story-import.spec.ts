import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORY_EXPORT_FORMAT,
  STORY_IMPORT_MAX_SUBTASKS,
  type StoryTransfer,
} from '@glacier-tasks/domain';
import { PendingStoryImport, readStoryFile, serializeStory } from './story-import.js';

const TODO = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';

const doc: StoryTransfer = {
  format: STORY_EXPORT_FORMAT,
  formatVersion: 1,
  exportedAt: '2026-11-04T10:00:00.000Z',
  appVersion: '1.0.2',
  source: { projectKey: 'GAME', projectName: 'Game' },
  statuses: [{ id: TODO, name: 'To Do', category: 'TODO' }],
  labels: [],
  assignees: [],
  story: {
    issueKey: 'GAME-1',
    title: 'Login',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    statusId: TODO,
    assigneeId: null,
    startDate: null,
    dueDate: null,
    labels: [],
    subtasks: [],
  },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-story-import-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('readStoryFile (threat model T15)', () => {
  it('reads a valid story file, also with a byte order mark', () => {
    expect(readStoryFile(file('a.story.json', JSON.stringify(doc)))).toEqual(doc);
    expect(readStoryFile(file('b.story.json', `\uFEFF${JSON.stringify(doc)}`))).toEqual(doc);
  });

  it('rejects files above the size limit before reading them', () => {
    const path = file('big.story.json', JSON.stringify(doc));
    expect(() => readStoryFile(path, 10)).toThrow('errors.importTooLarge');
  });

  it.each([
    ['not JSON', '{'],
    ['another format', JSON.stringify({ ...doc, format: 'glacier-tasks-export' })],
    ['an unknown field', JSON.stringify({ ...doc, script: 'x' })],
    ['an array', '[]'],
  ])('rejects %s', (_case, content) => {
    expect(() => readStoryFile(file('x.json', content))).toThrow('errors.importInvalid');
  });

  it('reports a missing file without its path', () => {
    expect(() => readStoryFile(join(dir, 'missing.json'))).toThrow('errors.importReadFailed');
  });
});

describe('serializeStory', () => {
  it('writes text that the import reads back', () => {
    const text = serializeStory(doc);
    expect(readStoryFile(file('round.story.json', text))).toEqual(doc);
  });

  it('refuses stories the import would reject', () => {
    const subtasks = Array.from({ length: STORY_IMPORT_MAX_SUBTASKS + 1 }, () => ({
      ...doc.story,
      subtasks: undefined,
    })).map(({ subtasks: _, ...task }) => task);
    expect(() => serializeStory({ ...doc, story: { ...doc.story, subtasks } })).toThrow(
      'errors.exportTooLarge',
    );
    expect(() => serializeStory(doc, 100)).toThrow('errors.exportTooLarge');
  });
});

describe('PendingStoryImport', () => {
  it('hands out the previewed file once, by token', () => {
    let n = 0;
    const pending = new PendingStoryImport(() => `token-${++n}`);
    const first = pending.set('/tmp/a.story.json', doc);
    expect(first).toMatchObject({ token: 'token-1', fileName: 'a.story.json' });
    expect(pending.take('token-1').doc).toBe(doc);
    expect(() => pending.take('token-1')).toThrow('errors.importExpired');
  });

  it('replaces an earlier preview', () => {
    let n = 0;
    const pending = new PendingStoryImport(() => `token-${++n}`);
    pending.set('a.json', doc);
    pending.set('b.json', doc);
    expect(() => pending.take('token-1')).toThrow('errors.importExpired');
    expect(pending.take('token-2').fileName).toBe('b.json');
  });

  it('can put a file back after a failed import, unless a newer one is waiting', () => {
    let n = 0;
    const pending = new PendingStoryImport(() => `token-${++n}`);
    pending.set('a.json', doc);
    const taken = pending.take('token-1');
    pending.restore(taken);
    expect(pending.take('token-1')).toBe(taken);
    pending.set('b.json', doc);
    pending.restore(taken);
    expect(pending.take('token-2').fileName).toBe('b.json');
  });
});
