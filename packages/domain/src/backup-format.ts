// Complete backup archive format (D34, DATA-01/04/08, threat model T8, ADR 0012).
//
// A `.glaciertasks` file is a ZIP archive with `manifest.json`, a consistent SQLite snapshot
// `workspace.sqlite`, and the managed files `attachments/<key>` and `avatars/<key>`. The
// manifest lists every other entry with its size and SHA-256; restore accepts nothing else.

import { z } from 'zod';

export const BACKUP_FORMAT = 'glacier-tasks-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = 'glaciertasks';
export const BACKUP_MANIFEST = 'manifest.json';
export const BACKUP_DATABASE = 'workspace.sqlite';

/** Managed storage keys are opaque UUID-like names (ADR 0007, ADR 0011). */
const KEY = '[A-Za-z0-9-]{1,64}';
const ENTRY_PATTERN = new RegExp(`^(?:${BACKUP_DATABASE}|attachments/${KEY}|avatars/${KEY})$`);

/** True for the only entry names a backup may contain besides the manifest (T8). */
export function isBackupEntryName(name: string): boolean {
  return ENTRY_PATTERN.test(name);
}

export const BACKUP_LIMITS = {
  /** Entries besides the manifest. */
  maxEntries: 200_000,
  maxManifestBytes: 64 * 1024 * 1024,
  /** Uncompressed / compressed; anything beyond is treated as a decompression bomb. */
  maxCompressionRatio: 200,
} as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const backupManifestSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string().max(64),
  schemaVersion: z.int().positive(),
  createdAt: z.iso.datetime(),
  kind: z.enum(['manual', 'automatic', 'safety']),
  entries: z
    .array(
      z.strictObject({
        path: z.string().refine(isBackupEntryName, 'Invalid entry name'),
        size: z.int().nonnegative(),
        sha256,
      }),
    )
    .max(BACKUP_LIMITS.maxEntries)
    .refine((entries) => entries.some((e) => e.path === BACKUP_DATABASE), 'Missing database')
    .refine(
      (entries) => new Set(entries.map((e) => e.path)).size === entries.length,
      'Duplicate entries',
    ),
});
export type BackupManifest = z.output<typeof backupManifestSchema>;

/** File name of an automatic backup; retention only ever deletes names of this shape (D13). */
export const AUTO_BACKUP_PATTERN = /^glacier-tasks-auto-\d{8}-\d{6}\.glaciertasks$/;

export function autoBackupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `glacier-tasks-auto-${stamp}.${BACKUP_EXTENSION}`;
}

/** JSON export marker (D14, DATA-02/03): never accepted by restore. */
export const EXPORT_FORMAT = 'glacier-tasks-export';
export const EXPORT_NOTICE =
  'Glacier Tasks JSON export. This file is NOT a backup and cannot be restored or imported. ' +
  'It contains no attachment or avatar files. Use "Create backup" for a complete, restorable copy.';
