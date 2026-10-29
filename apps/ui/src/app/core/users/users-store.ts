import { computed, inject, Injectable, signal } from '@angular/core';
import type { CreateUserInput, UserProfile } from '@glacier-tasks/domain';
import { GLACIER_API } from '../api/glacier-api';

/** Global assignment profiles (USER-01..05), including archived ones (D29). */
@Injectable({ providedIn: 'root' })
export class UsersStore {
  private readonly api = inject(GLACIER_API);

  /** All profiles, archived included; views filter. */
  readonly all = signal<UserProfile[]>([]);
  readonly loaded = signal(false);
  readonly active = computed(() => this.all().filter((user) => user.archivedAt === null));

  async load(): Promise<void> {
    this.all.set(await this.api.users.list(true));
    this.loaded.set(true);
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    return this.reloadAfter(this.api.users.create(input));
  }

  async rename(id: string, name: string): Promise<UserProfile> {
    return this.reloadAfter(this.api.users.update(id, { name }));
  }

  async archive(id: string): Promise<void> {
    await this.reloadAfter(this.api.users.archive(id));
  }

  async unarchive(id: string): Promise<void> {
    await this.reloadAfter(this.api.users.unarchive(id));
  }

  /** Opens the native picker in the main process; resolves null when cancelled. */
  async chooseAvatar(id: string): Promise<UserProfile | null> {
    return this.reloadAfter(this.api.users.chooseAvatar(id));
  }

  async removeAvatar(id: string): Promise<UserProfile> {
    return this.reloadAfter(this.api.users.removeAvatar(id));
  }

  unassignAll(id: string): Promise<{ unassigned: number }> {
    return this.api.users.unassignAll(id);
  }

  private async reloadAfter<T>(write: Promise<T>): Promise<T> {
    const result = await write;
    await this.load();
    return result;
  }
}
