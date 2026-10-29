import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { TrashItem } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService, type TranslationKey } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { Dialog } from '../../shared/dialog';

const KIND: Record<TrashItem['kind'], { label: TranslationKey; icon: string }> = {
  PROJECT: { label: 'trash.kind.PROJECT', icon: 'fa-diagram-project' },
  STORY: { label: 'taskType.STORY', icon: 'fa-book-bookmark' },
  SUBTASK: { label: 'taskType.SUBTASK', icon: 'fa-list-check' },
};

type Confirmation = { kind: 'purge'; item: TrashItem } | { kind: 'empty' };

/**
 * Trash (TRASH-01..06, D39, D49, D50): directly trashed projects, stories and subtasks,
 * optionally of one project (`#/trash?project=<id>`), with Restore, permanent deletion
 * confirmed by typing the key, and "Empty trash" confirmed by typing a word.
 */
@Component({
  selector: 'app-trash-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog],
  template: `
    <section class="page">
      <header class="page-header">
        <h1>{{ i18n.t('trash.title') }}</h1>
        <div class="page-actions">
          <label class="filter">
            <span>{{ i18n.t('trash.filter') }}</span>
            <select data-testid="trash-project-filter" (change)="filterBy($any($event.target).value)">
              <option value="" [selected]="!project()">{{ i18n.t('trash.allProjects') }}</option>
              @for (option of projectOptions(); track option.id) {
                <option [value]="option.id" [selected]="option.id === project()">
                  {{ option.key }} · {{ option.name }}
                </option>
              }
            </select>
          </label>
          @if ((items.value() ?? []).length > 0) {
            <button type="button" class="btn btn-danger" data-testid="trash-empty" (click)="confirm({ kind: 'empty' })">
              <i class="fa-solid fa-dumpster" aria-hidden="true"></i>
              {{ i18n.t('trash.empty') }}
            </button>
          }
        </div>
      </header>
      <p class="intro">{{ i18n.t('trash.intro') }}</p>

      @if (items.error()) {
        <p class="error-banner" role="alert">{{ i18n.errorMessage(items.error()) }}</p>
      }
      @if ((items.value() ?? []).length === 0 && !items.isLoading()) {
        <div class="empty-state">
          <h2>{{ i18n.t('trash.emptyTitle') }}</h2>
          <p>{{ i18n.t('trash.emptyBody') }}</p>
        </div>
      } @else {
        <ul class="card list" data-testid="trash-list">
          @for (item of items.value() ?? []; track item.id) {
            <li [attr.data-trash-title]="item.title">
              <i class="fa-solid {{ kind[item.kind].icon }} kind-icon" aria-hidden="true"></i>
              <span class="kind">{{ i18n.t(kind[item.kind].label) }}</span>
              <span class="mono key">{{ keyOf(item) }}</span>
              <span class="title">{{ item.title }}</span>
              <span class="date">{{ i18n.formatDateTime(item.trashedAt) }}</span>
              <span class="actions">
                <button type="button" class="btn" data-testid="trash-restore" [disabled]="busy() === item.id"
                  (click)="restore(item)">
                  <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                  {{ i18n.t('trash.restore') }}
                </button>
                <button type="button" class="btn btn-ghost btn-icon" data-testid="trash-purge"
                  [attr.aria-label]="i18n.t('trash.purge')" [title]="i18n.t('trash.purge')"
                  [disabled]="busy() === item.id" (click)="confirm({ kind: 'purge', item })">
                  <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                </button>
              </span>
              @if (errors()[item.id]; as message) {
                <p class="row-error" role="alert" data-testid="trash-error">{{ message }}</p>
              }
            </li>
          }
        </ul>
      }
    </section>

    <app-dialog [open]="confirmation() !== null" [heading]="confirmHeading()" (closed)="confirmation.set(null)">
      @if (confirmation(); as pending) {
        <form (submit)="$event.preventDefault(); confirmed()" novalidate>
          <p class="warning" role="alert">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            {{ i18n.t('trash.purgeWarning') }}
          </p>
          @if (pending.kind === 'purge') {
            <p>{{ i18n.t(pending.item.kind === 'PROJECT' ? 'trash.purgeProjectBody' : 'trash.purgeTaskBody', { name: pending.item.title }) }}</p>
          } @else {
            <p>{{ i18n.t(project() ? 'trash.emptyProjectBody' : 'trash.emptyAllBody', { count: (items.value() ?? []).length }) }}</p>
          }
          <div class="field">
            <label for="confirm-text">{{ i18n.t('trash.typeToConfirm', { word: expected() }) }}</label>
            <input id="confirm-text" class="mono" data-testid="trash-confirm-input" autocomplete="off"
              [value]="typed()" (input)="typed.set($any($event.target).value)" />
          </div>
          @if (dialogError(); as message) {
            <p class="error-banner" role="alert">{{ message }}</p>
          }
          <div class="page-actions dialog-actions">
            <button type="button" class="btn" (click)="confirmation.set(null)">{{ i18n.t('common.cancel') }}</button>
            <button type="submit" class="btn btn-danger" data-testid="trash-confirm"
              [disabled]="!matches() || working()">
              {{ i18n.t(pending.kind === 'purge' ? 'trash.purge' : 'trash.empty') }}
            </button>
          </div>
        </form>
      }
    </app-dialog>
  `,
  styles: `
    .intro {
      margin: -12px 0 20px;
      color: var(--color-text-muted);
    }
    .filter {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-muted);
      font-size: 13px;

      select {
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background-color: var(--color-bg);
        color: var(--color-text);
      }
    }
    .list {
      margin: 0;
      padding: 4px 0;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: 20px 90px 100px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;

        & + li {
          border-top: 1px solid var(--color-border);
        }
      }
    }
    .actions {
      display: flex;
      gap: 4px;
    }
    .kind-icon,
    .kind,
    .date,
    .key {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .title {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-error {
      grid-column: 2 / -1;
      margin: 0;
      color: var(--color-danger-text);
      font-size: 12px;
    }
    .warning {
      display: flex;
      gap: 8px;
      color: var(--color-danger-text);
      font-weight: 600;
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class TrashPage {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsStore);

  /** Query parameter: show one project's trash (D49). */
  readonly project = input<string | undefined>();

  protected readonly kind = KIND;
  protected readonly items = resource({
    params: () => ({ project: this.project() ?? null }),
    loader: ({ params }) => this.api.trash.list(params.project),
  });
  /** Live projects plus trashed ones, so a trashed project's own trash can be chosen. */
  private readonly allItems = resource({ loader: () => this.api.trash.list() });
  protected readonly projectOptions = computed(() => {
    const options = new Map(
      this.projects.projects().map((p) => [p.id, { id: p.id, key: p.key, name: p.name }]),
    );
    for (const item of this.allItems.value() ?? []) {
      if (item.kind === 'PROJECT' && !options.has(item.id)) {
        options.set(item.id, { id: item.id, key: item.projectKey, name: item.title });
      }
    }
    return [...options.values()].sort((a, b) => a.key.localeCompare(b.key));
  });

  protected readonly busy = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly confirmation = signal<Confirmation | null>(null);
  protected readonly typed = signal('');
  protected readonly working = signal(false);
  protected readonly dialogError = signal<string | null>(null);

  /** D50: the key of the item, or the localized confirmation word for "Empty trash". */
  protected readonly expected = computed(() => {
    const pending = this.confirmation();
    if (!pending) return '';
    return pending.kind === 'purge' ? this.keyOf(pending.item) : this.i18n.t('trash.emptyWord');
  });
  protected readonly matches = computed(
    () => this.typed().trim().toLowerCase() === this.expected().toLowerCase(),
  );
  protected readonly confirmHeading = computed(() =>
    this.i18n.t(
      this.confirmation()?.kind === 'empty' ? 'trash.emptyTitleDialog' : 'trash.purgeTitle',
    ),
  );

  protected keyOf(item: TrashItem): string {
    return item.issueKey ?? item.projectKey;
  }

  protected filterBy(projectId: string): void {
    void this.router.navigate(['/trash'], { queryParams: { project: projectId || null } });
  }

  protected confirm(confirmation: Confirmation): void {
    this.typed.set('');
    this.dialogError.set(null);
    this.confirmation.set(confirmation);
  }

  protected async confirmed(): Promise<void> {
    const pending = this.confirmation();
    if (!pending || !this.matches() || this.working()) return;
    this.working.set(true);
    this.dialogError.set(null);
    try {
      if (pending.kind === 'purge') {
        await this.api.trash.purge(pending.item.kind, pending.item.id);
      } else {
        await this.api.trash.empty(this.project() ?? null);
      }
      this.confirmation.set(null);
      this.reload();
    } catch (error) {
      this.dialogError.set(this.i18n.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  protected async restore(item: TrashItem): Promise<void> {
    this.busy.set(item.id);
    this.errors.update(({ [item.id]: _, ...rest }) => rest);
    try {
      if (item.kind === 'PROJECT') {
        await this.api.projects.restore(item.id);
        await this.projects.load();
      } else {
        await this.api.tasks.restore(item.id);
      }
      this.reload();
    } catch (error) {
      this.errors.update((errors) => ({ ...errors, [item.id]: this.i18n.errorMessage(error) }));
    } finally {
      this.busy.set(null);
    }
  }

  private reload(): void {
    this.items.reload();
    this.allItems.reload();
  }
}
