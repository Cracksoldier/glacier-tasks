// Complete backup, restore and automatic backups (DATA-01..10, D13, D17, D20, D28, D34,
// threat model T8/T9, ADR 0012). Electron-free so it can be unit-tested; `main.ts` provides
// the dialogs and restarts the app.
//
// Backup: consistent SQLite snapshot → managed files listed by that snapshot → ZIP written to
// `<target>.partial` with a manifest of sizes and SHA-256 checksums → fsync → rename.
// Restore: validate and extract into `restore-staging/<token>` → (user confirms) safety backup
// and a pending marker → restart → `activatePendingRestore` swaps the files before the
// workspace is opened, migrates, rebuilds the search index and rolls back on any failure.

import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, open, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Database } from 'better-sqlite3';
import yauzl from 'yauzl';
import yazl from 'yazl';
import {
  type Migration,
  managedFileKeys,
  openDatabase,
  rebuildSearchIndex,
  snapshotDatabase,
  workspaceCounts,
} from '@glacier-tasks/data';
import {
  AppError,
  AUTO_BACKUP_PATTERN,
  autoBackupFileName,
  BACKUP_DATABASE,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMITS,
  BACKUP_MANIFEST,
  type BackupManifest,
  backupManifestSchema,
  type BackupResult,
  isBackupEntryName,
  type RestorePreview,
  type RestoreResult,
} from '@glacier-tasks/domain';
import { resolveInside } from './fs-safe.js';
import type { Logger } from './logger.js';
import { openWorkspace } from './workspace.js';

export interface DataPaths {
  workspaceDb: string;
  attachments: string;
  avatars: string;
  backups: string;
  /** `restore-staging/<token>/` holds validated archives waiting for activation. */
  restoreStaging: string;
  /** The previous workspace while a restore is being activated. */
  restoreRollback: string;
  /** Marker that asks the next start to activate a staged restore. */
  restorePending: string;
}

const failed = () => new AppError('IO', 'errors.backupFailed');
const invalid = (reason: string) => new AppError('VALIDATION', 'errors.backupInvalid', { reason });
const SYMLINK = 0o120000;
const FILE_TYPE_MASK = 0o170000;

// --- Backup -------------------------------------------------------------------

export interface CreateBackupOptions {
  db: Database;
  paths: Pick<DataPaths, 'attachments' | 'avatars'>;
  target: string;
  kind: BackupManifest['kind'];
  appVersion: string;
  schemaVersion: number;
  now?: () => Date;
}

/** Writes a complete `.glaciertasks` archive (DATA-01/04/05). */
export async function createBackup(options: CreateBackupOptions): Promise<BackupResult> {
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const partial = `${options.target}.partial`;
  const temp = await mkdtemp(join(tmpdir(), 'glacier-tasks-backup-'));
  try {
    // DATA-05: the snapshot is consistent; the files to include are the ones it references.
    const snapshot = join(temp, BACKUP_DATABASE);
    await snapshotDatabase(options.db, snapshot);
    const snapshotDb = openDatabase(snapshot);
    // Self-contained file: no WAL sidecar is needed to read it back.
    snapshotDb.pragma('journal_mode = DELETE');
    const keys = managedFileKeys(snapshotDb);
    snapshotDb.close();

    const sources: Array<{ path: string; file: string; compress: boolean }> = [
      { path: BACKUP_DATABASE, file: snapshot, compress: true },
      ...keys.attachments.map((key) => ({
        path: `attachments/${key}`,
        file: resolveInside(options.paths.attachments, key),
        compress: false,
      })),
      ...keys.avatars.map((key) => ({
        path: `avatars/${key}`,
        file: resolveInside(options.paths.avatars, key),
        compress: false,
      })),
    ];
    // A file removed after the snapshot would make the archive incomplete: try again later.
    for (const source of sources) {
      if (!existsSync(source.file)) throw new AppError('CONFLICT', 'errors.backupChanged');
    }

    const zip = new yazl.ZipFile();
    const entries: BackupManifest['entries'] = [];
    for (const source of sources) {
      zip.addReadStreamLazy(source.path, { compress: source.compress }, (callback) => {
        const hash = createHash('sha256');
        let size = 0;
        const measure = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk);
            size += chunk.length;
            done(null, chunk);
          },
          flush(done) {
            entries.push({ path: source.path, size, sha256: hash.digest('hex') });
            done();
          },
        });
        const input = createReadStream(source.file);
        input.on('error', (error) => measure.destroy(error));
        callback(null, input.pipe(measure));
      });
    }
    // Requested only after every other entry was read, so all checksums are known.
    zip.addReadStreamLazy(BACKUP_MANIFEST, (callback) => {
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        appVersion: options.appVersion,
        schemaVersion: options.schemaVersion,
        createdAt,
        kind: options.kind,
        entries,
      };
      callback(null, Readable.from([Buffer.from(JSON.stringify(manifest, null, 2))]));
    });
    zip.end();

    await pipeline(zip.outputStream, createWriteStream(partial));
    const handle = await open(partial, 'r+');
    await handle.sync();
    await handle.close();
    await rename(partial, options.target);
    return {
      fileName: basename(options.target),
      byteSize: (await stat(options.target)).size,
      createdAt,
    };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error instanceof AppError ? error : failed();
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

