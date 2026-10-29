// Managed attachment storage (spec §3.6, FILE-01..05, D03, D33, threat model T5/T10/T11,
// ADR 0011). Electron-free so it can be unit-tested; `main.ts` provides the dialogs and the
// OS handler, `media-protocol.ts` serves previews.
//
// Import order (staged copy → metadata transaction → finalize): the bytes are copied to
// `.staging/<key>` while hashing, the row and its history event are committed, then the file
// is renamed to `<key>`. `reconcile()` finishes or discards whatever a crash left behind.
// Storage paths are built from opaque keys only; original names never touch the disk except
// as sanitized names of temporary copies opened by the user.

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
} from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AttachmentService } from '@glacier-tasks/data';
import {
  AppError,
  type AttachmentMetadata,
  attachmentMime,
  type DroppedFile,
  sanitizeFileName,
} from '@glacier-tasks/domain';
import { resolveInside } from './fs-safe.js';
import type { Logger } from './logger.js';

const STAGING = '.staging';
/** Enough bytes for every preview signature (WebP needs 12). */
const HEAD_BYTES = 16;

export interface AttachmentStoreOptions {
  /** Managed directory (`<userData>/attachments`). */
  dir: string;
  /** Temporary copies handed to the OS handler; cleared on startup. */
  openDir: string;
  attachments: AttachmentService;
  logger: Logger;
  /** Current per-file limit in bytes (device setting, D47). */
  maxBytes: () => number;
  newKey?: () => string;
}

const tooLarge = () => new AppError('VALIDATION', 'errors.attachmentTooLarge');
const unreadable = () => new AppError('IO', 'errors.attachmentUnreadable');

export class AttachmentStore {
  private readonly newKey: () => string;

  constructor(private readonly options: AttachmentStoreOptions) {
    this.newKey = options.newKey ?? randomUUID;
    mkdirSync(this.stagingDir(), { recursive: true });
  }

