// Query and list behaviour (M5, ADR 0010): filters, D09 hierarchy, sorting, paging, trash
// exclusion and full-text search against a real, migrated database.

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CreateTaskData,
  type TaskListRow,
  type TaskQuery,
  taskQuerySchema,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { createServiceContext } from './context.js';
import { LabelService } from './labels.js';
import { ProjectService } from './projects.js';
import { TaskService } from './tasks.js';
import { UserService } from './users.js';

let db: Database;
let projects: ProjectService;
let tasks: TaskService;
let projectId: string;
let otherProjectId: string;
let todo: WorkflowStatus;
let doing: WorkflowStatus;
let done: WorkflowStatus;
let ids: Record<string, string>;
let ann: string;
let bob: string;
let bug: string;

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
  const users = new UserService(ctx);
  const labels = new LabelService(ctx);
  projectId = projects.create({ key: 'GAME', name: 'Game' }).id;
  otherProjectId = projects.create({ key: 'SND', name: 'Sound' }).id;
  [todo, doing, done] = projects.statuses(projectId) as [
    WorkflowStatus,
    WorkflowStatus,
    WorkflowStatus,
  ];
  ann = users.create({ name: 'Ann' }).id;
  bob = users.create({ name: 'Bob' }).id;
  bug = labels.create(projectId, { name: 'Bug', color: 'red' }).id;

  // GAME-1 … GAME-5 and SND-1, in this order.
  ids = {};
  ids['inventory'] = create({
    title: 'Inventory system',
    priority: 'HIGH',
    assigneeUserId: ann,
    labelIds: [bug],
    dueDate: '2026-11-10',
  });
  ids['slots'] = create({
    type: 'SUBTASK',
    parentStoryId: ids['inventory'],
    title: 'Slot grid',
    priority: 'LOW',
  });
  ids['tooltips'] = create({
    type: 'SUBTASK',
    parentStoryId: ids['inventory'],
    title: 'Item tooltips',
    descriptionMarkdown: 'Größe der Kacheln anpassen',
    priority: 'CRITICAL',
    assigneeUserId: bob,
  });
  ids['save'] = create({ title: 'Save game', priority: 'LOW', statusId: doing.id });
  ids['menu'] = create({
    title: 'Main menu',
    assigneeUserId: bob,
    dueDate: '2026-11-01',
    statusId: done.id,
  });
  ids['music'] = tasks.create({ ...base(), projectId: otherProjectId, title: 'Menu music' }).id;
});

afterEach(() => db.close());

function base(): CreateTaskData {
  return {
    projectId,
    type: 'STORY',
    parentStoryId: null,
    title: 'Task',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
  };
}

function create(overrides: Partial<CreateTaskData>): string {
  return tasks.create({ ...base(), ...overrides }).id;
}

const query = (overrides: Partial<TaskQuery> = {}) =>
  taskQuerySchema.parse({ projectId, ...overrides });

/** Rows as `title` or `(title)` for dimmed context, with subtask titles nested. */
function shape(rows: TaskListRow[]): unknown[] {
  return rows.map((row) => {
    const title = row.storyMatches ? row.story.title : `(${row.story.title})`;
    return row.subtasks.length > 0 ? [title, row.subtasks.map((s) => s.title)] : title;
  });
}

const list = (overrides: Partial<TaskQuery> = {}) => shape(tasks.list(query(overrides)).items);

