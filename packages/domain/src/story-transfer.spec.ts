import { describe, expect, it } from 'vitest';
import {
  STORY_EXPORT_FORMAT,
  STORY_IMPORT_MAX_SUBTASKS,
  storyImportInputSchema,
  storyTransferSchema,
} from './story-transfer.js';

const TODO = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
const ADA = '5d2c8f1a-3b4e-4c6d-8e9f-0a1b2c3d4e5f';

const task = {
  issueKey: 'GAME-2',
  title: 'Form',
  descriptionMarkdown: '',
  priority: 'MEDIUM',
  statusId: TODO,
  assigneeId: null,
  startDate: null,
  dueDate: null,
  labels: [],
};

function doc(overrides: Record<string, unknown> = {}, story: Record<string, unknown> = {}) {
  return {
    format: STORY_EXPORT_FORMAT,
    formatVersion: 1,
    exportedAt: '2026-11-04T10:00:00.000Z',
    appVersion: '1.0.2',
    source: { projectKey: 'GAME', projectName: 'Game' },
    statuses: [{ id: TODO, name: 'To Do', category: 'TODO' }],
    labels: [{ name: 'UI', color: 'blue' }],
    assignees: [{ id: ADA, name: 'Ada' }],
    story: {
      ...task,
      issueKey: 'GAME-1',
      title: 'Login',
      assigneeId: ADA,
      labels: ['ui'],
      subtasks: [task],
      ...story,
    },
    ...overrides,
  };
}

describe('storyTransferSchema', () => {
  it('accepts an exported story', () => {
    expect(storyTransferSchema.safeParse(doc()).success).toBe(true);
  });

  it('rejects other formats, e.g. the workspace export', () => {
    expect(storyTransferSchema.safeParse(doc({ format: 'glacier-tasks-export' })).success).toBe(
      false,
    );
    expect(storyTransferSchema.safeParse(doc({ formatVersion: 2 })).success).toBe(false);
    expect(storyTransferSchema.safeParse(doc({ extra: true })).success).toBe(false);
  });

  it('rejects references to unknown statuses, assignees and labels', () => {
    const other = '7c1e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
    expect(storyTransferSchema.safeParse(doc({}, { statusId: other })).success).toBe(false);
    expect(storyTransferSchema.safeParse(doc({}, { assigneeId: other })).success).toBe(false);
    expect(storyTransferSchema.safeParse(doc({}, { labels: ['Backend'] })).success).toBe(false);
    expect(
      storyTransferSchema.safeParse(doc({}, { subtasks: [{ ...task, statusId: other }] })).success,
    ).toBe(false);
  });

  it('rejects invalid fields and date ranges', () => {
    expect(storyTransferSchema.safeParse(doc({}, { title: ' ' })).success).toBe(false);
    expect(storyTransferSchema.safeParse(doc({}, { priority: 'URGENT' })).success).toBe(false);
    expect(
      storyTransferSchema.safeParse(doc({}, { startDate: '2026-11-10', dueDate: '2026-11-01' }))
        .success,
    ).toBe(false);
    expect(
      storyTransferSchema.safeParse(
        doc({}, { subtasks: [{ ...task, startDate: '2026-11-10', dueDate: '2026-11-01' }] }),
      ).success,
    ).toBe(false);
  });

  it('limits the number of subtasks', () => {
    const subtasks = Array.from({ length: STORY_IMPORT_MAX_SUBTASKS + 1 }, () => task);
    expect(storyTransferSchema.safeParse(doc({}, { subtasks })).success).toBe(false);
  });
});

describe('storyImportInputSchema', () => {
  it('accepts only ids in the status map', () => {
    const base = { token: TODO, projectId: ADA, assigneeUserId: null };
    expect(storyImportInputSchema.safeParse({ ...base, statusMap: { [TODO]: ADA } }).success).toBe(
      true,
    );
    expect(storyImportInputSchema.safeParse({ ...base, statusMap: { x: ADA } }).success).toBe(
      false,
    );
    const huge = Object.fromEntries(
      Array.from({ length: STORY_IMPORT_MAX_SUBTASKS + 2 }, (_, i) => [
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ADA,
      ]),
    );
    expect(storyImportInputSchema.safeParse({ ...base, statusMap: huge }).success).toBe(false);
  });
});