// --- Inspect and stage --------------------------------------------------------

export interface InspectOptions {
  file: string;
  paths: Pick<DataPaths, 'restoreStaging'>;
  latestSchemaVersion: number;
}

interface StagedInfo {
  fileName: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
}

const STAGED_INFO = 'staged.json';

/**
 * Validates an archive and extracts it into a fresh staging folder (DATA-04/08, T8): only
 * known entry names, no links, no duplicates, sizes and checksums as in the manifest, no
 * decompression bombs, an intact SQLite database of a known schema version, and every
 * managed file the database references. Nothing in the archive is ever executed.
 */
export async function inspectArchive(options: InspectOptions): Promise<RestorePreview> {
  rmSync(options.paths.restoreStaging, { recursive: true, force: true });
  const token = randomUUID();
  const staging = join(options.paths.restoreStaging, token);
  mkdirSync(join(staging, 'attachments'), { recursive: true });
  mkdirSync(join(staging, 'avatars'), { recursive: true });

  let zip: yauzl.ZipFile | undefined;
  try {
    try {
      zip = await yauzl.openPromise(options.file, {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      });
    } catch {
      throw invalid('not a zip archive');
    }
    const entries = await readEntries(zip);
    const byName = new Map<string, yauzl.Entry>();
    for (const entry of entries) {
      const name = entry.fileName;
      if (name !== BACKUP_MANIFEST && !isBackupEntryName(name)) throw invalid(`unexpected entry`);
      if (byName.has(name)) throw invalid('duplicate entry');
      if (((entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK) === SYMLINK) {
        throw invalid('link entry');
      }
      if (entry.isEncrypted()) throw invalid('encrypted entry');
      const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
      if (entry.uncompressedSize > 1024 * 1024 && ratio > BACKUP_LIMITS.maxCompressionRatio) {
        throw invalid('compression ratio');
      }
      byName.set(name, entry);
    }

    const manifestEntry = byName.get(BACKUP_MANIFEST);
    if (!manifestEntry || manifestEntry.uncompressedSize > BACKUP_LIMITS.maxManifestBytes) {
      throw invalid('missing manifest');
    }
    const manifest = parseManifest(await readEntry(zip, manifestEntry));
    if (manifest.schemaVersion > options.latestSchemaVersion) {
      // D28: a newer application wrote it.
      throw new AppError('VALIDATION', 'errors.backupFromNewerVersion', {
        backupVersion: manifest.schemaVersion,
        supportedVersion: options.latestSchemaVersion,
      });
    }
    if (manifest.entries.length !== byName.size - 1) throw invalid('entries differ from manifest');

    for (const expected of manifest.entries) {
      const entry = byName.get(expected.path);
      if (!entry || entry.uncompressedSize !== expected.size) throw invalid('size mismatch');
      const [folder, key] = expected.path.includes('/')
        ? (expected.path.split('/') as [string, string])
        : [null, expected.path];
      const target = folder ? resolveInside(staging, folder, key) : resolveInside(staging, key);
      const hash = createHash('sha256');
      let size = 0;
      const verify = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > expected.size) return done(invalid('entry larger than declared'));
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(await zip.openReadStreamPromise(entry), verify, createWriteStream(target));
      if (size !== expected.size || hash.digest('hex') !== expected.sha256) {
        throw invalid('checksum mismatch');
      }
    }

    const counts = verifyStagedDatabase(staging, manifest.schemaVersion);
    const info: StagedInfo = {
      fileName: basename(options.file),
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
    };
    writeFileSync(join(staging, STAGED_INFO), JSON.stringify(info));
    return { token, ...info, counts };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw invalid('unreadable archive');
  } finally {
    zip?.close();
  }
}

