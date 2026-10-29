// Shared dependencies of the data services. Clock and id generator are injectable so
// tests are deterministic.

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';

export interface ServiceContext {
  db: Database;
  /** Current time as UTC ISO-8601. */
  now: () => string;
  newId: () => string;
}

export function createServiceContext(
  db: Database,
  overrides: Partial<Omit<ServiceContext, 'db'>> = {},
): ServiceContext {
  return {
    db,
    now: overrides.now ?? (() => new Date().toISOString()),
    newId: overrides.newId ?? randomUUID,
  };
}

/** True if `error` is a SQLite UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
