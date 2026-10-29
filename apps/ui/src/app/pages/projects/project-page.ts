import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { type ProjectViewKind, TITLE_MAX_LENGTH } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ProjectViewStore } from '../../core/tasks/project-view';
import { Dialog } from '../../shared/dialog';
import { TaskFilterBar, type TaskSort } from '../../shared/task-filter-bar';
import { type ListQuery, TaskList } from '../../shared/task-list';
import { Board } from './board';
import { ProjectActivity } from './project-activity';

/**
 * Project home (PROJ-02): remembers the project as last opened and shows the board or the
 * list (D17) with the project's shared filters (D42, D43).
 */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Board, Dialog, ProjectActivity, RouterLink, TaskFilterBar, TaskList],
  template: `
    @if (project(); as project) {
      <section class="page wide">
        <header class="page-header">
          <div>
            <span class="key mono" data-testid="project-key-badge">{{ project.key }}</span>
            <h1 data-testid="project-title">{{ project.name }}</h1>
          </div>
          <div class="page-actions">
            @if (trashCount() > 0) {
              <a class="btn btn-ghost" data-testid="project-trash-link" [routerLink]="['/trash']"
                [queryParams]="{ project: project.id }">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                {{ i18n.t('trash.projectLink', { count: trashCount() }) }}
              </a>
            }
            <a
              class="btn"
              [routerLink]="['/projects', project.id, 'settings']"
              data-testid="project-settings-link"
            >
              <i class="fa-solid fa-sliders" aria-hidden="true"></i>
              {{ i18n.t('projectSettings.title') }}
            </a>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="story-new"
              (click)="openCreate()"
            >
              <i class="fa-solid fa-plus" aria-hidden="true"></i>
              {{ i18n.t('stories.new') }}
            </button>
          </div>
        </header>
        @if (project.description) {
          <p class="description">{{ project.description }}</p>
        }

        <div class="view-tabs" role="tablist" [attr.aria-label]="i18n.t('board.views')">
          <button type="button" role="tab" class="tab" data-testid="view-board"
            [class.active]="view() === 'board'" [attr.aria-selected]="view() === 'board'"
            (click)="setView('board')">
            <i class="fa-solid fa-table-columns" aria-hidden="true"></i>
            {{ i18n.t('board.viewBoard') }}
          </button>
          <button type="button" role="tab" class="tab" data-testid="view-list"
            [class.active]="view() === 'list'" [attr.aria-selected]="view() === 'list'"
            (click)="setView('list')">
            <i class="fa-solid fa-list" aria-hidden="true"></i>
            {{ i18n.t('board.viewList') }}
          </button>
          <button type="button" role="tab" class="tab" data-testid="view-activity"
            [class.active]="view() === 'activity'" [attr.aria-selected]="view() === 'activity'"
            (click)="setView('activity')">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            {{ i18n.t('activity.projectTab') }}
          </button>
        </div>

        @if (view() !== 'activity') {
        <app-task-filter-bar
          [filters]="projectView().filters"
          [statuses]="statuses.value() ?? []"
          [labels]="labels.value() ?? []"
          [text]="text()"
          [sort]="projectView()"
          [showText]="view() === 'list'"
          [showSort]="view() === 'list'"
          [showStatus]="view() === 'list'"
          (filtersChange)="viewStore.update(project.id, { filters: $event })"
          (sortChange)="setSort(project.id, $event)"
          (textChange)="text.set($event)"
        />
        }
        @if (view() === 'activity') {
          <app-project-activity [projectId]="project.id" />
        } @else if (view() === 'board') {
          <app-board [projectId]="project.id" [filters]="projectView().filters"
            [group]="projectView().boardGroup"
            (groupChange)="viewStore.update(project.id, { boardGroup: $event })" />
        } @else {
          <app-task-list
            [query]="listQuery()"
            [columns]="projectView().columns"
            emptyTitle="stories.emptyTitle"
            emptyBody="stories.emptyBody"
            (columnsChange)="viewStore.update(project.id, { columns: $event })"
          />
        }
      </section>

      <app-dialog
        [open]="createOpen()"
        [heading]="i18n.t('stories.createTitle')"
        (closed)="createOpen.set(false)"
      >
        <form (submit)="$event.preventDefault(); create(project.id)" novalidate>
          @if (createError(); as message) {
            <p class="error-banner" role="alert">{{ message }}</p>
          }
          <div class="field">
            <label for="story-title">{{ i18n.t('task.field.title') }}</label>
            <input
              id="story-title"
              data-testid="story-title"
              autocomplete="off"
              [maxLength]="titleMax"
              [value]="newTitle()"
              (input)="newTitle.set($any($event.target).value)"
            />
          </div>
          <div class="page-actions dialog-actions">
            <button type="button" class="btn" (click)="createOpen.set(false)">
              {{ i18n.t('common.cancel') }}
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="story-create-submit"
              [disabled]="newTitle().trim() === '' || creating()"
            >
              {{ i18n.t('stories.create') }}
            </button>
          </div>
        </form>
      </app-dialog>
    }
  `,
  styles: `
    .key {
      color: var(--color-accent);
      font-size: 12px;
      font-weight: 600;
    }
    h1 {
      overflow-wrap: anywhere;
    }
    .description {
      margin: -8px 0 24px;
      color: var(--color-text-muted);
      white-space: pre-line;
    }
    .wide {
      max-width: none;
    }
    .view-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;

      &.active {
        border-color: var(--color-border);
        background-color: var(--color-surface-elevated);
        color: var(--color-accent);
        font-weight: 600;
      }
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 8px;
    }
  `,
})
export class ProjectPage {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly store = inject(ProjectsStore);
  private readonly settings = inject(SettingsStore);
  protected readonly viewStore = inject(ProjectViewStore);
  private readonly router = inject(Router);

