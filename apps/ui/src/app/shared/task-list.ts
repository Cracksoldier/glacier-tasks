import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  afterEveryRender,
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  type Label,
  LIST_COLUMNS,
  type ListColumn,
  type TaskListRow,
  type TaskQuery,
  type TaskSummary,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../core/api/glacier-api';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';
import { ProjectsStore } from '../core/projects/projects-store';
import { activeFilterCount, EMPTY_FILTERS, LIST_COLUMN_KEYS } from '../core/tasks/project-view';
import { PRIORITY_KEYS, TASK_TYPE_KEYS } from '../core/tasks/task-display';
import { UsersStore } from '../core/users/users-store';
import { Avatar } from './avatar';
import { LabelChip } from './label-chip';
import { MultiSelect } from './multi-select';

export type ListQuery = Omit<TaskQuery, 'page'>;

/** A visible line: a story row or one of its subtasks below an expanded story. */
export type ListItem =
  | { kind: 'story'; task: TaskSummary; matches: boolean; childCount: number; expanded: boolean }
  | { kind: 'subtask'; task: TaskSummary; parentId: string };

interface ProjectMeta {
  statuses: Map<string, WorkflowStatus>;
  labels: Map<string, Label>;
}

const PAGE_SIZE = 100;
/** The viewport fills the window down to this margin, but never gets smaller than MIN. */
const VIEWPORT_BOTTOM_MARGIN = 24;
const VIEWPORT_MIN_HEIGHT = 240;
/** Load the next page when the rendered range gets this close to the end. */
const PREFETCH_ROWS = 20;
export const ROW_HEIGHT = 36;

/** Column widths in px; the title takes the remaining space (at least TITLE_MIN). */
const COLUMN_WIDTHS: Record<ListColumn | 'project', number> = {
  project: 140,
  type: 90,
  status: 130,
  priority: 100,
  assignee: 150,
  labels: 160,
  startDate: 110,
  dueDate: 110,
  createdAt: 150,
  updatedAt: 150,
  subtasks: 80,
};
const EXPANDER_WIDTH = 28;
const KEY_WIDTH = 100;
const TITLE_MIN = 200;
const COLUMN_GAP = 12;

function isFiltered(query: ListQuery): boolean {
  return (query.text ?? '').trim() !== '' || activeFilterCount({ ...EMPTY_FILTERS, ...query }) > 0;
}

/**
 * Hierarchical task list (LIST-01..05, D09, D44): story rows with their subtasks, dimmed
 * context rows for stories that only match through a subtask, a column picker, virtual
 * scrolling with on-demand pages and treegrid keyboard navigation.
 */
@Component({
  selector: 'app-task-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Avatar,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkVirtualScrollViewport,
    LabelChip,
    MultiSelect,
    RouterLink,
  ],
  templateUrl: './task-list.html',
  styleUrl: './task-list.scss',
  host: { '(window:resize)': 'fitViewport()' },
})
export class TaskList {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly projects = inject(ProjectsStore);
  private readonly users = inject(UsersStore);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly query = input.required<ListQuery>();
  readonly columns = input.required<ReadonlyArray<ListColumn>>();
  /** Adds a project column (all-projects search). */
  readonly showProject = input(false);
  readonly emptyTitle = input<TranslationKey>('list.emptyTitle');
  readonly emptyBody = input<TranslationKey>('list.emptyBody');
  readonly columnsChange = output<ListColumn[]>();

  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly priorityKey = PRIORITY_KEYS;
  protected readonly typeKey = TASK_TYPE_KEYS;
  protected readonly columnKey = LIST_COLUMN_KEYS;
  protected readonly columnOptions = computed(() =>
    LIST_COLUMNS.map((column) => ({ value: column, label: this.i18n.t(LIST_COLUMN_KEYS[column]) })),
  );
  /** Visible optional columns in their canonical order. */
  protected readonly visibleColumns = computed(() =>
    LIST_COLUMNS.filter((column) => this.columns().includes(column)),
  );
  /** Column widths in grid order; `null` is the title, which takes the remaining space. */
  private readonly widths = computed(() => [
    EXPANDER_WIDTH,
    KEY_WIDTH,
    ...(this.showProject() ? [COLUMN_WIDTHS.project] : []),
    null,
    ...this.visibleColumns().map((column) => COLUMN_WIDTHS[column]),
  ]);
  protected readonly gridTemplate = computed(() =>
    this.widths()
      .map((width) => (width === null ? `minmax(${TITLE_MIN}px, 1fr)` : `${width}px`))
      .join(' '),
  );
  /** Header and rows scroll sideways together inside `.scroller` when columns don't fit. */
  protected readonly minWidth = computed(() => {
    const widths = this.widths();
    const sum = widths.reduce<number>((total, width) => total + (width ?? TITLE_MIN), 0);
    return sum + COLUMN_GAP * (widths.length + 1);
  });

  protected readonly rows = signal<TaskListRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Stories whose expansion differs from the default (expanded while filtering). */
  private readonly toggled = signal<ReadonlySet<string>>(new Set());
  protected readonly activeIndex = signal(0);
  protected readonly viewportHeight = signal(VIEWPORT_MIN_HEIGHT);
  private readonly meta = signal<ReadonlyMap<string, ProjectMeta>>(new Map());
  private readonly metaRequested = new Set<string>();
  private generation = 0;

