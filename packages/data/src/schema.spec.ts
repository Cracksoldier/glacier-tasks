// Integration tests for the draft schema (M0): constraints, triggers, FTS, backup API.

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidSortKey } from '@glacier-tasks/domain';
import {
  currentSchemaVersion,
  integrityCheck,
  LATEST_SCHEMA_VERSION,
  migrate,
  MIGRATIONS,
  openDatabase,
  snapshotDatabase,
} from './index.js';

const NOW = '2026-10-29T10:00:00.000Z';

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-tasks-data-'));
  db = openDatabase(join(dir, 'workspace.sqlite'), { wal: true });
  migrate(db, MIGRATIONS, () => NOW);
  issueCounter = 0;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertProject(
  key: string,
  target: Database = db,
): { projectId: string; todo: string; done: string } {
  const projectId = randomUUID();
  target
    .prepare(
      `INSERT INTO projects (id, project_key, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(projectId, key, `${key} project`, NOW, NOW);
  const status = target.prepare(
    `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const todo = randomUUID();
  const done = randomUUID();
  status.run(todo, projectId, 'To Do', 'TODO', 0, 1, NOW, NOW);
  status.run(done, projectId, 'Done', 'DONE', 1, 0, NOW, NOW);
  return { projectId, todo, done };
}

let issueCounter = 0;
function insertTask(
  projectId: string,
  statusId: string,
  fields: {
    type?: 'STORY' | 'SUBTASK';
    parent?: string;
    title?: string;
    description?: string;
  } = {},
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, project_id, issue_number, type, parent_story_id, title,
       description_markdown, status_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'a0', ?, ?)`,
  ).run(
    id,
    projectId,
    ++issueCounter,
    fields.type ?? 'STORY',
    fields.parent ?? null,
    fields.title ?? 'Task',
    fields.description ?? '',
    statusId,
    NOW,
    NOW,
  );
  return id;
}

function search(query: string): number {
  return (
    db.prepare('SELECT count(*) AS c FROM tasks_fts WHERE tasks_fts MATCH ?').get(query) as {
      c: number;
    }
  ).c;
}

describe('migrations', () => {
  it('reaches the latest version and is idempotent', () => {
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(db, MIGRATIONS).applied).toEqual([]);
  });

  it('refuses a database from a newer application version', () => {
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(99, 'future', NOW);
    expect(() => migrate(db, MIGRATIONS)).toThrow(/newer/i);
  });

  it('enables foreign keys on every connection', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('re-keys the fraction-only sort keys of 0001 in their current order (0002)', () => {
    const old = openDatabase(join(dir, 'old.sqlite'), { wal: true });
    try {
      migrate(old, MIGRATIONS.slice(0, 1), () => NOW);
      const { projectId, todo, done } = insertProject('GAME', old);
      const insert = old.prepare(
        `INSERT INTO tasks (id, project_id, issue_number, type, parent_story_id, title, status_id,
           sort_order, created_at, updated_at, trashed_at)
         VALUES (?, ?, ?, ?, ?, 'Task', ?, ?, ?, ?, ?)`,
      );
      let number = 0;
      const add = (
        statusId: string,
        key: string,
        parent: string | null = null,
        trashed = false,
      ) => {
        const id = randomUUID();
        insert.run(
          id,
          projectId,
          ++number,
          parent ? 'SUBTASK' : 'STORY',
          parent,
          statusId,
          key,
          NOW,
          NOW,
          trashed ? NOW : null,
        );
        return id;
      };
      // To Do column in order 0V < V < V (tie, broken by issue number) < zzV, one trashed.
      const story = add(todo, 'V');
      const tie = add(todo, 'V');
      const top = add(todo, '0V', null, true);
      const end = add(todo, 'zzV');
      const sub2 = add(todo, 'k', story);
      const sub1 = add(todo, 'G', story);
      const doneOnly = add(done, '1');

      migrate(old, MIGRATIONS, () => NOW);
      const keys = new Map(
        (
          old.prepare('SELECT id, sort_order AS key FROM tasks').all() as {
            id: string;
            key: string;
          }[]
        ).map((row) => [row.id, row.key]),
      );
      expect([top, story, tie, end].map((id) => keys.get(id))).toEqual([
        'd0000',
        'd0001',
        'd0002',
        'd0003',
      ]);
      expect([sub1, sub2].map((id) => keys.get(id))).toEqual(['d0000', 'd0001']);
      expect(keys.get(doneOnly)).toBe('d0000');
      for (const key of keys.values()) expect(isValidSortKey(key)).toBe(true);
    } finally {
      old.close();
    }
  });
});

describe('projects and statuses', () => {
  it('enforces the project key format (D08) and uniqueness', () => {
    insertProject('GAME');
    expect(() => insertProject('GAME')).toThrow(/UNIQUE/);
    for (const bad of ['G', 'game', '1AB', 'AB-1', 'ABCDEFGHIJK']) {
      expect(() => insertProject(bad), bad).toThrow(/CHECK/);
    }
  });

  it('allows at most one default status per project', () => {
    const { projectId } = insertProject('GAME');
    expect(() =>
      db
        .prepare(
          `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
           VALUES (?, ?, 'Review', 'IN_PROGRESS', 2, 1, ?, ?)`,
        )
        .run(randomUUID(), projectId, NOW, NOW),
    ).toThrow(/UNIQUE/);
  });

  it('refuses to delete a status still referenced by a task, including trashed ones (D01)', () => {
    const { projectId, todo } = insertProject('GAME');
    const task = insertTask(projectId, todo);
    db.prepare('UPDATE tasks SET trashed_at = ? WHERE id = ?').run(NOW, task);
    expect(() => db.prepare('DELETE FROM statuses WHERE id = ?').run(todo)).toThrow(/FOREIGN KEY/);
  });
});

describe('tasks', () => {
  it('rejects a status from another project', () => {
    const game = insertProject('GAME');
    const web = insertProject('WEB');
    expect(() => insertTask(game.projectId, web.todo)).toThrow(/FOREIGN KEY/);
  });

  it('rejects a label from another project', () => {
    const game = insertProject('GAME');
    const web = insertProject('WEB');
    const task = insertTask(game.projectId, game.todo);
    const label = randomUUID();
    db.prepare('INSERT INTO labels (id, project_id, name) VALUES (?, ?, ?)').run(
      label,
      web.projectId,
      'bug',
    );
    expect(() =>
      db
        .prepare('INSERT INTO task_labels (task_id, label_id, project_id) VALUES (?, ?, ?)')
        .run(task, label, game.projectId),
    ).toThrow(/FOREIGN KEY/);
  });

  it('requires subtasks to have a story parent in the same project', () => {
    const game = insertProject('GAME');
    const web = insertProject('WEB');
    const story = insertTask(game.projectId, game.todo);
    const subtask = insertTask(game.projectId, game.todo, { type: 'SUBTASK', parent: story });

    expect(() => insertTask(game.projectId, game.todo, { type: 'SUBTASK' })).toThrow(/CHECK/);
    expect(() =>
      insertTask(game.projectId, game.todo, { type: 'SUBTASK', parent: subtask }),
    ).toThrow(/parent must be a story/);
    expect(() => insertTask(web.projectId, web.todo, { type: 'SUBTASK', parent: story })).toThrow(
      /FOREIGN KEY/,
    );
  });

  it('rejects inverted date ranges', () => {
    const { projectId, todo } = insertProject('GAME');
    const task = insertTask(projectId, todo);
    expect(() =>
      db
        .prepare('UPDATE tasks SET start_date = ?, due_date = ? WHERE id = ?')
        .run('2026-11-02', '2026-11-01', task),
    ).toThrow(/CHECK/);
  });

  it('cascades permanent project deletion to all dependent rows', () => {
    const { projectId, todo } = insertProject('GAME');
    const story = insertTask(projectId, todo, { title: 'Implement inventory' });
    insertTask(projectId, todo, { type: 'SUBTASK', parent: story });
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    for (const table of ['tasks', 'statuses', 'labels', 'task_labels', 'tasks_fts']) {
      expect((db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c).toBe(0);
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('full-text search (SEARCH-02/03)', () => {
  it('indexes title, description and issue key of live tasks', () => {
    const { projectId, todo } = insertProject('GAME');
    insertTask(projectId, todo, { title: 'Implement inventory', description: 'Drag & drop items' });
    expect(search('inventor*')).toBe(1);
    expect(search('drop')).toBe(1);
    expect(search('"GAME 1"')).toBe(1);
  });

  it('follows edits and drops trashed tasks from the index', () => {
    const { projectId, todo } = insertProject('GAME');
    const task = insertTask(projectId, todo, { title: 'Implement inventory' });
    db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('Crafting system', task);
    expect(search('inventory')).toBe(0);
    expect(search('crafting')).toBe(1);

    db.prepare('UPDATE tasks SET trashed_at = ? WHERE id = ?').run(NOW, task);
    expect(search('crafting')).toBe(0);
    db.prepare('UPDATE tasks SET trashed_at = NULL WHERE id = ?').run(task);
    expect(search('crafting')).toBe(1);
  });

  it('matches without diacritics', () => {
    const { projectId, todo } = insertProject('GAME');
    insertTask(projectId, todo, { title: 'Überarbeitung der Benutzeroberfläche' });
    expect(search('uberarbeitung')).toBe(1);
  });
});

describe('activity events', () => {
  it('are append-only and require valid JSON', () => {
    const insert = db.prepare(
      `INSERT INTO activity_events (id, entity_type, entity_id, event_type, occurred_at, payload_json, source)
       VALUES (?, 'USER', ?, 'created', ?, ?, 'UI')`,
    );
    const id = randomUUID();
    insert.run(id, randomUUID(), NOW, '{"name":"Alex"}');
    expect(() =>
      db.prepare('UPDATE activity_events SET event_type = ? WHERE id = ?').run('x', id),
    ).toThrow(/append-only/);
    expect(() => insert.run(randomUUID(), randomUUID(), NOW, 'not json')).toThrow(/CHECK/);
  });
});

describe('backup API (DATA-05)', () => {
  it('produces a consistent, migrated snapshot of a WAL database', async () => {
    const { projectId, todo } = insertProject('GAME');
    insertTask(projectId, todo, { title: 'Implement inventory' });
    const target = join(dir, 'snapshot.sqlite');
    await snapshotDatabase(db, target);

    const copy = openDatabase(target, { readonly: true });
    try {
      expect(integrityCheck(copy)).toBe('ok');
      expect(currentSchemaVersion(copy)).toBe(LATEST_SCHEMA_VERSION);
      expect(
        (
          copy
            .prepare("SELECT count(*) AS c FROM tasks_fts WHERE tasks_fts MATCH 'inventory'")
            .get() as {
            c: number;
          }
        ).c,
      ).toBe(1);
    } finally {
      copy.close();
    }
  });
});
