import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AttachmentService,
  createServiceContext,
  MIGRATIONS,
  migrate,
  openDatabase,
  ProjectService,
  TaskService,
} from '@glacier-tasks/data';
import { AttachmentStore } from './attachment-store.js';
import { silentLogger } from './logger.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF = Buffer.from('GIF89a-tiny');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

let dir: string;
let attachmentsDir: string;
let openDir: string;
let db: Database;
let service: AttachmentService;
let store: AttachmentStore;
let taskId: string;
let maxBytes: number;
let keyCounter: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-attachments-'));
  attachmentsDir = join(dir, 'attachments');
  openDir = join(dir, 'open');
  mkdirSync(attachmentsDir);
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS);
  const ctx = createServiceContext(db);
  const projects = new ProjectService(ctx);
  const tasks = new TaskService(ctx, projects);
  service = new AttachmentService(ctx);
  const projectId = projects.create({ key: 'GAME', name: 'Game' }).id;
  taskId = tasks.create({
    projectId,
    type: 'STORY',
    parentStoryId: null,
    title: 'Inventory',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
  }).id;
  maxBytes = 1024;
  keyCounter = 0;
  store = new AttachmentStore({
    dir: attachmentsDir,
    openDir,
    attachments: service,
    logger: silentLogger,
    maxBytes: () => maxBytes,
    newKey: () => `key-${++keyCounter}`,
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function source(name: string, bytes: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

const stored = () =>
  readdirSync(attachmentsDir)
    .filter((name) => name !== '.staging')
    .sort();

describe('AttachmentStore (FILE-01/02, D33)', () => {
  it('keeps a picked file after the source is deleted', async () => {
    const path = source('Screen shot.png', PNG);
    const added = await store.importFrom(taskId, path);
    rmSync(path);

    expect(added).toMatchObject({
      originalName: 'Screen shot.png',
      mimeType: 'image/png',
      byteSize: PNG.length,
      previewable: true,
    });
    expect(added.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored()).toEqual(['key-1']);
    expect(store.read(added.id)?.bytes.equals(PNG)).toBe(true);
    expect(readdirSync(join(attachmentsDir, '.staging'))).toEqual([]);
  });

  it('previews raster images by signature and never SVG', async () => {
    const [gif, svg, disguised] = await store.importFiles(taskId, [
      { name: 'anim.gif', bytes: GIF },
      { name: 'logo.svg', bytes: SVG },
      { name: 'photo.png', bytes: SVG },
    ]);
    expect(gif).toMatchObject({ mimeType: 'image/gif', previewable: true });
    expect(svg).toMatchObject({ mimeType: 'image/svg+xml', previewable: false });
    // SVG renamed to .png: the extension must not make it previewable.
    expect(disguised).toMatchObject({ mimeType: 'application/octet-stream', previewable: false });
    expect(store.read((svg as { id: string }).id)).toBeNull();
    expect(store.read((disguised as { id: string }).id)).toBeNull();
  });

  it('enforces the size limit before and while copying', async () => {
    maxBytes = 4;
    await expect(store.importFrom(taskId, source('big.png', PNG))).rejects.toMatchObject({
      message: 'errors.attachmentTooLarge',
    });
    await expect(
      store.importFiles(taskId, [{ name: 'big.png', bytes: PNG }]),
    ).rejects.toMatchObject({
      message: 'errors.attachmentTooLarge',
    });
    expect(stored()).toEqual([]);
    expect(service.list(taskId)).toEqual([]);
  });

  it('refuses directories, missing files and unknown tasks without leaving files', async () => {
    await expect(store.importFrom(taskId, dir)).rejects.toMatchObject({
      message: 'errors.attachmentUnreadable',
    });
    await expect(store.importFrom(taskId, join(dir, 'missing.txt'))).rejects.toMatchObject({
      message: 'errors.attachmentUnreadable',
    });
    await expect(
      store.importFiles('00000000-0000-4000-8000-000000000999', [{ name: 'a', bytes: PNG }]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(stored()).toEqual([]);
  });

  it('opens and saves copies under a sanitized name, never the managed file (T5, T11)', async () => {
    const [added] = await store.importFiles(taskId, [
      { name: '..\\..\\evil<1>.txt', bytes: Buffer.from('hello') },
    ]);
    const id = (added as { id: string }).id;
    const opened = await store.openCopy(id);
    expect(basename(opened)).toBe('evil_1_.txt');
    expect(dirname(dirname(opened))).toBe(openDir);
    expect(readFileSync(opened, 'utf-8')).toBe('hello');
    expect(store.saveName(id)).toBe('evil_1_.txt');

    const target = join(dir, 'saved.txt');
    await store.saveTo(id, target);
    expect(readFileSync(target, 'utf-8')).toBe('hello');

    store.clearOpenCopies();
    expect(existsSync(openDir)).toBe(false);
  });

  it('deletes the bytes immediately on removal (D03)', async () => {
    const [added] = await store.importFiles(taskId, [{ name: 'a.png', bytes: PNG }]);
    store.remove((added as { id: string }).id);
    expect(stored()).toEqual([]);
    expect(store.read((added as { id: string }).id)).toBeNull();
    await expect(store.openCopy((added as { id: string }).id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reconciles staged, orphaned and missing files on startup', async () => {
    const [kept, lost] = await store.importFiles(taskId, [
      { name: 'kept.png', bytes: PNG },
      { name: 'lost.png', bytes: PNG },
    ]);
    // A crash after the commit but before the rename: the staged file must be finalized.
    const committed = service.insert(taskId, {
      originalName: 'late.png',
      mimeType: 'image/png',
      byteSize: PNG.length,
      sha256: 'b'.repeat(64),
      storageKey: 'late-key',
    });
    writeFileSync(join(attachmentsDir, '.staging', 'late-key'), PNG);
    writeFileSync(join(attachmentsDir, '.staging', 'aborted-import'), PNG);
    writeFileSync(join(attachmentsDir, 'orphan'), PNG);
    rmSync(join(attachmentsDir, 'key-2'));

    expect(store.reconcile()).toEqual({ finalized: 1, removed: 2, missing: 1, failed: 0 });
    expect(stored()).toEqual(['key-1', 'late-key']);
    expect(store.read(committed.id)?.bytes.equals(PNG)).toBe(true);
    expect(store.read((kept as { id: string }).id)).not.toBeNull();
    expect(store.read((lost as { id: string }).id)).toBeNull();
  });
});