  /** Copies a file the user picked (main-process dialog) into managed storage. */
  async importFrom(taskId: string, sourcePath: string): Promise<AttachmentMetadata> {
    this.options.attachments.list(taskId); // NOT_FOUND before touching the disk
    const limit = this.options.maxBytes();
    try {
      const stats = await stat(sourcePath);
      if (!stats.isFile()) throw unreadable();
      if (stats.size > limit) throw tooLarge();
    } catch (error) {
      throw error instanceof AppError ? error : unreadable();
    }
    const key = this.newKey();
    const staged = this.stagedPath(key);
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        // The file may grow between stat and copy.
        if (size > limit) return done(tooLarge());
        if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(createReadStream(sourcePath), measure, createWriteStream(staged));
    } catch (error) {
      rmSync(staged, { force: true });
      throw error instanceof AppError ? error : unreadable();
    }
    return this.commit(taskId, basename(sourcePath), key, size, hash.digest('hex'), head);
  }

  /** Drag & drop: bytes from the renderer, never a path (T5). */
  async importFiles(
    taskId: string,
    files: ReadonlyArray<DroppedFile>,
  ): Promise<AttachmentMetadata[]> {
    this.options.attachments.list(taskId);
    const limit = this.options.maxBytes();
    if (files.some((file) => file.bytes.length > limit)) throw tooLarge();
    const added: AttachmentMetadata[] = [];
    for (const file of files) {
      const key = this.newKey();
      await writeFile(this.stagedPath(key), file.bytes);
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      added.push(this.commit(taskId, file.name, key, file.bytes.length, sha256, file.bytes));
    }
    return added;
  }

  /** Bytes of a live, previewable attachment for the media protocol (T10), else null. */
  read(id: string): { bytes: Buffer; mimeType: string } | null {
    try {
      const attachment = this.options.attachments.getLive(id);
      if (!attachment.previewable) return null;
      return {
        bytes: readFileSync(resolveInside(this.options.dir, attachment.storageKey)),
        mimeType: attachment.mimeType,
      };
    } catch {
      return null;
    }
  }

  /**
   * A temporary copy under its sanitized original name, for the OS handler (T11): the OS can
   * pick an app by extension, and nothing it does reaches the managed bytes.
   */
  async openCopy(id: string): Promise<string> {
    const attachment = this.options.attachments.getLive(id);
    const folder = join(this.options.openDir, randomUUID());
    await mkdir(folder, { recursive: true });
    const target = join(folder, sanitizeFileName(attachment.originalName));
    await this.copyOut(attachment.storageKey, target);
    return target;
  }

  /** Copies the bytes to a target the user chose in the save dialog. */
  async saveTo(id: string, target: string): Promise<void> {
    await this.copyOut(this.options.attachments.getLive(id).storageKey, target);
  }

  /** Default file name for the save dialog. */
  saveName(id: string): string {
    return sanitizeFileName(this.options.attachments.getLive(id).originalName);
  }

  /** D03: tombstone and history first, then the bytes go immediately. */
  remove(id: string): void {
    const key = this.options.attachments.remove(id);
    try {
      rmSync(resolveInside(this.options.dir, key), { force: true });
    } catch (error) {
      // The row is already a tombstone; reconcile() deletes the orphan on the next start.
      this.options.logger.warn('removed attachment bytes could not be deleted', { error });
    }
  }

  /** Bytes of permanently deleted attachments (TRASH-05); leftovers go at the next start. */
  deleteFiles(keys: ReadonlyArray<string>): void {
    for (const key of keys) {
      try {
        rmSync(resolveInside(this.options.dir, key), { force: true });
      } catch (error) {
        this.options.logger.warn('purged attachment bytes could not be deleted', { error });
      }
    }
  }

  /**
   * Startup reconciliation (spec §3.6): finishes staged files whose row was committed,
   * deletes other staged files and every file without a live row (failed imports, bytes of
   * removed attachments), and reports rows whose file is missing. One bad entry never
   * blocks startup.
   */
  reconcile(): { finalized: number; removed: number; missing: number; failed: number } {
    const keys = new Set(this.options.attachments.storageKeys());
    const result = { finalized: 0, removed: 0, missing: 0, failed: 0 };
    const attempt = (name: string, action: () => void) => {
      try {
        action();
      } catch (error) {
        result.failed++;
        this.options.logger.warn('attachment storage entry could not be reconciled', {
          name,
          error,
        });
      }
    };
    for (const name of readdirSync(this.stagingDir())) {
      attempt(name, () => {
        const staged = resolveInside(this.stagingDir(), name);
        if (keys.has(name) && !existsSync(resolveInside(this.options.dir, name))) {
          renameSync(staged, resolveInside(this.options.dir, name));
          result.finalized++;
        } else {
          rmSync(staged, { recursive: true, force: true });
          result.removed++;
        }
      });
    }
    const present = new Set(readdirSync(this.options.dir).filter((name) => name !== STAGING));
    for (const name of present) {
      if (keys.has(name)) continue;
      attempt(name, () => {
        rmSync(resolveInside(this.options.dir, name), { recursive: true, force: true });
        result.removed++;
      });
    }
    for (const key of keys) if (!present.has(key)) result.missing++;
    if (Object.values(result).some((count) => count > 0)) {
      this.options.logger.warn('attachment storage reconciled', result);
    }
    return result;
  }

  /** Deletes temporary copies from earlier sessions. */
  clearOpenCopies(): void {
    try {
      rmSync(this.options.openDir, { recursive: true, force: true });
    } catch (error) {
      this.options.logger.warn('temporary attachment copies could not be removed', { error });
    }
  }

  private commit(
    taskId: string,
    name: string,
    key: string,
    byteSize: number,
    sha256: string,
    head: Uint8Array,
  ): AttachmentMetadata {
    const staged = this.stagedPath(key);
    let metadata: AttachmentMetadata;
    try {
      metadata = this.options.attachments.insert(taskId, {
        originalName: name.trim() || 'attachment',
        mimeType: attachmentMime(name, head),
        byteSize,
        sha256,
        storageKey: key,
      });
    } catch (error) {
      rmSync(staged, { force: true });
      throw error;
    }
    try {
      renameSync(staged, resolveInside(this.options.dir, key));
    } catch (error) {
      // The row exists; reconcile() moves the staged file into place on the next start.
      this.options.logger.warn('staged attachment could not be finalized', { error });
    }
    return metadata;
  }

  private async copyOut(key: string, target: string): Promise<void> {
    try {
      await copyFile(resolveInside(this.options.dir, key), target);
    } catch {
      throw unreadable();
    }
  }

  private stagingDir(): string {
    return join(this.options.dir, STAGING);
  }

  private stagedPath(key: string): string {
    return resolveInside(this.stagingDir(), key);
  }
}
