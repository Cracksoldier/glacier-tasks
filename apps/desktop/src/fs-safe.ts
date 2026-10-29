// File-system helpers for app-managed storage (threat model T5).

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Writes via temp file + fsync + rename, so readers never see a partially written file. */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): void {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  const fd = openSync(tempPath, 'w');
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf-8') : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export class PathEscapeError extends Error {
  constructor() {
    super('Path escapes the managed directory');
    this.name = 'PathEscapeError';
  }
}

function isWithin(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Resolves `segments` below `base` and guarantees the result stays inside `base`, also after
 * following symlinks of every existing path component. Segments must be single path
 * components (no separators), e.g. opaque storage keys.
 */
export function resolveInside(base: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      /[\\/]/.test(segment) ||
      segment.includes('\0') ||
      isAbsolute(segment)
    ) {
      throw new PathEscapeError();
    }
  }
  const realBase = realpathSync(base);
  const target = resolve(realBase, ...segments);
  if (!isWithin(realBase, target)) throw new PathEscapeError();

  // Follow symlinks of the deepest existing ancestor (or the target itself).
  let existing = target;
  while (!existsSync(existing) && existing !== realBase) existing = dirname(existing);
  if (!isWithin(realBase, realpathSync(existing))) throw new PathEscapeError();
  return target;
}
