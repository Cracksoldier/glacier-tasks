import { describe, expect, it } from 'vitest';
import {
  AUTO_BACKUP_PATTERN,
  autoBackupFileName,
  backupManifestSchema,
  isBackupEntryName,
} from './backup-format.js';

describe('backup entry names (T8)', () => {
  it.each([
    'workspace.sqlite',
    'attachments/1f6e9c2a-0000-4000-8000-000000000001',
    'avatars/key-1',
  ])('accepts %s', (name) => expect(isBackupEntryName(name)).toBe(true));

  it.each([
    'manifest.json',
    '../workspace.sqlite',
    'attachments/../../evil',
    'attachments/a/b',
    'attachments/',
    '/attachments/abc',
    'C:\attachments\abc',
    'attachments\abc',
    'avatars/key.exe',
    'other/abc',
    'workspace.sqlite-wal',
  ])('rejects %s', (name) => expect(isBackupEntryName(name)).toBe(false));
});

describe('backupManifestSchema (D34)', () => {
  const entry = (path: string) => ({ path, size: 1, sha256: 'a'.repeat(64) });
  const manifest = {
    format: 'glacier-tasks-backup',
    formatVersion: 1,
    appVersion: '0.0.0',
    schemaVersion: 2,
    createdAt: '2026-10-29T10:00:00.000Z',
    kind: 'manual',
    entries: [entry('workspace.sqlite'), entry('attachments/k1')],
  };

  it('accepts a complete manifest', () => {
    expect(backupManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects other formats, missing databases, duplicates and bad names', () => {
    expect(
      backupManifestSchema.safeParse({ ...manifest, format: 'glacier-tasks-export' }).success,
    ).toBe(false);
    expect(backupManifestSchema.safeParse({ ...manifest, formatVersion: 2 }).success).toBe(false);
    expect(
      backupManifestSchema.safeParse({ ...manifest, entries: [entry('attachments/k1')] }).success,
    ).toBe(false);
    expect(
      backupManifestSchema.safeParse({
        ...manifest,
        entries: [entry('workspace.sqlite'), entry('workspace.sqlite')],
      }).success,
    ).toBe(false);
    expect(
      backupManifestSchema.safeParse({
        ...manifest,
        entries: [entry('workspace.sqlite'), entry('../x')],
      }).success,
    ).toBe(false);
  });
});

describe('automatic backup names (D13)', () => {
  it('builds names that the retention pattern recognises', () => {
    const name = autoBackupFileName(new Date(2026, 9, 29, 8, 5, 9));
    expect(name).toBe('glacier-tasks-auto-20261029-080509.glaciertasks');
    expect(AUTO_BACKUP_PATTERN.test(name)).toBe(true);
    expect(AUTO_BACKUP_PATTERN.test('my-backup.glaciertasks')).toBe(false);
    expect(AUTO_BACKUP_PATTERN.test(`${name}.partial`)).toBe(false);
  });
});
