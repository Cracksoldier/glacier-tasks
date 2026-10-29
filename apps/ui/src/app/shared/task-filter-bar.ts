import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  type Label,
  PRIORITIES,
  STATUS_CATEGORIES,
  TASK_SORT_FIELDS,
  TASK_TYPES,
  type TaskFilters,
  type TaskSortField,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { I18nService } from '../core/i18n/i18n.service';
import { activeFilterCount, EMPTY_FILTERS, SORT_FIELD_KEYS } from '../core/tasks/project-view';
import { CATEGORY_KEYS, PRIORITY_KEYS, TASK_TYPE_KEYS } from '../core/tasks/task-display';
import { UsersStore } from '../core/users/users-store';
import { MultiSelect, type MultiSelectOption } from './multi-select';

export interface TaskSort {
  sortBy: TaskSortField;
  sortDirection: 'asc' | 'desc';
}

const TEXT_DEBOUNCE_MS = 200;

/**
 * Filters, search text and sort for the list view, the board and search (ADR 0010).
 * The board hides text, sort, type and status (D43); the all-projects search offers
 * status categories instead of a project's statuses and hides labels (D41).
 */
@Component({
  selector: 'app-task-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MultiSelect],
  template: `
    <div class="filter-bar" role="search" [attr.aria-label]="i18n.t('filters.barLabel')">
      @if (showText()) {
        <label class="text">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <span class="visually-hidden">{{ i18n.t('filters.text') }}</span>
          <input
            #textInput
            type="search"
            data-testid="filter-text"
            autocomplete="off"
            [placeholder]="i18n.t('filters.textPlaceholder')"
            [value]="text()"
            (input)="typed($any($event.target).value)"
            (keydown.enter)="flushText($any($event.target).value)"
          />
        </label>
      }
      @if (showStatus()) {
        <app-multi-select
          testId="filter-type"
          [label]="i18n.t('filters.type')"
          [options]="typeOptions()"
          [selected]="filters().types"
          (selectedChange)="patch({ types: $event })"
        />
        @if (allProjects()) {
          <app-multi-select
            testId="filter-category"
            [label]="i18n.t('filters.status')"
            [options]="categoryOptions()"
            [selected]="filters().statusCategories"
            (selectedChange)="patch({ statusCategories: $event })"
          />
        } @else {
          <app-multi-select
            testId="filter-status"
            [label]="i18n.t('filters.status')"
            [options]="statusOptions()"
            [selected]="filters().statusIds"
            (selectedChange)="patch({ statusIds: $event })"
          />
        }
      }
      <app-multi-select
        testId="filter-priority"
        [label]="i18n.t('filters.priority')"
        [options]="priorityOptions()"
        [selected]="filters().priorities"
        (selectedChange)="patch({ priorities: $event })"
      />
      <app-multi-select
        testId="filter-assignee"
        [label]="i18n.t('filters.assignee')"
        [options]="assigneeOptions()"
        [selected]="filters().assigneeUserIds"
        (selectedChange)="patch({ assigneeUserIds: $event })"
      />
      @if (!allProjects()) {
        <app-multi-select
          testId="filter-label"
          [label]="i18n.t('filters.labels')"
          [emptyText]="i18n.t('filters.noLabels')"
          [options]="labelOptions()"
          [selected]="filters().labelIds"
          (selectedChange)="patch({ labelIds: $event })"
        />
      }
      <label class="date">
        <span>{{ i18n.t('filters.dueFrom') }}</span>
        <input
          type="date"
          data-testid="filter-due-from"
          [value]="filters().dueFrom ?? ''"
          (change)="patch({ dueFrom: $any($event.target).value || null })"
        />
      </label>
      <label class="date">
        <span>{{ i18n.t('filters.dueTo') }}</span>
        <input
          type="date"
          data-testid="filter-due-to"
          [value]="filters().dueTo ?? ''"
          (change)="patch({ dueTo: $any($event.target).value || null })"
        />
      </label>
      @if (activeCount() > 0) {
        <button type="button" class="btn btn-ghost" data-testid="filter-clear" (click)="clear()">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          {{ i18n.t('filters.clear', { count: activeCount() }) }}
        </button>
      }

      @if (showSort()) {
        <div class="sort">
          <label>
            <span>{{ i18n.t('filters.sortBy') }}</span>
            <select
              data-testid="sort-by"
              (change)="setSort({ sortBy: $any($event.target).value, sortDirection: sort().sortDirection })"
            >
              @for (field of sortFields(); track field) {
                <option [value]="field" [selected]="field === sort().sortBy">
                  {{ i18n.t(sortKey[field]) }}
                </option>
              }
            </select>
          </label>
          <button
            type="button"
            class="btn btn-ghost btn-icon"
            data-testid="sort-direction"
            [attr.aria-label]="i18n.t(sort().sortDirection === 'asc' ? 'filters.ascending' : 'filters.descending')"
            [title]="i18n.t(sort().sortDirection === 'asc' ? 'filters.ascending' : 'filters.descending')"
            (click)="setSort({ sortBy: sort().sortBy, sortDirection: sort().sortDirection === 'asc' ? 'desc' : 'asc' })"
          >
            <i
              class="fa-solid"
              [class.fa-arrow-up-short-wide]="sort().sortDirection === 'asc'"
              [class.fa-arrow-down-wide-short]="sort().sortDirection === 'desc'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .text {
      display: flex;
      flex: 1 1 220px;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);

      i {
        color: var(--color-text-muted);
      }
      input {
        flex: 1;
        min-width: 0;
        padding: 7px 0;
        border: 0;
        outline: none;
        background: transparent;
        color: inherit;
      }
      &:focus-within {
        outline: 2px solid var(--color-focus);
        outline-offset: 1px;
      }
    }
    .date,
    .sort label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .date input,
    select {
      padding: 5px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);
      color: var(--color-text);
    }
    .sort {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
  `,
})
export class TaskFilterBar {
  protected readonly i18n = inject(I18nService);
  private readonly users = inject(UsersStore);
  private readonly textInput = viewChild<ElementRef<HTMLInputElement>>('textInput');

