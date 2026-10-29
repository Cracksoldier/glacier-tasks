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
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DEFAULT_LIST_COLUMNS, type ListColumn, type TaskFilters } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { activeFilterCount, EMPTY_FILTERS } from '../../core/tasks/project-view';
import { SearchShortcut } from '../../core/tasks/search-shortcut';
import { type TaskSort, TaskFilterBar } from '../../shared/task-filter-bar';
import { type ListQuery, TaskList } from '../../shared/task-list';

type Scope = 'project' | 'all';

/**
 * Search (SEARCH-01..04, D41): the last opened project by default, all projects on request.
 * Text and scope live in the URL so returning from a task keeps the search; filters, sort and
 * columns are not remembered.
 */
@Component({
  selector: 'app-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskFilterBar, TaskList],
  template: `
    <section class="page wide">
      <header class="page-header">
        <h1>{{ i18n.t('search.title') }}</h1>
      </header>

      <div class="scope" role="radiogroup" [attr.aria-label]="i18n.t('search.scope')">
        <label>
          <input type="radio" name="search-scope" value="project" data-testid="search-scope-project"
            [checked]="effectiveScope() === 'project'" [disabled]="!project()"
            (change)="setScope('project')" />
          @if (project(); as project) {
            {{ i18n.t('search.scopeProject', { name: project.name }) }}
          } @else {
            {{ i18n.t('search.scopeNoProject') }}
          }
        </label>
        <label>
          <input type="radio" name="search-scope" value="all" data-testid="search-scope-all"
            [checked]="effectiveScope() === 'all'" (change)="setScope('all')" />
          {{ i18n.t('search.scopeAll') }}
        </label>
      </div>

      <app-task-filter-bar
        [filters]="filters()"
        [statuses]="statuses.value() ?? []"
        [labels]="labels.value() ?? []"
        [text]="text()"
        [sort]="sort()"
        [allProjects]="effectiveScope() === 'all'"
        [offerRelevance]="true"
        (filtersChange)="filters.set($event)"
        (textChange)="setText($event)"
        (sortChange)="sort.set($event)"
      />

      @if (hasCriteria()) {
        <app-task-list
          [query]="query()"
          [columns]="columns()"
          [showProject]="effectiveScope() === 'all'"
          (columnsChange)="columns.set($event)"
        />
      } @else {
        <div class="empty-state" data-testid="search-prompt">
          <h2>{{ i18n.t('search.promptTitle') }}</h2>
          <p>{{ i18n.t('search.promptBody') }}</p>
        </div>
      }
    </section>
  `,
  styles: `
    .wide {
      max-width: none;
    }
    .scope {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 12px;

      label {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
    }
  `,
})
export class SearchPage {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsStore);
  private readonly settings = inject(SettingsStore);
  private readonly shortcut = inject(SearchShortcut);
  private readonly filterBar = viewChild(TaskFilterBar);

  /** Query parameters (`#/search?q=…&scope=all`). */
  readonly q = input<string | undefined>();
  readonly scope = input<Scope | undefined>();

  protected readonly project = computed(() => this.projects.find(this.settings.lastProjectId()));
  protected readonly text = linkedSignal(() => this.q() ?? '');
  private readonly chosenScope = linkedSignal<Scope>(() => this.scope() ?? 'project');
  /** Without a last project only the all-projects scope is possible. */
  protected readonly effectiveScope = computed<Scope>(() =>
    this.project() ? this.chosenScope() : 'all',
  );
  protected readonly filters = signal<TaskFilters>(EMPTY_FILTERS);
  protected readonly sort = signal<TaskSort>({ sortBy: 'relevance', sortDirection: 'asc' });
  protected readonly columns = signal<ListColumn[]>([...DEFAULT_LIST_COLUMNS]);

  protected readonly hasCriteria = computed(
    () => this.text().trim() !== '' || activeFilterCount(this.filters()) > 0,
  );
  private readonly projectId = computed(() =>
    this.effectiveScope() === 'project' ? (this.project()?.id ?? null) : null,
  );
  protected readonly query = computed<ListQuery>(() => ({
    projectId: this.projectId(),
    text: this.text(),
    ...this.filters(),
    ...this.sort(),
  }));
  protected readonly statuses = resource({
    params: () => this.projectId() ?? undefined,
    loader: ({ params }) => this.api.workflows.list(params),
  });
  protected readonly labels = resource({
    params: () => this.projectId() ?? undefined,
    loader: ({ params }) => this.api.labels.list(params),
  });

  constructor() {
    // Focus on open and on every further Ctrl+F.
    effect(() => {
      this.shortcut.focusRequests();
      const bar = this.filterBar();
      untracked(() => setTimeout(() => bar?.focusText()));
    });
  }

  protected setText(text: string): void {
    this.text.set(text);
    this.syncUrl();
  }

  protected setScope(scope: Scope): void {
    this.chosenScope.set(scope);
    // Status ids and labels belong to one project; categories replace them for all projects.
    this.filters.update((filters) =>
      scope === 'all'
        ? { ...filters, statusIds: [], labelIds: [] }
        : { ...filters, statusCategories: [] },
    );
    this.syncUrl();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { q: this.text() || null, scope: this.chosenScope() === 'all' ? 'all' : null },
      replaceUrl: true,
    });
  }
}
