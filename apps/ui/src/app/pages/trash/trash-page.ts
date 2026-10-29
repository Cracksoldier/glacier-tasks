import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import type { TrashItem } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService, type TranslationKey } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';

const KIND: Record<TrashItem['kind'], { label: TranslationKey; icon: string }> = {
  PROJECT: { label: 'trash.kind.PROJECT', icon: 'fa-diagram-project' },
  STORY: { label: 'taskType.STORY', icon: 'fa-book-bookmark' },
  SUBTASK: { label: 'taskType.SUBTASK', icon: 'fa-list-check' },
};

/**
 * Minimal trash (D39): directly trashed projects, stories and subtasks with Restore.
 * Permanent deletion, filters and per-project views follow in M7.
 */
@Component({
  selector: 'app-trash-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="page-header">
        <h1>{{ i18n.t('trash.title') }}</h1>
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
              <span class="mono key">{{ item.issueKey ?? item.projectKey }}</span>
              <span class="title">{{ item.title }}</span>
              <span class="date">{{ i18n.formatDateTime(item.trashedAt) }}</span>
              <button
                type="button"
                class="btn"
                data-testid="trash-restore"
                [disabled]="busy() === item.id"
                (click)="restore(item)"
              >
                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                {{ i18n.t('trash.restore') }}
              </button>
              @if (errors()[item.id]; as message) {
                <p class="row-error" role="alert" data-testid="trash-error">{{ message }}</p>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .intro {
      margin: -12px 0 20px;
      color: var(--color-text-muted);
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
  `,
})
export class TrashPage {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly projects = inject(ProjectsStore);

  protected readonly kind = KIND;
  protected readonly items = resource({ loader: () => this.api.trash.list() });
  protected readonly busy = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});

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
      this.items.reload();
    } catch (error) {
      this.errors.update((errors) => ({ ...errors, [item.id]: this.i18n.errorMessage(error) }));
    } finally {
      this.busy.set(null);
    }
  }
}
