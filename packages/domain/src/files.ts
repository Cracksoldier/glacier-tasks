// Attachment file rules (spec §3.6, D33, threat model T5/T11). File names are display
// metadata only; types that matter for security come from the file signature.

import { detectImageMime } from './invariants.js';
import { PREVIEWABLE_IMAGE_MIME_TYPES } from './limits.js';

export type PreviewMimeType = (typeof PREVIEWABLE_IMAGE_MIME_TYPES)[number];

/** PNG, JPEG, GIF or WebP by signature; everything else (SVG included) is not previewable. */
export function detectPreviewMime(bytes: Uint8Array): PreviewMimeType | undefined {
  const ascii = String.fromCharCode(...bytes.subarray(0, 6));
  if (ascii === 'GIF87a' || ascii === 'GIF89a') return 'image/gif';
  return detectImageMime(bytes);
}

// Common types for display and for the OS handler's hint; never used to decide previews.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const PREVIEWABLE = new Set<string>(PREVIEWABLE_IMAGE_MIME_TYPES);

/**
 * MIME type for metadata: the detected preview type wins, then the extension. Previews are
 * keyed on the MIME type, so the extension may never claim a previewable type: a `.png`
 * without a PNG signature becomes `application/octet-stream` (D33, T10).
 */
export function attachmentMime(name: string, bytes: Uint8Array): string {
  const preview = detectPreviewMime(bytes);
  if (preview) return preview;
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const byName = extension ? MIME_BY_EXTENSION[extension] : undefined;
  return byName && !PREVIEWABLE.has(byName) ? byName : 'application/octet-stream';
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export const FILE_NAME_MAX_LENGTH = 255;

/**
 * A safe single file name for temporary copies and save dialogs: no path separators,
 * control or reserved characters, no reserved Windows device names, no trailing dots.
 */
export function sanitizeFileName(name: string): string {
  let safe = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!safe || safe === '.' || safe === '..') safe = 'attachment';
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  if (safe.length > FILE_NAME_MAX_LENGTH) {
    const extension = /(\.[a-z0-9]{1,10})$/i.exec(safe)?.[1] ?? '';
    safe = safe.slice(0, FILE_NAME_MAX_LENGTH - extension.length) + extension;
  }
  return safe;
}
