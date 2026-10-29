// Custom `glacier-media://` protocol for managed images (threat model T10, ADR 0007/0011).
// Only `avatar/<uuid>` of a known avatar row and `attachment/<uuid>` of a live, previewable
// attachment (PNG/JPEG/GIF/WebP by signature, never SVG) are served. The renderer never
// receives file:// paths.

import { protocol, type Session } from 'electron';
import { MEDIA_SCHEME, parseMediaUrl } from '@glacier-tasks/domain';
import type { AttachmentStore } from './attachment-store.js';
import type { AvatarStore } from './avatar-store.js';

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function handleMediaProtocol(
  session: Session,
  avatars: () => AvatarStore | undefined,
  attachments: () => AttachmentStore | undefined,
): void {
  session.protocol.handle(MEDIA_SCHEME, (request) => {
    const target = request.method === 'GET' ? parseMediaUrl(request.url) : undefined;
    const store = target?.kind === 'attachment' ? attachments() : avatars();
    const file = target ? store?.read(target.id) : null;
    if (!file) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
}
