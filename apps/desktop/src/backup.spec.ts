import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  AttachmentService,
  createServiceContext,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrate,
  openDatabase,
  ProjectService,
  TaskService,
  UserService,
} from '@glacier-tasks/data';
import { taskQuerySchema } from '@glacier-tasks/domain';
import { AttachmentStore } from './attachment-store.js';
import {
  activatePendingRestore,
  createBackup,
  type DataPaths,
  inspectArchive,
  pruneAutomaticBackups,
  requestRestore,
  runAutomaticBackup,
} from './backup.js';
import { silentLogger } from './logger.js';
import { resolveAppPaths } from './paths.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let root: string;
let paths: DataPaths & { root: string };
let db: Database;
let archive: string;

function openLive(): Database {
  const live = openDatabase(paths.workspaceDb, { wal: true });
  migrate(live, MIGRATIONS);
  return live;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'glacier-backup-'));
  paths = resolveAppPaths(join(root, 'data'));
  for (const dir of [paths.root, paths.attachments, paths.avatars, paths.backups]) {
    mkdirSync(dir, { recursive: true });
  }
  db = openLive();
  archive = join(root, 'out.glaciertasks');
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

/** Two projects, a profile with an avatar, stories, a subtask, history and attachments. */
async function seed(): Promise<{ storyId: string; attachmentId: string; userId: string }> {
  const ctx = createServiceContext(db);
  const projects = new ProjectService(ctx);
  const tasks = new TaskService(ctx, projects);
  const users = new UserService(ctx);
  const game = projects.create({ key: 'GAME', name: 'Game' }).id;
  const sound = projects.create({ key: 'SND', name: 'Sound' }).id;
  const ann = users.create({ name: 'Ann' });
  writeFileSync(join(paths.avatars, 'avatar-key'), PNG);
  users.setAvatar(ann.id, {
    storageKey: 'avatar-key',
    mimeType: 'image/png',
    sha256: createHash('sha256').update(PNG).digest('hex'),
    byteSize: PNG.length,
  });
  const base = {
    type: 'STORY' as const,
    parentStoryId: null,
    descriptionMarkdown: '',
    priority: 'MEDIUM' as const,
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
  };
  const story = tasks.create({
    ...base,
    projectId: game,
    title: 'Inventory slots',
    assigneeUserId: ann.id,
  });
  tasks.update(story.id, 1, { descriptionMarkdown: 'Second version' });
  tasks.create({
    ...base,
    projectId: game,
    type: 'SUBTASK',
    parentStoryId: story.id,
    title: 'Tooltip',
  });
  tasks.create({ ...base, projectId: sound, title: 'Menu music' });
  const store = new AttachmentStore({
    dir: paths.attachments,
    openDir: join(root, 'open'),
    attachments: new AttachmentService(ctx),
    logger: silentLogger,
    maxBytes: () => 1024 * 1024,
  });
  const [attachment] = await store.importFiles(story.id, [{ name: 'shot.png', bytes: PNG }]);
  return { storyId: story.id, attachmentId: attachment?.id as string, userId: ann.id };
}

const backup = (target = archive, kind: 'manual' | 'automatic' | 'safety' = 'manual') =>
  createBackup({
    db,
    paths,
    target,
    kind,
    appVersion: '1.0.0',
    schemaVersion: LATEST_SCHEMA_VERSION,
  });

const inspect = (file = archive) =>
  inspectArchive({ file, paths, latestSchemaVersion: LATEST_SCHEMA_VERSION });

/** Writes an archive with arbitrary entries for the validation tests. */
async function writeZip(
  target: string,
  entries: Array<{ name: string; data: Buffer; mode?: number; compress?: boolean }>,
): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(entry.data, entry.name, {
      compress: entry.compress ?? false,
      ...(entry.mode ? { mode: entry.mode } : {}),
    });
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(target));
}

