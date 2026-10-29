import type {
  ActivityEvent,
  FieldChange,
  LabelSnapshot,
  Priority,
  RefSnapshot,
  StatusCategory,
  StatusSnapshot,
  TaskChanges,
  TaskRef,
} from '@glacier-tasks/domain';
import type { I18nService, TranslationKey } from '../i18n/i18n.service';
import { CATEGORY_KEYS, PRIORITY_KEYS } from '../tasks/task-display';

/** One readable history line (AUDIT-02/03): built from the event's own snapshots only. */
export interface ActivityEntry {
  id: string;
  occurredAt: string;
  icon: string;
  /** What the event is about, e.g. "GAME-1 Inventory" or "Status Review". */
  subject: string;
  summary: string;
  details: string[];
  /** Set for task events so lists can link to the task. */
  task: { id: string; projectId: string } | null;
  /** The event carries a description version (D11). */
  descriptionChanged: boolean;
}

type Payload = Record<string, unknown>;

const ICONS: Record<string, string> = {
  created: 'fa-plus',
  updated: 'fa-pen',
  trashed: 'fa-trash-can',
  restored: 'fa-rotate-left',
  removed: 'fa-xmark',
  reordered: 'fa-arrows-up-down',
  movedToStory: 'fa-right-left',
  subtaskCreated: 'fa-plus',
  subtaskTrashed: 'fa-trash-can',
  subtaskRestored: 'fa-rotate-left',
  subtaskMovedIn: 'fa-right-to-bracket',
  subtaskMovedOut: 'fa-right-from-bracket',
  attachmentAdded: 'fa-paperclip',
  attachmentRemoved: 'fa-paperclip',
  avatarChanged: 'fa-image',
  archived: 'fa-box-archive',
  unarchived: 'fa-box-open',
  bulkUnassigned: 'fa-user-slash',
};

/** Turns events into history lines with the current UI language. */
export class ActivityFormatter {
  constructor(private readonly i18n: I18nService) {}

  format(event: ActivityEvent): ActivityEntry {
    const p = event.payload as Payload;
    const [, action = ''] = event.eventType.split('.');
    const entry: ActivityEntry = {
      id: event.id,
      occurredAt: event.occurredAt,
      icon: ICONS[action] ?? 'fa-circle-info',
      subject: this.subject(event, p),
      summary: '',
      details: [],
      task:
        event.entityType === 'TASK' && event.projectId
          ? { id: event.entityId, projectId: event.projectId }
          : null,
      descriptionChanged: false,
    };
    const known = this.describe(event.eventType, p, entry);
    if (!known) entry.summary = event.eventType;
    return entry;
  }

  private subject(event: ActivityEvent, p: Payload): string {
    switch (event.entityType) {
      case 'TASK':
        return `${str(p['issueKey'])} ${str(p['title'])}`.trim();
      case 'PROJECT':
        return this.t('activity.subject.project', { name: str(p['name']) });
      case 'STATUS':
        return this.t('activity.subject.status', { name: str(p['name']) });
      case 'LABEL':
        return this.t('activity.subject.label', { name: str(p['name']) });
      case 'USER':
        return this.t('activity.subject.user', { name: str(p['name']) });
    }
  }

