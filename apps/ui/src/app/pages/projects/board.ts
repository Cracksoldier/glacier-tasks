import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
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
import { RouterLink } from '@angular/router';
import {
  isAppErrorInfo,
  sortKeyBetween,
  type TaskFilters,
  type TaskSummary,
  type WorkflowStatus,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { loaded } from '../../core/api/loaded';
import { I18nService, type TranslationKey } from '../../core/i18n/i18n.service';
import { EMPTY_FILTERS, queryAll } from '../../core/tasks/project-view';
import { PRIORITY_KEYS } from '../../core/tasks/task-display';
import { UsersStore } from '../../core/users/users-store';
import { Avatar } from '../../shared/avatar';
import { LabelChip } from '../../shared/label-chip';

interface Column {
  status: WorkflowStatus;
  stories: TaskSummary[];
}

/** One status column inside a swimlane (BOARD-07). */
interface LaneColumn {
  status: WorkflowStatus;
  tasks: TaskSummary[];
}

/** A story with its subtasks by status, or the closing "Other stories" row (story === null). */
interface Lane {
  id: string;
  story: TaskSummary | null;
  columns: LaneColumn[];
  done: number;
  total: number;
}

export type BoardGroup = 'stories' | 'subtasks';

/** Board cards rendered per column before "Show more" (ADR 0013). */
const CARDS_PER_PAGE = 100;

/**
 * Kanban board (BOARD-01..06): one column per status, story cards only, expandable subtasks
 * with status changes (D06), drag & drop with fractional sort keys (D26) and a status select
 * on every card as the keyboard alternative to dragging. The project's filters apply to the
 * story fields only (D09, D43); columns stay, so the status filter is ignored. Grouped by
 * subtasks (BOARD-07, D51), each story with subtasks becomes a swimlane whose subtasks can be
 * dragged between statuses; stories without subtasks follow in an "Other stories" row.
 */
@Component({
  selector: 'app-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Avatar,
    CdkDrag,
    CdkDragPlaceholder,
    CdkDropList,
    CdkDropListGroup,
    LabelChip,
    RouterLink,
  ],
  templateUrl: './board.html',
  styleUrl: './board.scss',
})
export class Board {
  /** Resource values without the error-state throw (see core/api/loaded). */
  protected readonly loaded = loaded;
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  protected readonly users = inject(UsersStore);

  readonly projectId = input.required<string>();
  readonly filters = input<TaskFilters>(EMPTY_FILTERS);
  /** Remembered per project (D51); the toggle asks the page to store a change. */
  readonly group = input<BoardGroup>('stories');
  readonly groupChange = output<BoardGroup>();

