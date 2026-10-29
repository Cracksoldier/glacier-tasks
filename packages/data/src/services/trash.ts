// Trash listing (D39): directly trashed projects and tasks, newest first. Tasks that went
// to the trash with their story or project are restored with it and are not listed.
// Permanent deletion follows in M7.

import { formatIssueKey, type TrashItem } from '@glacier-tasks/domain';
import type { ServiceContext } from './context.js';

interface TrashRow {
  kind: TrashItem['kind'];
  id: string;
  project_id: string;
  project_key: string;
  issue_number: number | null;
  title: string;
  trashed_at: string;
}

export class TrashService {
  constructor(private readonly ctx: ServiceContext) {}

  list(): TrashItem[] {
    return this.ctx.db
      .prepare<[], TrashRow>(
        `SELECT 'PROJECT' AS kind, id, id AS project_id, project_key, NULL AS issue_number,
           name AS title, trashed_at
         FROM projects WHERE trashed_at IS NOT NULL
         UNION ALL
         SELECT t.type, t.id, t.project_id, p.project_key, t.issue_number, t.title, t.trashed_at
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.trashed_at IS NOT NULL AND t.trash_cascade_root_id IS NULL
           AND p.trashed_at IS NULL
         ORDER BY trashed_at DESC, title`,
      )
      .all()
      .map((row) => ({
        kind: row.kind,
        id: row.id,
        projectId: row.project_id,
        projectKey: row.project_key,
        issueKey:
          row.issue_number === null ? null : formatIssueKey(row.project_key, row.issue_number),
        title: row.title,
        trashedAt: row.trashed_at,
      }));
  }
}
