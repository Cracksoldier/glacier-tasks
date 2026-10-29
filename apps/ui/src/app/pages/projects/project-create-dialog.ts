import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  isAppErrorInfo,
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_NAME_MAX_LENGTH,
  suggestProjectKey,
} from '@glacier-tasks/domain';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { Dialog } from '../../shared/dialog';

/** "New project" dialog (PROJ-01). Opened through ProjectsStore.createDialogOpen. */
@Component({
  selector: 'app-project-create-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog],
  template: `
    <app-dialog
      [open]="store.createDialogOpen()"
      [heading]="i18n.t('projects.create.title')"
      (closed)="close()"
    >
      <form (submit)="$event.preventDefault(); submit()" novalidate>
        @if (error(); as message) {
          <p class="error-banner" role="alert">{{ message }}</p>
        }
        <div class="field">
          <label for="project-name">{{ i18n.t('projects.field.name') }}</label>
          <input
            id="project-name"
            data-testid="project-name"
            autocomplete="off"
            [maxLength]="nameMax"
            [value]="name()"
            (input)="setName($any($event.target).value)"
            [attr.aria-invalid]="showErrors() && !nameValid()"
          />
          @if (showErrors() && !nameValid()) {
            <p class="field-error">{{ i18n.t('validation.required') }}</p>
          }
        </div>
        <div class="field">
          <label for="project-key">{{ i18n.t('projects.field.key') }}</label>
          <input
            id="project-key"
            class="mono"
            data-testid="project-key"
            autocomplete="off"
            maxlength="10"
            [value]="key()"
            (input)="setKey($any($event.target).value)"
            [attr.aria-invalid]="keyError() !== null"
            aria-describedby="project-key-hint"
          />
          @if (keyError(); as message) {
            <p class="field-error" data-testid="project-key-error">{{ message }}</p>
          }
          <p id="project-key-hint" class="field-hint">{{ i18n.t('projects.field.keyHint') }}</p>
        </div>
        <div class="field">
          <label for="project-description">{{ i18n.t('projects.field.description') }}</label>
          <textarea
            id="project-description"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
          ></textarea>
        </div>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="close()">
            {{ i18n.t('common.cancel') }}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            data-testid="project-create-submit"
            [disabled]="saving()"
          >
            {{ i18n.t('projects.create.submit') }}
          </button>
        </div>
      </form>
    </app-dialog>
  `,
  styles: `
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 8px;
    }
  `,
})
export class ProjectCreateDialog {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ProjectsStore);
  private readonly router = inject(Router);

  protected readonly nameMax = PROJECT_NAME_MAX_LENGTH;
  protected readonly name = signal('');
  protected readonly key = signal('');
  protected readonly description = signal('');
  protected readonly saving = signal(false);
  protected readonly showErrors = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly keyTaken = signal(false);
  /** The key follows the name until the user edits it. */
  private keyEdited = false;

  protected readonly nameValid = computed(() => this.name().trim().length > 0);
  protected readonly keyValid = computed(() => isValidProjectKey(normalizeProjectKey(this.key())));
  protected readonly keyError = computed(() => {
    if (this.keyTaken()) return this.i18n.t('errors.projectKeyTaken');
    if ((this.showErrors() || this.key() !== '') && !this.keyValid()) {
      return this.i18n.t('projects.field.keyInvalid');
    }
    return null;
  });

  protected setName(value: string): void {
    this.name.set(value);
    if (!this.keyEdited) this.key.set(suggestProjectKey(value));
    this.keyTaken.set(false);
  }

  protected setKey(value: string): void {
    this.keyEdited = true;
    this.key.set(normalizeProjectKey(value));
    this.keyTaken.set(false);
  }

  protected async submit(): Promise<void> {
    this.showErrors.set(true);
    this.error.set(null);
    if (!this.nameValid() || !this.keyValid() || this.saving()) return;
    this.saving.set(true);
    try {
      const project = await this.store.create({
        name: this.name(),
        key: this.key(),
        description: this.description(),
      });
      this.close();
      await this.router.navigate(['/projects', project.id]);
    } catch (error) {
      if (isAppErrorInfo(error) && error.message === 'errors.projectKeyTaken') {
        this.keyTaken.set(true);
      } else {
        this.error.set(this.i18n.errorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.store.createDialogOpen.set(false);
    this.name.set('');
    this.key.set('');
    this.description.set('');
    this.showErrors.set(false);
    this.error.set(null);
    this.keyTaken.set(false);
    this.keyEdited = false;
  }
}
