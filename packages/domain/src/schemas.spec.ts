import { describe, expect, it } from 'vitest';
import { allIpcChannels, ipcChannel } from './api.js';
import {
  createProjectInputSchema,
  createTaskInputSchema,
  exportOptionsSchema,
  labelInputSchema,
  labelPatchSchema,
  updateTaskInputSchema,
} from './schemas.js';

const PROJECT_ID = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
const STORY_ID = '5d2c8f1a-3b4e-4c6d-8e9f-0a1b2c3d4e5f';

describe('createProjectInputSchema', () => {
  it('normalizes the key and applies defaults', () => {
    expect(createProjectInputSchema.parse({ key: ' game ', name: ' Game Dev ' })).toEqual({
      key: 'GAME',
      name: 'Game Dev',
      description: '',
    });
  });

  it('rejects invalid keys and unknown fields', () => {
    expect(createProjectInputSchema.safeParse({ key: 'G', name: 'x' }).success).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ key: 'GAME', name: 'x', extra: true }).success,
    ).toBe(false);
  });
});

describe('createTaskInputSchema', () => {
  it('creates a story with defaults (TASK-04)', () => {
    const parsed = createTaskInputSchema.parse({
      projectId: PROJECT_ID,
      type: 'STORY',
      title: 'Implement inventory',
    });
    expect(parsed).toMatchObject({
      parentStoryId: null,
      priority: 'MEDIUM',
      assigneeUserId: null,
      labelIds: [],
      descriptionMarkdown: '',
    });
    expect(parsed.statusId).toBeUndefined();
  });

  it('requires a parent for subtasks and forbids one for stories', () => {
    expect(
      createTaskInputSchema.safeParse({ projectId: PROJECT_ID, type: 'SUBTASK', title: 'x' })
        .success,
    ).toBe(false);
    expect(
      createTaskInputSchema.safeParse({
        projectId: PROJECT_ID,
        type: 'STORY',
        parentStoryId: STORY_ID,
        title: 'x',
      }).success,
    ).toBe(false);
    expect(
      createTaskInputSchema.safeParse({
        projectId: PROJECT_ID,
        type: 'SUBTASK',
        parentStoryId: STORY_ID,
        title: 'x',
      }).success,
    ).toBe(true);
  });

  it('rejects inverted date ranges and impossible dates', () => {
    const base = { projectId: PROJECT_ID, type: 'STORY', title: 'x' };
    expect(
      createTaskInputSchema.safeParse({ ...base, startDate: '2026-11-02', dueDate: '2026-11-01' })
        .success,
    ).toBe(false);
    expect(createTaskInputSchema.safeParse({ ...base, dueDate: '2026-02-30' }).success).toBe(false);
  });

  it('rejects blank titles and non-UUID references', () => {
    expect(
      createTaskInputSchema.safeParse({ projectId: PROJECT_ID, type: 'STORY', title: '  ' })
        .success,
    ).toBe(false);
    expect(
      createTaskInputSchema.safeParse({ projectId: '../etc', type: 'STORY', title: 'x' }).success,
    ).toBe(false);
  });
});

describe('updateTaskInputSchema', () => {
  it('accepts partial patches and validates date ranges inside the patch', () => {
    expect(updateTaskInputSchema.safeParse({ priority: 'HIGH' }).success).toBe(true);
    expect(
      updateTaskInputSchema.safeParse({ startDate: '2026-12-01', dueDate: '2026-11-01' }).success,
    ).toBe(false);
  });
});

describe('exportOptionsSchema (D14)', () => {
  it('excludes trashed items by default', () => {
    expect(exportOptionsSchema.parse({ scope: { kind: 'workspace' } })).toEqual({
      scope: { kind: 'workspace' },
      includeTrashed: false,
    });
  });
});

describe('IPC channels', () => {
  it('are unique and follow group:method', () => {
    const channels = allIpcChannels();
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toContain(ipcChannel('tasks', 'moveToStory'));
    for (const channel of channels) expect(channel).toMatch(/^[a-z]+:[A-Za-z]+$/);
  });
});

describe('label schemas (D25)', () => {
  it('accepts palette colors only', () => {
    expect(labelInputSchema.parse({ name: ' Bug ' })).toEqual({ name: 'Bug', color: null });
    expect(labelInputSchema.safeParse({ name: 'Bug', color: 'red' }).success).toBe(true);
    expect(labelInputSchema.safeParse({ name: 'Bug', color: '#ff0000' }).success).toBe(false);
    expect(labelPatchSchema.safeParse({ color: null }).success).toBe(true);
    expect(labelPatchSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
