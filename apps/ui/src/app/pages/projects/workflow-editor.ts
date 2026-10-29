import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';
import {
  STATUS_CATEGORIES,
  STATUS_NAME_MAX_LENGTH,
  type StatusCategory,
  type StatusUsage,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { CATEGORY_KEYS } from '../../core/tasks/task-display';
import { Dialog } from '../../shared/dialog';

/**
 * Workflow editor (spec §3.4, §7 item 5): add, rename, recategorize, set default and reorder
 * statuses (D07: one DONE status must remain), and delete with a mandatory migration target
 * and a preview of the affected tasks (D01, UJ-04).
 */
@Component({
  selector: 'app-workflow-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDrag, CdkDragHandle, CdkDropList, Dialog],
  template: `
    <section class="card" aria-labelledby="workflow-heading">
      <h2 id="workflow-heading">{{ i18n.t('projectSettings.statuses') }}</h2>
      @if (error(); as message) {
        <p class="error-banner" role="alert" data-testid="workflow-error">{{ message }}</p>
      }
      <ol class="statuses" cdkDropList (cdkDropListDropped)="dropped($event)" data-testid="status-list">
        @for (status of statuses.value() ?? []; track status.id; let i = $index; let last = $last) {
          <li cdkDrag [cdkDragData]="status" [attr.data-status-name]="status.name">
            <span class="handle" cdkDragHandle [attr.aria-hidden]="true">
              <i class="fa-solid fa-grip-vertical"></i>
            </span>
            @if (renamingId() === status.id) {
              <input class="name-input" data-testid="status-edit-name" [maxLength]="nameMax"
                [attr.aria-label]="i18n.t('workflow.name')" [value]="renameValue()"
                (input)="renameValue.set($any($event.target).value)"
                (keydown.enter)="$event.preventDefault(); rename(status)"
                (keydown.escape)="renamingId.set(null)" />
              <button type="button" class="btn" data-testid="status-save-name" (click)="rename(status)">
                {{ i18n.t('common.save') }}
              </button>
            } @else {
              <span class="status-name">{{ status.name }}</span>
              <button type="button" class="btn btn-ghost btn-icon" data-testid="status-rename"
                [attr.aria-label]="i18n.t('workflow.rename')" [title]="i18n.t('workflow.rename')"
                (click)="startRename(status)">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
              </button>
            }
            <select data-testid="status-category" [attr.aria-label]="i18n.t('workflow.category') + ': ' + status.name"
              (change)="setCategory(status, $any($event.target))">
              @for (category of categories; track category) {
                <option [value]="category" [selected]="category === status.category">
                  {{ i18n.t(categoryKey[category]) }}
                </option>
              }
            </select>
            <label class="default">
              <input type="radio" name="default-status" data-testid="status-default"
                [checked]="status.isDefault" (change)="setDefault(status, $any($event.target))" />
              {{ i18n.t('projectSettings.defaultStatus') }}
            </label>
            <span class="order">
              <button type="button" class="btn btn-ghost btn-icon" data-testid="status-up" [disabled]="i === 0"
                [attr.aria-label]="i18n.t('workflow.moveUp') + ': ' + status.name" (click)="move(status, i - 1)">
                <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
              </button>
              <button type="button" class="btn btn-ghost btn-icon" data-testid="status-down" [disabled]="last"
                [attr.aria-label]="i18n.t('workflow.moveDown') + ': ' + status.name" (click)="move(status, i + 1)">
                <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
              </button>
              <button type="button" class="btn btn-ghost btn-icon" data-testid="status-delete"
                [attr.aria-label]="i18n.t('workflow.delete') + ': ' + status.name" [title]="i18n.t('workflow.delete')"
                (click)="openDelete(status)">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              </button>
            </span>
          </li>
        }
      </ol>
      <form class="add" (submit)="$event.preventDefault(); add()" novalidate>
        <input data-testid="status-new-name" [placeholder]="i18n.t('workflow.newPlaceholder')"
          [attr.aria-label]="i18n.t('workflow.newPlaceholder')" [maxLength]="nameMax" [value]="newName()"
          (input)="newName.set($any($event.target).value)" />
        <select data-testid="status-new-category" [attr.aria-label]="i18n.t('workflow.category')"
          (change)="newCategory.set($any($event.target).value)">
          @for (category of categories; track category) {
            <option [value]="category" [selected]="category === newCategory()">{{ i18n.t(categoryKey[category]) }}</option>
          }
        </select>
        <button type="submit" class="btn" data-testid="status-add" [disabled]="!newName().trim()">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
          {{ i18n.t('workflow.add') }}
        </button>
      </form>
    </section>

    <app-dialog [open]="deleting() !== null" [heading]="i18n.t('workflow.deleteTitle')" (closed)="closeDelete()">
      @if (deleting(); as status) {
        @if (deleteError(); as message) {
          <p class="error-banner" role="alert" data-testid="wizard-error">{{ message }}</p>
        }
        @if (usage(); as counts) {
          <p data-testid="wizard-usage">
            {{ i18n.t('workflow.deleteUsage', { name: status.name, stories: counts.stories,
              subtasks: counts.subtasks, trashed: counts.trashed }) }}
          </p>
        }
        <div class="field">
          <label for="replacement">{{ i18n.t('workflow.replacement') }}</label>
          <select id="replacement" data-testid="wizard-replacement" (change)="replacementId.set($any($event.target).value)">
            <option value="" [selected]="replacementId() === ''">—</option>
            @for (other of statuses.value() ?? []; track other.id) {
              @if (other.id !== status.id) {
                <option [value]="other.id">{{ other.name }}</option>
              }
            }
          </select>
        </div>
        @if (status.isDefault) {
          <p class="field-hint">{{ i18n.t('workflow.deleteDefaultHint') }}</p>
        }
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="closeDelete()">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" data-testid="wizard-confirm"
            [disabled]="!replacementId() || busy()" (click)="confirmDelete(status)">
            {{ i18n.t('workflow.deleteConfirm') }}
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
    .statuses {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background-color: var(--color-surface);
      }
    }
    .handle {
      color: var(--color-text-muted);
      cursor: grab;
    }
    .status-name {
      min-width: 120px;
      font-weight: 600;
    }
    .default {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--color-text-muted);
      font-size: 12px;
      cursor: pointer;
    }
    .order {
      display: flex;
      margin-left: auto;
    }
    select,
    input:not([type='radio']) {
      padding: 5px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);
    }
    .name-input {
      width: 160px;
    }
    .add {
      display: flex;
      gap: 8px;

      input {
        flex: 1;
      }
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 16px;
    }
    .field select {
      width: 100%;
    }
  `,
})
export class WorkflowEditor {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);

  readonly projectId = input.required<string>();

  protected readonly categories = STATUS_CATEGORIES;
  protected readonly categoryKey = CATEGORY_KEYS;
  protected readonly nameMax = STATUS_NAME_MAX_LENGTH;
  protected readonly statuses = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  protected readonly error = signal<string | null>(null);
  protected readonly newName = signal('');
  protected readonly newCategory = signal<StatusCategory>('IN_PROGRESS');
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameValue = signal('');

  protected readonly deleting = signal<WorkflowStatus | null>(null);
  protected readonly usage = signal<StatusUsage | null>(null);
  protected readonly replacementId = signal('');
  protected readonly deleteError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected add(): Promise<boolean> {
    const name = this.newName().trim();
    return this.run(async () => {
      await this.api.workflows.create(this.projectId(), { name, category: this.newCategory() });
      this.newName.set('');
    });
  }

  protected startRename(status: WorkflowStatus): void {
    this.renameValue.set(status.name);
    this.renamingId.set(status.id);
  }

  protected rename(status: WorkflowStatus): Promise<boolean> {
    return this.run(async () => {
      await this.api.workflows.update(status.id, { name: this.renameValue() });
      this.renamingId.set(null);
    });
  }

  protected async setCategory(status: WorkflowStatus, select: HTMLSelectElement): Promise<void> {
    const ok = await this.run(() =>
      this.api.workflows.update(status.id, { category: select.value as StatusCategory }),
    );
    // An unchanged [selected] binding is not re-applied after a refusal (e.g. last DONE).
    if (!ok) select.value = status.category;
  }

  protected async setDefault(status: WorkflowStatus, radio: HTMLInputElement): Promise<void> {
    const ok = await this.run(() => this.api.workflows.update(status.id, { isDefault: true }));
    if (!ok) radio.checked = false;
  }

  protected move(status: WorkflowStatus, position: number): Promise<boolean> {
    return this.run(() => this.api.workflows.update(status.id, { position }));
  }

  protected dropped(event: CdkDragDrop<unknown, unknown, WorkflowStatus>): void {
    if (event.previousIndex !== event.currentIndex)
      void this.move(event.item.data, event.currentIndex);
  }

  protected async openDelete(status: WorkflowStatus): Promise<void> {
    this.replacementId.set('');
    this.deleteError.set(null);
    this.usage.set(null);
    this.deleting.set(status);
    try {
      this.usage.set(await this.api.workflows.usage(status.id));
    } catch (error) {
      this.deleteError.set(this.i18n.errorMessage(error));
    }
  }

  protected closeDelete(): void {
    this.deleting.set(null);
  }

  /** UJ-04: one atomic removal; on failure nothing changed and the dialog explains why. */
  protected async confirmDelete(status: WorkflowStatus): Promise<void> {
    this.busy.set(true);
    this.deleteError.set(null);
    try {
      await this.api.workflows.removeAndMigrate(status.id, this.replacementId());
      this.deleting.set(null);
      this.statuses.reload();
    } catch (error) {
      this.deleteError.set(this.i18n.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<unknown>): Promise<boolean> {
    this.error.set(null);
    let ok = true;
    try {
      await action();
    } catch (error) {
      ok = false;
      this.error.set(this.i18n.errorMessage(error));
    }
    this.statuses.reload();
    return ok;
  }
}