describe('list rows (LIST-01/02, D09)', () => {
  it('shows every live story in board order with all subtasks when nothing is filtered', () => {
    const page = tasks.list(query());
    expect(shape(page.items)).toEqual([
      ['Inventory system', ['Slot grid', 'Item tooltips']],
      'Save game',
      'Main menu',
    ]);
    expect(page.total).toBe(3);
  });

  it('shows a matching subtask beneath its dimmed parent', () => {
    expect(list({ priorities: ['CRITICAL'] })).toEqual([['(Inventory system)', ['Item tooltips']]]);
    expect(list({ priorities: ['HIGH'] })).toEqual(['Inventory system']);
    expect(list({ priorities: ['HIGH', 'CRITICAL'] })).toEqual([
      ['Inventory system', ['Item tooltips']],
    ]);
  });

  it('filters by type', () => {
    expect(list({ types: ['STORY'] })).toEqual(['Inventory system', 'Save game', 'Main menu']);
    expect(list({ types: ['SUBTASK'] })).toEqual([
      ['(Inventory system)', ['Slot grid', 'Item tooltips']],
    ]);
  });

  it('filters by assignee, including unassigned', () => {
    expect(list({ assigneeUserIds: [ann] })).toEqual(['Inventory system']);
    expect(list({ assigneeUserIds: [null] })).toEqual([
      ['(Inventory system)', ['Slot grid']],
      'Save game',
    ]);
    expect(list({ assigneeUserIds: [bob, null], types: ['STORY'] })).toEqual([
      'Save game',
      'Main menu',
    ]);
  });

  it('filters by status, status category, label and due date', () => {
    expect(list({ statusIds: [doing.id, done.id] })).toEqual(['Save game', 'Main menu']);
    expect(list({ statusCategories: ['DONE'] })).toEqual(['Main menu']);
    expect(list({ labelIds: [bug] })).toEqual(['Inventory system']);
    // A due-date bound drops tasks without a due date.
    expect(list({ dueFrom: '2026-11-05' })).toEqual(['Inventory system']);
    expect(list({ dueTo: '2026-11-05' })).toEqual(['Main menu']);
    expect(list({ dueFrom: '2026-11-01', dueTo: '2026-11-10', priorities: ['MEDIUM'] })).toEqual([
      'Main menu',
    ]);
  });

  it('pages by story rows', () => {
    const first = tasks.list(query({ page: { offset: 0, limit: 2 } }));
    expect(first.items.map((row) => row.story.title)).toEqual(['Inventory system', 'Save game']);
    expect(first.total).toBe(3);
    const second = tasks.list(query({ page: { offset: 2, limit: 2 } }));
    expect(second.items.map((row) => row.story.title)).toEqual(['Main menu']);
  });
});

describe('sorting (LIST-03)', () => {
  it('sorts story rows and subtasks within their parent', () => {
    expect(list({ sortBy: 'title' })).toEqual([
      ['Inventory system', ['Item tooltips', 'Slot grid']],
      'Main menu',
      'Save game',
    ]);
    expect(list({ sortBy: 'title', sortDirection: 'desc' })).toEqual([
      'Save game',
      'Main menu',
      ['Inventory system', ['Slot grid', 'Item tooltips']],
    ]);
  });

  it('sorts empty values last in both directions', () => {
    const titles = (overrides: Partial<TaskQuery>) =>
      tasks.list(query({ types: ['STORY'], ...overrides })).items.map((row) => row.story.title);
    expect(titles({ sortBy: 'dueDate' })).toEqual(['Main menu', 'Inventory system', 'Save game']);
    expect(titles({ sortBy: 'dueDate', sortDirection: 'desc' })).toEqual([
      'Inventory system',
      'Main menu',
      'Save game',
    ]);
    expect(titles({ sortBy: 'assignee' })).toEqual(['Inventory system', 'Main menu', 'Save game']);
    expect(titles({ sortBy: 'assignee', sortDirection: 'desc' })).toEqual([
      'Main menu',
      'Inventory system',
      'Save game',
    ]);
  });

  it('sorts by priority, status, issue key and dates deterministically', () => {
    const keys = (overrides: Partial<TaskQuery>) =>
      tasks.list(query({ types: ['STORY'], ...overrides })).items.map((row) => row.story.issueKey);
    expect(keys({ sortBy: 'priority', sortDirection: 'desc' })).toEqual([
      'GAME-1',
      'GAME-5',
      'GAME-4',
    ]);
    expect(keys({ sortBy: 'status', sortDirection: 'desc' })).toEqual([
      'GAME-5',
      'GAME-4',
      'GAME-1',
    ]);
    expect(keys({ sortBy: 'issueKey', sortDirection: 'desc' })).toEqual([
      'GAME-5',
      'GAME-4',
      'GAME-1',
    ]);
    expect(keys({ sortBy: 'createdAt' })).toEqual(['GAME-1', 'GAME-4', 'GAME-5']);
    expect(keys({ sortBy: 'updatedAt', sortDirection: 'desc' })).toEqual([
      'GAME-5',
      'GAME-4',
      'GAME-1',
    ]);
    // Equal start dates (all empty) fall back to the issue number.
    expect(keys({ sortBy: 'startDate', sortDirection: 'desc' })).toEqual([
      'GAME-1',
      'GAME-4',
      'GAME-5',
    ]);
  });

  it('sorts a status across projects by category, then name', () => {
    const page = tasks.list(query({ projectId: null, sortBy: 'status', types: ['STORY'] }));
    expect(page.items.map((row) => row.story.issueKey)).toEqual([
      'GAME-1',
      'SND-1',
      'GAME-4',
      'GAME-5',
    ]);
  });
});