  /** Fills summary and details; false for event types this version doesn't know. */
  private describe(type: string, p: Payload, entry: ActivityEntry): boolean {
    const t = (key: TranslationKey, params?: Record<string, string | number>) =>
      this.t(key, params);
    switch (type) {
      case 'task.created':
        entry.summary = t('activity.task.created');
        entry.descriptionChanged = str(p['descriptionMarkdown']) !== '';
        if (p['parent'])
          entry.details.push(t('activity.task.inStory', { story: ref(p['parent']) }));
        return true;
      case 'task.updated':
        entry.summary = t('activity.task.updated');
        this.taskChanges((p['changes'] ?? {}) as Partial<TaskChanges>, entry);
        if (p['cause']) entry.details.push(this.cause(str(p['cause'])));
        return true;
      case 'task.trashed':
      case 'task.restored': {
        entry.summary = t(
          type === 'task.trashed' ? 'activity.task.trashed' : 'activity.task.restored',
        );
        const cascaded = (p['cascaded'] ?? []) as TaskRef[];
        if (cascaded.length > 0) {
          entry.details.push(t('activity.task.cascaded', { tasks: cascaded.map(ref).join(', ') }));
        }
        return true;
      }
      case 'task.movedToStory':
        entry.summary = t('activity.task.movedToStory', { from: ref(p['from']), to: ref(p['to']) });
        return true;
      case 'task.subtaskCreated':
      case 'task.subtaskTrashed':
      case 'task.subtaskRestored':
        entry.summary = t(`activity.${type}` as TranslationKey, { subtask: ref(p['subtask']) });
        return true;
      case 'task.subtaskMovedIn':
      case 'task.subtaskMovedOut':
        entry.summary = t(`activity.${type}` as TranslationKey, {
          subtask: ref(p['subtask']),
          story: ref(p['otherStory']),
        });
        return true;
      case 'task.attachmentAdded':
      case 'task.attachmentRemoved': {
        const file = (p['attachment'] ?? {}) as { name?: string };
        entry.summary = t(`activity.${type}` as TranslationKey, { name: str(file.name) });
        return true;
      }
      case 'project.created':
        entry.summary = t('activity.project.created', { key: str(p['key']) });
        return true;
      case 'project.updated':
        entry.summary = t('activity.project.updated');
        this.simpleChanges(p['changes'], entry, {
          key: 'activity.field.key',
          name: 'activity.field.name',
          description: 'activity.field.description',
        });
        return true;
      case 'project.trashed':
      case 'project.restored':
        entry.summary = t(`activity.${type}` as TranslationKey, {
          count: num(p['cascadedTaskCount']),
        });
        return true;
      case 'status.created':
        entry.summary = t('activity.status.created', { category: this.category(p['category']) });
        return true;
      case 'status.updated': {
        entry.summary = t('activity.status.updated');
        const changes = (p['changes'] ?? {}) as Payload;
        const name = changes['name'] as FieldChange<string> | undefined;
        if (name) entry.details.push(change(t('activity.field.name'), name.from, name.to));
        const category = changes['category'] as FieldChange<string> | undefined;
        if (category) {
          entry.details.push(
            change(
              t('activity.field.category'),
              this.category(category.from),
              this.category(category.to),
            ),
          );
        }
        const isDefault = changes['isDefault'] as FieldChange<boolean> | undefined;
        if (isDefault) {
          entry.details.push(
            t(isDefault.to ? 'activity.status.nowDefault' : 'activity.status.noLongerDefault'),
          );
        }
        return true;
      }
      case 'status.reordered':
        entry.summary = t('activity.status.reordered', {
          from: num(p['from']) + 1,
          to: num(p['to']) + 1,
        });
        return true;
      case 'status.removed': {
        const migrated = (p['migrated'] ?? {}) as Record<string, number>;
        entry.summary = t('activity.status.removed', {
          replacement: str((p['replacement'] as RefSnapshot | undefined)?.name),
        });
        entry.details.push(
          t('activity.status.migrated', {
            stories: migrated['stories'] ?? 0,
            subtasks: migrated['subtasks'] ?? 0,
            trashed: migrated['trashed'] ?? 0,
          }),
        );
        if (p['defaultReassigned']) entry.details.push(t('activity.status.defaultReassigned'));
        return true;
      }
      case 'label.created':
        entry.summary = t('activity.label.created');
        return true;
      case 'label.updated':
        entry.summary = t('activity.label.updated');
        this.simpleChanges(p['changes'], entry, {
          name: 'activity.field.name',
          color: 'activity.field.color',
        });
        return true;
      case 'label.removed': {
        entry.summary = t('activity.label.removed');
        const affected = (p['affectedTasks'] ?? []) as TaskRef[];
        if (affected.length > 0) {
          entry.details.push(t('activity.label.affected', { tasks: affected.map(ref).join(', ') }));
        }
        return true;
      }
      case 'user.created':
      case 'user.archived':
      case 'user.unarchived':
        entry.summary = t(`activity.${type}` as TranslationKey);
        return true;
      case 'user.updated':
        entry.summary = t('activity.user.updated');
        this.simpleChanges(p['changes'], entry, { name: 'activity.field.name' });
        return true;
      case 'user.avatarChanged':
        entry.summary = t(p['to'] ? 'activity.user.avatarSet' : 'activity.user.avatarRemoved');
        return true;
      case 'user.bulkUnassigned':
        entry.summary = t('activity.user.bulkUnassigned', { count: num(p['count']) });
        return true;
      default:
        return false;
    }
  }

