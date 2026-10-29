// Migration 0002 — re-key task ordering for the integer-plus-fraction sort keys (D26,
// docs/adr/0009-workflows-and-board.md).
//
// The fraction-only keys of 0001 grew by one character every few moves to the top or end of a
// column. Every list (stories per project and status, subtasks per story, trashed rows
// included so a restore keeps its place) gets fixed five-character keys 'd' + 4 base-62
// digits in its current order. This is a storage format change, not a user edit: versions,
// timestamps and activity stay untouched.

import type { Migration } from '../migrate.js';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const digit = (expr: string) => `substr('${DIGITS}', (${expr}) % 62 + 1, 1)`;

const sql = /* sql */ `
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id, type,
                        CASE type WHEN 'STORY' THEN status_id ELSE parent_story_id END
           ORDER BY sort_order, issue_number
         ) - 1 AS n
  FROM tasks
)
UPDATE tasks
SET sort_order = 'd' || ${digit('ranked.n / 238328')} || ${digit('ranked.n / 3844')}
                     || ${digit('ranked.n / 62')} || ${digit('ranked.n')}
FROM ranked
WHERE tasks.id = ranked.id;
`;

export const migration0002: Migration = {
  version: 2,
  name: 'sort-keys',
  sql,
};
