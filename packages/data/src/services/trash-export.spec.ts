// Permanent deletion (TRASH-05, D49/D50), FTS rebuild (D20) and JSON export (D14).

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CreateTaskData, EXPORT_FORMAT, exportOptionsSchema } from '@glacier-tasks/domain';
import {
  migrate,
  MIGRATIONS,
  openDatabase,
  rebuildSearchIndex,
  workspaceCounts,
} from '../index.js';
import { ActivityService } from './activity.js';
import { AttachmentService } from './attachments.js';
import { createServiceContext, type ServiceContext } from './context.js';
import { exportWorkspace } from './export.js';
import { LabelService } from './labels.js';
import { ProjectService } from './projects.js';
import { TaskService } from './tasks.js';
import { TrashService } from './trash.js';
import { UserService } from './users.js';

let db: Database;
let ctx: ServiceContext;
let projects: ProjectService;
let tasks: TaskService;
let trash: TrashService;
let attachments: AttachmentService;
let activity: ActivityService;
let game: string;
let sound: string;
let keyCounter = 0;

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
  trash = new TrashService(ctx);
  attachments = new AttachmentService(ctx);
  activity = new ActivityService(ctx);
  game = projects.create({ key: 'GAME', name: 'Game' }).id;
  sound = projects.create({ key: 'SND', name: 'Sound' }).id;
});

afterEach(() => db.close());

