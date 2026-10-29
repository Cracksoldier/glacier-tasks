// Integration tests for workflow statuses and board moves (M4).

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CreateTaskData,
  sortKeyBetween,
  taskQuerySchema,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { ActivityService } from './activity.js';
import { createServiceContext, type ServiceContext } from './context.js';
import { ProjectService } from './projects.js';
import { TaskService } from './tasks.js';
import { WorkflowService } from './workflows.js';

let db: Database;
let ctx: ServiceContext;
let projects: ProjectService;
let tasks: TaskService;
let workflows: WorkflowService;
let activity: ActivityService;
let projectId: string;
let todo: WorkflowStatus;
let doing: WorkflowStatus;
let done: WorkflowStatus;

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
  workflows = new WorkflowService(ctx);
  activity = new ActivityService(ctx);
  projectId = projects.create({ key: 'GAME', name: 'Game' }).id;
  [todo, doing, done] = workflows.list(projectId) as [
    WorkflowStatus,
    WorkflowStatus,
    WorkflowStatus,
  ];
});

afterEach(() => db.close());

function task(overrides: Partial<CreateTaskData> = {}) {
  return tasks.create({
    projectId,
    type: 'STORY',
    parentStoryId: null,
    title: 'Story',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    ...overrides,
  });
}

const names = () => workflows.list(projectId).map((s) => s.name);
const statusEvents = (id: string) => activity.forEntity('STATUS', id).map((e) => e.eventType);

