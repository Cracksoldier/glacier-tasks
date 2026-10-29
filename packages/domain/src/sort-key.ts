// Fractional sort keys for board/list ordering (D26).
//
// Keys are base-62 strings whose alphabet is in ASCII order, so SQLite's default BINARY
// collation and JavaScript string comparison both sort them correctly. A key never ends in
// '0', which guarantees that a key can always be generated before any existing key.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

const SORT_KEY_PATTERN = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isValidSortKey(key: string): boolean {
  return SORT_KEY_PATTERN.test(key);
}

function digitValue(char: string): number {
  const value = DIGITS.indexOf(char);
  if (value < 0) throw new Error(`Invalid sort key character: ${char}`);
  return value;
}

/** Midpoint of fractional strings `a` < `b`; `b === null` means "no upper bound". */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Skip the common prefix (treating missing digits of `a` as '0').
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? digitValue(a[0] as string) : 0;
  const digitB = b !== null && b.length > 0 ? digitValue(b[0] as string) : BASE;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)] as string;
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return (DIGITS[digitA] as string) + midpoint(a.slice(1), null);
}

/**
 * Returns a key strictly between `before` and `after`.
 * `null` means "start of list" for `before` and "end of list" for `after`.
 */
export function sortKeyBetween(before: string | null, after: string | null): string {
  if (before !== null && !isValidSortKey(before)) throw new Error('Invalid lower sort key');
  if (after !== null && !isValidSortKey(after)) throw new Error('Invalid upper sort key');
  if (before !== null && after !== null && before >= after) {
    throw new Error('Lower sort key must be less than upper sort key');
  }
  return midpoint(before ?? '', after);
}
