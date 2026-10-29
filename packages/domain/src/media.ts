// URLs of the app's custom media protocol (threat model T10, ADR 0007). The renderer builds
// them; the main process parses them by hand (no `new URL()`) and serves only known ids.

export const MEDIA_SCHEME = 'glacier-media';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MEDIA_URL = new RegExp(`^${MEDIA_SCHEME}://(avatar)/(${UUID})/?$`);

export type MediaKind = 'avatar';

export function avatarUrl(avatarFileId: string): string {
  return `${MEDIA_SCHEME}://avatar/${avatarFileId}`;
}

/** Returns the kind and id of a media URL, or undefined for anything else. */
export function parseMediaUrl(url: string): { kind: MediaKind; id: string } | undefined {
  const match = MEDIA_URL.exec(url.toLowerCase());
  return match ? { kind: match[1] as MediaKind, id: match[2] as string } : undefined;
}
