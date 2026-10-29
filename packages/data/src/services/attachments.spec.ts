// Attachment metadata (D03), description versions (D11) and project activity coverage
// (D12, PROJ-06) against a real, migrated database.

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateTaskData } from '@glacier-tasks/domain';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { ActivityService } from './activity.js';
import { AttachmentService, type NewAttachment } from './attachments.js';
import { createServiceContext } from './context.js';
import { LabelService } from './labels.js';
import { ProjectService } from './projects.js';
import { TaskService } from './tasks.js';
import { WorkflowService } from './workflows.js';

let db: Database;
let projects: ProjectService;
let tasks: TaskService;
let attachments: AttachmentService;
let activity: ActivityService;
let labels: LabelService;
let workflows: WorkflowService;
let projectId: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS);
  let tick = 0;
  let idCounter = 0;
  const ctx = createServiceContext(db, {
    now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, tick++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  });
  projects = new ProjectService(ctx);
  tasks = new TaskService(ctx, projects);
  attachments = new AttachmentService(ctx);
  activity = new ActivityService(ctx);
  labels = new LabelService(ctx);
  workflows = new WorkflowService(ctx);
  projectId = projects.create({ key: 'GAME', name: 'Game' }).id;
});

afterEach(() => db.close());

function story(overrides: Partial<CreateTaskData> = {}) {
  return tasks.create({
    projectId,
    type: 'STORY',
    parentStoryId: null,
    title: 'Inventory',
    descriptionMarkdown: 'v1',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    ...overrides,
  });
}

let keyCounter = 0;
function file(overrides: Partial<NewAttachment> = {}): NewAttachment {
  return {
    originalName: 'screenshot.png',
    mimeType: 'image/png',
    byteSize: 1234,
    sha256: 'a'.repeat(64),
    storageKey: `key-${++keyCounter}`,
    ...overrides,
  };
}

describe('attachments (FILE-01/02/05, D03)', () => {
  it('lists live attachments newest first with preview flags', () => {
    const task = story();
    attachments.insert(task.id, file());
    attachments.insert(task.id, file({ originalName: 'notes.txt', mimeType: 'text/plain' }));
    attachments.insert(task.id, file({ originalName: 'logo.svg', mimeType: 'image/svg+xml' }));

    const listed = attachments.list(task.id);
    expect(listed.map((a) => [a.originalName, a.previewable])).toEqual([
      ['logo.svg', false],
      ['notes.txt', false],
      ['screenshot.png', true],
    ]);
    expect(listed[0]).not.toHaveProperty('storageKey');
    expect(tasks.get(task.id).attachments).toEqual(listed);
  });

  it('removes with a tombstone and a history event, returning the storage key', () => {
    const task = story();
    const added = attachments.insert(task.id, file({ storageKey: 'bytes-1' }));
    expect(attachments.remove(added.id)).toBe('bytes-1');

    expect(attachments.list(task.id)).toEqual([]);
    expect(attachments.get(added.id).removedAt).not.toBeNull();
    expect(attachments.storageKeys()).toEqual([]);
    expect(() => attachments.remove(added.id)).toThrowError(
      expect.objectContaining({ message: 'errors.attachmentNotFound' }),
    );
    const events = activity.forEntity('TASK', task.id);
    expect(events.slice(0, 2).map((e) => e.eventType)).toEqual([
      'task.attachmentRemoved',
      'task.attachmentAdded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      issueKey: 'GAME-1',
      attachment: { id: added.id, name: 'screenshot.png', byteSize: 1234 },
    });
  });

  it('keeps the bytes of a trashed task but refuses changes until it is restored', () => {
    const task = story();
    const added = attachments.insert(task.id, file({ storageKey: 'kept' }));
    tasks.trash(task.id);
    expect(attachments.storageKeys()).toEqual(['kept']);
    expect(() => attachments.insert(task.id, file())).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => attachments.remove(added.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => attachments.getLive(added.id)).toThrow();
    tasks.restore(task.id);
    expect(attachments.getLive(added.id).storageKey).toBe('kept');
  });

  it('rejects unknown tasks and attachments', () => {
    expect(() => attachments.list('00000000-0000-4000-8000-000000000999')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => attachments.get('00000000-0000-4000-8000-000000000999')).toThrowError(
      expect.objectContaining({ message: 'errors.attachmentNotFound' }),
    );
  });
});

describe('description versions (AUDIT-04, D11)', () => {
  it('lists every description text newest first, skipping other changes', () => {
    const task = story();
    tasks.update(task.id, 1, { descriptionMarkdown: 'v2' });
    tasks.update(task.id, 2, { title: 'Renamed' });
    tasks.update(task.id, 3, { descriptionMarkdown: 'v3' });
    expect(activity.descriptionVersions(task.id).map((v) => v.markdown)).toEqual([
      'v3',
      'v2',
      'v1',
    ]);
  });
});

describe('project activity (PROJ-06, D12)', () => {
  it('collects project, status, label, task and attachment events of the project', () => {
    const task = story();
    attachments.insert(task.id, file());
    labels.create(projectId, { name: 'Bug', color: 'red' });
    workflows.create(projectId, { name: 'Review', category: 'IN_PROGRESS' });
    projects.update(projectId, { name: 'Game Dev' });
    story({ type: 'SUBTASK', parentStoryId: task.id, title: 'Slots' });
    const types = new Set(activity.forProject(projectId).items.map((e) => e.eventType));
    // The D27 copy on the parent story stays in the story's own history only.
    expect(types).not.toContain('task.subtaskCreated');
    expect(activity.forEntity('TASK', task.id).map((e) => e.eventType)).toContain(
      'task.subtaskCreated',
    );
    for (const type of [
      'project.created',
      'project.updated',
      'status.created',
      'label.created',
      'task.created',
      'task.attachmentAdded',
    ]) {
      expect(types, type).toContain(type);
    }
  });
});
