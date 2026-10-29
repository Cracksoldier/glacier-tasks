import { describe, expect, it } from 'vitest';
import {
  checkTitle,
  checkWorkflow,
  formatIssueKey,
  isDateRangeValid,
  isValidLocalDate,
  isValidProjectKey,
  normalizeProjectKey,
  parseIssueKey,
  profileInitials,
  subtaskProgress,
} from './invariants.js';
import { DEFAULT_STATUSES } from './enums.js';

describe('project keys (D08)', () => {
  it.each(['GAME', 'AB', 'A1', 'ABCDEFGHIJ', 'X2Y3'])('accepts %s', (key) => {
    expect(isValidProjectKey(key)).toBe(true);
  });

  it.each(['', 'A', 'game', '1AB', 'AB-1', 'ABCDEFGHIJK', 'ÄB', 'AB '])('rejects %j', (key) => {
    expect(isValidProjectKey(key)).toBe(false);
  });

  it('normalizes input before validation', () => {
    expect(normalizeProjectKey('  game ')).toBe('GAME');
  });
});

describe('issue keys', () => {
  it('formats and parses round-trip', () => {
    expect(formatIssueKey('GAME', 42)).toBe('GAME-42');
    expect(parseIssueKey('GAME-42')).toEqual({ projectKey: 'GAME', issueNumber: 42 });
  });

  it('parses case-insensitively', () => {
    expect(parseIssueKey(' game-7 ')).toEqual({ projectKey: 'GAME', issueNumber: 7 });
  });

  it.each(['GAME', 'GAME-', 'GAME-0', 'GAME-01', '-1', 'G-1', 'GAME-1a'])('rejects %j', (v) => {
    expect(parseIssueKey(v)).toBeUndefined();
  });
});

describe('titles', () => {
  it('trims and accepts', () => {
    expect(checkTitle('  Implement inventory ')).toEqual({
      ok: true,
      value: 'Implement inventory',
    });
  });

  it('rejects empty and whitespace-only', () => {
    expect(checkTitle('   ')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('enforces 255 characters after trimming', () => {
    expect(checkTitle(` ${'a'.repeat(255)} `).ok).toBe(true);
    expect(checkTitle('a'.repeat(256))).toEqual({ ok: false, reason: 'TOO_LONG' });
  });
});

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidLocalDate('2026-10-29')).toBe(true);
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
    expect(isValidLocalDate('2026-10-29T00:00:00Z')).toBe(false);
  });

  it('requires start date not after due date', () => {
    expect(isDateRangeValid('2026-10-01', '2026-10-31')).toBe(true);
    expect(isDateRangeValid('2026-10-31', '2026-10-31')).toBe(true);
    expect(isDateRangeValid('2026-11-01', '2026-10-31')).toBe(false);
    expect(isDateRangeValid(null, '2026-10-31')).toBe(true);
    expect(isDateRangeValid('2026-11-01', null)).toBe(true);
  });
});

describe('workflow (D07, D32)', () => {
  it('accepts the default workflow', () => {
    expect(checkWorkflow(DEFAULT_STATUSES)).toEqual({ ok: true });
  });

  it('requires exactly one default and at least one DONE status', () => {
    expect(checkWorkflow([])).toEqual({ ok: false, reason: 'EMPTY' });
    expect(checkWorkflow([{ category: 'DONE', isDefault: false }])).toEqual({
      ok: false,
      reason: 'NO_DEFAULT',
    });
    expect(
      checkWorkflow([
        { category: 'TODO', isDefault: true },
        { category: 'DONE', isDefault: true },
      ]),
    ).toEqual({ ok: false, reason: 'MULTIPLE_DEFAULTS' });
    expect(checkWorkflow([{ category: 'TODO', isDefault: true }])).toEqual({
      ok: false,
      reason: 'NO_DONE',
    });
  });
});

describe('subtask progress (TASK-06)', () => {
  it('counts DONE categories only', () => {
    expect(subtaskProgress(['DONE', 'TODO', 'IN_PROGRESS', 'DONE'])).toEqual({ done: 2, total: 4 });
    expect(subtaskProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe('profile initials (USER-02)', () => {
  it.each([
    ['Alex', 'A'],
    ['alex smith', 'AS'],
    ['  Mary Jane  Watson ', 'MW'],
    ['Ölaf', 'Ö'],
    ['', '?'],
  ])('%j → %s', (name, expected) => {
    expect(profileInitials(name)).toBe(expected);
  });
});
