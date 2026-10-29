import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';
import {
  isAppErrorInfo,
  type Label,
  LABEL_COLORS,
  LABEL_NAME_MAX_LENGTH,
  type LabelColor,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { LABEL_COLOR_KEYS } from '../../core/tasks/task-display';
import { Dialog } from '../../shared/dialog';
import { LabelChip } from '../../shared/label-chip';

/** Project label manager (PROJ-03, spec §3.5): create, rename, recolor (D25), delete. */
@Component({
  selector: 'app-label-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, LabelChip],
  template: `
    <section class="card" aria-labelledby="labels-heading">
      <h2 id="labels-heading">{{ i18n.t('labels.title') }}</h2>
      @if (error(); as message) {
        <p class="error-banner" role="alert">{{ message }}</p>
      }
      <ul class="labels" data-testid="label-list">
        @for (label of labels.value() ?? []; track label.id) {
          <li [attr.data-label-name]="label.name">
            @if (editingId() === label.id) {
              <input
                class="name-input"
                data-testid="label-edit-name"
                [attr.aria-label]="i18n.t('labels.name')"
                [maxLength]="nameMax"
                [value]="editName()"
                (input)="editName.set($any($event.target).value)"
                (keydown.enter)="$event.preventDefault(); rename(label)"
                (keydown.escape)="editingId.set(null)"
              />
              <button type="button" class="btn" data-testid="label-save" (click)="rename(label)">
                {{ i18n.t('common.save') }}
              </button>
            } @else {
              <app-label-chip [name]="label.name" [color]="label.color" />
              <span class="count">{{ i18n.t('labels.taskCount', { count: label.taskCount }) }}</span>
            }
            <span class="swatches" role="group" [attr.aria-label]="i18n.t('labels.color')">
              @for (color of colors; track color) {
                <button
                  type="button"
                  class="swatch"
                  [class.selected]="label.color === color"
                  [style.background-color]="'var(--label-' + color + '-bg)'"
                  [style.border-color]="'var(--label-' + color + '-fg)'"
                  [attr.aria-label]="i18n.t('labels.color') + ': ' + i18n.t(colorKey[color])"
                  [attr.aria-pressed]="label.color === color"
                  [attr.data-testid]="'label-color-' + color"
                  (click)="recolor(label, color)"
                ></button>
              }
            </span>
            <span class="actions">
              <button
                type="button"
                class="btn btn-ghost btn-icon"
                data-testid="label-rename"
                [attr.aria-label]="i18n.t('labels.rename')"
                [title]="i18n.t('labels.rename')"
                (click)="startEdit(label)"
              >
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-icon"
                data-testid="label-delete"
                [attr.aria-label]="i18n.t('labels.delete')"
                [title]="i18n.t('labels.delete')"
                (click)="removing.set(label)"
              >
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              </button>
            </span>
          </li>
        } @empty {
          <li class="hint">{{ i18n.t('labels.empty') }}</li>
        }
      </ul>
      <form class="create" (submit)="$event.preventDefault(); create()" novalidate>
        <input
          data-testid="label-new-name"
          [placeholder]="i18n.t('labels.newPlaceholder')"
          [attr.aria-label]="i18n.t('labels.newPlaceholder')"
          [maxLength]="nameMax"
          [value]="newName()"
          (input)="newName.set($any($event.target).value)"
        />
        <button type="submit" class="btn" data-testid="label-create" [disabled]="!newName().trim()">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
          {{ i18n.t('labels.add') }}
        </button>
      </form>
    </section>

    <app-dialog
      [open]="removing() !== null"
      [heading]="i18n.t('labels.deleteTitle')"
      (closed)="removing.set(null)"
    >
      @if (removing(); as label) {
        <p>{{ i18n.t('labels.deleteBody', { name: label.name, count: label.taskCount }) }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="removing.set(null)">
            {{ i18n.t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="label-delete-confirm"
            (click)="remove(label)"
          >
            {{ i18n.t('labels.delete') }}
          </button>
        </div>
      }
    </app-dialog>
  `,
  styles: `
    h2 {
      margin: 0 0 12px;
      font-size: 15px;
    }
    .labels {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 12px;
      }
    }
    .count,
    .hint {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .swatches {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .swatch {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid;
      border-radius: 50%;
      cursor: pointer;

      &.selected {
        outline: 2px solid var(--color-accent);
        outline-offset: 1px;
      }
    }
    .actions {
      display: flex;
    }
    .create {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);
    }
    .name-input {
      max-width: 220px;
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 16px;
    }
  `,
})
export class LabelManager {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);

  readonly projectId = input.required<string>();

  protected readonly colors = LABEL_COLORS;
  protected readonly colorKey = LABEL_COLOR_KEYS;
  protected readonly nameMax = LABEL_NAME_MAX_LENGTH;
  protected readonly labels = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.labels.list(params),
  });
  protected readonly newName = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly removing = signal<Label | null>(null);
  protected readonly error = signal<string | null>(null);

  protected create(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return Promise.resolve();
    return this.run(async () => {
      await this.api.labels.create(this.projectId(), { name, color: LABEL_COLORS[0] });
      this.newName.set('');
    });
  }

  protected startEdit(label: Label): void {
    this.editName.set(label.name);
    this.editingId.set(label.id);
  }

  protected rename(label: Label): Promise<void> {
    return this.run(async () => {
      await this.api.labels.update(label.id, { name: this.editName() });
      this.editingId.set(null);
    });
  }

  protected recolor(label: Label, color: LabelColor): Promise<void> {
    return this.run(() => this.api.labels.update(label.id, { color }));
  }

  protected remove(label: Label): Promise<void> {
    this.removing.set(null);
    return this.run(() => this.api.labels.remove(label.id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(
        isAppErrorInfo(error) &&
          error.code === 'VALIDATION' &&
          error.message === 'errors.validation'
          ? this.i18n.t('validation.required')
          : this.i18n.errorMessage(error),
      );
    }
    this.labels.reload();
  }
}
