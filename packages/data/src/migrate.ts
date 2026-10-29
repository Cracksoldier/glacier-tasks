// Schema migration runner (docs/adr/0005-migrations.md, spec §11).

import type { Database } from 'better-sqlite3';
import { AppError } from '@glacier-tasks/domain';

export interface Migration {
  /** Sequential, starting at 1, no gaps. */
  version: number;
  name: string;
  sql: string;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

const BOOKKEEPING_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export function currentSchemaVersion(db: Database): number {
  db.exec(BOOKKEEPING_SQL);
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

export function assertMigrationsWellFormed(migrations: ReadonlyArray<Migration>): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration list must be sequential; found ${migration.version} at ${index}`);
    }
  });
}

/**
 * Applies all pending migrations, each in its own transaction.
 * Refuses to touch a database written by a newer application version.
 * The caller is responsible for taking a pre-migration backup when `needsMigration` is true.
 */
export function migrate(
  db: Database,
  migrations: ReadonlyArray<Migration>,
  now: () => string = () => new Date().toISOString(),
): MigrationResult {
  assertMigrationsWellFormed(migrations);
  const fromVersion = currentSchemaVersion(db);
  const latest = migrations.length;
  if (fromVersion > latest) {
    throw new AppError('MIGRATION_REQUIRED', 'errors.workspaceFromNewerVersion', {
      databaseVersion: fromVersion,
      supportedVersion: latest,
    });
  }

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const applied: number[] = [];
  for (const migration of migrations.slice(fromVersion)) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, now());
    })();
    applied.push(migration.version);
  }

  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new AppError('MIGRATION_REQUIRED', 'errors.migrationIntegrity', {
      violations: violations.length,
    });
  }
  return { fromVersion, toVersion: latest, applied };
}

export function needsMigration(db: Database, migrations: ReadonlyArray<Migration>): boolean {
  return currentSchemaVersion(db) < migrations.length;
}