  protected readonly priorityKey = PRIORITY_KEYS;
  protected readonly groups: ReadonlyArray<{
    value: BoardGroup;
    label: TranslationKey;
    icon: string;
  }> = [
    { value: 'stories', label: 'board.groupStories', icon: 'fa-table-columns' },
    { value: 'subtasks', label: 'board.groupSubtasks', icon: 'fa-layer-group' },
  ];
  protected readonly tasks = resource({
    params: () => ({ projectId: this.projectId(), filters: this.filters() }),
    loader: async ({ params: { projectId, filters } }) => {
      const [stories, subtasks] = await Promise.all([
        queryAll(this.api, {
          projectId,
          ...filters,
          types: ['STORY'],
          statusIds: [],
          statusCategories: [],
        }),
        queryAll(this.api, { projectId, types: ['SUBTASK'] }),
      ]);
      return { stories, subtasks };
    },
  });
  protected readonly statuses = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  private readonly labels = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.labels.list(params),
  });

  /** Local, optimistically updated columns; reset whenever the server data arrives. */
  protected readonly columns = linkedSignal<Column[]>(() => {
    const stories = loaded(this.tasks)?.stories ?? [];
    return (loaded(this.statuses) ?? []).map((status) => ({
      status,
      stories: stories.filter((t) => t.statusId === status.id),
    }));
  });
  protected readonly subtasksByStory = computed(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of loaded(this.tasks)?.subtasks ?? []) {
      if (task.parentStoryId)
        map.set(task.parentStoryId, [...(map.get(task.parentStoryId) ?? []), task]);
    }
    return map;
  });
  protected readonly labelsById = computed(
    () => new Map((loaded(this.labels) ?? []).map((label) => [label.id, label])),
  );
  protected readonly usersById = computed(() => new Map(this.users.all().map((u) => [u.id, u])));

  /**
   * Swimlanes in board order (status position, then card order, as loaded). Subtasks keep
   * their story's order inside a column. Moves are shown at once and confirmed by the reload.
   */
  protected readonly lanes = linkedSignal<Lane[]>(() => {
    const statuses = loaded(this.statuses) ?? [];
    const position = new Map(statuses.map((s) => [s.id, s.position]));
    const stories = [...(loaded(this.tasks)?.stories ?? [])].sort(
      (a, b) => (position.get(a.statusId) ?? 0) - (position.get(b.statusId) ?? 0),
    );
    const subtasks = this.subtasksByStory();
    const done = new Set(statuses.filter((s) => s.category === 'DONE').map((s) => s.id));
    const split = (tasks: TaskSummary[]) =>
      statuses.map((status) => ({ status, tasks: tasks.filter((t) => t.statusId === status.id) }));
    const lanes: Lane[] = stories
      .filter((story) => (subtasks.get(story.id) ?? []).length > 0)
      .map((story) => {
        const own = subtasks.get(story.id) ?? [];
        return {
          id: story.id,
          story,
          columns: split(own),
          done: own.filter((t) => done.has(t.statusId)).length,
          total: own.length,
        };
      });
    const others = stories.filter((story) => (subtasks.get(story.id) ?? []).length === 0);
    if (others.length > 0) {
      lanes.push({ id: 'other', story: null, columns: split(others), done: 0, total: 0 });
    }
    return lanes;
  });
  /**
   * Cards rendered per column (M8 performance): long columns show the first ones and grow
   * with "Show more". Drops stay correct because the visible cards are the column's start.
   */
  private readonly shown = signal<ReadonlyMap<string, number>>(new Map());

  protected limit(columnKey: string): number {
    return this.shown().get(columnKey) ?? CARDS_PER_PAGE;
  }

  protected showMore(columnKey: string): void {
    this.shown.update((shown) =>
      new Map(shown).set(columnKey, this.limit(columnKey) + CARDS_PER_PAGE),
    );
  }

  /** Collapsed swimlanes; not remembered (D51). */
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
  }

  /** Reloads cards after a story was created elsewhere on the page. */
  reload(): void {
    this.tasks.reload();
  }

  protected toggleLane(laneId: string): void {
    this.collapsed.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(laneId)) next.add(laneId);
      return next;
    });
  }

  /**
   * BOARD-07: a card dropped into another column of its swimlane changes status. Subtasks
   * change only their own status (D06); stories in "Other stories" move to the top of the
   * column (D26). Order inside a column is not changed here.
   */
  protected async dropInLane(
    event: CdkDragDrop<LaneColumn, LaneColumn, TaskSummary>,
  ): Promise<void> {
    const task = event.item.data;
    const from = event.previousContainer.data;
    const to = event.container.data;
    if (from.status.id === to.status.id) return;
    this.lanes.update((lanes) =>
      lanes.map((lane) => ({
        ...lane,
        columns: lane.columns.map((column) => {
          if (column === from)
            return { ...column, tasks: column.tasks.filter((t) => t.id !== task.id) };
          if (column === to)
            return { ...column, tasks: [...column.tasks, { ...task, statusId: to.status.id }] };
          return column;
        }),
      })),
    );
    await this.persist(() =>
      task.type === 'SUBTASK'
        ? this.api.tasks.update(task.id, task.version, { statusId: to.status.id })
        : this.api.tasks.move(task.id, task.version, to.status.id),
    );
  }

  protected toggle(storyId: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(storyId)) next.add(storyId);
      return next;
    });
  }

  /** BOARD-04/05: optimistic move, persisted atomically; any failure restores server state. */
  protected async drop(event: CdkDragDrop<Column, Column, TaskSummary>): Promise<void> {
    const story = event.item.data;
    const from = event.previousContainer.data;
    const to = event.container.data;
    const sameColumn = from.status.id === to.status.id;
    if (sameColumn && event.previousIndex === event.currentIndex) return;

    let sortOrder: string | undefined;
    if (sameColumn) {
      const stories = [...to.stories];
      moveItemInArray(stories, event.previousIndex, event.currentIndex);
      try {
        sortOrder = sortKeyBetween(
          stories[event.currentIndex - 1]?.sortOrder ?? null,
          stories[event.currentIndex + 1]?.sortOrder ?? null,
        );
      } catch {
        sortOrder = undefined; // inconsistent neighbours: let the server place it at the top
      }
      stories[event.currentIndex] = { ...story, sortOrder: sortOrder ?? story.sortOrder };
      this.replaceColumn(to.status.id, stories);
    } else {
      // D26: a card moved to another column goes to the top.
      this.replaceColumn(
        from.status.id,
        from.stories.filter((s) => s.id !== story.id),
      );
      this.replaceColumn(to.status.id, [{ ...story, statusId: to.status.id }, ...to.stories]);
    }
    await this.persist(() => this.api.tasks.move(story.id, story.version, to.status.id, sortOrder));
  }

  /** Keyboard alternative to dragging (M4 task 5): the card goes to the top of the column. */
  protected async moveTo(story: TaskSummary, select: HTMLSelectElement): Promise<void> {
    const ok = await this.persist(() => this.api.tasks.move(story.id, story.version, select.value));
    if (!ok) select.value = story.statusId;
  }

  /** D06: subtask status from the expanded card; saves immediately (TASK-08). */
  protected async setSubtaskStatus(subtask: TaskSummary, select: HTMLSelectElement): Promise<void> {
    const ok = await this.persist(() =>
      this.api.tasks.update(subtask.id, subtask.version, { statusId: select.value }),
    );
    if (!ok) select.value = subtask.statusId;
  }

  protected statusOf(id: string): WorkflowStatus | undefined {
    return loaded(this.statuses)?.find((status) => status.id === id);
  }

  private replaceColumn(statusId: string, stories: TaskSummary[]): void {
    this.columns.update((columns) =>
      columns.map((column) => (column.status.id === statusId ? { ...column, stories } : column)),
    );
  }

  private async persist(write: () => Promise<unknown>): Promise<boolean> {
    this.error.set(null);
    let ok = true;
    try {
      await write();
    } catch (error) {
      ok = false;
      this.error.set(
        isAppErrorInfo(error) && error.message === 'errors.staleTask'
          ? this.i18n.t('board.staleRefreshed')
          : this.i18n.errorMessage(error),
      );
    }
    // Fresh versions after success; the true state after a failure.
    this.tasks.reload();
    return ok;
  }
}
