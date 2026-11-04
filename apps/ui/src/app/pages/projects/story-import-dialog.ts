import { NgTemplateOutlet } from '@angular/common';
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
import type { StoryImportPreview, TaskDetail } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { loaded } from '../../core/api/loaded';
import { I18nService } from '../../core/i18n/i18n.service';
import { UsersStore } from '../../core/users/users-store';
import { Dialog } from '../../shared/dialog';

type SourceStatus = StoryImportPreview['statuses'][number];

/**
 * Confirms a story import (DATA-11, D58): statuses without a same-named status here are
 * mapped by the user, one profile is assigned to the story and all its subtasks.
 */
@Component({
  selector: 'app-story-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, NgTemplateOutlet],
  template: `
    <app-dialog [open]="preview() !== null" [heading]="i18n.t('storyImport.title')" (closed)="closed.emit()">
      @if (preview(); as file) {
        @if (error(); as message) {
          <p class="error-banner" role="alert">{{ message }}</p>
        }
        <dl class="facts" data-testid="story-import-preview">
          <dt>{{ i18n.t('storyImport.file') }}</dt>
          <dd class="mono">{{ file.fileName }}</dd>
          <dt>{{ i18n.t('storyImport.story') }}</dt>
          <dd><span class="mono">{{ file.story.issueKey }}</span> {{ file.story.title }}</dd>
          <dt>{{ i18n.t('storyImport.subtasks') }}</dt>
          <dd data-testid="story-import-subtasks">{{ file.subtaskCount }}</dd>
          <dt>{{ i18n.t('storyImport.source') }}</dt>
          <dd>{{ i18n.t('storyImport.sourceValue', { name: file.source.projectName, key: file.source.projectKey }) }}</dd>
        </dl>

        @if (file.needsMapping) {
          <fieldset class="mapping" data-testid="story-import-mapping">
            <legend>{{ i18n.t('storyImport.statusesTitle') }}</legend>
            <p class="field-hint">{{ i18n.t('storyImport.statusesHint') }}</p>
            @for (status of unmatched(); track status.sourceId) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: status }" />
            }
            @if (matched().length > 0) {
              <details>
                <summary>{{ i18n.t('storyImport.matched', { count: matched().length }) }}</summary>
                @for (status of matched(); track status.sourceId) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: status }" />
                }
              </details>
            }
          </fieldset>
        }

        <div class="field">
          <label for="story-import-assignee">{{ i18n.t('storyImport.assignee') }}</label>
          <select id="story-import-assignee" data-testid="story-import-assignee"
            (change)="assigneeUserId.set($any($event.target).value || null)">
            <option value="" [selected]="assigneeUserId() === null">{{ i18n.t('task.unassigned') }}</option>
            @for (user of users.active(); track user.id) {
              <option [value]="user.id" [selected]="user.id === assigneeUserId()">{{ user.name }}</option>
            }
          </select>
          @if (file.assignee; as original) {
            <p class="field-hint">
              {{ i18n.t(original.suggestedUserId ? 'storyImport.originalAssignee' : 'storyImport.originalUnavailable', { name: original.name }) }}
            </p>
          }
        </div>

        <ul class="notes">
          @if (file.labels.reused.length > 0) {
            <li>{{ i18n.t('storyImport.labelsReused', { names: file.labels.reused.join(', ') }) }}</li>
          }
          @if (file.labels.created.length > 0) {
            <li data-testid="story-import-new-labels">
              {{ i18n.t('storyImport.labelsCreated', { names: file.labels.created.join(', ') }) }}
            </li>
          }
          @if (file.hasAttachmentRefs) {
            <li class="warning" data-testid="story-import-attachments">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              {{ i18n.t('storyImport.attachments') }}
            </li>
          }
          <li>{{ i18n.t('storyImport.note') }}</li>
        </ul>

        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="closed.emit()">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" data-testid="story-import-confirm"
            [disabled]="busy()" (click)="confirm(file)">
            <i class="fa-solid fa-file-import" aria-hidden="true"></i>
            {{ i18n.t('storyImport.confirm') }}
          </button>
        </div>
      }
    </app-dialog>

    <ng-template #row let-status>
      <div class="map-row">
        <label [for]="'map-' + status.sourceId">
          {{ i18n.t('storyImport.statusTasks', { name: status.name, count: status.taskCount }) }}
        </label>
        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
        <select [id]="'map-' + status.sourceId" [attr.data-testid]="'story-import-status-' + status.sourceId"
          (change)="mapStatus(status.sourceId, $any($event.target).value)">
          @for (target of targets(); track target.id) {
            <option [value]="target.id" [selected]="target.id === statusMap()[status.sourceId]">{{ target.name }}</option>
          }
        </select>
      </div>
    </ng-template>
  `,
  styles: `
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 16px;
      margin: 0 0 16px;

      dt {
        color: var(--color-text-muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    }
    .mapping {
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);

      legend {
        padding: 0 4px;
        font-weight: 600;
      }
      .field-hint {
        margin-bottom: 10px;
      }
      summary {
        margin: 6px 0;
        color: var(--color-text-muted);
        cursor: pointer;
      }
    }
    .map-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;

      label {
        overflow-wrap: anywhere;
      }
      i {
        color: var(--color-text-muted);
      }
    }
    select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);
      color: var(--color-text);
    }
    .notes {
      margin: 0 0 12px;
      padding-left: 18px;
      color: var(--color-text-muted);
      font-size: 13px;

      li + li {
        margin-top: 4px;
      }
    }
    .warning {
      color: var(--color-danger-text);
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class StoryImportDialog {
  protected readonly i18n = inject(I18nService);
  protected readonly users = inject(UsersStore);
  private readonly api = inject(GLACIER_API);

  /** The validated file to import; null keeps the dialog closed. */
  readonly preview = input.required<StoryImportPreview | null>();
  readonly projectId = input.required<string>();
  readonly closed = output<void>();
  readonly imported = output<TaskDetail>();

  protected readonly busy = signal(false);
  protected readonly error = linkedSignal<StoryImportPreview | null, string | null>({
    source: this.preview,
    computation: () => null,
  });
  protected readonly statusMap = linkedSignal(() =>
    Object.fromEntries(
      (this.preview()?.statuses ?? []).map((s) => [s.sourceId, s.suggestedStatusId]),
    ),
  );
  protected readonly assigneeUserId = linkedSignal<string | null>(
    () => this.preview()?.assignee?.suggestedUserId ?? null,
  );
  private readonly statuses = resource({
    params: () => (this.preview() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  protected readonly targets = computed(() => loaded(this.statuses) ?? []);
  protected readonly unmatched = computed<SourceStatus[]>(
    () => this.preview()?.statuses.filter((s) => !s.matchedByName) ?? [],
  );
  protected readonly matched = computed<SourceStatus[]>(
    () => this.preview()?.statuses.filter((s) => s.matchedByName) ?? [],
  );

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
  }

  protected mapStatus(sourceId: string, targetId: string): void {
    this.statusMap.update((map) => ({ ...map, [sourceId]: targetId }));
  }

  protected async confirm(file: StoryImportPreview): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const story = await this.api.data.importStory({
        token: file.token,
        projectId: this.projectId(),
        statusMap: this.statusMap(),
        assigneeUserId: this.assigneeUserId(),
      });
      this.imported.emit(story);
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
