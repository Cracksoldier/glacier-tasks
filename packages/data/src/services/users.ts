// Global assignment profiles (spec §3.2, USER-01..05): archived instead of deleted (D29),
// optional avatar (D24), activity events (D12). Avatar bytes are handled by the caller;
// this service only maintains `avatar_files` rows and returns storage keys to delete.

import {
  AppError,
  type AvatarMimeType,
  type CreateUserInput,
  type UpdateUserInput,
  type UserArchiveTogglePayload,
  type UserAvatarChangedPayload,
  type UserCreatedPayload,
  USER_EVENTS,
  type UserProfile,
  type UserUpdatedPayload,
} from '@glacier-tasks/domain';
import { recordEvent } from './activity.js';
import type { ServiceContext } from './context.js';

interface UserRow {
  id: string;
  name: string;
  avatar_file_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface NewAvatarFile {
  storageKey: string;
  mimeType: AvatarMimeType;
  sha256: string;
  byteSize: number;
}

export interface AvatarChange {
  user: UserProfile;
  /** Storage key of the replaced or removed file; the caller deletes its bytes (D24). */
  replacedStorageKey: string | null;
}

function toUser(row: UserRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    avatarFileId: row.avatar_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export class UserService {
  constructor(private readonly ctx: ServiceContext) {}

  list(includeArchived = false): UserProfile[] {
    return this.ctx.db
      .prepare<[number], UserRow>(
        `SELECT * FROM users WHERE ? = 1 OR archived_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at`,
      )
      .all(includeArchived ? 1 : 0)
      .map(toUser);
  }

  get(id: string): UserProfile {
    return toUser(this.require(id));
  }

  create(input: CreateUserInput): UserProfile {
    const name = input.name.trim();
    const id = this.ctx.newId();
    this.ctx.db.transaction(() => {
      const now = this.ctx.now();
      this.ctx.db
        .prepare(`INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(id, name, now, now);
      const payload: UserCreatedPayload = { name };
      this.record(id, USER_EVENTS.created, payload);
    })();
    return this.get(id);
  }

  update(id: string, input: UpdateUserInput): UserProfile {
    this.ctx.db.transaction(() => {
      const row = this.require(id);
      const name = input.name.trim();
      if (name === row.name) return;
      this.ctx.db
        .prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`)
        .run(name, this.ctx.now(), id);
      const payload: UserUpdatedPayload = { name, changes: { name: { from: row.name, to: name } } };
      this.record(id, USER_EVENTS.updated, payload);
    })();
    return this.get(id);
  }

  /** D29: profiles are never deleted; archived ones stay referenced by history and tasks. */
  archive(id: string): void {
    this.setArchived(id, true);
  }

  unarchive(id: string): void {
    this.setArchived(id, false);
  }

  setAvatar(id: string, file: NewAvatarFile): AvatarChange {
    return this.changeAvatar(id, file);
  }

  clearAvatar(id: string): AvatarChange {
    return this.changeAvatar(id, null);
  }

  /** Storage keys of every avatar file row, for startup reconciliation. */
  avatarStorageKeys(): string[] {
    return this.ctx.db
      .prepare<[], { storage_key: string }>(`SELECT storage_key FROM avatar_files`)
      .all()
      .map((row) => row.storage_key);
  }

  findAvatarFile(
    avatarFileId: string,
  ): { storageKey: string; mimeType: AvatarMimeType } | undefined {
    const row = this.ctx.db
      .prepare<[string], { storage_key: string; mime_type: AvatarMimeType }>(
        `SELECT storage_key, mime_type FROM avatar_files WHERE id = ?`,
      )
      .get(avatarFileId);
    return row && { storageKey: row.storage_key, mimeType: row.mime_type };
  }

  private changeAvatar(id: string, file: NewAvatarFile | null): AvatarChange {
    const replacedStorageKey = this.ctx.db.transaction((): string | null => {
      const row = this.require(id);
      const previous = row.avatar_file_id;
      const previousKey = previous ? (this.findAvatarFile(previous)?.storageKey ?? null) : null;
      if (!file && !previous) return null;

      let newFileId: string | null = null;
      if (file) {
        newFileId = this.ctx.newId();
        this.ctx.db
          .prepare(
            `INSERT INTO avatar_files (id, storage_key, mime_type, sha256, byte_size)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(newFileId, file.storageKey, file.mimeType, file.sha256, file.byteSize);
      }
      this.ctx.db
        .prepare(`UPDATE users SET avatar_file_id = ?, updated_at = ? WHERE id = ?`)
        .run(newFileId, this.ctx.now(), id);
      if (previous) this.ctx.db.prepare(`DELETE FROM avatar_files WHERE id = ?`).run(previous);

      const payload: UserAvatarChangedPayload = { name: row.name, from: previous, to: newFileId };
      this.record(id, USER_EVENTS.avatarChanged, payload);
      return previousKey;
    })();
    return { user: this.get(id), replacedStorageKey };
  }

  private setArchived(id: string, archived: boolean): void {
    this.ctx.db.transaction(() => {
      const row = this.require(id);
      if ((row.archived_at !== null) === archived) {
        throw new AppError(
          'CONFLICT',
          archived ? 'errors.userAlreadyArchived' : 'errors.userNotArchived',
        );
      }
      const now = this.ctx.now();
      this.ctx.db
        .prepare(`UPDATE users SET archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(archived ? now : null, now, id);
      const payload: UserArchiveTogglePayload = { name: row.name };
      this.record(id, archived ? USER_EVENTS.archived : USER_EVENTS.unarchived, payload);
    })();
  }

  private require(id: string): UserRow {
    const row = this.ctx.db.prepare<[string], UserRow>(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!row) throw new AppError('NOT_FOUND', 'errors.userNotFound');
    return row;
  }

  private record(userId: string, eventType: string, payload: object): void {
    // Profiles are global, so their events carry no project id (D12).
    recordEvent(this.ctx, {
      entityType: 'USER',
      entityId: userId,
      projectId: null,
      eventType,
      payload,
    });
  }
}