function task(overrides: Partial<CreateTaskData> = {}) {
  return tasks.create({
    projectId: game,
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

function attach(taskId: string): string {
  const storageKey = `key-${++keyCounter}`;
  attachments.insert(taskId, {
    originalName: 'a.png',
    mimeType: 'image/png',
    byteSize: 1,
    sha256: 'a'.repeat(64),
    storageKey,
  });
  return storageKey;
}

const count = (sql: string, ...params: unknown[]) =>
  (db.prepare(sql).get(...params) as { n: number }).n;

describe('trash list and purge (TRASH-03/05, D49)', () => {
  it('filters the trash by project', () => {
    const a = task({ title: 'A' });
    const b = task({ projectId: sound, title: 'B' });
    tasks.trash(a.id);
    tasks.trash(b.id);
    expect(trash.list(game).map((item) => item.title)).toEqual(['A']);
    expect(
      trash
        .list()
        .map((item) => item.title)
        .sort(),
    ).toEqual(['A', 'B']);
  });

  it('purges a story with all its subtasks, attachments, labels and history', () => {
    const label = new LabelService(ctx).create(game, { name: 'Bug', color: 'red' });
    const story = task({ title: 'Inventory', labelIds: [label.id] });
    const subtask = task({ type: 'SUBTASK', parentStoryId: story.id, title: 'Slots' });
    const loose = task({ type: 'SUBTASK', parentStoryId: story.id, title: 'Loose' });
    const keys = [attach(story.id), attach(subtask.id)];
    const removedKey = attach(loose.id);
    attachments.remove(attachments.list(loose.id)[0]?.id as string);
    tasks.trash(loose.id); // independently trashed before its story
    tasks.trash(story.id);

    expect(trash.purge('STORY', story.id).sort()).toEqual([...keys, removedKey].sort());
    for (const id of [story.id, subtask.id, loose.id]) {
      expect(count(`SELECT count(*) AS n FROM tasks WHERE id = ?`, id)).toBe(0);
      expect(activity.forEntity('TASK', id)).toEqual([]);
    }
    expect(count(`SELECT count(*) AS n FROM attachments`)).toBe(0);
    expect(count(`SELECT count(*) AS n FROM task_labels`)).toBe(0);
    expect(count(`SELECT count(*) AS n FROM tasks_fts`)).toBe(0);
    expect(trash.list()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('purges a project with everything in it and frees its key', () => {
    const story = task();
    const key = attach(story.id);
    const other = task({ projectId: sound, title: 'Keep me' });
    projects.trash(game);

    expect(trash.purge('PROJECT', game)).toEqual([key]);
    expect(count(`SELECT count(*) AS n FROM projects WHERE id = ?`, game)).toBe(0);
    expect(count(`SELECT count(*) AS n FROM statuses WHERE project_id = ?`, game)).toBe(0);
    expect(count(`SELECT count(*) AS n FROM activity_events WHERE project_id = ?`, game)).toBe(0);
    expect(tasks.get(other.id).title).toBe('Keep me');
    expect(projects.create({ key: 'GAME', name: 'New game' }).key).toBe('GAME');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('refuses live items and items trashed only by a cascade', () => {
    const story = task();
    const subtask = task({ type: 'SUBTASK', parentStoryId: story.id });
    expect(() => trash.purge('STORY', story.id)).toThrowError(
      expect.objectContaining({ message: 'errors.notInTrash' }),
    );
    tasks.trash(story.id);
    expect(() => trash.purge('SUBTASK', subtask.id)).toThrowError(
      expect.objectContaining({ message: 'errors.notInTrash' }),
    );
  });

  it('empties the trash of one project or of everything', () => {
    const story = task();
    const loose = task({ type: 'SUBTASK', parentStoryId: story.id });
    tasks.trash(loose.id);
    tasks.trash(story.id);
    const elsewhere = task({ projectId: sound });
    tasks.trash(elsewhere.id);

    expect(trash.empty(game).deleted).toBe(2);
    expect(trash.list().map((item) => item.projectKey)).toEqual(['SND']);
    expect(trash.empty(null).deleted).toBe(1);
    expect(trash.list()).toEqual([]);
  });
});

describe('rebuildSearchIndex (D20)', () => {
  it('restores the index to exactly the live tasks', () => {
    const live = task({ title: 'Inventory slots' });
    const gone = task({ title: 'Trashed slots' });
    tasks.trash(gone.id);
    db.exec(`DELETE FROM tasks_fts`);
    db.exec(
      `INSERT INTO tasks_fts (rowid, issue_key, title, description) VALUES (999, 'X-1', 'stale', '')`,
    );

    rebuildSearchIndex(db);
    const hits = db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'slots'`).all();
    expect(hits).toHaveLength(1);
    expect(count(`SELECT count(*) AS n FROM tasks_fts`)).toBe(1);
    expect(tasks.query({ ...exportQuery(), text: 'inventory' }).items.map((t) => t.id)).toEqual([
      live.id,
    ]);
  });
});

function exportQuery() {
  return {
    projectId: game,
    text: '',
    types: [],
    statusIds: [],
    statusCategories: [],
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

describe('exportWorkspace (DATA-02/03, D14)', () => {
  it('exports metadata and history without bytes, excluding trashed items by default', () => {
    const ann = new UserService(ctx).create({ name: 'Ann' });
    const story = task({ title: 'Inventory', descriptionMarkdown: 'Text', assigneeUserId: ann.id });
    task({ type: 'SUBTASK', parentStoryId: story.id, title: 'Slots' });
    attach(story.id);
    const gone = task({ title: 'Gone' });
    tasks.trash(gone.id);

    const document = exportWorkspace(
      ctx,
      exportOptionsSchema.parse({ scope: { kind: 'workspace' } }),
      '1.0.0',
    );
    expect(document.format).toBe(EXPORT_FORMAT);
    expect(document.notice).toMatch(/NOT a backup/);
    const json = JSON.stringify(document);
    expect(json).not.toContain('storage_key');
    expect(json).not.toContain('key-1'); // no storage keys, no bytes
    const exported = document.projects as Array<{
      key: string;
      stories: Array<Record<string, unknown>>;
    }>;
    const gameExport = exported.find((p) => p.key === 'GAME');
    expect(gameExport?.stories.map((s) => s['title'])).toEqual(['Inventory']);
    expect(gameExport?.stories[0]).toMatchObject({
      issueKey: 'GAME-1',
      descriptionMarkdown: 'Text',
      subtasks: [expect.objectContaining({ title: 'Slots' })],
      attachments: [expect.objectContaining({ name: 'a.png', sha256: 'a'.repeat(64) })],
    });
    expect((gameExport?.stories[0]?.['history'] as unknown[]).length).toBeGreaterThan(0);
    expect(document.users).toEqual([expect.objectContaining({ name: 'Ann', hasAvatar: false })]);
  });

  it('limits the scope to one project and can include trashed items', () => {
    task({ title: 'Live' });
    const gone = task({ title: 'Gone' });
    tasks.trash(gone.id);
    task({ projectId: sound, title: 'Other project' });

    const document = exportWorkspace(
      ctx,
      exportOptionsSchema.parse({
        scope: { kind: 'project', projectId: game },
        includeTrashed: true,
      }),
      '1.0.0',
    );
    const exported = document.projects as Array<{ key: string; stories: Array<{ title: string }> }>;
    expect(exported.map((p) => p.key)).toEqual(['GAME']);
    expect(exported[0]?.stories.map((s) => s.title).sort()).toEqual(['Gone', 'Live']);
    expect(document.users).toEqual([]);
  });

  it('counts rows for the restore preview', () => {
    task();
    expect(workspaceCounts(db)).toMatchObject({ projects: 2, tasks: 1, attachments: 0 });
  });
});
