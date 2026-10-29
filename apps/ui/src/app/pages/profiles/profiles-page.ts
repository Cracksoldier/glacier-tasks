import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { USER_NAME_MAX_LENGTH, type UserProfile } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { UsersStore } from '../../core/users/users-store';
import { Avatar } from '../../shared/avatar';
import { ActivityTimeline } from '../../shared/activity-timeline';
import { Dialog } from '../../shared/dialog';

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; id: string };

/**
 * Profile manager (USER-01, USER-02, USER-05): global profiles, avatars, archiving, and each
 * profile's history in a dialog (D12, D46).
 */
@Component({
  selector: 'app-profiles-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimeline, Avatar, Dialog],
  template: `
    <section class="page">
      <header class="page-header">
        <h1>{{ i18n.t('profiles.title') }}</h1>
        <div class="page-actions">
          <label class="toggle">
            <input
              type="checkbox"
              data-testid="show-archived"
              [checked]="showArchived()"
              (change)="showArchived.set($any($event.target).checked)"
            />
            {{ i18n.t('profiles.showArchived') }}
          </label>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="profile-new"
            (click)="openCreate()"
          >
            <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
            {{ i18n.t('profiles.new') }}
          </button>
        </div>
      </header>

      @if (error(); as message) {
        <p class="error-banner" role="alert">{{ message }}</p>
      }
      @if (notice(); as message) {
        <p class="notice" role="status" data-testid="profiles-notice">{{ message }}</p>
      }

      @if (visible().length === 0) {
        <div class="empty-state">
          <h2>{{ i18n.t('profiles.emptyTitle') }}</h2>
          <p>{{ i18n.t('profiles.emptyBody') }}</p>
        </div>
      } @else {
        <ul class="list card" data-testid="profile-list">
          @for (user of visible(); track user.id) {
            <li [class.archived]="user.archivedAt !== null" [attr.data-profile-name]="user.name">
              <app-avatar
                [userId]="user.id"
                [name]="user.name"
                [avatarFileId]="user.avatarFileId"
                [archived]="user.archivedAt !== null"
                [size]="36"
              />
              <span class="name">{{ user.name }}</span>
              @if (user.archivedAt !== null) {
                <span class="badge" data-testid="profile-archived-badge">{{
                  i18n.t('profiles.archived')
                }}</span>
              }
              <span class="actions">
                <button
                  type="button"
                  class="btn btn-ghost"
                  data-testid="profile-edit"
                  (click)="openEdit(user.id)"
                >
                  <i class="fa-solid fa-pen" aria-hidden="true"></i>
                  {{ i18n.t('common.edit') }}
                </button>
                <button
                  type="button"
                  class="btn btn-ghost"
                  data-testid="profile-history"
                  (click)="historyOf.set(user)"
                >
                  <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                  {{ i18n.t('activity.profileHistory') }}
                </button>
                @if (user.archivedAt === null) {
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-testid="profile-archive"
                    (click)="run(store.archive(user.id))"
                  >
                    <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
                    {{ i18n.t('profiles.archive') }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-testid="profile-unarchive"
                    (click)="run(store.unarchive(user.id))"
                  >
                    <i class="fa-solid fa-box-open" aria-hidden="true"></i>
                    {{ i18n.t('profiles.unarchive') }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-testid="profile-unassign-all"
                    (click)="unassigning.set(user)"
                  >
                    <i class="fa-solid fa-user-slash" aria-hidden="true"></i>
                    {{ i18n.t('profiles.unassignAll') }}
                  </button>
                }
              </span>
            </li>
          }
        </ul>
      }
    </section>

    <app-dialog
      [open]="historyOf() !== null"
      [wide]="true"
      [heading]="i18n.t('activity.profileHistoryTitle', { name: historyOf()?.name ?? '' })"
      (closed)="historyOf.set(null)"
    >
      @if (history.error()) {
        <p class="error-banner" role="alert">{{ i18n.errorMessage(history.error()) }}</p>
      }
      <div class="history" data-testid="profile-history-dialog">
        <app-activity-timeline [events]="history.value() ?? []" />
      </div>
    </app-dialog>

    <app-dialog
      [open]="unassigning() !== null"
      [heading]="i18n.t('profiles.unassignAll')"
      (closed)="unassigning.set(null)"
    >
      @if (unassigning(); as user) {
        <p>{{ i18n.t('profiles.unassignAllConfirm', { name: user.name }) }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="unassigning.set(null)">
            {{ i18n.t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="profile-unassign-confirm"
            (click)="unassignAll(user.id)"
          >
            {{ i18n.t('profiles.unassignAll') }}
          </button>
        </div>
      }
    </app-dialog>

    <app-dialog
      [open]="editor().mode !== 'closed'"
      [heading]="i18n.t(editing() ? 'profiles.editTitle' : 'profiles.createTitle')"
      (closed)="closeEditor()"
    >
      <form (submit)="$event.preventDefault(); saveName()" novalidate>
        @if (dialogError(); as message) {
          <p class="error-banner" role="alert">{{ message }}</p>
        }
        @if (editing(); as user) {
          <div class="avatar-row">
            <app-avatar
              [userId]="user.id"
              [name]="name() || user.name"
              [avatarFileId]="user.avatarFileId"
              [size]="64"
            />
            <div class="page-actions">
              <button
                type="button"
                class="btn"
                data-testid="avatar-choose"
                [disabled]="busy()"
                (click)="chooseAvatar(user.id)"
              >
                <i class="fa-solid fa-image" aria-hidden="true"></i>
                {{ i18n.t('profiles.chooseAvatar') }}
              </button>
              @if (user.avatarFileId) {
                <button
                  type="button"
                  class="btn btn-ghost"
                  data-testid="avatar-remove"
                  [disabled]="busy()"
                  (click)="removeAvatar(user.id)"
                >
                  {{ i18n.t('profiles.removeAvatar') }}
                </button>
              }
            </div>
          </div>
          <p class="field-hint avatar-hint">{{ i18n.t('profiles.avatarHint') }}</p>
        }
        <div class="field">
          <label for="profile-name">{{ i18n.t('profiles.field.name') }}</label>
          <input
            id="profile-name"
            data-testid="profile-name"
            autocomplete="off"
            [maxLength]="nameMax"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            [attr.aria-invalid]="showErrors() && !nameValid()"
          />
          @if (showErrors() && !nameValid()) {
            <p class="field-error">{{ i18n.t('validation.required') }}</p>
          }
        </div>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" data-testid="profile-close" (click)="closeEditor()">
            {{ i18n.t(editing() ? 'common.close' : 'common.cancel') }}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            data-testid="profile-save"
            [disabled]="busy()"
          >
            {{ i18n.t(editing() ? 'common.save' : 'profiles.create') }}
          </button>
        </div>
      </form>
    </app-dialog>
  `,
  styles: `
    .history {
      max-height: 60vh;
      overflow-y: auto;
    }
    .notice {
      margin: 0 0 16px;
      color: var(--color-accent);
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: 8px;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .list {
      margin: 0;
      padding: 4px 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;

        & + li {
          border-top: 1px solid var(--color-border);
        }
      }
      li.archived .name {
        color: var(--color-text-muted);
      }
    }
    .name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .badge {
      padding: 1px 8px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .avatar-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .avatar-hint {
      margin: 8px 0 16px;
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 8px;
    }
  `,
})
export class ProfilesPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(UsersStore);
  private readonly api = inject(GLACIER_API);

  protected readonly nameMax = USER_NAME_MAX_LENGTH;
  protected readonly showArchived = signal(false);
  protected readonly visible = computed(() =>
    this.showArchived() ? this.store.all() : this.store.active(),
  );
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly unassigning = signal<UserProfile | null>(null);
  protected readonly historyOf = signal<UserProfile | null>(null);
  protected readonly history = resource({
    params: () => this.historyOf()?.id,
    loader: ({ params }) => this.api.activity.forEntity('USER', params),
  });

  protected readonly editor = signal<EditorState>({ mode: 'closed' });
  protected readonly editing = computed(() => {
    const state = this.editor();
    return state.mode === 'edit' ? this.store.all().find((u) => u.id === state.id) : undefined;
  });
  protected readonly name = signal('');
  protected readonly showErrors = signal(false);
  protected readonly busy = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly nameValid = computed(() => this.name().trim().length > 0);

  constructor() {
    void this.run(this.store.load());
  }

  /** USER-05: removes an archived profile from all its tasks at once. */
  protected async unassignAll(id: string): Promise<void> {
    this.unassigning.set(null);
    this.notice.set(null);
    this.error.set(null);
    try {
      const { unassigned } = await this.store.unassignAll(id);
      this.notice.set(this.i18n.t('profiles.unassignedCount', { count: unassigned }));
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
    }
  }

  protected openCreate(): void {
    this.resetEditor();
    this.editor.set({ mode: 'create' });
  }

  protected openEdit(id: string): void {
    this.resetEditor();
    this.name.set(this.store.all().find((u) => u.id === id)?.name ?? '');
    this.editor.set({ mode: 'edit', id });
  }

  protected closeEditor(): void {
    this.editor.set({ mode: 'closed' });
  }

  protected async saveName(): Promise<void> {
    this.showErrors.set(true);
    if (!this.nameValid() || this.busy()) return;
    const user = this.editing();
    await this.dialogAction(async () => {
      if (user) {
        await this.store.rename(user.id, this.name());
        this.closeEditor();
      } else {
        // Stay in the dialog so an avatar can be added right away.
        const created = await this.store.create({ name: this.name() });
        this.editor.set({ mode: 'edit', id: created.id });
      }
    });
  }

  protected chooseAvatar(id: string): Promise<void> {
    return this.dialogAction(() => this.store.chooseAvatar(id));
  }

  protected removeAvatar(id: string): Promise<void> {
    return this.dialogAction(() => this.store.removeAvatar(id));
  }

  protected async run(action: Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await action;
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
    }
  }

  private async dialogAction(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.dialogError.set(null);
    try {
      await action();
    } catch (error) {
      this.dialogError.set(this.i18n.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private resetEditor(): void {
    this.name.set('');
    this.showErrors.set(false);
    this.dialogError.set(null);
  }
}
