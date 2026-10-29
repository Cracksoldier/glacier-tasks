import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
} from '@angular/core';
import type { AttachmentMetadata } from '@glacier-tasks/domain';
import { diffLines } from '../../core/activity/line-diff';
import { GLACIER_API } from '../../core/api/glacier-api';
import { loaded } from '../../core/api/loaded';
import { I18nService } from '../../core/i18n/i18n.service';
import { Dialog } from '../../shared/dialog';
import { MarkdownView } from '../../shared/markdown-view';

type Mode = 'rendered' | 'source' | 'compare';

/**
 * Description version browser (AUDIT-04, D11): every stored description text, newest first,
 * shown rendered or as source, or compared line by line with the version before it.
 */
@Component({
  selector: 'app-description-versions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, MarkdownView],
  template: `
    <app-dialog [open]="open()" [wide]="true" [heading]="i18n.t('versions.title')" (closed)="closed.emit()">
      @if (versions.error()) {
        <p class="error-banner" role="alert">{{ i18n.errorMessage(versions.error()) }}</p>
      }
      <div class="layout">
        <ol class="versions" data-testid="version-list">
          @for (version of loaded(versions) ?? []; track version.eventId; let i = $index) {
            <li>
              <button type="button" class="version" data-testid="version-item"
                [class.active]="version.eventId === selectedId()" (click)="selectedId.set(version.eventId)">
                <span>{{ i18n.formatDateTime(version.occurredAt) }}</span>
                @if (i === 0) {
                  <span class="badge">{{ i18n.t('versions.current') }}</span>
                }
              </button>
            </li>
          }
        </ol>
        <div class="content">
          <div class="modes" role="tablist" [attr.aria-label]="i18n.t('versions.view')">
            @for (option of modes; track option) {
              <button type="button" role="tab" class="tab" [attr.data-testid]="'version-mode-' + option"
                [class.active]="mode() === option" [attr.aria-selected]="mode() === option"
                [disabled]="option === 'compare' && !previous()" (click)="mode.set(option)">
                {{ i18n.t(modeKey[option]) }}
              </button>
            }
          </div>
          @if (selected(); as version) {
            @switch (mode()) {
              @case ('rendered') {
                <div class="card pane" data-testid="version-rendered">
                  @if (version.markdown.trim()) {
                    <app-markdown-view [source]="version.markdown" [attachments]="attachments()" />
                  } @else {
                    <p class="muted">{{ i18n.t('task.noDescription') }}</p>
                  }
                </div>
              }
              @case ('source') {
                <pre class="card pane mono" data-testid="version-source">{{ version.markdown }}</pre>
              }
              @case ('compare') {
                <div class="card pane mono diff" data-testid="version-diff"
                  [attr.aria-label]="i18n.t('versions.compareLabel')">
                  @for (line of diff(); track $index) {
                    <div class="diff-line {{ line.kind }}" [attr.data-kind]="line.kind">
                      <span class="sign" aria-hidden="true">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</span>
                      <span class="visually-hidden">{{ i18n.t(lineKey[line.kind]) }}</span>
                      <span>{{ line.text || ' ' }}</span>
                    </div>
                  }
                </div>
              }
            }
          }
        </div>
      </div>
    </app-dialog>
  `,
  styles: `
    .layout {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      gap: 16px;
    }
    .versions {
      max-height: 60vh;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .version {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      padding: 6px 8px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--color-text);
      font-size: 13px;
      text-align: left;
      cursor: pointer;

      &.active {
        border-color: var(--color-border);
        background-color: var(--color-surface-elevated);
        font-weight: 600;
      }
    }
    .badge {
      color: var(--color-accent);
      font-size: 11px;
    }
    .modes {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .tab {
      padding: 4px 10px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;

      &.active {
        border-color: var(--color-border);
        color: var(--color-accent);
      }
      &:disabled {
        cursor: default;
        opacity: 0.5;
      }
    }
    .pane {
      max-height: 60vh;
      margin: 0;
      padding: 12px;
      overflow: auto;
    }
    pre.pane {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .diff-line {
      display: flex;
      gap: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;

      &.added {
        background-color: color-mix(in srgb, var(--category-done) 18%, transparent);
      }
      &.removed {
        background-color: color-mix(in srgb, var(--color-danger) 18%, transparent);
        text-decoration: line-through;
      }
    }
    .sign {
      flex: none;
      width: 1ch;
      color: var(--color-text-muted);
    }
  `,
})
export class DescriptionVersions {
  /** Resource values without the error-state throw (see core/api/loaded). */
  protected readonly loaded = loaded;
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);

  readonly taskId = input.required<string>();
  readonly open = input.required<boolean>();
  /** The event to select first (from the history); defaults to the newest version. */
  readonly initialEventId = input<string | null>(null);
  readonly attachments = input<ReadonlyArray<AttachmentMetadata>>([]);
  readonly closed = output<void>();

  protected readonly modes: Mode[] = ['rendered', 'source', 'compare'];
  protected readonly modeKey = {
    rendered: 'versions.rendered',
    source: 'versions.source',
    compare: 'versions.compare',
  } as const;
  protected readonly lineKey = {
    same: 'versions.lineSame',
    added: 'versions.lineAdded',
    removed: 'versions.lineRemoved',
  } as const;

  protected readonly versions = resource({
    params: () => (this.open() ? this.taskId() : undefined),
    loader: ({ params }) => this.api.tasks.descriptionVersions(params),
  });
  protected readonly selectedId = linkedSignal(
    () => this.initialEventId() ?? loaded(this.versions)?.[0]?.eventId ?? null,
  );
  protected readonly mode = signal<Mode>('rendered');

  private readonly index = computed(() =>
    (loaded(this.versions) ?? []).findIndex((v) => v.eventId === this.selectedId()),
  );
  protected readonly selected = computed(() => loaded(this.versions)?.[this.index()]);
  /** Newest first, so the predecessor is the next entry. */
  protected readonly previous = computed(() =>
    this.index() >= 0 ? loaded(this.versions)?.[this.index() + 1] : undefined,
  );
  protected readonly diff = computed(() =>
    diffLines(this.previous()?.markdown ?? '', this.selected()?.markdown ?? ''),
  );
}
