import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  isAppErrorInfo,
  isValidProjectKey,
  normalizeProjectKey,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  type UpdateProjectInput,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { CATEGORY_KEYS } from '../../core/tasks/task-display';
import { Dialog } from '../../shared/dialog';
import { LabelManager } from './label-manager';

/** Edit name, key and description (PROJ-03); statuses are read-only until M4. */
@Component({
  selector: 'app-project-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, LabelManager, RouterLink],
  template: `
    @if (project(); as project) {
      <section class="page narrow">
        <a class="back" [routerLink]="['/projects', project.id]">
          <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
          {{ project.name }}
        </a>
        <header class="page-header">
          <h1>{{ i18n.t('projectSettings.title') }}</h1>
        </header>

        <form class="card" (submit)="$event.preventDefault(); save()" novalidate>
          @if (error(); as message) {
            <p class="error-banner" role="alert">{{ message }}</p>
          }
          @if (saved()) {
            <p class="saved" role="status" data-testid="project-saved">
              {{ i18n.t('common.saved') }}
            </p>
          }
          <div class="field">
            <label for="settings-name">{{ i18n.t('projects.field.name') }}</label>
            <input
              id="settings-name"
              data-testid="settings-project-name"
              [maxLength]="nameMax"
              [value]="name()"
              (input)="edit(name, $any($event.target).value)"
              [attr.aria-invalid]="!nameValid()"
            />
            @if (!nameValid()) {
              <p class="field-error">{{ i18n.t('validation.required') }}</p>
            }
          </div>
          <div class="field">
            <label for="settings-key">{{ i18n.t('projects.field.key') }}</label>
            <input
              id="settings-key"
              class="mono"
              data-testid="settings-project-key"
              maxlength="10"
              [disabled]="project.keyLocked"
              [value]="key()"
              (input)="edit(key, normalize($any($event.target).value))"
              [attr.aria-invalid]="keyError() !== null"
              aria-describedby="settings-key-hint"
            />
            @if (keyError(); as message) {
              <p class="field-error">{{ message }}</p>
            }
            <p id="settings-key-hint" class="field-hint" data-testid="settings-key-hint">
              {{
                i18n.t(project.keyLocked ? 'projectSettings.keyLocked' : 'projects.field.keyHint')
              }}
            </p>
          </div>
          <div class="field">
            <label for="settings-description">{{ i18n.t('projects.field.description') }}</label>
            <textarea
              id="settings-description"
              [maxLength]="descriptionMax"
              [value]="description()"
              (input)="edit(description, $any($event.target).value)"
            ></textarea>
          </div>
          <div class="page-actions">
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="settings-save"
              [disabled]="saving() || !dirty()"
            >
              {{ i18n.t('common.save') }}
            </button>
          </div>
        </form>

        <section class="card statuses" aria-labelledby="statuses-heading">
          <h2 id="statuses-heading">{{ i18n.t('projectSettings.statuses') }}</h2>
          <ol data-testid="status-list">
            @for (status of statuses.value() ?? []; track status.id) {
              <li>
                <span class="status-name">{{ status.name }}</span>
                <span class="category">{{ i18n.t(categoryKey[status.category]) }}</span>
                @if (status.isDefault) {
                  <span class="badge">{{ i18n.t('projectSettings.defaultStatus') }}</span>
                }
              </li>
            }
          </ol>
          <p class="field-hint">{{ i18n.t('projectSettings.statusesHint') }}</p>
        </section>

        <app-label-manager class="block" [projectId]="project.id" />

        <section class="card danger-zone" aria-labelledby="trash-heading">
          <h2 id="trash-heading">{{ i18n.t('projectSettings.trashTitle') }}</h2>
          <p class="field-hint">{{ i18n.t('projectSettings.trashBody') }}</p>
          <button
            type="button"
            class="btn"
            data-testid="project-trash"
            (click)="trashOpen.set(true)"
          >
            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
            {{ i18n.t('projectSettings.trashAction') }}
          </button>
        </section>
      </section>

      <app-dialog
        [open]="trashOpen()"
        [heading]="i18n.t('projectSettings.trashTitle')"
        (closed)="trashOpen.set(false)"
      >
        <p>{{ i18n.t('projectSettings.trashConfirm', { name: project.name }) }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="trashOpen.set(false)">
            {{ i18n.t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="project-trash-confirm"
            (click)="trashProject()"
          >
            {{ i18n.t('projectSettings.trashAction') }}
          </button>
        </div>
      </app-dialog>
    }
  `,
  styles: `
    .block {
      display: block;
      margin-top: 20px;
    }
    .danger-zone {
      margin-top: 20px;

      h2 {
        margin: 0 0 8px;
        font-size: 15px;
      }
      p {
        margin-bottom: 12px;
      }
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 16px;
    }
    .narrow {
      max-width: 720px;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      color: var(--color-text-muted);
      text-decoration: none;

      &:hover {
        color: var(--color-text);
      }
    }
    .saved {
      margin: 0 0 16px;
      color: var(--color-accent);
    }
    .statuses {
      margin-top: 20px;

      h2 {
        margin: 0 0 12px;
        font-size: 15px;
      }
      ol {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0 0 12px;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: center;
        gap: 12px;
      }
    }
    .status-name {
      min-width: 140px;
      font-weight: 600;
    }
    .category {
      color: var(--color-text-muted);
    }
    .badge {
      padding: 1px 8px;
      border: 1px solid var(--color-accent);
      border-radius: 999px;
      color: var(--color-accent);
      font-size: 12px;
    }
  `,
})
export class ProjectSettingsPage {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(ProjectsStore);
  private readonly api = inject(GLACIER_API);
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsStore);

  readonly projectId = input.required<string>();
  protected readonly project = computed(() => this.store.find(this.projectId()));

  protected readonly nameMax = PROJECT_NAME_MAX_LENGTH;
  protected readonly descriptionMax = PROJECT_DESCRIPTION_MAX_LENGTH;
  protected readonly categoryKey = CATEGORY_KEYS;

  // Form fields start from the stored project and reset when it changes (e.g. after saving).
  protected readonly name = linkedSignal(() => this.project()?.name ?? '');
  protected readonly key = linkedSignal(() => this.project()?.key ?? '');
  protected readonly description = linkedSignal(() => this.project()?.description ?? '');
  protected readonly saving = signal(false);
  protected readonly trashOpen = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly keyTaken = signal(false);

  protected readonly statuses = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.workflows.list(params),
  });

  protected readonly nameValid = computed(() => this.name().trim().length > 0);
  protected readonly keyError = computed(() => {
    if (this.keyTaken()) return this.i18n.t('errors.projectKeyTaken');
    return isValidProjectKey(this.key()) ? null : this.i18n.t('projects.field.keyInvalid');
  });
  private readonly patch = computed<UpdateProjectInput>(() => {
    const project = this.project();
    if (!project) return {};
    const patch: UpdateProjectInput = {};
    if (this.name().trim() !== project.name) patch.name = this.name();
    if (this.key() !== project.key) patch.key = this.key();
    if (this.description() !== project.description) patch.description = this.description();
    return patch;
  });
  protected readonly dirty = computed(() => Object.keys(this.patch()).length > 0);

  protected normalize(value: string): string {
    return normalizeProjectKey(value);
  }

  protected edit(field: { set(value: string): void }, value: string): void {
    field.set(value);
    this.saved.set(false);
    this.keyTaken.set(false);
  }

  /** TRASH-01: the project and its tasks go to the trash; restore from the Trash page. */
  protected async trashProject(): Promise<void> {
    this.trashOpen.set(false);
    this.error.set(null);
    try {
      await this.api.projects.trash(this.projectId());
      // The main process cleared the stored last project; mirror that locally.
      if (this.settings.lastProjectId() === this.projectId()) await this.settings.load();
      await this.store.load();
      await this.router.navigate(['/projects']);
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
    }
  }

  protected async save(): Promise<void> {
    if (!this.nameValid() || this.keyError() || !this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.store.update(this.projectId(), this.patch());
      this.saved.set(true);
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
}
