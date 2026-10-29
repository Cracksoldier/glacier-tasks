import { describe, expect, it } from 'vitest';
import { avatarUrl, parseMediaUrl } from './media.js';

const ID = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';

describe('media URLs (T10)', () => {
  it('round-trips avatar URLs', () => {
    expect(avatarUrl(ID)).toBe(`glacier-media://avatar/${ID}`);
    expect(parseMediaUrl(avatarUrl(ID))).toEqual({ kind: 'avatar', id: ID });
    // Chromium normalizes standard-scheme URLs; a trailing slash is tolerated.
    expect(parseMediaUrl(`${avatarUrl(ID)}/`)).toEqual({ kind: 'avatar', id: ID });
  });

  it.each([
    `glacier-media://avatar/${ID}/../../etc/passwd`,
    `glacier-media://avatar/..%2F..%2Fsecret`,
    `glacier-media://attachment/${ID}`,
    `glacier-media://avatar/${ID}?x=1`,
    `glacier-media://avatar/not-a-uuid`,
    `file:///C:/avatars/${ID}`,
    `https://example.com/avatar/${ID}`,
  ])('rejects %s', (url) => {
    expect(parseMediaUrl(url)).toBeUndefined();
  });
});
