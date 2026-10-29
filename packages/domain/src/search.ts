// Full-text search input (SEARCH-02, ADR 0010).

/**
 * Turns user input into an FTS5 MATCH expression: every whitespace-separated word becomes a
 * quoted prefix term (`"word"*`), and all of them must match. Quoting makes FTS syntax such as
 * `OR`, `NEAR(…)`, `col:` or `*` plain text, so no input can produce a query error. A word with
 * punctuation stays one phrase, which is how `GAME-12` finds its task key. Returns `null` when
 * nothing searchable is left.
 */
export function toFtsQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((word) => word.replaceAll('"', ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word) => `"${word}"*`);
  return terms.length > 0 ? terms.join(' ') : null;
}
