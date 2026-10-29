// Append-only activity history (spec §3.7, D11, D12). Writers call `recordEvent` inside
// the transaction of the change it describes.

import {
  type ActivityEvent,
  type ActivitySource,
  type DescriptionVersion,
  type EntityType,
  type PagedResult,
  type PageRequest,
  TASK_EVENTS,
} from '@glacier-tasks/domain';
import type { ServiceContext } from './context.js';

export interface NewActivityEvent {
  entityType: EntityType;
  entityId: string;
  projectId: string | null;
  eventType: string;
  payload: object;
  source?: ActivitySource;
}

interface ActivityRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  project_id: string | null;
  event_type: string;
  occurred_at: string;
  source: ActivitySource;
  payload_json: string;
}

const COLUMNS = `id, entity_type, entity_id, project_id, event_type, occurred_at, source, payload_json`;

// D27 copies on the parent story; shown in that story's history only.
const NOT_MIRRORED = `event_type NOT LIKE 'task.subtask%'`;

// Same-timestamp events keep insertion order via rowid.
const NEWEST_FIRST = `ORDER BY occurred_at DESC, rowid DESC`;

function toEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    source: row.source,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

export function recordEvent(ctx: ServiceContext, event: NewActivityEvent): string {
  const id = ctx.newId();
  ctx.db
    .prepare(`INSERT INTO activity_events (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      event.entityType,
      event.entityId,
      event.projectId,
      event.eventType,
      ctx.now(),
      event.source ?? 'UI',
      JSON.stringify(event.payload),
    );
  return id;
}

export class ActivityService {
  constructor(private readonly ctx: ServiceContext) {}

  forEntity(entityType: EntityType, entityId: string): ActivityEvent[] {
    return this.ctx.db
      .prepare<[string, string], ActivityRow>(
        `SELECT ${COLUMNS} FROM activity_events
         WHERE entity_type = ? AND entity_id = ? ${NEWEST_FIRST}`,
      )
      .all(entityType, entityId)
      .map(toEvent);
  }

  /**
   * Description versions of a task, newest first (D11): the text of `task.created` and of
   * every `task.updated` that changed the description.
   */
  descriptionVersions(taskId: string): DescriptionVersion[] {
    const versions: DescriptionVersion[] = [];
    for (const event of this.forEntity('TASK', taskId)) {
      const payload = event.payload as {
        descriptionMarkdown?: string;
        changes?: { descriptionMarkdown?: { to: string } };
      };
      const markdown =
        event.eventType === TASK_EVENTS.created
          ? payload.descriptionMarkdown
          : event.eventType === TASK_EVENTS.updated
            ? payload.changes?.descriptionMarkdown?.to
            : undefined;
      if (markdown !== undefined) {
        versions.push({ eventId: event.id, occurredAt: event.occurredAt, markdown });
      }
    }
    return versions;
  }

  /**
   * Project activity (PROJ-06), newest first. Events mirrored onto a parent story for its own
   * history (D27, `task.subtask*`) are left out: the subtask's own event already says it.
   */
  forProject(
    projectId: string,
    page: PageRequest = { offset: 0, limit: 100 },
  ): PagedResult<ActivityEvent> {
    const { total } = this.ctx.db
      .prepare<[string], { total: number }>(
        `SELECT count(*) AS total FROM activity_events WHERE project_id = ? AND ${NOT_MIRRORED}`,
      )
      .get(projectId) as { total: number };
    const items = this.ctx.db
      .prepare<[string, number, number], ActivityRow>(
        `SELECT ${COLUMNS} FROM activity_events WHERE project_id = ? AND ${NOT_MIRRORED}
         ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
      )
      .all(projectId, page.limit, page.offset)
      .map(toEvent);
    return { items, total, offset: page.offset, limit: page.limit };
  }
}
