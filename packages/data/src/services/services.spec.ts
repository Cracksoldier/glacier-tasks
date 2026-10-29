// Integration tests for the project, user and activity services (M2) against a real,
// migrated SQLite database.

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { ActivityService } from './activity.js';
import { createServiceContext, type ServiceContext } from './context.js';
import { ProjectService } from './projects.js';
import { UserService } from './users.js';

let db: Database;
let ctx: ServiceContext;
let projects: ProjectService;
let users: UserService;
let activity: ActivityService;
let tick: number;
let idCounter: number;

const AVATAR = {
  mimeType: 'image/png' as const,
  sha256: 'a'.repeat(64),
  byteSize: 1234,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS, () => '2026-10-29T10:00:00.000Z');
  tick = 0;
  idCounter = 0;
  ctx = createServiceContext(db, {
    // Strictly increasing timestamps make ordering assertions deterministic.
    now: () => new Date(Date.UTC(2026, 9, 29, 10, 0, tick++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  });
  projects = new ProjectService(ctx);
  users = new UserService(ctx);
  activity = new ActivityService(ctx);
});

afterEach(() => db.close());

function eventTypes(entityType: 'PROJECT' | 'USER', id: string): string[] {
  return activity.forEntity(entityType, id).map((event) => event.eventType);
}