function parseManifest(bytes: Buffer): BackupManifest {
  try {
    return backupManifestSchema.parse(JSON.parse(bytes.toString('utf-8')));
  } catch {
    throw invalid('manifest');
  }
}

/** Integrity, foreign keys, schema version and the managed-file inventory of a staged DB. */
function verifyStagedDatabase(staging: string, schemaVersion: number): RestorePreview['counts'] {
  let db: Database | undefined;
  try {
    db = openDatabase(join(staging, BACKUP_DATABASE), { readonly: true });
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw invalid('integrity');
    if ((db.pragma('foreign_key_check') as unknown[]).length > 0) throw invalid('foreign keys');
    const version = (
      db.prepare(`SELECT max(version) AS version FROM schema_migrations`).get() as {
        version: number | null;
      }
    ).version;
    if (version !== schemaVersion) throw invalid('schema version');
    const keys = managedFileKeys(db);
    for (const key of keys.attachments) {
      if (!existsSync(resolveInside(staging, 'attachments', key))) throw invalid('missing file');
    }
    for (const key of keys.avatars) {
      if (!existsSync(resolveInside(staging, 'avatars', key))) throw invalid('missing file');
    }
    return workspaceCounts(db);
  } catch (error) {
    throw error instanceof AppError ? error : invalid('database');
  } finally {
    db?.close();
  }
}

