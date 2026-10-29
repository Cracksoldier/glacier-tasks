// Validation limits (spec §3, D24, D33). Keep in sync with docs/architecture.md.

export const MIB = 1024 * 1024;

export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 100_000;
export const PROJECT_NAME_MAX_LENGTH = 255;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 10_000;
export const USER_NAME_MAX_LENGTH = 100;
export const STATUS_NAME_MAX_LENGTH = 50;
export const LABEL_NAME_MAX_LENGTH = 50;

/** Default per-file attachment limit; configurable (D33). */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 100 * MIB;
/** Raster formats rendered inline; SVG is never previewed (D33). */
export const PREVIEWABLE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const AVATAR_MAX_BYTES = 5 * MIB; // D24
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Automatic backups (D13). */
export const DEFAULT_AUTO_BACKUP_INTERVAL_HOURS = 24;
export const DEFAULT_AUTO_BACKUP_RETENTION = 7;
