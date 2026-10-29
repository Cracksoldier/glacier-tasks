// Task attachment metadata (spec §3.6, FILE-01..05, D03, D33). The bytes live in managed
// storage handled by the desktop app (ADR 0011); this service only records rows and
// history. Removal keeps a tombstone (`removed_at`) and hands back the storage key, whose
// bytes the caller deletes right away.

import {
  AppError,
  type AttachmentEventPayload,
  type AttachmentMetadata,
  formatIssueKey,
  PREVIEWABLE_IMAGE_MIME_TYPES,
  TASK_EVENTS,
} from '@glacier-tasks/domain';
import { recordEvent } from './activity.js';
import type { ServiceContext } from './context.js';

interface AttachmentRow {
  id: string;
  task_id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  added_at: string;
  removed_at: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  project_key: string;
  issue_number: number;
  title: string;
}

export interface NewAttachment {
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
}

/** Metadata plus the storage key, for the desktop store only (never sent to the renderer). */
export interface StoredAttachment extends AttachmentMetadata {
  storageKey: string;
}

const PREVIEWABLE = new Set<string>(PREVIEWABLE_IMAGE_MIME_TYPES);

function toStored(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    addedAt: row.added_at,
    removedAt: row.removed_at,
    previewable: row.removed_at === null && PREVIEWABLE.has(row.mime_type),
    storageKey: row.storage_key,
  };
}

/** The renderer-facing shape, without the storage key. */
export function toAttachmentMetadata(stored: StoredAttachment): AttachmentMetadata {
  const { storageKey: _storageKey, ...metadata } = stored;
  return metadata;
}

const attachmentNotFound = () => new AppError('NOT_FOUND', 'errors.attachmentNotFound');

/** Live attachments of a task, newest first (also used by `TaskService.get`). */
export function liveAttachments(ctx: ServiceContext, taskId: string): AttachmentMetadata[] {
  return ctx.db
    .prepare<[string], AttachmentRow>(
      `SELECT * FROM attachments WHERE task_id = ? AND removed_at IS NULL
       ORDER BY added_at DESC, rowid DESC`,
    )
    .all(taskId)
    .map((row) => toAttachmentMetadata(toStored(row)));
}

export class AttachmentService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Live attachments of a live task, newest first. */
  list(taskId: string): AttachmentMetadata[] {
    this.requireLiveTask(taskId);
    return liveAttachments(this.ctx, taskId);
  }

  /** Any attachment row, removed ones included; NOT_FOUND for unknown ids. */
  get(id: string): StoredAttachment {
    const row = this.ctx.db
      .prepare<[string], AttachmentRow>(`SELECT * FROM attachments WHERE id = ?`)
      .get(id);
    if (!row) throw attachmentNotFound();
    return toStored(row);
  }

  /** A live attachment (not removed) whose task and project are not trashed. */
  getLive(id: string): StoredAttachment {
    const attachment = this.get(id);
    if (attachment.removedAt !== null) throw attachmentNotFound();
    this.requireLiveTask(attachment.taskId, attachmentNotFound);
    return attachment;
  }

  insert(taskId: string, file: NewAttachment): AttachmentMetadata {
    const id = this.ctx.newId();
    this.ctx.db.transaction(() => {
      const task = this.requireLiveTask(taskId);
      this.ctx.db
        .prepare(
          `INSERT INTO attachments
             (id, task_id, original_name, mime_type, byte_size, sha256, storage_key, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          taskId,
          file.originalName,
          file.mimeType,
          file.byteSize,
          file.sha256,
          file.storageKey,
          this.ctx.now(),
        );
      this.record(task, TASK_EVENTS.attachmentAdded, {
        id,
        name: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
      });
    })();
    return toAttachmentMetadata(this.get(id));
  }

  /** D03: tombstone plus history in one transaction; returns the storage key to delete. */
  remove(id: string): string {
    let storageKey = '';
    this.ctx.db.transaction(() => {
      const attachment = this.getLive(id);
      const task = this.requireLiveTask(attachment.taskId);
      this.ctx.db
        .prepare(`UPDATE attachments SET removed_at = ? WHERE id = ?`)
        .run(this.ctx.now(), id);
      this.record(task, TASK_EVENTS.attachmentRemoved, {
        id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
      });
      storageKey = attachment.storageKey;
    })();
    return storageKey;
  }

  /** Storage keys whose bytes must exist: every row that is not removed (D03). */
  storageKeys(): string[] {
    return this.ctx.db
      .prepare<[], { storage_key: string }>(
        `SELECT storage_key FROM attachments WHERE removed_at IS NULL`,
      )
      .all()
      .map((row) => row.storage_key);
  }

  private record(
    task: TaskRow,
    eventType: string,
    attachment: AttachmentEventPayload['attachment'],
  ) {
    const payload: AttachmentEventPayload = {
      issueKey: formatIssueKey(task.project_key, task.issue_number),
      title: task.title,
      attachment,
    };
    recordEvent(this.ctx, {
      entityType: 'TASK',
      entityId: task.id,
      projectId: task.project_id,
      eventType,
      payload,
    });
  }

  private requireLiveTask(
    taskId: string,
    notFound = () => new AppError('NOT_FOUND', 'errors.taskNotFound'),
  ): TaskRow {
    const task = this.ctx.db
      .prepare<[string], TaskRow>(
        `SELECT t.id, t.project_id, p.project_key, t.issue_number, t.title
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.id = ? AND t.trashed_at IS NULL AND p.trashed_at IS NULL`,
      )
      .get(taskId);
    if (!task) throw notFound();
    return task;
  }
}
