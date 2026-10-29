// Integration tests for tasks, labels and trash (M3) against a real, migrated database.

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateTaskData, WorkflowStatus } from '@glacier-tasks/domain';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { ActivityService } from './activity.js';
import { createServiceContext, type ServiceContext } from './context.js';
import { LabelService } from './labels.js';
import { ProjectService } from './projects.js';
import { TaskService } from './tasks.js';
import { TrashService } from './trash.js';
import { UserService } from './users.js';

let db: Database;
let ctx: ServiceContext;
let projects: ProjectService;
let tasks: TaskService;
let labels: LabelService;
let users: UserService;
let trash: TrashService;
let activity: ActivityService;
let projectId: string;
let statuses: { todo: WorkflowStatus; doing: WorkflowStatus; done: WorkflowStatus };

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS);
  let tick = 0;
  let idCounter = 0;
  ctx = createServiceContext(db, {
    now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, tick++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  });
  projects = new ProjectService(ctx);
  tasks = new TaskService(ctx, projects);
  labels = new LabelService(ctx);
  users = new UserService(ctx);
  trash = new TrashService(ctx);
  activity = new ActivityService(ctx);
  projectId = projects.create({ key: 'GAME', name: 'Game Dev' }).id;
  const [todo, doing, done] = projects.statuses(projectId) as [
    WorkflowStatus,
    WorkflowStatus,
    WorkflowStatus,
  ];
  statuses = { todo, doing, done };
});

afterEach(() => db.close());

function input(overrides: Partial<CreateTaskData> = {}): CreateTaskData {
  return {
    projectId,
    type: 'STORY',
    parentStoryId: null,
    title: 'Implement inventory',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    ...overrides,
  };
}

const story = (overrides: Partial<CreateTaskData> = {}) => tasks.create(input(overrides));
const subtask = (parentStoryId: string, title = 'Subtask') =>
  tasks.create(input({ type: 'SUBTASK', parentStoryId, title }));

function events(id: string): string[] {
  return activity.forEntity('TASK', id).map((event) => event.eventType);
}

function ftsCount(term: string): number {
  return (
    db.prepare(`SELECT count(*) AS n FROM tasks_fts WHERE tasks_fts MATCH ?`).get(term) as {
      n: number;
    }
  ).n;
}