describe('full-text search (SEARCH-02/03)', () => {
  it('finds titles, descriptions and issue keys, including subtasks', () => {
    expect(list({ text: 'tooltip' })).toEqual([['(Inventory system)', ['Item tooltips']]]);
    expect(list({ text: 'kacheln' })).toEqual([['(Inventory system)', ['Item tooltips']]]);
    expect(list({ text: 'GAME-3' })).toEqual([['(Inventory system)', ['Item tooltips']]]);
    expect(list({ text: 'game-4' })).toEqual(['Save game']);
    expect(list({ text: 'inv sys' })).toEqual(['Inventory system']);
  });

  it('ignores diacritics and accepts hostile input', () => {
    expect(list({ text: 'grosse' })).toEqual([]);
    expect(list({ text: 'gro' })).toEqual([['(Inventory system)', ['Item tooltips']]]);
    for (const text of ['a OR "b', 'NEAR(x', '*', 'title:menu', '"', '-', 'AND']) {
      expect(() => tasks.list(query({ text })), text).not.toThrow();
    }
    expect(list({ text: ' " * ' })).toHaveLength(3); // nothing searchable: no text filter
  });

  it('searches all projects and ranks by relevance', () => {
    const page = tasks.list(query({ projectId: null, text: 'menu', sortBy: 'relevance' }));
    expect(page.items.map((row) => row.story.title).sort()).toEqual(['Main menu', 'Menu music']);
    expect(tasks.list(query({ text: 'menu' })).items.map((row) => row.story.title)).toEqual([
      'Main menu',
    ]);
  });

  it('never returns trashed tasks or tasks of trashed projects', () => {
    tasks.trash(ids['slots'] as string);
    tasks.trash(ids['save'] as string);
    expect(list()).toEqual([['Inventory system', ['Item tooltips']], 'Main menu']);
    expect(list({ text: 'slot' })).toEqual([]);

    projects.trash(otherProjectId);
    expect(shape(tasks.list(query({ projectId: null, text: 'menu' })).items)).toEqual([
      'Main menu',
    ]);
    expect(() => tasks.list(query({ projectId: otherProjectId }))).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('keeps the index equal to the live tasks (I20)', () => {
    const liveRows = () =>
      (
        db.prepare('SELECT row_id FROM tasks WHERE trashed_at IS NULL ORDER BY row_id').all() as {
          row_id: number;
        }[]
      ).map((r) => r.row_id);
    const indexed = () =>
      (db.prepare('SELECT rowid FROM tasks_fts ORDER BY rowid').all() as { rowid: number }[]).map(
        (r) => r.rowid,
      );
    tasks.update(ids['save'] as string, 1, { title: 'Save slots' });
    tasks.trash(ids['inventory'] as string);
    expect(indexed()).toEqual(liveRows());
    expect(list({ text: 'slots' })).toEqual(['Save slots']);
    tasks.restore(ids['inventory'] as string);
    expect(indexed()).toEqual(liveRows());
    expect(list({ text: 'slot' })).toEqual([['(Inventory system)', ['Slot grid']], 'Save slots']);
  });
});

describe('flat query (board)', () => {
  it('applies the same filters to a flat result', () => {
    const page = tasks.query(query({ types: ['STORY'], assigneeUserIds: [bob] }));
    expect(page.items.map((t) => t.title)).toEqual(['Main menu']);
    expect(tasks.query(query({ text: 'tooltip' })).items.map((t) => t.title)).toEqual([
      'Item tooltips',
    ]);
  });
});

describe('scale (A14)', () => {
  it('lists and searches 10,000 tasks', () => {
    const insert = db.transaction(() => {
      for (let i = 0; i < 2_000; i++) {
        const story = create({ title: `Story ${i} lorem`, priority: i % 2 ? 'LOW' : 'HIGH' });
        for (let j = 0; j < 4; j++) {
          create({ type: 'SUBTASK', parentStoryId: story, title: `Sub ${i}.${j} ipsum` });
        }
      }
    });
    insert();
    const started = performance.now();
    const page = tasks.list(query({ sortBy: 'title', page: { offset: 0, limit: 100 } }));
    const search = tasks.list(
      query({ text: 'lorem', priorities: ['HIGH'], page: { offset: 0, limit: 100 } }),
    );
    const elapsed = performance.now() - started;
    expect(page.total).toBe(2_003);
    expect(search.total).toBe(1_000);
    console.info(`[scale] list + search over 10,000 tasks: ${elapsed.toFixed(0)} ms`);
  }, 60_000); // seeding 10,000 tasks through the services is slow on CI runners
});