  readonly filters = input.required<TaskFilters>();
  readonly statuses = input<ReadonlyArray<WorkflowStatus>>([]);
  readonly labels = input<ReadonlyArray<Label>>([]);
  readonly text = input('');
  readonly sort = input<TaskSort>({ sortBy: 'sortOrder', sortDirection: 'asc' });
  readonly showText = input(true);
  readonly showSort = input(true);
  /** Type and status filters; the board hides both (only stories, columns are statuses). */
  readonly showStatus = input(true);
  /** Search only: relevance sorting while there is text (project views can't keep it). */
  readonly offerRelevance = input(false);
  /** All-projects search: status categories instead of statuses, no labels (D41). */
  readonly allProjects = input(false);

  readonly filtersChange = output<TaskFilters>();
  readonly textChange = output<string>();
  readonly sortChange = output<TaskSort>();

  protected readonly sortKey = SORT_FIELD_KEYS;
  protected readonly activeCount = computed(() => activeFilterCount(this.filters()));
  /** Relevance only makes sense while there is search text. */
  protected readonly sortFields = computed(() =>
    TASK_SORT_FIELDS.filter(
      (field) => field !== 'relevance' || (this.offerRelevance() && this.text().trim() !== ''),
    ),
  );

  protected readonly typeOptions = computed(() =>
    TASK_TYPES.map((type) => ({ value: type, label: this.i18n.t(TASK_TYPE_KEYS[type]) })),
  );
  protected readonly categoryOptions = computed(() =>
    STATUS_CATEGORIES.map((c) => ({ value: c, label: this.i18n.t(CATEGORY_KEYS[c]) })),
  );
  protected readonly statusOptions = computed(() =>
    this.statuses().map((status) => ({ value: status.id, label: status.name })),
  );
  protected readonly priorityOptions = computed(() =>
    [...PRIORITIES].reverse().map((p) => ({ value: p, label: this.i18n.t(PRIORITY_KEYS[p]) })),
  );
  protected readonly assigneeOptions = computed((): MultiSelectOption<string | null>[] => [
    { value: null, label: this.i18n.t('filters.unassigned') },
    ...this.users
      .all()
      .filter(
        (user) => user.archivedAt === null || this.filters().assigneeUserIds.includes(user.id),
      )
      .map((user) => ({ value: user.id, label: user.name })),
  ]);
  protected readonly labelOptions = computed(() =>
    this.labels().map((label) => ({ value: label.id, label: label.name })),
  );

  private textTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.textTimer));
  }

  /** Moves the keyboard focus to the search field (Ctrl+F on the search page). */
  focusText(): void {
    this.textInput()?.nativeElement.focus();
  }

  protected typed(value: string): void {
    clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => this.textChange.emit(value), TEXT_DEBOUNCE_MS);
  }

  protected flushText(value: string): void {
    clearTimeout(this.textTimer);
    this.textChange.emit(value);
  }

  protected patch(change: Partial<TaskFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...change });
  }

  protected clear(): void {
    this.filtersChange.emit(EMPTY_FILTERS);
  }

  protected setSort(sort: TaskSort): void {
    this.sortChange.emit(sort);
  }
}
