// Managed avatar storage (D24, threat model T5/T10, ADR 0007). Electron-free so it can be
// unit-tested; `main.ts` provides the file picker and `media-protocol.ts` serves the bytes.
//
// Import order: validate the source → write the bytes under a fresh opaque key → commit the
// metadata transaction → delete the replaced file. A crash between the steps leaves at most
// an unreferenced file, which `reconcile()` removes on the next start.

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import type { UserService } from '@glacier-tasks/data';
import {
  AppError,
  AVATAR_MAX_BYTES,
  detectImageMime,
  type UserProfile,
} from '@glacier-tasks/domain';
import { resolveInside, writeFileAtomic } from './fs-safe.js';
import type { Logger } from './logger.js';

export interface AvatarStoreOptions {
  dir: string;
  users: UserService;
  logger: Logger;
  newKey?: () => string;
}

export class AvatarStore {
  private readonly newKey: () => string;

  constructor(private readonly options: AvatarStoreOptions) {
    this.newKey = options.newKey ?? randomUUID;
  }

  /** Copies a user-picked image into managed storage and assigns it to the profile. */
  importFrom(userId: string, sourcePath: string): UserProfile {
    this.options.users.get(userId); // NOT_FOUND before touching the disk
    const bytes = readSource(sourcePath);
    const mimeType = detectImageMime(bytes);
    if (!mimeType) throw new AppError('VALIDATION', 'errors.avatarUnsupported');

    const storageKey = this.newKey();
    const target = resolveInside(this.options.dir, storageKey);
    writeFileAtomic(target, bytes);
    let change: ReturnType<UserService['setAvatar']>;
    try {
      change = this.options.users.setAvatar(userId, {
        storageKey,
        mimeType,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteSize: bytes.length,
      });
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
    this.deleteFile(change.replacedStorageKey);
    return change.user;
  }

  remove(userId: string): UserProfile {
    const change = this.options.users.clearAvatar(userId);
    this.deleteFile(change.replacedStorageKey);
    return change.user;
  }

  /** Bytes of a known avatar file, or null if the id is unknown or the file is missing. */
  read(avatarFileId: string): { bytes: Buffer; mimeType: string } | null {
    const file = this.options.users.findAvatarFile(avatarFileId);
    if (!file) return null;
    try {
      return {
        bytes: readFileSync(resolveInside(this.options.dir, file.storageKey)),
        mimeType: file.mimeType,
      };
    } catch {
      return null;
    }
  }

  /**
   * Startup reconciliation (spec §3.6): removes files no avatar row references (interrupted
   * imports, failed deletions) and reports rows whose bytes are missing; those profiles fall
   * back to initials in the UI.
   */
  reconcile(): { removed: number; missing: number } {
    const referenced = new Set(this.options.users.avatarStorageKeys());
    const present = new Set(readdirSync(this.options.dir));
    let removed = 0;
    for (const name of present) {
      if (referenced.has(name)) continue;
      rmSync(resolveInside(this.options.dir, name), { recursive: true, force: true });
      removed++;
    }
    const missing = [...referenced].filter((key) => !present.has(key)).length;
    if (removed > 0 || missing > 0) {
      this.options.logger.warn('avatar storage reconciled', { removed, missing });
    }
    return { removed, missing };
  }

  private deleteFile(storageKey: string | null): void {
    if (!storageKey) return;
    try {
      rmSync(resolveInside(this.options.dir, storageKey), { force: true });
    } catch (error) {
      // The row is already gone; reconcile() removes the orphan on the next start.
      this.options.logger.warn('replaced avatar file could not be deleted', { error });
    }
  }
}

function readSource(sourcePath: string): Buffer {
  let bytes: Buffer;
  try {
    const stats = statSync(sourcePath);
    if (!stats.isFile()) throw new AppError('VALIDATION', 'errors.avatarUnsupported');
    if (stats.size > AVATAR_MAX_BYTES) throw new AppError('VALIDATION', 'errors.avatarTooLarge');
    bytes = readFileSync(sourcePath);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('IO', 'errors.avatarUnreadable');
  }
  // The file may have grown between stat and read.
  if (bytes.length > AVATAR_MAX_BYTES) throw new AppError('VALIDATION', 'errors.avatarTooLarge');
  return bytes;
}
