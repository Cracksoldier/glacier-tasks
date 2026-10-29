// Fractional sort keys for board/list ordering (D26).
//
// Keys are base-62 strings whose alphabet is in ASCII order, so SQLite's default BINARY
// collation and JavaScript string comparison both sort them correctly. The format follows the
// rocicorp `fractional-indexing` design (CC0): a variable-length integer part followed by an
// optional fraction. The integer part's head character encodes its length ('a'–'z': 2–27
// characters for non-negative integers, 'Z'–'A': 2–27 characters for negative ones). Moving
// to the start or end of a list decrements or increments the integer part, so keys grow only
// logarithmically there; fractions are needed only between two neighbours. A fraction never
// ends in '0', which guarantees that a key can always be generated between any two keys.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO = DIGITS[0] as string;
const LAST = DIGITS[BASE - 1] as string;
/** The smallest integer part; it can't be decremented, so keys before it use a fraction. */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

const SORT_KEY_PATTERN = /^[0-9A-Za-z]+$/;

/** Length of the integer part announced by its head character, or `null` for a digit. */
function integerLength(head: string): number | null {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  return null;
}

export function isValidSortKey(key: string): boolean {
  if (!SORT_KEY_PATTERN.test(key) || key === SMALLEST_INTEGER) return false;
  const length = integerLength(key[0] as string);
  if (length === null || length > key.length) return false;
  return !key.slice(length).endsWith(ZERO);
}

function digitValue(char: string): number {
  const value = DIGITS.indexOf(char);
  if (value < 0) throw new Error(`Invalid sort key character: ${char}`);
  return value;
}

function integerPart(key: string): string {
  return key.slice(0, integerLength(key[0] as string) as number);
}

/** Midpoint of fractional strings `a` < `b`; `b === null` means "no upper bound". */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Skip the common prefix (treating missing digits of `a` as '0').
    let n = 0;
    while (n < b.length && (a[n] ?? ZERO) === b[n]) n++;
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

/** The next integer part, or `null` past the largest one. */
function incrementInteger(integer: string): string | null {
  const head = integer[0] as string;
  const digits = integer.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const value = digitValue(digits[i] as string) + 1;
    if (value === BASE) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS[value] as string;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

/** The previous integer part, or `null` before the smallest one. */
function decrementInteger(integer: string): string | null {
  const head = integer[0] as string;
  const digits = integer.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const value = digitValue(digits[i] as string) - 1;
    if (value < 0) {
      digits[i] = LAST;
    } else {
      digits[i] = DIGITS[value] as string;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${LAST}`;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(LAST);
  else digits.pop();
  return nextHead + digits.join('');
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

  if (before === null) {
    if (after === null) return `a${ZERO}`;
    const intAfter = integerPart(after);
    if (intAfter === SMALLEST_INTEGER) {
      return intAfter + midpoint('', after.slice(intAfter.length));
    }
    if (intAfter < after) return intAfter;
    const previous = decrementInteger(intAfter);
    if (previous === null) throw new Error('Sort key space exhausted');
    return previous;
  }

  const intBefore = integerPart(before);
  const fracBefore = before.slice(intBefore.length);
  if (after === null) {
    const next = incrementInteger(intBefore);
    return next ?? intBefore + midpoint(fracBefore, null);
  }

  const intAfter = integerPart(after);
  if (intBefore === intAfter) {
    return intBefore + midpoint(fracBefore, after.slice(intAfter.length));
  }
  const next = incrementInteger(intBefore);
  if (next === null) throw new Error('Sort key space exhausted');
  return next < after ? next : intBefore + midpoint(fracBefore, null);
}
