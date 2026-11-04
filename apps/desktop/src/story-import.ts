// Reading story files for import (DATA-11, ADR 0014, threat model T15). The file is untrusted:
// it is size-limited, parsed as JSON and validated with the strict schema before any service
// sees it. The validated document waits in memory until the user confirms the preview.

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  AppError,
  STORY_IMPORT_MAX_BYTES,
  type StoryTransfer,
  storyTransferSchema,
} from '@glacier-tasks/domain';

const invalid = () => new AppError('VALIDATION', 'errors.importInvalid');
const tooLarge = () => new AppError('VALIDATION', 'errors.importTooLarge');

/**
 * The file text for an exported story. A story that the import would reject (too many
 * subtasks, more than `maxBytes`) fails with `exportTooLarge` instead of writing a file
 * that can never be imported.
 */
export function serializeStory(doc: StoryTransfer, maxBytes = STORY_IMPORT_MAX_BYTES): string {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (!storyTransferSchema.safeParse(doc).success || Buffer.byteLength(text) > maxBytes) {
    throw new AppError('VALIDATION', 'errors.exportTooLarge');
  }
  return text;
}

/** Reads and validates a story file; throws `importTooLarge` or `importInvalid`. */
export function readStoryFile(path: string, maxBytes = STORY_IMPORT_MAX_BYTES): StoryTransfer {
  let text: string;
  try {
    if (statSync(path).size > maxBytes) throw tooLarge();
    const bytes = readFileSync(path);
    // The file may have grown since the check.
    if (bytes.length > maxBytes) throw tooLarge();
    text = bytes.toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('IO', 'errors.importReadFailed');
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw invalid();
  }
  const parsed = storyTransferSchema.safeParse(json);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export interface PendingImport {
  token: string;
  fileName: string;
  doc: StoryTransfer;
}

/** Holds the one previewed story file; a new preview replaces it. */
export class PendingStoryImport {
  private pending: PendingImport | undefined;

  constructor(private readonly newToken: () => string = randomUUID) {}

  set(path: string, doc: StoryTransfer): PendingImport {
    this.pending = { token: this.newToken(), fileName: basename(path), doc };
    return this.pending;
  }

  /** Returns the pending file for `token` and forgets it; `importExpired` otherwise. */
  take(token: string): PendingImport {
    const pending = this.pending;
    if (!pending || pending.token !== token) {
      throw new AppError('CONFLICT', 'errors.importExpired');
    }
    this.pending = undefined;
    return pending;
  }

  /** Puts a taken file back, e.g. after a failed import so the user can retry. */
  restore(pending: PendingImport): void {
    this.pending ??= pending;
  }
}
