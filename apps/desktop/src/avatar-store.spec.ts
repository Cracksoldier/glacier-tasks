import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createServiceContext,
  MIGRATIONS,
  migrate,
  openDatabase,
  UserService,
} from '@glacier-tasks/data';
import { AVATAR_MAX_BYTES } from '@glacier-tasks/domain';
import { AvatarStore } from './avatar-store.js';
import { silentLogger } from './logger.js';

// Lets a test simulate a file that another process holds open (EBUSY on Windows).
const fsControl = vi.hoisted(() => ({ lockedName: null as string | null }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: (path: string, options?: Parameters<typeof actual.rmSync>[1]) => {
      if (fsControl.lockedName && path.endsWith(fsControl.lockedName)) {
        throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      }
      actual.rmSync(path, options);
    },
  };
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7]);

let dir: string;
let avatarsDir: string;
let db: Database;
let users: UserService;
let store: AvatarStore;
let keyCounter: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-avatars-'));
  avatarsDir = join(dir, 'avatars');
  mkdirSync(avatarsDir);
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS);
  users = new UserService(createServiceContext(db));
  keyCounter = 0;
  store = new AvatarStore({
    dir: avatarsDir,
    users,
    logger: silentLogger,
    newKey: () => `key-${++keyCounter}`,
  });
});

afterEach(() => {
  fsControl.lockedName = null;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function source(name: string, bytes: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe('AvatarStore', () => {
  it.each([
    ['png', PNG, 'image/png'],
    ['jpg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('imports a %s by content and serves it back', (ext, bytes, mimeType) => {
    const user = users.create({ name: 'Ann' });
    const updated = store.importFrom(user.id, source(`avatar.${ext}`, bytes));
    expect(updated.avatarFileId).not.toBeNull();
    expect(store.read(updated.avatarFileId as string)).toEqual({ bytes, mimeType });
  });

  it('keeps the avatar after the source file is deleted (M2 acceptance)', () => {
    const user = users.create({ name: 'Ann' });
    const path = source('avatar.png', PNG);
    const updated = store.importFrom(user.id, path);
    rmSync(path);
    expect(store.read(updated.avatarFileId as string)?.bytes).toEqual(PNG);
    expect(readdirSync(avatarsDir)).toEqual(['key-1']);
  });

  it('rejects content that is not PNG/JPEG/WebP whatever the extension', () => {
    const user = users.create({ name: 'Ann' });
    const fake = source('avatar.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(() => store.importFrom(user.id, fake)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.avatarUnsupported' }),
    );
    expect(() => store.importFrom(user.id, dir)).toThrowError(
      expect.objectContaining({ message: 'errors.avatarUnsupported' }),
    );
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it('rejects files above 5 MiB (D24)', () => {
    const user = users.create({ name: 'Ann' });
    const big = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);
    expect(() => store.importFrom(user.id, source('big.png', big))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: 'errors.avatarTooLarge' }),
    );
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it('reports an unreadable source without leaking its path', () => {
    const user = users.create({ name: 'Ann' });
    expect(() => store.importFrom(user.id, join(dir, 'missing.png'))).toThrowError(
      expect.objectContaining({ code: 'IO', message: 'errors.avatarUnreadable' }),
    );
  });

  it('checks the profile before copying anything', () => {
    expect(() =>
      store.importFrom('00000000-0000-4000-8000-000000000000', source('a.png', PNG)),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it('deletes the replaced and the removed file (D24)', () => {
    const user = users.create({ name: 'Ann' });
    store.importFrom(user.id, source('a.png', PNG));
    store.importFrom(user.id, source('b.jpg', JPEG));
    expect(readdirSync(avatarsDir)).toEqual(['key-2']);

    expect(store.remove(user.id).avatarFileId).toBeNull();
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it('removes the copied bytes when the metadata write fails', () => {
    const user = users.create({ name: 'Ann' });
    vi.spyOn(users, 'setAvatar').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    expect(() => store.importFrom(user.id, source('a.png', PNG))).toThrow('disk I/O error');
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it('returns null for unknown ids and missing bytes', () => {
    const user = users.create({ name: 'Ann' });
    const updated = store.importFrom(user.id, source('a.png', PNG));
    expect(store.read('00000000-0000-4000-8000-000000000000')).toBeNull();
    rmSync(join(avatarsDir, 'key-1'));
    expect(store.read(updated.avatarFileId as string)).toBeNull();
  });

  it('never resolves a storage key outside the avatar directory (T5)', () => {
    const user = users.create({ name: 'Ann' });
    writeFileSync(join(dir, 'secret.png'), PNG);
    const updated = store.importFrom(user.id, source('a.png', PNG));
    db.prepare(`UPDATE avatar_files SET storage_key = '../secret.png'`).run();
    expect(store.read(updated.avatarFileId as string)).toBeNull();
  });

  it('reconciles orphans and counts missing files on startup', () => {
    const ann = users.create({ name: 'Ann' });
    const bob = users.create({ name: 'Bob' });
    store.importFrom(ann.id, source('a.png', PNG));
    store.importFrom(bob.id, source('b.png', PNG));
    rmSync(join(avatarsDir, 'key-2'));
    writeFileSync(join(avatarsDir, 'orphan'), PNG);
    writeFileSync(join(avatarsDir, '.key-3.123.tmp'), PNG);

    expect(store.reconcile()).toEqual({ removed: 2, missing: 1, failed: 0 });
    expect(readdirSync(avatarsDir)).toEqual(['key-1']);
    expect(existsSync(join(avatarsDir, 'key-1'))).toBe(true);
  });

  it('skips an orphan it cannot remove and still cleans up the others', () => {
    writeFileSync(join(avatarsDir, 'locked'), PNG);
    writeFileSync(join(avatarsDir, 'orphan'), PNG);
    fsControl.lockedName = 'locked';

    expect(store.reconcile()).toEqual({ removed: 1, missing: 0, failed: 1 });
    expect(readdirSync(avatarsDir)).toEqual(['locked']);
  });
});
