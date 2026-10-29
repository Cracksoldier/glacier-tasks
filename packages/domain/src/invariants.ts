// Pure, side-effect-free domain rules. The main process enforces them before writing;
// the renderer may reuse them for immediate form feedback. See docs/architecture.md §4.

import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from './limits.js';

/** Project key format (D08): uppercase letter followed by 1–9 uppercase letters/digits. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_PATTERN.test(key);
}

/** Normalizes user input for a project key: trims and upper-cases. Does not validate. */
export function normalizeProjectKey(input: string): string {
  return input.trim().toUpperCase();
}

const ISSUE_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)$/;

export function formatIssueKey(projectKey: string, issueNumber: number): string {
  return `${projectKey}-${issueNumber}`;
}

export function parseIssueKey(
  value: string,
): { projectKey: string; issueNumber: number } | undefined {
  const match = ISSUE_KEY_PATTERN.exec(value.trim().toUpperCase());
  if (!match) return undefined;
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber)) return undefined;
  return { projectKey: match[1] as string, issueNumber };
}

export type TitleCheck = { ok: true; value: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' };

/** Titles are required, trimmed and at most 255 characters (spec §3.3). */
export function checkTitle(input: string, maxLength = TITLE_MAX_LENGTH): TitleCheck {
  const value = input.trim();
  if (value.length === 0) return { ok: false, reason: 'EMPTY' };
  if (value.length > maxLength) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, value };
}

export function isDescriptionWithinLimit(markdown: string): boolean {
  return markdown.length <= DESCRIPTION_MAX_LENGTH;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form (date-only fields are local dates). */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Start date must not be after due date when both are set (spec §3.3). */
export function isDateRangeValid(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  if (!startDate || !dueDate) return true;
  // ISO local dates compare correctly as strings.
  return startDate <= dueDate;
}

/** Validates a set of workflow statuses for one project (spec §3.4, D07). */
export function checkWorkflow(
  statuses: ReadonlyArray<{ category: string; isDefault: boolean }>,
): { ok: true } | { ok: false; reason: 'EMPTY' | 'NO_DEFAULT' | 'MULTIPLE_DEFAULTS' | 'NO_DONE' } {
  if (statuses.length === 0) return { ok: false, reason: 'EMPTY' };
  const defaults = statuses.filter((s) => s.isDefault).length;
  if (defaults === 0) return { ok: false, reason: 'NO_DEFAULT' };
  if (defaults > 1) return { ok: false, reason: 'MULTIPLE_DEFAULTS' };
  if (!statuses.some((s) => s.category === 'DONE')) return { ok: false, reason: 'NO_DONE' };
  return { ok: true };
}

/** Subtask progress (`done/total`) based on status category, never on status name (TASK-06). */
export function subtaskProgress(subtaskCategories: ReadonlyArray<string>): {
  done: number;
  total: number;
} {
  return {
    done: subtaskCategories.filter((c) => c === 'DONE').length,
    total: subtaskCategories.length,
  };
}

/** Initials fallback for profiles without avatar (USER-02). */
export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0] as string)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] as string)[0] ?? '') : '';
  return (first + last).toUpperCase();
}