describe('creating tasks (TASK-01..04, D30)', () => {
  it('creates a story with key, default status and history (UJ-01)', () => {
    const created = story({ descriptionMarkdown: '# Plan' });
    expect(created).toMatchObject({
      issueKey: 'GAME-1',
      issueNumber: 1,
      type: 'STORY',
      statusId: statuses.todo.id,
      priority: 'MEDIUM',
      version: 1,
      subtaskProgress: { done: 0, total: 0 },
      subtasks: [],
      attachments: [],
    });
    expect(activity.forEntity('TASK', created.id)[0]?.payload).toMatchObject({
      issueKey: 'GAME-1',
      descriptionMarkdown: '# Plan',
      status: { name: 'To Do', category: 'TODO' },
    });
    expect(projects.get(projectId).keyLocked).toBe(true);
  });

  it('shares one issue sequence between stories and subtasks', () => {
    const first = story();
    const sub = subtask(first.id);
    const second = story();
    expect([first.issueKey, sub.issueKey, second.issueKey]).toEqual(['GAME-1', 'GAME-2', 'GAME-3']);
  });

  it('orders new stories at the end of their column and subtasks under the parent', () => {
    const a = story({ title: 'A' });
    const b = story({ title: 'B' });
    expect(a.sortOrder < b.sortOrder).toBe(true);
    const s1 = subtask(a.id, 's1');
    const s2 = subtask(a.id, 's2');
    expect(tasks.get(a.id).subtasks.map((s) => s.id)).toEqual([s1.id, s2.id]);
  });

  it('records subtask creation on the parent story (D27)', () => {
    const parent = story();
    subtask(parent.id);
    expect(events(parent.id)).toEqual(['task.subtaskCreated', 'task.created']);
  });

  it('rejects invalid parents: missing, a subtask, trashed or another project (TASK-07)', () => {
    const parent = story();
    const child = subtask(parent.id);
    const other = projects.create({ key: 'OTHER', name: 'Other' });
    const foreign = tasks.create(input({ projectId: other.id }));

    expect(() => subtask('00000000-0000-4000-8000-0000000000ff')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.invalidParent' }),
    );
    expect(() => subtask(child.id)).toThrowError(
      expect.objectContaining({ message: 'errors.invalidParent' }),
    );
    expect(() => subtask(foreign.id)).toThrowError(
      expect.objectContaining({ message: 'errors.crossProjectReference' }),
    );
    tasks.trash(parent.id);
    expect(() => subtask(parent.id)).toThrowError(
      expect.objectContaining({ message: 'errors.invalidParent' }),
    );
  });

  it('rejects statuses and labels of another project (TASK-07)', () => {
    const other = projects.create({ key: 'OTHER', name: 'Other' });
    const [otherStatus] = projects.statuses(other.id);
    const otherLabel = labels.create(other.id, { name: 'Bug', color: 'red' });
    expect(() => story({ statusId: otherStatus?.id })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.crossProjectReference' }),
    );
    expect(() => story({ labelIds: [otherLabel.id] })).toThrowError(
      expect.objectContaining({ message: 'errors.crossProjectReference' }),
    );
    // The failed attempts did not consume issue numbers.
    expect(story().issueKey).toBe('GAME-1');
  });

  it('rejects an archived assignee and an invalid date range', () => {
    const ann = users.create({ name: 'Ann' });
    users.archive(ann.id);
    expect(() => story({ assigneeUserId: ann.id })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.assigneeArchived' }),
    );
    expect(() => story({ startDate: '2026-11-02', dueDate: '2026-11-01' })).toThrowError(
      expect.objectContaining({ message: 'errors.invalidDateRange' }),
    );
  });

  it('rejects tasks in a trashed project', () => {
    projects.trash(projectId);
    expect(() => story()).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('updating tasks (TASK-03, TASK-10, D05)', () => {
  it('applies changes, bumps the version and records only real changes', () => {
    const ann = users.create({ name: 'Ann' });
    const bug = labels.create(projectId, { name: 'Bug', color: 'red' });
    const created = story();
    const updated = tasks.update(created.id, 1, {
      title: 'Inventory v2',
      descriptionMarkdown: 'New text',
      assigneeUserId: ann.id,
      labelIds: [bug.id],
      dueDate: '2026-12-01',
    });
    expect(updated).toMatchObject({
      title: 'Inventory v2',
      descriptionMarkdown: 'New text',
      assigneeUserId: ann.id,
      labelIds: [bug.id],
      dueDate: '2026-12-01',
      version: 2,
    });
    const [latest] = activity.forEntity('TASK', created.id);
    expect(latest?.payload).toEqual({
      issueKey: 'GAME-1',
      title: 'Inventory v2',
      changes: {
        title: { from: 'Implement inventory', to: 'Inventory v2' },
        descriptionMarkdown: { to: 'New text' },
        assignee: { from: null, to: { id: ann.id, name: 'Ann' } },
        dueDate: { from: null, to: '2026-12-01' },
        labels: { added: [{ id: bug.id, name: 'Bug', color: 'red' }], removed: [] },
      },
    });

    // A no-op save changes nothing.
    expect(tasks.update(created.id, 2, { title: 'Inventory v2' }).version).toBe(2);
    expect(events(created.id)).toEqual(['task.updated', 'task.created']);
  });

  it('rejects a stale version and leaves the task unchanged (UJ-09)', () => {
    const created = story();
    tasks.update(created.id, 1, { priority: 'HIGH' });
    expect(() => tasks.update(created.id, 1, { title: 'Overwrite' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.staleTask' }),
    );
    expect(tasks.get(created.id)).toMatchObject({ title: 'Implement inventory', version: 2 });
  });

  it('validates the merged date range', () => {
    const created = story({ startDate: '2026-11-10' });
    expect(() => tasks.update(created.id, 1, { dueDate: '2026-11-01' })).toThrowError(
      expect.objectContaining({ message: 'errors.invalidDateRange' }),
    );
    expect(tasks.update(created.id, 1, { startDate: null, dueDate: '2026-11-01' }).version).toBe(2);
  });

  it('keeps an archived assignee but refuses to assign one anew (I09)', () => {
    const ann = users.create({ name: 'Ann' });
    const bob = users.create({ name: 'Bob' });
    const created = story({ assigneeUserId: ann.id });
    users.archive(ann.id);
    const kept = tasks.update(created.id, 1, { title: 'Renamed', assigneeUserId: ann.id });
    expect(kept).toMatchObject({ assigneeUserId: ann.id, assigneeArchived: true });
    users.archive(bob.id);
    expect(() => tasks.update(created.id, 2, { assigneeUserId: bob.id })).toThrowError(
      expect.objectContaining({ message: 'errors.assigneeArchived' }),
    );
    expect(tasks.update(created.id, 2, { assigneeUserId: null }).assigneeUserId).toBeNull();
  });

  it('moves a story to the top of its new column (D26)', () => {
    const waiting = story({ title: 'waiting', statusId: statuses.doing.id });
    const moved = story({ title: 'moved' });
    const updated = tasks.update(moved.id, 1, { statusId: statuses.doing.id });
    expect(updated.sortOrder < waiting.sortOrder).toBe(true);
    expect(activity.forEntity('TASK', moved.id)[0]?.payload['changes']).toEqual({
      status: {
        from: { id: statuses.todo.id, name: 'To Do', category: 'TODO' },
        to: { id: statuses.doing.id, name: 'In Progress', category: 'IN_PROGRESS' },
      },
    });
  });

  it('never couples story and subtask status (TASK-05, UJ-02)', () => {
    const parent = story();
    const a = subtask(parent.id, 'a');
    const b = subtask(parent.id, 'b');
    tasks.update(a.id, 1, { statusId: statuses.done.id });
    expect(tasks.get(parent.id)).toMatchObject({
      statusId: statuses.todo.id,
      subtaskProgress: { done: 1, total: 2 },
    });
    tasks.update(b.id, 1, { statusId: statuses.done.id });
    expect(tasks.get(parent.id)).toMatchObject({
      statusId: statuses.todo.id,
      version: 1,
      subtaskProgress: { done: 2, total: 2 },
    });

    tasks.update(parent.id, 1, { statusId: statuses.doing.id });
    expect(tasks.get(a.id).statusId).toBe(statuses.done.id);
  });

  it('keeps the search index in sync with title edits', () => {
    const created = story({ title: 'Inventory' });
    tasks.update(created.id, 1, { title: 'Crafting' });
    expect(ftsCount('inventory')).toBe(0);
    expect(ftsCount('crafting')).toBe(1);
  });
});

describe('moving subtasks (D04, D27)', () => {
  it('moves a subtask to another story of the same project, keeping its key', () => {
    const first = story({ title: 'First' });
    const second = story({ title: 'Second' });
    const sub = subtask(first.id);
    tasks.moveToStory(sub.id, 1, second.id);

    expect(tasks.get(sub.id)).toMatchObject({
      parentStoryId: second.id,
      issueKey: sub.issueKey,
      version: 2,
    });
    expect(tasks.get(first.id).subtaskProgress).toEqual({ done: 0, total: 0 });
    expect(tasks.get(second.id).subtasks.map((s) => s.id)).toEqual([sub.id]);
    expect(events(sub.id)[0]).toBe('task.movedToStory');
    expect(events(first.id)[0]).toBe('task.subtaskMovedOut');
    expect(events(second.id)[0]).toBe('task.subtaskMovedIn');
  });

  it('refuses stories, other projects, trashed targets and stale versions', () => {
    const first = story();
    const second = story();
    const sub = subtask(first.id);
    const other = projects.create({ key: 'OTHER', name: 'Other' });
    const foreign = tasks.create(input({ projectId: other.id }));

    expect(() => tasks.moveToStory(first.id, 1, second.id)).toThrowError(
      expect.objectContaining({ message: 'errors.invalidParent' }),
    );
    expect(() => tasks.moveToStory(sub.id, 1, foreign.id)).toThrowError(
      expect.objectContaining({ message: 'errors.crossProjectReference' }),
    );
    expect(() => tasks.moveToStory(sub.id, 7, second.id)).toThrowError(
      expect.objectContaining({ message: 'errors.staleTask' }),
    );
    tasks.trash(second.id);
    expect(() => tasks.moveToStory(sub.id, 1, second.id)).toThrowError(
      expect.objectContaining({ message: 'errors.invalidParent' }),
    );
  });
});

describe('trash and restore (D02, TRASH-02/04/06)', () => {
  it('restores a story with exactly the subtasks it took along (UJ-06)', () => {
    const parent = story();
    const a = subtask(parent.id, 'A');
    const b = subtask(parent.id, 'B');
    tasks.trash(a.id);
    tasks.trash(parent.id);

    expect(tasks.query({ ...queryAll(), types: [] }).items).toEqual([]);
    expect(trash.list().map((item) => [item.kind, item.title])).toEqual([
      ['STORY', 'Implement inventory'],
      ['SUBTASK', 'A'],
    ]);
    expect(() => tasks.get(b.id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => tasks.restore(b.id)).toThrowError(
      expect.objectContaining({ message: 'errors.restoreParentFirst' }),
    );
    expect(() => tasks.restore(a.id)).toThrowError(
      expect.objectContaining({ message: 'errors.restoreParentFirst' }),
    );

    tasks.restore(parent.id);
    expect(tasks.get(parent.id).subtasks.map((s) => s.title)).toEqual(['B']);
    expect(trash.list().map((item) => item.title)).toEqual(['A']);

    tasks.restore(a.id);
    expect(tasks.get(parent.id).subtasks.map((s) => s.title)).toEqual(['A', 'B']);
    expect(events(parent.id).slice(0, 2)).toEqual(['task.subtaskRestored', 'task.restored']);
  });

  it('bumps versions so an open editor cannot overwrite a trashed task', () => {
    const created = story();
    tasks.trash(created.id);
    tasks.restore(created.id);
    expect(() => tasks.update(created.id, 1, { title: 'x' })).toThrowError(
      expect.objectContaining({ message: 'errors.staleTask' }),
    );
  });

  it('refuses double trash and restoring a live task', () => {
    const created = story();
    expect(() => tasks.restore(created.id)).toThrowError(
      expect.objectContaining({ message: 'errors.notTrashed' }),
    );
    tasks.trash(created.id);
    expect(() => tasks.trash(created.id)).toThrowError(
      expect.objectContaining({ message: 'errors.alreadyTrashed' }),
    );
  });

  it('removes trashed tasks from the search index and restores them (SEARCH-03)', () => {
    const created = story({ title: 'Inventory' });
    tasks.trash(created.id);
    expect(ftsCount('inventory')).toBe(0);
    tasks.restore(created.id);
    expect(ftsCount('inventory')).toBe(1);
  });

  it('cascades project trash to live tasks only and restores exactly those', () => {
    const kept = story({ title: 'kept' });
    const early = story({ title: 'early' });
    tasks.trash(early.id);
    projects.trash(projectId);

    expect(projects.isLive(projectId)).toBe(false);
    expect(trash.list().map((item) => [item.kind, item.title])).toEqual([['PROJECT', 'Game Dev']]);
    expect(() => tasks.restore(early.id)).toThrowError(
      expect.objectContaining({ message: 'errors.projectTrashed' }),
    );
    // D08: the key stays reserved while trashed.
    expect(() => projects.create({ key: 'GAME', name: 'Again' })).toThrowError(
      expect.objectContaining({ message: 'errors.projectKeyTaken' }),
    );

    projects.restore(projectId);
    expect(tasks.get(kept.id).trashedAt).toBeNull();
    expect(trash.list().map((item) => item.title)).toEqual(['early']);
    expect(
      activity
        .forEntity('PROJECT', projectId)
        .map((e) => e.eventType)
        .slice(0, 2),
    ).toEqual(['project.restored', 'project.trashed']);
  });
});

describe('labels (D25, D12)', () => {
  it('creates, renames and recolors with unique names per project', () => {
    const bug = labels.create(projectId, { name: 'Bug', color: 'red' });
    expect(() => labels.create(projectId, { name: 'bug', color: null })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.labelNameTaken' }),
    );
    const other = projects.create({ key: 'OTHER', name: 'Other' });
    expect(labels.create(other.id, { name: 'Bug', color: null }).name).toBe('Bug');

    expect(labels.update(bug.id, { name: 'Defect', color: null })).toMatchObject({
      name: 'Defect',
      color: null,
      taskCount: 0,
    });
    expect(labels.list(projectId).map((l) => l.name)).toEqual(['Defect']);
    expect(activity.forEntity('LABEL', bug.id).map((e) => e.eventType)).toEqual([
      'label.updated',
      'label.created',
    ]);
  });

  it('removing a label unlinks it, records task history and bumps versions', () => {
    const bug = labels.create(projectId, { name: 'Bug', color: 'red' });
    const created = story({ labelIds: [bug.id] });
    expect(labels.list(projectId)[0]?.taskCount).toBe(1);

    labels.remove(bug.id);
    expect(tasks.get(created.id)).toMatchObject({ labelIds: [], version: 2 });
    expect(activity.forEntity('TASK', created.id)[0]?.payload).toMatchObject({
      cause: 'label.removed',
      changes: { labels: { added: [], removed: [{ name: 'Bug' }] } },
    });
    expect(activity.forEntity('LABEL', bug.id)[0]?.payload).toMatchObject({
      affectedTasks: [{ issueKey: 'GAME-1' }],
    });
  });
});

describe('bulk unassignment (USER-05)', () => {
  it('clears the assignee on live and trashed tasks', () => {
    const ann = users.create({ name: 'Ann' });
    const live = story({ assigneeUserId: ann.id });
    const trashed = story({ assigneeUserId: ann.id });
    tasks.trash(trashed.id);
    users.archive(ann.id);

    expect(tasks.unassignAll(ann.id)).toEqual({ unassigned: 2 });
    expect(tasks.get(live.id).assigneeUserId).toBeNull();
    tasks.restore(trashed.id);
    expect(tasks.get(trashed.id).assigneeUserId).toBeNull();
    expect(activity.forEntity('USER', ann.id)[0]?.payload).toEqual({ name: 'Ann', count: 2 });
  });
});

describe('query (M3 subset)', () => {
  it('lists live stories in board order and pages', () => {
    const doing = story({ title: 'doing', statusId: statuses.doing.id });
    const todo = story({ title: 'todo' });
    subtask(todo.id);
    const page = tasks.query({ ...queryAll(), types: ['STORY'] });
    expect(page.items.map((t) => t.id)).toEqual([todo.id, doing.id]);
    expect(page.total).toBe(2);
    expect(tasks.query({ ...queryAll(), sortBy: 'issueKey', sortDirection: 'desc' }).total).toBe(3);
    expect(() => tasks.query({ ...queryAll(), text: 'x' })).toThrowError(
      expect.objectContaining({ message: 'errors.notAvailable' }),
    );
  });

  it('refuses the filters and sort orders that M5 adds', () => {
    const unsupported = [
      { priorities: ['HIGH' as const] },
      { assigneeUserIds: [null] },
      { labelIds: ['00000000-0000-4000-8000-000000000999'] },
      { dueFrom: '2026-01-01' },
      { dueTo: '2026-01-01' },
      { sortBy: 'title' as const },
      { projectId: null },
    ];
    for (const overrides of unsupported) {
      expect(
        () => tasks.query({ ...queryAll(), ...overrides }),
        JSON.stringify(overrides),
      ).toThrowError(expect.objectContaining({ message: 'errors.notAvailable' }));
    }
  });
});

function queryAll() {
  return {
    projectId,
    text: '',
    types: [] as Array<'STORY' | 'SUBTASK'>,
    statusIds: [],
    priorities: [],
    assigneeUserIds: [],
    labelIds: [],
    dueFrom: null,
    dueTo: null,
    sortBy: 'sortOrder' as const,
    sortDirection: 'asc' as const,
    page: { offset: 0, limit: 100 },
  };
}