  /** Bound from the route parameter. */
  readonly projectId = input.required<string>();
  protected readonly project = computed(() => this.store.find(this.projectId()));

  protected readonly titleMax = TITLE_MAX_LENGTH;
  /** Board or list (D17 `lastView`). */
  protected readonly view = this.settings.lastView;
  protected readonly projectView = this.viewStore.view(this.projectId);
  /** List search text; not remembered (D42) and reset when the project changes. */
  protected readonly text = linkedSignal({ source: this.projectId, computation: () => '' });
  protected readonly listQuery = computed<ListQuery>(() => {
    const view = this.projectView();
    return {
      projectId: this.projectId(),
      text: this.text(),
      ...view.filters,
      sortBy: view.sortBy,
      sortDirection: view.sortDirection,
    };
  });
  protected readonly statuses = resource({
    params: () => (this.project() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  protected readonly labels = resource({
    params: () => (this.project() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.labels.list(params),
  });

  /** D49: link to this project's trash, shown when it has trashed items. */
  private readonly trash = resource({
    params: () => (this.project() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.trash.list(params),
  });
  protected readonly trashCount = computed(() => this.trash.value()?.length ?? 0);

  protected readonly createOpen = signal(false);
  protected readonly newTitle = signal('');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (!this.store.loaded()) return;
      const project = this.project();
      untracked(() => {
        if (project) {
          void this.settings.setLastProject(project.id).catch(() => undefined);
        } else {
          // Unknown or trashed project, e.g. a stale last-project id.
          if (this.settings.lastProjectId() === this.projectId()) {
            void this.settings.setLastProject(null).catch(() => undefined);
          }
          void this.router.navigate(['/projects']);
        }
      });
    });
  }

  protected setSort(projectId: string, { sortBy, sortDirection }: TaskSort): void {
    if (sortBy !== 'relevance') this.viewStore.update(projectId, { sortBy, sortDirection });
  }

  protected setView(view: ProjectViewKind): void {
    void this.settings.setLastView(view).catch(() => undefined);
  }

  protected openCreate(): void {
    this.newTitle.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected async create(projectId: string): Promise<void> {
    const title = this.newTitle().trim();
    if (!title || this.creating()) return;
    this.creating.set(true);
    try {
      const story = await this.api.tasks.create({ projectId, type: 'STORY', title });
      this.createOpen.set(false);
      await this.router.navigate(['/projects', projectId, 'tasks', story.id]);
    } catch (error) {
      this.createError.set(this.i18n.errorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }
}
