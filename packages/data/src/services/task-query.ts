// SQL for the task query and list (LIST-01..05, SEARCH-01..04, ADR 0010). The match predicate
// looks at a task's own fields only; the list view adds the D09 hierarchy on top of it.
//
// Aliases: t = tasks, p = projects, s = statuses, u = users (assignee), f = FTS hits.

import { type TaskQueryData, toFtsQuery } from '@glacier-tasks/domain';

export interface MatchSql {
  /** Common table expressions the joins need (without `WITH`), or ''. */
  ctes: string;
  /** Joins after `FROM tasks t JOIN projects p … LEFT JOIN users u …`. */
  joins: string;
  where: string;
  params: unknown[];
  /** Whether `f.rank` (bm25, lower is better) is available. */
  ranked: boolean;
}

export const STATUS_JOIN = 'JOIN statuses s ON s.project_id = t.project_id AND s.id = t.status_id';
// Key and title hits weigh more than description hits. MATERIALIZED keeps SQLite from
// flattening the FTS query into the join, where bm25() is not allowed.
const FTS_CTE = `fts_hits AS MATERIALIZED (
    SELECT rowid AS row_id, bm25(tasks_fts, 10.0, 5.0, 1.0) AS rank
    FROM tasks_fts WHERE tasks_fts MATCH ?
  )`;
const FTS_JOIN = 'JOIN fts_hits f ON f.row_id = t.row_id';

const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => '?').join(', ');

/** Live tasks of live projects that match every given filter (OR within a filter). */
export function matchSql(q: TaskQueryData): MatchSql {
  const joins = [STATUS_JOIN];
  const params: unknown[] = [];
  const where = ['t.trashed_at IS NULL', 'p.trashed_at IS NULL'];

  const fts = toFtsQuery(q.text);
  if (fts) {
    joins.push(FTS_JOIN);
    params.push(fts);
  }
  const values: unknown[] = [];
  const any = (column: string, list: ReadonlyArray<unknown>) => {
    if (list.length === 0) return;
    where.push(`${column} IN (${placeholders(list)})`);
    values.push(...list);
  };
  if (q.projectId !== null) {
    where.push('t.project_id = ?');
    values.push(q.projectId);
  }
  any('t.type', q.types);
  any('t.status_id', q.statusIds);
  any('s.category', q.statusCategories);
  any('t.priority', q.priorities);
  if (q.assigneeUserIds.length > 0) {
    const ids = q.assigneeUserIds.filter((id): id is string => id !== null);
    const parts = ids.length > 0 ? [`t.assignee_user_id IN (${placeholders(ids)})`] : [];
    if (ids.length < q.assigneeUserIds.length) parts.push('t.assignee_user_id IS NULL');
    where.push(`(${parts.join(' OR ')})`);
    values.push(...ids);
  }
  if (q.labelIds.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM task_labels tl
        WHERE tl.task_id = t.id AND tl.label_id IN (${placeholders(q.labelIds)}))`,
    );
    values.push(...q.labelIds);
  }
  // A due-date bound excludes tasks without a due date.
  if (q.dueFrom !== null) {
    where.push('t.due_date >= ?');
    values.push(q.dueFrom);
  }
  if (q.dueTo !== null) {
    where.push('t.due_date <= ?');
    values.push(q.dueTo);
  }
  return {
    ctes: fts ? FTS_CTE : '',
    joins: joins.join('\n'),
    where: where.join(' AND '),
    params: [...params, ...values],
    ranked: fts !== null,
  };
}

/** `WITH …` for the match CTEs plus any further ones, or '' when there are none. */
export function withSql(match: MatchSql, ...more: string[]): string {
  const ctes = [match.ctes, ...more].filter((cte) => cte !== '');
  return ctes.length > 0 ? `WITH ${ctes.join(',\n')}` : '';
}

const PRIORITY_RANK = `CASE t.priority WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END`;
const CATEGORY_RANK = `CASE s.category WHEN 'TODO' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END`;

export interface OrderOptions {
  /** Expression for the bm25 rank, or null without search text. */
  rank: string | null;
  /** Subtasks within one parent: "board order" is the parent's subtask order. */
  withinParent?: boolean;
}

/**
 * ORDER BY for a query. Empty values sort last in both directions; project key and issue
 * number break every tie, so results are deterministic.
 */
export function orderSql(q: TaskQueryData, options: OrderOptions): string {
  const dir = q.sortDirection === 'desc' ? 'DESC' : 'ASC';
  const nullsLast = (expr: string) => `(${expr}) IS NULL, ${expr} ${dir}`;
  const boardOrder = options.withinParent
    ? `t.sort_order ${dir}`
    : `s.position ${dir}, t.sort_order ${dir}`;
  let primary: string;
  switch (q.sortBy) {
    case 'issueKey':
      primary = `p.project_key ${dir}, t.issue_number ${dir}`;
      break;
    case 'title':
      primary = `t.title COLLATE NOCASE ${dir}`;
      break;
    case 'priority':
      primary = `${PRIORITY_RANK} ${dir}`;
      break;
    case 'status':
      primary =
        q.projectId !== null
          ? `s.position ${dir}`
          : `${CATEGORY_RANK} ${dir}, s.name COLLATE NOCASE ${dir}`;
      break;
    case 'assignee':
      primary = nullsLast('u.name COLLATE NOCASE');
      break;
    case 'createdAt':
      primary = `t.created_at ${dir}`;
      break;
    case 'updatedAt':
      primary = `t.updated_at ${dir}`;
      break;
    case 'startDate':
      primary = nullsLast('t.start_date');
      break;
    case 'dueDate':
      primary = nullsLast('t.due_date');
      break;
    case 'relevance':
      primary = options.rank ? `${options.rank} ${dir}` : boardOrder;
      break;
    default:
      primary = boardOrder;
  }
  const tieBreak = options.withinParent
    ? 't.sort_order, t.issue_number'
    : 'p.project_key, t.issue_number';
  return `${primary}, ${tieBreak}`;
}