function manifestFor(entries: Array<{ name: string; data: Buffer }>, overrides: object = {}) {
  return Buffer.from(
    JSON.stringify({
      format: 'glacier-tasks-backup',
      formatVersion: 1,
      appVersion: '1.0.0',
      schemaVersion: LATEST_SCHEMA_VERSION,
      createdAt: '2026-10-29T10:00:00.000Z',
      kind: 'manual',
      entries: entries.map((e) => ({
        path: e.name,
        size: e.data.length,
        sha256: createHash('sha256').update(e.data).digest('hex'),
      })),
      ...overrides,
    }),
  );
}

/** A valid snapshot of the current workspace as raw bytes. */
async function databaseBytes(): Promise<Buffer> {
  const file = join(root, 'snapshot.sqlite');
  await db.backup(file);
  const snapshot = openDatabase(file);
  snapshot.pragma('journal_mode = DELETE');
  snapshot.close();
  return readFileSync(file);
}

describe('complete backup and restore (DATA-01, D34)', () => {
  it('round-trips projects, profiles, history, avatars, attachments and search', async () => {
    const { storyId, attachmentId, userId } = await seed();
    const result = await backup();
    expect(result.fileName).toBe('out.glaciertasks');
    expect(existsSync(`${archive}.partial`)).toBe(false);

    // Change the live data after the backup.
    const ctx = createServiceContext(db);
    new ProjectService(ctx).create({ key: 'NEW', name: 'Added later' });
    rmSync(
      join(
        paths.attachments,
        readdirSync(paths.attachments).find((n) => n !== '.staging') as string,
      ),
    );

    const preview = await inspect();
    expect(preview).toMatchObject({
      fileName: 'out.glaciertasks',
      schemaVersion: LATEST_SCHEMA_VERSION,
      counts: { projects: 2, users: 1, tasks: 3, attachments: 1, avatars: 1 },
    });
    requestRestore(paths, preview.token, 'safety.glaciertasks');
    db.close();

    const outcome = await activatePendingRestore({
      paths,
      migrations: MIGRATIONS,
      logger: silentLogger,
    });
    expect(outcome).toMatchObject({
      status: 'restored',
      result: { schemaVersion: LATEST_SCHEMA_VERSION, safetyBackupFileName: 'safety.glaciertasks' },
    });
    db = openLive();
    const restored = createServiceContext(db);
    const projects = new ProjectService(restored);
    const tasks = new TaskService(restored, projects);
    expect(projects.list().map((p) => p.key)).toEqual(['GAME', 'SND']);
    expect(new UserService(restored).get(userId).avatarFileId).not.toBeNull();
    expect(readFileSync(join(paths.avatars, 'avatar-key')).equals(PNG)).toBe(true);
    const attachments = new AttachmentService(restored);
    const stored = attachments.getLive(attachmentId);
    expect(readFileSync(join(paths.attachments, stored.storageKey)).equals(PNG)).toBe(true);
    expect(tasks.get(storyId).descriptionMarkdown).toBe('Second version');
    // Search works right after the restore (D20).
    const project = projects.list().find((p) => p.key === 'GAME')?.id as string;
    const query = taskQuerySchema.parse({ projectId: project, text: 'slots' });
    expect(tasks.query(query).items.map((t) => t.id)).toEqual([storyId]);
    expect(existsSync(paths.restorePending)).toBe(false);
    expect(existsSync(paths.restoreStaging)).toBe(false);
    expect(existsSync(paths.restoreRollback)).toBe(false);
  });

  it('restores into a clean installation', async () => {
    await seed();
    await backup();
    db.close();
    for (const path of [
      paths.workspaceDb,
      `${paths.workspaceDb}-wal`,
      `${paths.workspaceDb}-shm`,
    ]) {
      rmSync(path, { force: true });
    }
    rmSync(paths.attachments, { recursive: true, force: true });
    rmSync(paths.avatars, { recursive: true, force: true });

    const preview = await inspect();
    requestRestore(paths, preview.token, null);
    expect(
      (await activatePendingRestore({ paths, migrations: MIGRATIONS, logger: silentLogger }))
        .status,
    ).toBe('restored');
    db = openLive();
    expect(new ProjectService(createServiceContext(db)).list()).toHaveLength(2);
  });

  it('migrates a backup from an older schema version (D28)', async () => {
    db.close();
    rmSync(paths.workspaceDb);
    for (const suffix of ['-wal', '-shm']) rmSync(`${paths.workspaceDb}${suffix}`, { force: true });
    const old = openDatabase(join(root, 'old.sqlite'));
    migrate(old, MIGRATIONS.slice(0, 1));
    old.close();
    const data = readFileSync(join(root, 'old.sqlite'));
    const entries = [{ name: 'workspace.sqlite', data }];
    await writeZip(archive, [
      { name: 'manifest.json', data: manifestFor(entries, { schemaVersion: 1 }) },
      ...entries,
    ]);
    const preview = await inspect();
    expect(preview.schemaVersion).toBe(1);
    requestRestore(paths, preview.token, null);
    expect(
      (await activatePendingRestore({ paths, migrations: MIGRATIONS, logger: silentLogger }))
        .status,
    ).toBe('restored');
    db = openLive();
    expect(
      (db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number }).v,
    ).toBe(LATEST_SCHEMA_VERSION);
  });

  it('keeps the previous workspace when activation fails (T9)', async () => {
    await seed();
    await backup();
    const preview = await inspect();
    requestRestore(paths, preview.token, null);
    // Damage the staged database after validation.
    writeFileSync(join(paths.restoreStaging, preview.token, 'workspace.sqlite'), 'not a database');
    db.close();

    const outcome = await activatePendingRestore({
      paths,
      migrations: MIGRATIONS,
      logger: silentLogger,
    });
    expect(outcome.status).toBe('failed');
    db = openLive();
    expect(new ProjectService(createServiceContext(db)).list().map((p) => p.key)).toEqual([
      'GAME',
      'SND',
    ]);
    expect(readFileSync(join(paths.avatars, 'avatar-key')).equals(PNG)).toBe(true);
    expect(existsSync(paths.restorePending)).toBe(false);
    expect(existsSync(paths.restoreRollback)).toBe(false);
  });

  it('discards staged archives that were never confirmed', async () => {
    await seed();
    await backup();
    await inspect();
    expect(existsSync(paths.restoreStaging)).toBe(true);
    expect(
      (await activatePendingRestore({ paths, migrations: MIGRATIONS, logger: silentLogger }))
        .status,
    ).toBe('none');
    expect(existsSync(paths.restoreStaging)).toBe(false);
  });
});

