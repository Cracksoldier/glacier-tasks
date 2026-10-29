import { describe, expect, it } from 'vitest';
import { attachmentMime, detectPreviewMime, sanitizeFileName } from './files.js';
import { attachmentUrl, parseMediaUrl } from './media.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectPreviewMime (D33)', () => {
  it('recognises PNG, JPEG, GIF and WebP by signature only', () => {
    expect(detectPreviewMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(detectPreviewMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectPreviewMime(ascii('GIF89a…'))).toBe('image/gif');
    expect(detectPreviewMime(ascii('GIF87a…'))).toBe('image/gif');
    expect(detectPreviewMime(ascii('RIFF\0\0\0\0WEBPVP8'))).toBe('image/webp');
  });

  it('never previews SVG or unknown content', () => {
    expect(detectPreviewMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(detectPreviewMime(ascii('hello'))).toBeUndefined();
    expect(detectPreviewMime(bytes())).toBeUndefined();
  });
});

describe('attachmentMime', () => {
  it('prefers the signature, then the extension, then octet-stream', () => {
    expect(attachmentMime('photo.txt', ascii('GIF89a'))).toBe('image/gif');
    expect(attachmentMime('notes.TXT', ascii('hi'))).toBe('text/plain');
    expect(attachmentMime('logo.svg', ascii('<svg/>'))).toBe('image/svg+xml');
    expect(attachmentMime('data.bin', ascii('x'))).toBe('application/octet-stream');
    // An extension never claims a previewable type without the matching signature.
    expect(attachmentMime('photo.png', ascii('<svg/>'))).toBe('application/octet-stream');
    expect(attachmentMime('anim.GIF', ascii('nope'))).toBe('application/octet-stream');
    expect(attachmentMime('README', ascii('x'))).toBe('application/octet-stream');
  });
});

describe('sanitizeFileName (T5)', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Windows\\evil.exe', 'evil.exe'],
    ['a<b>c:d"e|f?g*h.txt', 'a_b_c_d_e_f_g_h.txt'],
    ['tab\there.txt', 'tab_here.txt'],
    ['name. . ', 'name'],
    ['CON', '_CON'],
    ['lpt1.txt', '_lpt1.txt'],
    ['..', 'attachment'],
    ['', 'attachment'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('keeps the extension when shortening', () => {
    const long = `${'x'.repeat(300)}.png`;
    const safe = sanitizeFileName(long);
    expect(safe).toHaveLength(255);
    expect(safe.endsWith('.png')).toBe(true);
  });
});

describe('attachment media URLs (T10)', () => {
  it('round-trips and rejects anything else', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(parseMediaUrl(attachmentUrl(id))).toEqual({ kind: 'attachment', id });
    expect(parseMediaUrl(`glacier-media://attachment/${id}/../x`)).toBeUndefined();
    expect(parseMediaUrl('glacier-media://attachment/../../secret')).toBeUndefined();
  });
});
