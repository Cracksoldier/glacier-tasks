import { computed, inject, Injectable, type Signal } from '@angular/core';
import {
  DEFAULT_LIST_COLUMNS,
  type GlacierTasksAPI,
  type ListColumn,
  type ProjectView,
  type TaskFilters,
  type TaskQuery,
  type TaskSortField,
  type TaskSummary,
} from '@glacier-tasks/domain';
import { SettingsStore } from '../settings/settings-store';
import type { TranslationKey } from '../i18n/i18n.service';

export const EMPTY_FILTERS: TaskFilters = {
  types: [],
  statusIds: [],
  statusCategories: [],
  priorities: [],
  assigneeUserIds: [],
  labelIds: [],
  dueFrom: null,
  dueTo: null,
};

export const DEFAULT_PROJECT_VIEW: ProjectView = {
  sortBy: 'sortOrder',
  sortDirection: 'asc',
  filters: EMPTY_FILTERS,
  columns: [...DEFAULT_LIST_COLUMNS],
  boardGroup: 'stories',
};

/** Number of filters in use (each list counts once, each date bound once). */
export function activeFilterCount(filters: TaskFilters): number {
  const lists = [
    filters.types,
    filters.statusIds,
    filters.statusCategories,
    filters.priorities,
    filters.assigneeUserIds,
    filters.labelIds,
  ];
  return (
    lists.filter((list) => list.length > 0).length +
    (filters.dueFrom !== null ? 1 : 0) +
    (filters.dueTo !== null ? 1 : 0)
  );
}

/** Per-project sort, filters and list columns, remembered in device settings (D42). */
@Injectable({ providedIn: 'root' })
export class ProjectViewStore {
  private readonly settings = inject(SettingsStore);

  view(projectId: Signal<string>): Signal<ProjectView> {
    return computed(() => this.settings.projectViews()[projectId()] ?? DEFAULT_PROJECT_VIEW);
  }

  /** Saves a change; a failed write rolls back and is only logged (it is a convenience). */
  update(projectId: string, change: Partial<ProjectView>): void {
    const current = this.settings.projectViews()[projectId] ?? DEFAULT_PROJECT_VIEW;
    void this.settings
      .setProjectView(projectId, { ...current, ...change })
      .catch((error: unknown) => console.error(error));
  }
}

/** Loads every page of a flat query (the board needs all cards of a project). */
export async function queryAll(api: GlacierTasksAPI, query: TaskQuery): Promise<TaskSummary[]> {
  const limit = 500;
  const items: TaskSummary[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await api.tasks.query({ ...query, page: { offset, limit } });
    items.push(...page.items);
    if (page.items.length < limit || items.length >= page.total) return items;
  }
}

export const SORT_FIELD_KEYS: Record<TaskSortField, TranslationKey> = {
  sortOrder: 'list.sort.sortOrder',
  issueKey: 'list.sort.issueKey',
  title: 'list.sort.title',
  priority: 'list.sort.priority',
  status: 'list.sort.status',
  assignee: 'list.sort.assignee',
  createdAt: 'list.sort.createdAt',
  updatedAt: 'list.sort.updatedAt',
  startDate: 'list.sort.startDate',
  dueDate: 'list.sort.dueDate',
  relevance: 'list.sort.relevance',
};

export const LIST_COLUMN_KEYS: Record<ListColumn, TranslationKey> = {
  type: 'list.column.type',
  status: 'list.column.status',
  priority: 'list.column.priority',
  assignee: 'list.column.assignee',
  labels: 'list.column.labels',
  startDate: 'list.column.startDate',
  dueDate: 'list.column.dueDate',
  createdAt: 'list.column.createdAt',
  updatedAt: 'list.column.updatedAt',
  subtasks: 'list.column.subtasks',
};
