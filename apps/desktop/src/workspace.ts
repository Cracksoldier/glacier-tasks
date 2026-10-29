// Workspace startup flow (spec §11, ADR 0005): open, safety-snapshot, migrate.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  currentSchemaVersion,
  type Migration,
  migrate,
  needsMigration,
  openDatabase,
  snapshotDatabase,
} from '@glacier-tasks/data';
import { AppError, isAppError } from '@glacier-tasks/domain';
import type { Logger } from './logger.js';

export interface OpenWorkspaceOptions {
  dbPath: string;
  backupsDir: string;
  migrations: ReadonlyArray<Migration>;
  logger: Logger;
  now?: () => Date;
}

export interface OpenedWorkspace {
  db: Database;
  fromVersion: number;
  toVersion: number;
  safetyBackupPath: string | null;
}

const CORRUPTION_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB']);

function classify(error: unknown): AppError {
  if (isAppError(error)) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CORRUPTION_CODES.has(code)) {
    return new AppError('IO', 'errors.workspaceCorrupt', { sqliteCode: code });
  }
  return new AppError('IO', 'errors.workspaceUnavailable', {
    ...(typeof code === 'string' ? { code } : {}),
  });
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function openWorkspace(options: OpenWorkspaceOptions): Promise<OpenedWorkspace> {
  const now = options.now ?? (() => new Date());
  const existed = existsSync(options.dbPath);
  let db: Database | undefined;
  try {
    db = openDatabase(options.dbPath, { wal: true });
    const fromVersion = currentSchemaVersion(db);
    let safetyBackupPath: string | null = null;

    if (existed && fromVersion > 0 && needsMigration(db, options.migrations)) {
      safetyBackupPath = join(
        options.backupsDir,
        `pre-migration-v${fromVersion}-${timestamp(now())}.sqlite`,
      );
      await snapshotDatabase(db, safetyBackupPath);
      options.logger.info('safety backup before migration', { fromVersion });
    }

    const result = migrate(db, options.migrations, () => now().toISOString());
    if (result.applied.length > 0) {
      options.logger.info('workspace migrated', {
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
      });
    }
    return { db, fromVersion, toVersion: result.toVersion, safetyBackupPath };
  } catch (error) {
    db?.close();
    const appError = classify(error);
    options.logger.error('workspace could not be opened', { code: appError.code, error });
    throw appError;
  }
}
