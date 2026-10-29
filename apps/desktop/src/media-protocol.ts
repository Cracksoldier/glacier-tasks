// Custom `glacier-media://` protocol for managed images (threat model T10, ADR 0007).
// Only `glacier-media://avatar/<uuid>` of a known avatar row is served; attachments follow
// in M6. The renderer never receives file:// paths.

import { protocol, type Session } from 'electron';
import { MEDIA_SCHEME, parseMediaUrl } from '@glacier-tasks/domain';
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
): void {
  session.protocol.handle(MEDIA_SCHEME, (request) => {
    const target = request.method === 'GET' ? parseMediaUrl(request.url) : undefined;
    const file = target ? avatars()?.read(target.id) : null;
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