  private taskChanges(changes: Partial<TaskChanges>, entry: ActivityEntry): void {
    const t = (key: TranslationKey) => this.t(key);
    if (changes.title)
      entry.details.push(change(t('activity.field.title'), changes.title.from, changes.title.to));
    if (changes.descriptionMarkdown) {
      entry.descriptionChanged = true;
      entry.details.push(t('activity.task.descriptionChanged'));
    }
    if (changes.priority) {
      entry.details.push(
        change(
          t('activity.field.priority'),
          this.priority(changes.priority.from),
          this.priority(changes.priority.to),
        ),
      );
    }
    if (changes.status) {
      const status = changes.status as FieldChange<StatusSnapshot>;
      entry.details.push(change(t('activity.field.status'), status.from.name, status.to.name));
    }
    if (changes.assignee) {
      entry.details.push(
        change(
          t('activity.field.assignee'),
          this.person(changes.assignee.from),
          this.person(changes.assignee.to),
        ),
      );
    }
    if (changes.startDate) {
      entry.details.push(
        change(
          t('activity.field.startDate'),
          this.date(changes.startDate.from),
          this.date(changes.startDate.to),
        ),
      );
    }
    if (changes.dueDate) {
      entry.details.push(
        change(
          t('activity.field.dueDate'),
          this.date(changes.dueDate.from),
          this.date(changes.dueDate.to),
        ),
      );
    }
    if (changes.labels) {
      const names = (labels: LabelSnapshot[]) => labels.map((l) => l.name).join(', ');
      if (changes.labels.added.length > 0) {
        entry.details.push(
          this.t('activity.task.labelsAdded', { labels: names(changes.labels.added) }),
        );
      }
      if (changes.labels.removed.length > 0) {
        entry.details.push(
          this.t('activity.task.labelsRemoved', { labels: names(changes.labels.removed) }),
        );
      }
    }
  }

  /** Name/key/color/description changes of projects, labels and profiles. */
  private simpleChanges(
    raw: unknown,
    entry: ActivityEntry,
    fields: Record<string, TranslationKey>,
  ): void {
    const changes = (raw ?? {}) as Record<string, FieldChange<string | null> | undefined>;
    for (const [field, key] of Object.entries(fields)) {
      const value = changes[field];
      if (!value) continue;
      entry.details.push(
        field === 'description'
          ? this.t('activity.project.descriptionChanged')
          : change(this.t(key), value.from ?? this.none(), value.to ?? this.none()),
      );
    }
  }

  private cause(cause: string): string {
    const key: Record<string, TranslationKey> = {
      'label.removed': 'activity.cause.labelRemoved',
      'user.bulkUnassigned': 'activity.cause.bulkUnassigned',
      'status.removed': 'activity.cause.statusRemoved',
    };
    return this.t(key[cause] ?? 'activity.cause.other');
  }

  private priority(value: string): string {
    return value in PRIORITY_KEYS ? this.t(PRIORITY_KEYS[value as Priority]) : value;
  }

  private category(value: unknown): string {
    const category = str(value);
    return category in CATEGORY_KEYS ? this.t(CATEGORY_KEYS[category as StatusCategory]) : category;
  }

  private person(value: RefSnapshot | null): string {
    return value ? value.name : this.t('activity.unassigned');
  }

  private date(value: string | null): string {
    return value ? this.i18n.formatLocalDate(value) : this.none();
  }

  private none(): string {
    return this.t('activity.none');
  }

  private t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}

function change(label: string, from: string, to: string): string {
  return `${label}: ${from} → ${to}`;
}

function ref(value: unknown): string {
  const task = value as Partial<TaskRef> | undefined;
  return task ? `${task.issueKey ?? ''} ${task.title ?? ''}`.trim() : '';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
