import { describe, expect, it } from 'vitest';
import { isValidSortKey, sortKeyBetween } from './sort-key.js';

function binaryCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe('sortKeyBetween (D26)', () => {
  it('creates a first key', () => {
    const key = sortKeyBetween(null, null);
    expect(isValidSortKey(key)).toBe(true);
  });

  it('creates keys before, after and between', () => {
    const middle = sortKeyBetween(null, null);
    const before = sortKeyBetween(null, middle);
    const after = sortKeyBetween(middle, null);
    const between = sortKeyBetween(before, middle);
    expect([after, between, middle, before].sort(binaryCompare)).toEqual([
      before,
      between,
      middle,
      after,
    ]);
  });

  it('keeps prepending to the top of a column (moved cards go to the top)', () => {
    let top = sortKeyBetween(null, null);
    for (let i = 0; i < 500; i++) {
      const next = sortKeyBetween(null, top);
      expect(next < top).toBe(true);
      expect(isValidSortKey(next)).toBe(true);
      top = next;
    }
  });

  it('keeps inserting between two adjacent keys', () => {
    const low = sortKeyBetween(null, null);
    let high = sortKeyBetween(low, null);
    for (let i = 0; i < 500; i++) {
      const mid = sortKeyBetween(low, high);
      expect(low < mid && mid < high).toBe(true);
      high = mid;
    }
  });

  it('maintains order under random insertions', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const keys: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const index = Math.floor(random() * (keys.length + 1));
      const key = sortKeyBetween(keys[index - 1] ?? null, keys[index] ?? null);
      expect(isValidSortKey(key)).toBe(true);
      keys.splice(index, 0, key);
    }
    expect([...keys].sort(binaryCompare)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps keys short when prepending or appending many times', () => {
    let top = sortKeyBetween(null, null);
    let end = top;
    for (let i = 0; i < 10_000; i++) {
      const nextTop = sortKeyBetween(null, top);
      const nextEnd = sortKeyBetween(end, null);
      expect(nextTop < top && end < nextEnd).toBe(true);
      top = nextTop;
      end = nextEnd;
    }
    expect(top.length).toBeLessThan(10);
    expect(end.length).toBeLessThan(10);
  });

  it('crosses integer lengths in both directions', () => {
    expect(sortKeyBetween('az', null)).toBe('b00');
    expect(sortKeyBetween(null, 'b00')).toBe('az');
    expect(sortKeyBetween(null, 'a0')).toBe('Zz');
    expect(sortKeyBetween('Zz', null)).toBe('a0');
    expect(sortKeyBetween('a0', 'a1')).toBe('a0V');
  });

  it('validates the key format', () => {
    for (const key of ['a0', 'a0V', 'Zz', 'b00', 'b00V', 'd0001']) {
      expect(isValidSortKey(key)).toBe(true);
    }
    // Old fraction-only keys, short integer parts, trailing zero fractions, foreign characters.
    for (const key of ['', 'V', '0V', 'zzV', 'b0', 'a00', 'a0V0', 'a-', `A${'0'.repeat(26)}`]) {
      expect(isValidSortKey(key)).toBe(false);
    }
  });

  it('rejects invalid or inverted bounds', () => {
    expect(() => sortKeyBetween('a1', 'a0')).toThrow();
    expect(() => sortKeyBetween('a0', 'a0')).toThrow();
    expect(() => sortKeyBetween('V', null)).toThrow();
    expect(() => sortKeyBetween('a-b', null)).toThrow();
  });
});
