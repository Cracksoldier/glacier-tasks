import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ActivityEvent } from '@glacier-tasks/domain';
import { ActivityFormatter } from '../core/activity/activity-format';
import { I18nService } from '../core/i18n/i18n.service';

/**
 * History list, newest first (AUDIT-02, D12): task details, the project activity tab and the
 * profile history dialog. Text comes from the events' own snapshots, so renamed or archived
 * profiles, statuses and labels stay readable.
 */
@Component({
  selector: 'app-activity-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (entries().length === 0) {
      <p class="muted" data-testid="activity-empty">{{ i18n.t('activity.empty') }}</p>
    } @else {
      <ol class="timeline" data-testid="activity-list">
        @for (entry of entries(); track entry.id) {
          <li class="entry" data-testid="activity-entry">
            <i class="fa-solid {{ entry.icon }} icon" aria-hidden="true"></i>
            <div class="body">
              <div class="line">
                @if (showSubject()) {
                  @if (entry.task; as task) {
                    <a class="subject" [routerLink]="['/projects', task.projectId, 'tasks', task.id]">
                      {{ entry.subject }}
                    </a>
                  } @else {
                    <span class="subject">{{ entry.subject }}</span>
                  }
                }
                <span class="summary">{{ entry.summary }}</span>
                <time class="time" [attr.datetime]="entry.occurredAt">
                  {{ i18n.formatDateTime(entry.occurredAt) }}
                </time>
              </div>
              @if (entry.details.length > 0) {
                <ul class="details">
                  @for (detail of entry.details; track $index) {
                    <li>{{ detail }}</li>
                  }
                </ul>
              }
              @if (entry.descriptionChanged && versionsLink()) {
                <button type="button" class="btn btn-ghost link" data-testid="activity-versions"
                  (click)="openVersions.emit(entry.id)">
                  {{ i18n.t('activity.showVersions') }}
                </button>
              }
            </div>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .timeline {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .entry {
      display: flex;
      gap: 10px;
      padding: 8px 0;

      & + .entry {
        border-top: 1px solid var(--color-border);
      }
    }
    .icon {
      width: 16px;
      margin-top: 3px;
      color: var(--color-text-muted);
      text-align: center;
    }
    .body {
      flex: 1;
      min-width: 0;
    }
    .line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
    }
    .subject {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    a.subject {
      color: var(--color-text);
    }
    .time {
      margin-left: auto;
      color: var(--color-text-muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .details {
      margin: 4px 0 0;
      padding-left: 18px;
      color: var(--color-text-muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .link {
      margin-top: 4px;
      padding: 2px 6px;
      font-size: 12px;
    }
  `,
})
export class ActivityTimeline {
  protected readonly i18n = inject(I18nService);
  private readonly formatter = new ActivityFormatter(this.i18n);

  readonly events = input.required<ReadonlyArray<ActivityEvent>>();
  /** Shows what each entry is about (project and profile views; not on the task itself). */
  readonly showSubject = input(false);
  /** Offers "Show versions" on entries that changed the description (task details). */
  readonly versionsLink = input(false);
  readonly openVersions = output<string>();

  protected readonly entries = computed(() =>
    this.events().map((event) => this.formatter.format(event)),
  );
}
