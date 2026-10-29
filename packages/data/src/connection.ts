// SQLite connection lifecycle (spec §5.1).

import BetterSqlite3, { type Database } from 'better-sqlite3';

export interface OpenOptions {
  /** Use WAL for the live workspace; tests and backups may use the default journal. */
  wal?: boolean;
  readonly?: boolean;
}

export function openDatabase(filePath: string, options: OpenOptions = {}): Database {
  const db = new BetterSqlite3(filePath, { readonly: options.readonly ?? false });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (options.wal && !options.readonly) db.pragma('journal_mode = WAL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new Error('Foreign key enforcement could not be enabled');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Consistent online snapshot via the SQLite backup API (DATA-05). */
export async function snapshotDatabase(db: Database, targetPath: string): Promise<void> {
  await db.backup(targetPath);
}

export function integrityCheck(db: Database): string {
  return db.pragma('integrity_check', { simple: true }) as string;
}