describe('backup failures', () => {
  it('fails without leaving a partial file when the target cannot be written', async () => {
    await seed();
    const target = join(root, 'missing-folder', 'out.glaciertasks');
    await expect(backup(target)).rejects.toMatchObject({ message: 'errors.backupFailed' });
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it('refuses to write an incomplete archive when a file disappeared', async () => {
    await seed();
    rmSync(join(paths.avatars, 'avatar-key'));
    await expect(backup()).rejects.toMatchObject({ message: 'errors.backupChanged' });
    expect(existsSync(archive)).toBe(false);
  });
});

describe('archive validation (DATA-04/08, T8)', () => {
  const rejects = async (message = 'errors.backupInvalid') => {
    await expect(inspect()).rejects.toMatchObject({ message });
    expect(readdirSync(paths.restoreStaging)).toEqual([]);
  };

  it('rejects files that are not backups, including JSON exports', async () => {
    writeFileSync(
      archive,
      JSON.stringify({ format: 'glacier-tasks-export', notice: 'not a backup' }),
    );
    await rejects();
    await writeZip(archive, [{ name: 'readme.txt', data: Buffer.from('hello') }]);
    await rejects();
  });

  it('rejects tampered checksums and sizes', async () => {
    const data = await databaseBytes();
    const entries = [{ name: 'workspace.sqlite', data }];
    const manifest = JSON.parse(manifestFor(entries).toString()) as {
      entries: Array<{ sha256: string }>;
    };
    (manifest.entries[0] as { sha256: string }).sha256 = '0'.repeat(64);
    await writeZip(archive, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      ...entries,
    ]);
    await rejects();
  });

  it('rejects path traversal, unknown names and link entries', async () => {
    const data = await databaseBytes();
    for (const bad of [
      { name: 'attachments/zz/zz/evil', data: PNG },
      { name: 'other/file', data: PNG },
      { name: 'attachments/link', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
    ]) {
      const entries = [{ name: 'workspace.sqlite', data }, bad];
      await writeZip(archive, [
        { name: 'manifest.json', data: manifestFor([entries[0] as never]) },
        ...entries,
      ]);
      // yazl refuses to write '..'; patch the same-length placeholder in the finished archive.
      const bytes = readFileSync(archive);
      writeFileSync(
        archive,
        Buffer.from(bytes.toString('latin1').replaceAll('zz/zz', '../..'), 'latin1'),
      );
      await rejects();
    }
  });

  it('rejects decompression bombs', async () => {
    const data = await databaseBytes();
    const bomb = { name: 'attachments/bomb', data: Buffer.alloc(8 * 1024 * 1024) };
    const entries = [{ name: 'workspace.sqlite', data }, bomb];
    await writeZip(archive, [
      { name: 'manifest.json', data: manifestFor(entries) },
      { ...entries[0], compress: false } as never,
      { ...bomb, compress: true },
    ]);
    await rejects();
  });

  it('rejects backups from a newer version (D28)', async () => {
    const data = await databaseBytes();
    const entries = [{ name: 'workspace.sqlite', data }];
    await writeZip(archive, [
      {
        name: 'manifest.json',
        data: manifestFor(entries, { schemaVersion: LATEST_SCHEMA_VERSION + 1 }),
      },
      ...entries,
    ]);
    await rejects('errors.backupFromNewerVersion');
  });

  it('rejects archives whose files are missing for the database', async () => {
    await seed();
    const data = await databaseBytes();
    const entries = [{ name: 'workspace.sqlite', data }];
    await writeZip(archive, [{ name: 'manifest.json', data: manifestFor(entries) }, ...entries]);
    await rejects();
  });
});

describe('automatic backups (D13)', () => {
  const state = (folder: string | null, lastRunAt: string | null = null) => ({
    enabled: true,
    folder,
    intervalHours: 24,
    retention: 2,
    lastRunAt,
  });

  it('runs when due, keeps the newest N and leaves other files alone', async () => {
    await seed();
    const folder = join(root, 'auto');
    mkdirSync(folder);
    for (const name of [
      'glacier-tasks-auto-20261001-000000.glaciertasks',
      'glacier-tasks-auto-20261002-000000.glaciertasks',
      'glacier-tasks-auto-20261003-000000.glaciertasks',
      'my-own-backup.glaciertasks',
      'notes.txt',
    ]) {
      writeFileSync(join(folder, name), 'x');
    }
    const outcome = await runAutomaticBackup(
      state(folder),
      (target) => backup(target, 'automatic'),
      new Date(2026, 9, 29, 12),
    );
    expect(outcome.status).toBe('created');
    expect(readdirSync(folder).sort()).toEqual([
      'glacier-tasks-auto-20261003-000000.glaciertasks',
      'glacier-tasks-auto-20261029-120000.glaciertasks',
      'my-own-backup.glaciertasks',
      'notes.txt',
    ]);
  });

  it('skips when not due or disabled and reports an unavailable folder', async () => {
    const run = () => {
      throw new Error('must not run');
    };
    const now = new Date('2026-10-29T12:00:00.000Z');
    expect(await runAutomaticBackup(state(root, '2026-10-29T00:00:00.000Z'), run, now)).toEqual({
      status: 'skipped',
    });
    expect(await runAutomaticBackup({ ...state(root), enabled: false }, run, now)).toEqual({
      status: 'skipped',
    });
    expect(await runAutomaticBackup(state(join(root, 'gone')), run, now)).toEqual({
      status: 'failed',
      messageKey: 'errors.autoBackupFolderUnavailable',
    });
  });

  it('prunes nothing when there are fewer backups than the retention', () => {
    const folder = join(root, 'few');
    mkdirSync(folder);
    writeFileSync(join(folder, 'glacier-tasks-auto-20261001-000000.glaciertasks'), 'x');
    expect(pruneAutomaticBackups(folder, 7)).toEqual([]);
  });
});
