import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { ActivityEvent } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ActivityTimeline } from '../../shared/activity-timeline';

const PAGE_SIZE = 50;

/** Project activity tab (PROJ-06, D12, D45): project, status, label and task events. */
@Component({
  selector: 'app-project-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimeline],
  template: `
    @if (error(); as message) {
      <p class="error-banner" role="alert">{{ message }}</p>
    }
    <div class="card activity" data-testid="project-activity">
      @if (loaded()) {
        <app-activity-timeline [events]="events()" [showSubject]="true" />
      } @else {
        <p class="muted">{{ i18n.t('common.loading') }}</p>
      }
    </div>
    @if (events().length < total()) {
      <button type="button" class="btn more" data-testid="activity-more" [disabled]="loading()" (click)="loadMore()">
        {{ i18n.t('activity.loadMore', { shown: events().length, total: total() }) }}
      </button>
    }
  `,
  styles: `
    .activity {
      padding: 8px 16px;
    }
    .muted {
      color: var(--color-text-muted);
    }
    .more {
      margin-top: 12px;
    }
  `,
})
export class ProjectActivity {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);

  readonly projectId = input.required<string>();

  protected readonly events = signal<ActivityEvent[]>([]);
  protected readonly total = signal(0);
  protected readonly loaded = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private generation = 0;

  constructor() {
    effect(() => {
      this.projectId();
      untracked(() => {
        this.generation++;
        this.events.set([]);
        this.total.set(0);
        this.loaded.set(false);
        this.loading.set(false);
        void this.loadMore();
      });
    });
  }

  protected async loadMore(): Promise<void> {
    if (this.loading()) return;
    const generation = this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.activity.forProject(this.projectId(), {
        offset: this.events().length,
        limit: PAGE_SIZE,
      });
      if (generation !== this.generation) return;
      this.events.update((events) => [...events, ...page.items]);
      this.total.set(page.total);
      this.loaded.set(true);
    } catch (error) {
      if (generation === this.generation) this.error.set(this.i18n.errorMessage(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
}
