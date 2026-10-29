import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TITLE_MAX_LENGTH } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { PRIORITY_KEYS } from '../../core/tasks/task-display';
import { UsersStore } from '../../core/users/users-store';
import { Avatar } from '../../shared/avatar';
import { Board } from './board';
import { Dialog } from '../../shared/dialog';
import { LabelChip } from '../../shared/label-chip';

/**
 * Project home (PROJ-02): remembers the project as last opened and lists its stories until
 * the Kanban board replaces the list in M4 (D40).
 */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Board, Dialog, LabelChip, RouterLink],
  template: `
    @if (project(); as project) {
      <section class="page wide">
        <header class="page-header">
          <div>
            <span class="key mono" data-testid="project-key-badge">{{ project.key }}</span>
            <h1 data-testid="project-title">{{ project.name }}</h1>
          </div>
          <div class="page-actions">
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
        </div>

        @if (view() === 'board') {
          <app-board [projectId]="project.id" />
        } @else {
          @if (stories.error()) {
            <p class="error-banner" role="alert">{{ i18n.errorMessage(stories.error()) }}</p>
          }
          @if (storyRows().length === 0 && !stories.isLoading()) {
            <div class="empty-state">
              <h2>{{ i18n.t('stories.emptyTitle') }}</h2>
              <p>{{ i18n.t('stories.emptyBody') }}</p>
            </div>
          } @else {
            <ul class="card story-list" data-testid="story-list">
              @for (row of storyRows(); track row.story.id) {
                <li>
                  <a
                    class="story-row"
                    [routerLink]="['/projects', project.id, 'tasks', row.story.id]"
                    [attr.data-issue-key]="row.story.issueKey"
                  >
                    <span class="issue-key mono">{{ row.story.issueKey }}</span>
                    <span class="title">{{ row.story.title }}</span>
                    <span class="labels">
                      @for (label of row.labels; track label.id) {
                        <app-label-chip [name]="label.name" [color]="label.color" />
                      }
                    </span>
                    <span class="status" data-testid="story-status">{{ row.statusName }}</span>
                    <span class="priority priority-{{ row.story.priority }}">
                      {{ i18n.t(priorityKey[row.story.priority]) }}
                    </span>
                    <span class="due">
                      @if (row.story.dueDate) {
                        {{ i18n.formatLocalDate(row.story.dueDate) }}
                      }
                    </span>
                    <span class="progress" data-testid="story-progress">
                      @if (row.story.subtaskProgress; as progress) {
                        @if (progress.total > 0) {
                          {{ progress.done }}/{{ progress.total }}
                        }
                      }
                    </span>
                    <span class="assignee">
                      @if (row.assignee; as user) {
                        <app-avatar
                          [userId]="user.id"
                          [name]="user.name"
                          [avatarFileId]="user.avatarFileId"
                          [archived]="user.archivedAt !== null"
                          [size]="24"
                          [title]="user.name"
                        />
                      }
                    </span>
                  </a>
                </li>
              }
            </ul>
          }
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
    .story-list {
      margin: 0;
      padding: 4px 0;
      list-style: none;

      li + li {
        border-top: 1px solid var(--color-border);
      }
    }
    .story-row {
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr) auto 110px 80px 96px 44px 28px;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      color: var(--color-text);
      text-decoration: none;

      &:hover {
        background-color: var(--color-surface-hover);
      }
    }
    .issue-key {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .title {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .labels {
      display: flex;
      gap: 4px;
    }
    .status,
    .due,
    .progress {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .priority {
      font-size: 12px;
    }
    .priority-HIGH,
    .priority-CRITICAL {
      color: var(--color-danger-text);
      font-weight: 600;
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
  private readonly users = inject(UsersStore);
  private readonly router = inject(Router);

  /** Bound from the route parameter. */
  readonly projectId = input.required<string>();
  protected readonly project = computed(() => this.store.find(this.projectId()));

  protected readonly titleMax = TITLE_MAX_LENGTH;
  protected readonly priorityKey = PRIORITY_KEYS;

  /** Board or list (D17 `lastView`); the list is the simple story list until M5. */
  protected readonly view = this.settings.lastView;

  protected readonly stories = resource({
    params: () => (this.project() && this.view() === 'list' ? this.projectId() : undefined),
    loader: ({ params }) =>
      this.api.tasks.query({
        projectId: params,
        types: ['STORY'],
        page: { offset: 0, limit: 500 },
      }),
  });
  private readonly statuses = resource({
    params: () => (this.project() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  private readonly labels = resource({
    params: () => (this.project() ? this.projectId() : undefined),
    loader: ({ params }) => this.api.labels.list(params),
  });

  protected readonly storyRows = computed(() => {
    const statuses = new Map((this.statuses.value() ?? []).map((s) => [s.id, s.name]));
    const labels = new Map((this.labels.value() ?? []).map((l) => [l.id, l]));
    const users = new Map(this.users.all().map((u) => [u.id, u]));
    return (this.stories.value()?.items ?? []).map((story) => ({
      story,
      statusName: statuses.get(story.statusId) ?? '',
      labels: story.labelIds.flatMap((id) => labels.get(id) ?? []),
      assignee: story.assigneeUserId ? users.get(story.assigneeUserId) : undefined,
    }));
  });

  protected readonly createOpen = signal(false);
  protected readonly newTitle = signal('');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
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

  protected setView(view: 'board' | 'list'): void {
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
