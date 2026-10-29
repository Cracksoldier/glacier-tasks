import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentSchemaVersion,
  type Migration,
  MIGRATIONS,
  openDatabase,
} from '@glacier-tasks/data';
import { silentLogger } from './logger.js';
import { openWorkspace } from './workspace.js';

let dir: string;
let dbPath: string;
let backupsDir: string;

const NOW = new Date('2026-10-29T10:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-workspace-'));
  dbPath = join(dir, 'glacier-tasks.sqlite');
  backupsDir = join(dir, 'backups');
  mkdirSync(backupsDir);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = (migrations: ReadonlyArray<Migration> = MIGRATIONS) =>
  openWorkspace({ dbPath, backupsDir, migrations, logger: silentLogger, now: () => NOW });

const extraMigration: Migration = {
  version: MIGRATIONS.length + 1,
  name: 'test-extra',
  sql: 'CREATE TABLE test_extra (id INTEGER PRIMARY KEY);',
};

describe('openWorkspace', () => {
  it('creates and migrates a fresh workspace without a safety backup', async () => {
    const workspace = await open();
    expect(workspace.fromVersion).toBe(0);
    expect(workspace.toVersion).toBe(MIGRATIONS.length);
    expect(workspace.safetyBackupPath).toBeNull();
    expect(workspace.db.pragma('journal_mode', { simple: true })).toBe('wal');
    workspace.db.close();
    expect(readdirSync(backupsDir)).toEqual([]);
  });

  it('reopens an up-to-date workspace without migrating', async () => {
    (await open()).db.close();
    const workspace = await open();
    expect(workspace.fromVersion).toBe(MIGRATIONS.length);
    expect(workspace.safetyBackupPath).toBeNull();
    workspace.db.close();
  });

  it('takes a safety backup before migrating an existing workspace (spec §11)', async () => {
    (await open()).db.close();
    const workspace = await open([...MIGRATIONS, extraMigration]);
    workspace.db.close();

    expect(workspace.safetyBackupPath).toBe(
      join(backupsDir, `pre-migration-v${MIGRATIONS.length}-2026-10-29T10-00-00-000Z.sqlite`),
    );
    expect(existsSync(workspace.safetyBackupPath as string)).toBe(true);
    const backup = openDatabase(workspace.safetyBackupPath as string, { readonly: true });
    expect(currentSchemaVersion(backup)).toBe(MIGRATIONS.length);
    backup.close();
  });

  it('refuses a workspace from a newer app version and leaves it untouched', async () => {
    (await open([...MIGRATIONS, extraMigration])).db.close();
    await expect(open()).rejects.toMatchObject({
      code: 'MIGRATION_REQUIRED',
      message: 'errors.workspaceFromNewerVersion',
    });
    const db = openDatabase(dbPath, { readonly: true });
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.length + 1);
    db.close();
  });

  it('classifies a damaged file as a corrupt workspace', async () => {
    writeFileSync(dbPath, 'this is not a sqlite database, just text padding'.repeat(100));
    await expect(open()).rejects.toMatchObject({ code: 'IO', message: 'errors.workspaceCorrupt' });
  });
});
