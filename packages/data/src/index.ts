import { migration0001 } from './migrations/0001-initial.js';
import type { Migration } from './migrate.js';

export * from './connection.js';
export * from './migrate.js';
export * from './services/index.js';

/** All migrations in order. Append only; never edit a released migration. */
export const MIGRATIONS: ReadonlyArray<Migration> = [migration0001];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;