function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      if (entries.length > BACKUP_LIMITS.maxEntries + 1) {
        reject(invalid('too many entries'));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// --- Activate -----------------------------------------------------------------

interface PendingRestore {
  token: string;
  safetyBackupFileName: string | null;
}

/** Records the confirmed restore; the next start activates it (DATA-06/07). */
export function requestRestore(
  paths: Pick<DataPaths, 'restoreStaging' | 'restorePending'>,
  token: string,
  safetyBackupFileName: string | null,
): void {
  if (!existsSync(join(paths.restoreStaging, token, STAGED_INFO))) {
    throw new AppError('NOT_FOUND', 'errors.restoreExpired');
  }
  const pending: PendingRestore = { token, safetyBackupFileName };
  writeFileSync(paths.restorePending, JSON.stringify(pending));
}

export type ActivationOutcome =
  | { status: 'none' }
  | { status: 'restored'; result: RestoreResult }
  | { status: 'failed' };

export interface ActivateOptions {
  paths: DataPaths;
  migrations: ReadonlyArray<Migration>;
  logger: Logger;
  now?: () => Date;
}

/**
 * Runs before the workspace is opened. Moves the current data aside, puts the staged data in
 * place, migrates older schemas (D28), rebuilds the search index (D20) and checks integrity.
 * Any failure puts the previous data back (T9). Device settings are never touched (D17).
 */
export async function activatePendingRestore(options: ActivateOptions): Promise<ActivationOutcome> {
  const { paths, logger } = options;
  if (!existsSync(paths.restorePending)) {
    // A staged archive without confirmation is not needed any more.
    rmSync(paths.restoreStaging, { recursive: true, force: true });
    return { status: 'none' };
  }
  let pending: PendingRestore;
  try {
    pending = JSON.parse(readFileSync(paths.restorePending, 'utf-8')) as PendingRestore;
  } catch {
    rmSync(paths.restorePending, { force: true });
    return { status: 'failed' };
  }
  const staging = join(paths.restoreStaging, pending.token);
  const managed: Array<[string, string]> = [
    [paths.workspaceDb, BACKUP_DATABASE],
    [`${paths.workspaceDb}-wal`, `${BACKUP_DATABASE}-wal`],
    [`${paths.workspaceDb}-shm`, `${BACKUP_DATABASE}-shm`],
    [paths.attachments, 'attachments'],
    [paths.avatars, 'avatars'],
  ];
  const moved: Array<[string, string]> = [];
  const finish = () => {
    rmSync(paths.restorePending, { force: true });
    rmSync(paths.restoreStaging, { recursive: true, force: true });
  };
  try {
    const info = JSON.parse(readFileSync(join(staging, STAGED_INFO), 'utf-8')) as StagedInfo;
    rmSync(paths.restoreRollback, { recursive: true, force: true });
    mkdirSync(paths.restoreRollback, { recursive: true });
    for (const [live, name] of managed) {
      if (!existsSync(live)) continue;
      const aside = join(paths.restoreRollback, name);
      renameSync(live, aside);
      moved.push([live, aside]);
    }
    renameSync(join(staging, BACKUP_DATABASE), paths.workspaceDb);
    renameSync(join(staging, 'attachments'), paths.attachments);
    renameSync(join(staging, 'avatars'), paths.avatars);

    const opened = await openWorkspace({
      dbPath: paths.workspaceDb,
      backupsDir: paths.backups,
      migrations: options.migrations,
      logger,
      ...(options.now ? { now: options.now } : {}),
    });
    try {
      rebuildSearchIndex(opened.db);
      if (opened.db.pragma('integrity_check', { simple: true }) !== 'ok')
        throw invalid('integrity');
    } finally {
      opened.db.close();
    }
    rmSync(paths.restoreRollback, { recursive: true, force: true });
    finish();
    const result: RestoreResult = {
      restoredAt: (options.now ?? (() => new Date()))().toISOString(),
      schemaVersion: info.schemaVersion,
      safetyBackupFileName: pending.safetyBackupFileName,
    };
    logger.info('restore activated', { schemaVersion: info.schemaVersion });
    return { status: 'restored', result };
  } catch (error) {
    logger.error('restore failed; previous workspace kept', { error });
    for (const [live] of managed) rmSync(live, { recursive: true, force: true });
    for (const [live, aside] of moved) renameSync(aside, live);
    for (const dir of [paths.attachments, paths.avatars]) mkdirSync(dir, { recursive: true });
    rmSync(paths.restoreRollback, { recursive: true, force: true });
    finish();
    return { status: 'failed' };
  }
}

// --- Automatic backups ----------------------------------------------------------

export interface AutoBackupState {
  enabled: boolean;
  folder: string | null;
  intervalHours: number;
  retention: number;
  lastRunAt: string | null;
}

export type AutoBackupOutcome =
  | { status: 'skipped' }
  | { status: 'created'; result: BackupResult; deleted: string[] }
  | { status: 'failed'; messageKey: string };

/**
 * D13: on launch, at most once per interval, into the chosen folder; keeps the newest
 * `retention` automatic backups and deletes only older files named like automatic backups.
 */
export async function runAutomaticBackup(
  state: AutoBackupState,
  backup: (target: string) => Promise<BackupResult>,
  now: Date,
): Promise<AutoBackupOutcome> {
  if (!state.enabled || !state.folder) return { status: 'skipped' };
  const due =
    state.lastRunAt === null ||
    now.getTime() - new Date(state.lastRunAt).getTime() >= state.intervalHours * 3_600_000;
  if (!due) return { status: 'skipped' };
  try {
    if (!statSync(state.folder).isDirectory()) throw new Error('not a directory');
  } catch {
    return { status: 'failed', messageKey: 'errors.autoBackupFolderUnavailable' };
  }
  try {
    const result = await backup(join(state.folder, autoBackupFileName(now)));
    return {
      status: 'created',
      result,
      deleted: pruneAutomaticBackups(state.folder, state.retention),
    };
  } catch (error) {
    return {
      status: 'failed',
      messageKey: error instanceof AppError ? error.message : 'errors.backupFailed',
    };
  }
}

/** Deletes all but the newest `retention` automatic backups; other files are left alone. */
export function pruneAutomaticBackups(folder: string, retention: number): string[] {
  const automatic = readdirSync(folder)
    .filter((name) => AUTO_BACKUP_PATTERN.test(name))
    .sort()
    .reverse();
  const deleted: string[] = [];
  for (const name of automatic.slice(retention)) {
    try {
      rmSync(join(folder, name), { force: true });
      deleted.push(name);
    } catch {
      // Left for the next run.
    }
  }
  return deleted;
}