describe('ProjectService', () => {
  it('creates a project with normalized key and the default workflow (D32)', () => {
    const project = projects.create({ key: ' alpha ', name: '  Alpha  ' });
    expect(project).toMatchObject({
      key: 'ALPHA',
      name: 'Alpha',
      description: '',
      keyLocked: false,
    });

    const statuses = projects.statuses(project.id);
    expect(statuses.map((s) => [s.name, s.category, s.isDefault, s.position])).toEqual([
      ['To Do', 'TODO', true, 0],
      ['In Progress', 'IN_PROGRESS', false, 1],
      ['Done', 'DONE', false, 2],
    ]);
  });

  it('rejects duplicate keys, case-insensitively and including trashed projects (D08)', () => {
    const alpha = projects.create({ key: 'ALPHA', name: 'Alpha' });
    expect(() => projects.create({ key: 'alpha', name: 'Again' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.projectKeyTaken' }),
    );

    db.prepare(`UPDATE projects SET trashed_at = ? WHERE id = ?`).run(ctx.now(), alpha.id);
    expect(() => projects.create({ key: 'ALPHA', name: 'Again' })).toThrowError(
      expect.objectContaining({ message: 'errors.projectKeyTaken' }),
    );
    // Nothing partial was written by the failed attempts.
    expect(db.prepare(`SELECT count(*) AS n FROM statuses`).get()).toEqual({ n: 3 });
  });

  it('lists live projects by name with zero story counts', () => {
    projects.create({ key: 'ZED', name: 'zeta' });
    const beta = projects.create({ key: 'BETA', name: 'Beta' });
    projects.create({ key: 'ALPHA', name: 'alpha' });
    db.prepare(`UPDATE projects SET trashed_at = ? WHERE id = ?`).run(ctx.now(), beta.id);

    const list = projects.list();
    expect(list.map((p) => p.key)).toEqual(['ALPHA', 'ZED']);
    expect(list[0]).toMatchObject({ openStoryCount: 0, doneStoryCount: 0 });
    expect(projects.isLive(beta.id)).toBe(false);
    expect(() => projects.get(beta.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('counts live stories by status category', () => {
    const project = projects.create({ key: 'ALPHA', name: 'Alpha' });
    const [todo, , done] = projects.statuses(project.id);
    const insert = db.prepare(
      `INSERT INTO tasks (id, project_id, issue_number, type, title, status_id, sort_order, created_at, updated_at, trashed_at)
       VALUES (?, ?, ?, 'STORY', 'Story', ?, 'V', ?, ?, ?)`,
    );
    const now = ctx.now();
    insert.run(ctx.newId(), project.id, 1, todo?.id, now, now, null);
    insert.run(ctx.newId(), project.id, 2, done?.id, now, now, null);
    insert.run(ctx.newId(), project.id, 3, done?.id, now, now, now); // trashed

    expect(projects.list()[0]).toMatchObject({ openStoryCount: 1, doneStoryCount: 1 });
  });

  it('updates fields and records only the actual changes', () => {
    const project = projects.create({ key: 'ALPHA', name: 'Alpha' });
    const updated = projects.update(project.id, {
      key: 'alp',
      name: 'Alpha',
      description: 'Docs',
    });
    expect(updated).toMatchObject({ key: 'ALP', name: 'Alpha', description: 'Docs' });

    projects.update(project.id, { name: 'Alpha' }); // no-op: no event
    const [latest] = activity.forEntity('PROJECT', project.id);
    expect(latest?.payload).toEqual({
      name: 'Alpha',
      changes: { key: { from: 'ALPHA', to: 'ALP' }, description: { from: '', to: 'Docs' } },
    });
    expect(eventTypes('PROJECT', project.id)).toEqual(['project.updated', 'project.created']);
  });

  it('rejects a key change to a taken key and once a task id was issued (D30)', () => {
    projects.create({ key: 'TAKEN', name: 'Other' });
    const project = projects.create({ key: 'ALPHA', name: 'Alpha' });
    expect(() => projects.update(project.id, { key: 'taken' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.projectKeyTaken' }),
    );
    // Keeping the own key is fine.
    expect(projects.update(project.id, { key: 'ALPHA', name: 'Renamed' }).name).toBe('Renamed');

    db.transaction(() => projects.allocateIssueNumber(project.id))();
    expect(projects.get(project.id).keyLocked).toBe(true);
    expect(() => projects.update(project.id, { key: 'NEW' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.projectKeyLocked' }),
    );
    expect(projects.update(project.id, { name: 'Still editable' }).name).toBe('Still editable');
  });

  it('allocates monotonic issue numbers per project inside a transaction (I03)', () => {
    const alpha = projects.create({ key: 'ALPHA', name: 'Alpha' });
    const beta = projects.create({ key: 'BETA', name: 'Beta' });
    const allocate = db.transaction((id: string) => projects.allocateIssueNumber(id));

    expect([allocate(alpha.id), allocate(alpha.id), allocate(beta.id), allocate(alpha.id)]).toEqual(
      [1, 2, 1, 3],
    );
    // A rolled-back allocation does not consume a number that was never committed…
    expect(() =>
      db.transaction(() => {
        projects.allocateIssueNumber(alpha.id);
        throw new Error('rollback');
      })(),
    ).toThrow('rollback');
    expect(allocate(alpha.id)).toBe(4);
    // …and the allocator refuses to run outside a transaction.
    expect(() => projects.allocateIssueNumber(alpha.id)).toThrow(/inside a transaction/);
  });

  it('records a creation event with the seeded statuses (D12)', () => {
    const project = projects.create({ key: 'ALPHA', name: 'Alpha', description: 'D' });
    const page = activity.forProject(project.id);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      entityType: 'PROJECT',
      entityId: project.id,
      projectId: project.id,
      eventType: 'project.created',
      source: 'UI',
      payload: { key: 'ALPHA', name: 'Alpha', description: 'D' },
    });
    expect((page.items[0]?.payload['statuses'] as unknown[]).length).toBe(3);
  });

  it('pages project activity newest first', () => {
    const project = projects.create({ key: 'ALPHA', name: 'A' });
    for (const name of ['B', 'C', 'D']) projects.update(project.id, { name });
    const page = activity.forProject(project.id, { offset: 1, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.items.map((e) => e.payload['name'])).toEqual(['C', 'B']);
  });
});

describe('UserService', () => {
  it('creates global profiles that are independent of projects', () => {
    projects.create({ key: 'ALPHA', name: 'Alpha' });
    projects.create({ key: 'BETA', name: 'Beta' });
    users.create({ name: '  Zoe  ' });
    users.create({ name: 'anna' });
    users.create({ name: 'Anna' }); // names need not be unique

    expect(users.list().map((u) => u.name)).toEqual(['anna', 'Anna', 'Zoe']);
  });

  it('renames with a before/after event and ignores no-op renames', () => {
    const user = users.create({ name: 'Ann' });
    expect(users.update(user.id, { name: 'Anna ' }).name).toBe('Anna');
    users.update(user.id, { name: 'Anna' });
    const [latest] = activity.forEntity('USER', user.id);
    expect(latest).toMatchObject({
      projectId: null,
      payload: { name: 'Anna', changes: { name: { from: 'Ann', to: 'Anna' } } },
    });
    expect(eventTypes('USER', user.id)).toEqual(['user.updated', 'user.created']);
  });

  it('archives and unarchives without deleting (D29)', () => {
    const user = users.create({ name: 'Ann' });
    users.archive(user.id);
    expect(users.list()).toEqual([]);
    expect(users.list(true)[0]?.archivedAt).not.toBeNull();
    expect(() => users.archive(user.id)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT', message: 'errors.userAlreadyArchived' }),
    );

    // Archived profiles can still be renamed.
    users.update(user.id, { name: 'Anna' });
    users.unarchive(user.id);
    expect(users.list().map((u) => u.name)).toEqual(['Anna']);
    expect(() => users.unarchive(user.id)).toThrowError(
      expect.objectContaining({ message: 'errors.userNotArchived' }),
    );
    expect(eventTypes('USER', user.id)).toEqual([
      'user.unarchived',
      'user.updated',
      'user.archived',
      'user.created',
    ]);
  });

  it('replaces avatars and reports the storage key to delete (D24)', () => {
    const user = users.create({ name: 'Ann' });
    const first = users.setAvatar(user.id, { ...AVATAR, storageKey: 'key-1' });
    expect(first.replacedStorageKey).toBeNull();
    expect(first.user.avatarFileId).not.toBeNull();

    const second = users.setAvatar(user.id, { ...AVATAR, storageKey: 'key-2' });
    expect(second.replacedStorageKey).toBe('key-1');
    expect(users.avatarStorageKeys()).toEqual(['key-2']);
    expect(users.findAvatarFile(second.user.avatarFileId as string)).toEqual({
      storageKey: 'key-2',
      mimeType: 'image/png',
    });

    const cleared = users.clearAvatar(user.id);
    expect(cleared).toMatchObject({ replacedStorageKey: 'key-2', user: { avatarFileId: null } });
    expect(users.avatarStorageKeys()).toEqual([]);
    // Clearing again is a no-op without an event.
    expect(users.clearAvatar(user.id).replacedStorageKey).toBeNull();

    const avatarEvents = activity
      .forEntity('USER', user.id)
      .filter((e) => e.eventType === 'user.avatarChanged');
    expect(avatarEvents.map((e) => [e.payload['from'] !== null, e.payload['to'] !== null])).toEqual(
      [
        [true, false],
        [true, true],
        [false, true],
      ],
    );
  });

  it('rolls back the avatar row when the storage key is already used', () => {
    const ann = users.create({ name: 'Ann' });
    const bob = users.create({ name: 'Bob' });
    users.setAvatar(ann.id, { ...AVATAR, storageKey: 'shared' });
    expect(() => users.setAvatar(bob.id, { ...AVATAR, storageKey: 'shared' })).toThrow();
    expect(users.get(bob.id).avatarFileId).toBeNull();
    expect(eventTypes('USER', bob.id)).toEqual(['user.created']);
  });

  it('reports unknown profiles as NOT_FOUND', () => {
    const missing = '00000000-0000-4000-8000-999999999999';
    for (const call of [
      () => users.get(missing),
      () => users.update(missing, { name: 'X' }),
      () => users.archive(missing),
      () => users.clearAvatar(missing),
    ]) {
      expect(call).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND', message: 'errors.userNotFound' }),
      );
    }
  });

  it('keeps activity events immutable', () => {
    const user = users.create({ name: 'Ann' });
    expect(() =>
      db.prepare(`UPDATE activity_events SET event_type = 'x' WHERE entity_id = ?`).run(user.id),
    ).toThrow(/append-only/);
  });
});
