import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathEscapeError, resolveInside, writeFileAtomic } from './fs-safe.js';

let root: string;
let base: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'glacier-fs-safe-'));
  base = join(root, 'managed');
  mkdirSync(base);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('resolveInside (threat model T5)', () => {
  it('resolves opaque keys below the base directory', () => {
    expect(resolveInside(base, 'abc123')).toMatch(/managed[\\/]abc123$/);
  });

  it.each(['..', '.', '', '../outside', 'a/b', 'a\\b', '/etc/passwd', 'C:\\Windows', 'x\0y'])(
    'rejects %j',
    (segment) => {
      expect(() => resolveInside(base, segment)).toThrow(PathEscapeError);
    },
  );

  it('rejects symlinks that point outside the base directory', (context) => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    try {
      symlinkSync(outside, join(base, 'link'), 'junction');
    } catch {
      context.skip(); // creating links needs extra privileges on some systems
    }
    expect(() => resolveInside(base, 'link')).toThrow(PathEscapeError);
    expect(() => resolveInside(base, 'link', 'file')).toThrow(PathEscapeError);
  });
});

describe('writeFileAtomic', () => {
  it('writes content and leaves no temp files behind', () => {
    const file = join(base, 'settings.json');
    writeFileAtomic(file, '{"a":1}');
    writeFileAtomic(file, '{"a":2}');
    expect(readFileSync(file, 'utf-8')).toBe('{"a":2}');
    expect(readdirSync(base)).toEqual(['settings.json']);
  });
});