  protected readonly filtered = computed(() => isFiltered(this.query()));
  protected readonly items = computed<ListItem[]>(() => {
    const expandByDefault = this.filtered();
    const toggled = this.toggled();
    const items: ListItem[] = [];
    for (const row of this.rows()) {
      const childCount = row.subtasks.length;
      // While filtering, the subtasks are the matches, so they start visible.
      const expanded = childCount > 0 && expandByDefault !== toggled.has(row.story.id);
      items.push({
        kind: 'story',
        task: row.story,
        matches: row.storyMatches,
        childCount,
        expanded,
      });
      if (expanded) {
        for (const task of row.subtasks)
          items.push({ kind: 'subtask', task, parentId: row.story.id });
      }
    }
    return items;
  });
  protected readonly usersById = computed(() => new Map(this.users.all().map((u) => [u.id, u])));

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
    // A new query starts over; JSON comparison ignores identical objects from the parent.
    let lastKey = '';
    effect(() => {
      const query = this.query();
      const key = JSON.stringify(query);
      if (key === lastKey) return;
      lastKey = key;
      untracked(() => this.restart());
    });
    effect(() => {
      for (const row of this.rows()) untracked(() => this.requestMeta(row.story.projectId));
    });
    effect((onCleanup) => {
      const viewport = this.viewport();
      if (!viewport) return;
      const subscription = viewport.renderedRangeStream.subscribe((range) => {
        if (range.end >= this.items().length - PREFETCH_ROWS) void this.loadMore();
      });
      onCleanup(() => subscription.unsubscribe());
    });
    afterEveryRender({ read: () => this.fitViewport() });
    inject(DestroyRef).onDestroy(() => this.generation++);
  }

  /** Lets the list fill the window below the filters, so the page itself doesn't scroll. */
  protected fitViewport(): void {
    const element = this.viewport()?.elementRef.nativeElement;
    if (!element) return;
    const available =
      window.innerHeight - element.getBoundingClientRect().top - VIEWPORT_BOTTOM_MARGIN;
    const height = Math.max(VIEWPORT_MIN_HEIGHT, Math.floor(available));
    if (height === this.viewportHeight()) return;
    this.viewportHeight.set(height);
    afterNextRender(() => this.viewport()?.checkViewportSize(), { injector: this.injector });
  }

  protected status(task: TaskSummary): WorkflowStatus | undefined {
    return this.meta().get(task.projectId)?.statuses.get(task.statusId);
  }

  protected labelsOf(task: TaskSummary): Label[] {
    const labels = this.meta().get(task.projectId)?.labels;
    return labels ? task.labelIds.flatMap((id) => labels.get(id) ?? []) : [];
  }

  protected projectName(task: TaskSummary): string {
    return this.projects.find(task.projectId)?.name ?? '';
  }

  protected trackItem = (_index: number, item: ListItem) => `${item.kind}:${item.task.id}`;

  protected setColumns(columns: ListColumn[]): void {
    this.columnsChange.emit(LIST_COLUMNS.filter((column) => columns.includes(column)));
  }

  protected toggle(storyId: string): void {
    this.toggled.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(storyId)) next.add(storyId);
      return next;
    });
  }

  protected rowFocused(index: number): void {
    this.activeIndex.set(index);
  }

  /** Treegrid keys (WAI-ARIA): arrows, Home/End, Enter opens the task. */
  protected keydown(event: KeyboardEvent): void {
    const items = this.items();
    const index = Math.min(this.activeIndex(), items.length - 1);
    const item = items[index];
    if (!item) return;
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(index + 1);
        break;
      case 'ArrowUp':
        this.focusRow(index - 1);
        break;
      case 'Home':
        this.focusRow(0);
        break;
      case 'End':
        this.focusRow(items.length - 1);
        break;
      case 'ArrowRight':
        if (item.kind === 'story' && item.childCount > 0) {
          if (item.expanded) this.focusRow(index + 1);
          else this.toggle(item.task.id);
        }
        break;
      case 'ArrowLeft':
        if (item.kind === 'subtask') {
          this.focusRow(items.findIndex((i) => i.kind === 'story' && i.task.id === item.parentId));
        } else if (item.expanded) {
          this.toggle(item.task.id);
        }
        break;
      case 'Enter':
        void this.router.navigate(['/projects', item.task.projectId, 'tasks', item.task.id]);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private focusRow(index: number): void {
    const last = this.items().length - 1;
    if (last < 0) return;
    const target = Math.max(0, Math.min(index, last));
    this.activeIndex.set(target);
    const viewport = this.viewport();
    const range = viewport?.getRenderedRange();
    if (viewport && range && (target < range.start + 1 || target >= range.end - 1)) {
      viewport.scrollToIndex(target);
    }
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-row-index="${target}"]`)
          ?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }

  private restart(): void {
    this.generation++;
    this.rows.set([]);
    this.total.set(0);
    this.loaded.set(false);
    this.toggled.set(new Set());
    this.activeIndex.set(0);
    this.viewport()?.scrollToIndex(0);
    this.loading.set(false);
    void this.loadMore();
  }

  private async loadMore(): Promise<void> {
    if (this.loading() || (this.loaded() && this.rows().length >= this.total())) return;
    const generation = this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.tasks.list({
        ...this.query(),
        page: { offset: this.rows().length, limit: PAGE_SIZE },
      });
      if (generation !== this.generation) return;
      this.rows.update((rows) => [...rows, ...page.items]);
      this.total.set(page.total);
      this.loaded.set(true);
    } catch (error) {
      if (generation === this.generation) this.error.set(this.i18n.errorMessage(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  private requestMeta(projectId: string): void {
    if (this.metaRequested.has(projectId)) return;
    this.metaRequested.add(projectId);
    void Promise.all([this.api.workflows.list(projectId), this.api.labels.list(projectId)])
      .then(([statuses, labels]) =>
        this.meta.update((meta) =>
          new Map(meta).set(projectId, {
            statuses: new Map(statuses.map((s) => [s.id, s])),
            labels: new Map(labels.map((l) => [l.id, l])),
          }),
        ),
      )
      .catch(() => this.metaRequested.delete(projectId));
  }
}
