import { describe, expect, it } from 'vitest';
import { toFtsQuery } from './search.js';

describe('toFtsQuery (SEARCH-02)', () => {
  it('turns every word into a quoted prefix term', () => {
    expect(toFtsQuery('inventory  slot')).toBe('"inventory"* "slot"*');
    expect(toFtsQuery('GAME-12')).toBe('"GAME-12"*');
    expect(toFtsQuery('Größe')).toBe('"Größe"*');
  });

  it('neutralises FTS syntax', () => {
    expect(toFtsQuery('a OR b')).toBe('"a"* "OR"* "b"*');
    expect(toFtsQuery('NEAR(x y)')).toBe('"NEAR(x"* "y)"*');
    expect(toFtsQuery('title:"x" *')).toBe('"title:x"*');
  });

  it('returns null when nothing searchable is left', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('  " * - ')).toBeNull();
  });
});
