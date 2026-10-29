/** One line of a diff between two description versions (D11). */
export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Beyond this many line pairs the LCS table gets too large; fall back to remove-all/add-all. */
const MAX_CELLS = 4_000_000;

/**
 * Line diff via longest common subsequence: lines only in `before` are removed, lines only in
 * `after` are added. Written in-house to avoid a dependency (threat model T14).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  // Common prefix and suffix need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'same', text }));
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  return [...head, ...diffMiddle(middleA, middleB), ...tail];
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  const removed = (text: string): DiffLine => ({ kind: 'removed', text });
  const added = (text: string): DiffLine => ({ kind: 'added', text });
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [...a.map(removed), ...b.map(added)];
  }
  // lengths[i][j] = LCS length of a[i..] and b[j..], stored row-major.
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? (lengths[(i + 1) * width + j + 1] as number) + 1
          : Math.max(lengths[(i + 1) * width + j] as number, lengths[i * width + j + 1] as number);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] as string });
      i++;
      j++;
    } else if ((lengths[(i + 1) * width + j] as number) >= (lengths[i * width + j + 1] as number)) {
      lines.push(removed(a[i++] as string));
    } else {
      lines.push(added(b[j++] as string));
    }
  }
  return [...lines, ...a.slice(i).map(removed), ...b.slice(j).map(added)];
}