describe('workflow statuses (spec §3.4)', () => {
  it('creates statuses at the end with unique names per project', () => {
    const review = workflows.create(projectId, { name: 'Review', category: 'IN_PROGRESS' });
    expect(review).toMatchObject({ position: 3, isDefault: false });
    expect(names()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);
    expect(() => workflows.create(projectId, { name: 'review', category: 'TODO' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.statusNameTaken' }),
    );
    expect(statusEvents(review.id)).toEqual(['status.created']);
  });

  it('renames, recategorizes and keeps history references intact', () => {
    const created = task({ statusId: doing.id });
    workflows.update(doing.id, { name: 'Working', category: 'TODO' });
    expect(workflows.list(projectId)[1]).toMatchObject({ name: 'Working', category: 'TODO' });
    expect(tasks.get(created.id).statusId).toBe(doing.id);
    expect(activity.forEntity('STATUS', doing.id)[0]?.payload).toEqual({
      name: 'Working',
      changes: {
        name: { from: 'In Progress', to: 'Working' },
        category: { from: 'IN_PROGRESS', to: 'TODO' },
      },
    });
  });

  it('keeps exactly one default', () => {
    workflows.update(done.id, { isDefault: true });
    expect(
      workflows
        .list(projectId)
        .filter((s) => s.isDefault)
        .map((s) => s.id),
    ).toEqual([done.id]);
    // New tasks now start in the new default (TASK-04).
    expect(task().statusId).toBe(done.id);
  });

  it('reorders with dense positions and records the move', () => {
    workflows.update(done.id, { position: 0 });
    expect(names()).toEqual(['Done', 'To Do', 'In Progress']);
    expect(workflows.list(projectId).map((s) => s.position)).toEqual([0, 1, 2]);
    workflows.update(done.id, { position: 99 });
    expect(names()).toEqual(['To Do', 'In Progress', 'Done']);
    expect(activity.forEntity('STATUS', done.id)[0]?.payload).toEqual({
      name: 'Done',
      from: 0,
      to: 2,
    });
  });

  it('refuses to recategorize the last DONE status (D07)', () => {
    expect(() => workflows.update(done.id, { category: 'IN_PROGRESS' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.lastDoneStatus' }),
    );
    workflows.create(projectId, { name: 'Shipped', category: 'DONE' });
    expect(workflows.update(done.id, { category: 'IN_PROGRESS' }).category).toBe('IN_PROGRESS');
  });

  it('isolates projects', () => {
    const other = projects.create({ key: 'OTHER', name: 'Other' });
    const [otherTodo] = workflows.list(other.id);
    const story = task();
    expect(() => tasks.move(story.id, 1, otherTodo?.id ?? '')).toThrowError(
      expect.objectContaining({ message: 'errors.crossProjectReference' }),
    );
    expect(() => workflows.removeAndMigrate(todo.id, otherTodo?.id ?? '')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.invalidReplacement' }),
    );
  });
});

describe('remove and migrate (D01, UJ-04)', () => {
  it('moves live and trashed tasks atomically and records it', () => {
    const review = workflows.create(projectId, { name: 'Review', category: 'IN_PROGRESS' });
    const waiting = task({ title: 'already in progress', statusId: doing.id });
    const live = task({ title: 'live', statusId: review.id });
    const sub = tasks.create({ ...baseSubtask(live.id), statusId: review.id });
    const trashed = task({ title: 'trashed', statusId: review.id });
    tasks.trash(trashed.id);

    expect(workflows.usage(review.id)).toEqual({ stories: 1, subtasks: 1, trashed: 1 });
    workflows.removeAndMigrate(review.id, doing.id);

    expect(names()).toEqual(['To Do', 'In Progress', 'Done']);
    expect(tasks.get(live.id)).toMatchObject({ statusId: doing.id, version: 2 });
    expect(tasks.get(sub.id).statusId).toBe(doing.id);
    tasks.restore(trashed.id);
    expect(tasks.get(trashed.id).statusId).toBe(doing.id);
    // Migrated stories are appended after the stories already in the column.
    expect(tasks.get(live.id).sortOrder > waiting.sortOrder).toBe(true);

    expect(activity.forEntity('TASK', live.id)[0]?.payload).toMatchObject({
      cause: 'status.removed',
      changes: { status: { from: { name: 'Review' }, to: { name: 'In Progress' } } },
    });
    expect(activity.forEntity('STATUS', review.id)[0]?.payload).toMatchObject({
      name: 'Review',
      replacement: { name: 'In Progress' },
      defaultReassigned: false,
      migrated: { stories: 1, subtasks: 1, trashed: 1 },
    });
  });

  it('hands the default flag to the replacement', () => {
    workflows.removeAndMigrate(todo.id, doing.id);
    expect(workflows.list(projectId).map((s) => [s.name, s.isDefault, s.position])).toEqual([
      ['In Progress', true, 0],
      ['Done', false, 1],
    ]);
  });

  it('refuses the last DONE status and invalid replacements', () => {
    expect(() => workflows.removeAndMigrate(done.id, todo.id)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.lastDoneStatus' }),
    );
    expect(() => workflows.removeAndMigrate(todo.id, todo.id)).toThrowError(
      expect.objectContaining({ message: 'errors.invalidReplacement' }),
    );
    expect(names()).toEqual(['To Do', 'In Progress', 'Done']);
  });

  it('rolls everything back when a step fails', () => {
    const story = task({ statusId: doing.id });
    const record = vi.spyOn(ctx, 'newId').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => workflows.removeAndMigrate(doing.id, todo.id)).toThrow('disk full');
    record.mockRestore();
    expect(names()).toEqual(['To Do', 'In Progress', 'Done']);
    expect(tasks.get(story.id)).toMatchObject({ statusId: doing.id, version: 1 });
  });
});

describe('board moves (BOARD-04/05, D26)', () => {
  it('puts a story moved to another column at the top and records the change', () => {
    const first = task({ title: 'first', statusId: doing.id });
    const moved = task({ title: 'moved' });
    const sub = tasks.create({ ...baseSubtask(moved.id), statusId: todo.id });
    tasks.move(moved.id, 1, doing.id, 'zzz');

    const column = tasks.query(queryFor([doing.id])).items.map((t) => t.title);
    expect(column).toEqual(['moved', 'first']);
    expect(tasks.get(moved.id).version).toBe(2);
    expect(tasks.get(sub.id).statusId).toBe(todo.id); // TASK-05
    expect(activity.forEntity('TASK', moved.id)[0]?.payload['changes']).toMatchObject({
      status: { from: { name: 'To Do' }, to: { name: 'In Progress' } },
    });
    expect(first.version).toBe(1);
  });

  it('reorders within a column using the given key without a history event', () => {
    const a = task({ title: 'a' });
    const b = task({ title: 'b' });
    tasks.move(b.id, 1, todo.id, sortKeyBetween(null, a.sortOrder));
    expect(tasks.query(queryFor([todo.id])).items.map((t) => t.title)).toEqual(['b', 'a']);
    expect(activity.forEntity('TASK', b.id).map((e) => e.eventType)).toEqual(['task.created']);
  });

  it('keeps sort keys short when many stories are finished into the same column', () => {
    for (let i = 0; i < 2_000; i++) {
      const story = task({ title: `story ${i}` });
      tasks.move(story.id, 1, done.id);
    }
    const column = tasks.query({ ...queryFor([done.id]), page: { offset: 0, limit: 1 } });
    expect(column.items[0]?.title).toBe('story 1999');
    expect(column.items[0]?.sortOrder.length).toBeLessThan(8);
    const longest = db.prepare('SELECT max(length(sort_order)) AS n FROM tasks').get() as {
      n: number;
    };
    expect(longest.n).toBeLessThan(8);
  });

  it('refuses subtasks and stale versions', () => {
    const story = task();
    const sub = tasks.create(baseSubtask(story.id));
    expect(() => tasks.move(sub.id, 1, doing.id)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.moveStoriesOnly' }),
    );
    tasks.move(story.id, 1, doing.id);
    expect(() => tasks.move(story.id, 1, todo.id)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.staleTask' }),
    );
  });
});

function baseSubtask(parentStoryId: string): CreateTaskData {
  return {
    projectId,
    type: 'SUBTASK',
    parentStoryId,
    title: 'Sub',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
  };
}

function queryFor(statusIds: string[]) {
  return taskQuerySchema.parse({ projectId, types: ['STORY'], statusIds });
}
