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
  type ElementRef,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  type AttachmentMetadata,
  DESCRIPTION_MAX_LENGTH,
  isAppErrorInfo,
  isDateRangeValid,
  PRIORITIES,
  type Priority,
  type TaskDetail,
  type TaskSummary,
  TITLE_MAX_LENGTH,
  type UpdateTaskInput,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { PRIORITY_KEYS, TASK_TYPE_KEYS } from '../../core/tasks/task-display';
import { UsersStore } from '../../core/users/users-store';
import { ActivityTimeline } from '../../shared/activity-timeline';
import { Avatar } from '../../shared/avatar';
import { Dialog } from '../../shared/dialog';
import { LabelChip } from '../../shared/label-chip';
import { MarkdownView } from '../../shared/markdown-view';
import { DescriptionVersions } from './description-versions';
import { TaskAttachments } from './task-attachments';

/** The user's text at the moment a save was rejected as stale (D05, UJ-09). */
interface Draft {
  title: string;
  descriptionMarkdown: string;
}

/**
 * Story/subtask editor (TASK-03, D40): explicit Save/Cancel (TASK-08), version-checked saves
 * with a conflict banner that keeps the unsaved text visible (TASK-10), Markdown preview,
 * subtasks with quick status changes, move-to-story (D04), trash, attachments (D03, D10),
 * the task history (AUDIT-02) and the description version browser (D11).
 */
@Component({
  selector: 'app-task-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActivityTimeline,
    Avatar,
    DescriptionVersions,
    Dialog,
    LabelChip,
    MarkdownView,
    RouterLink,
    TaskAttachments,
  ],
  templateUrl: './task-editor-page.html',
  styleUrl: './task-editor-page.scss',
})
export class TaskEditorPage {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly router = inject(Router);
  protected readonly users = inject(UsersStore);

  /** Bound from the route parameters. */
  readonly projectId = input.required<string>();
  readonly taskId = input.required<string>();

  protected readonly titleMax = TITLE_MAX_LENGTH;
  protected readonly descriptionMax = DESCRIPTION_MAX_LENGTH;
  protected readonly priorities = PRIORITIES;
  protected readonly priorityKey = PRIORITY_KEYS;
  protected readonly typeKey = TASK_TYPE_KEYS;

  /** The saved task: source of the form fields. Replaced on load, save and reload. */
  protected readonly task = signal<TaskDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Subtasks and progress refresh on their own so a draft in the form survives. */
  protected readonly subtasks = linkedSignal(() => this.task()?.subtasks ?? []);
  /** Attachments change without a task save (they don't touch the task version). */
  protected readonly attachments = linkedSignal<ReadonlyArray<AttachmentMetadata>>(
    () => this.task()?.attachments ?? [],
  );
  /** Bumped by changes that record history without changing the task itself. */
  private readonly historyBump = signal(0);
  protected readonly history = resource({
    params: () => {
      const task = this.task();
      return task ? { id: task.id, version: task.version, bump: this.historyBump() } : undefined;
    },
    loader: ({ params }) => this.api.activity.forEntity('TASK', params.id),
  });
  protected readonly versionsOpen = signal(false);
  protected readonly versionsEventId = signal<string | null>(null);
  private readonly descriptionInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('descriptionInput');

  protected readonly statuses = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.workflows.list(params),
  });
  protected readonly labels = resource({
    params: () => this.projectId(),
    loader: ({ params }) => this.api.labels.list(params),
  });
  protected readonly parent = resource({
    params: () => this.task()?.parentStoryId ?? undefined,
    loader: ({ params }) => this.api.tasks.get(params),
  });
  /** Live stories as move targets for a subtask (D04). */
  protected readonly stories = resource({
    params: () => (this.task()?.type === 'SUBTASK' ? this.projectId() : undefined),
    loader: ({ params }) =>
      this.api.tasks.query({
        projectId: params,
        types: ['STORY'],
        sortBy: 'issueKey',
        page: { offset: 0, limit: 500 },
      }),
  });

  // Form fields follow the saved task and keep user edits until it changes.
  protected readonly title = linkedSignal(() => this.task()?.title ?? '');
  protected readonly description = linkedSignal(() => this.task()?.descriptionMarkdown ?? '');
  protected readonly priority = linkedSignal<Priority>(() => this.task()?.priority ?? 'MEDIUM');
  protected readonly statusId = linkedSignal(() => this.task()?.statusId ?? '');
  protected readonly assigneeUserId = linkedSignal(() => this.task()?.assigneeUserId ?? null);
  protected readonly startDate = linkedSignal(() => this.task()?.startDate ?? null);
  protected readonly dueDate = linkedSignal(() => this.task()?.dueDate ?? null);
  protected readonly labelIds = linkedSignal(() => this.task()?.labelIds ?? []);

  protected readonly tab = signal<'edit' | 'preview'>('edit');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal<Draft | null>(null);
  protected readonly subtaskError = signal<string | null>(null);
  protected readonly newSubtaskTitle = signal('');
  protected readonly trashOpen = signal(false);
  protected readonly moveTarget = signal('');

  protected readonly titleValid = computed(() => this.title().trim().length > 0);
  protected readonly datesValid = computed(() =>
    isDateRangeValid(this.startDate(), this.dueDate()),
  );

  /** Active profiles, plus the current assignee if archived (shown, not offered anew). */
  protected readonly assigneeOptions = computed(() => {
    const current = this.task()?.assigneeUserId;
    return this.users.all().filter((user) => user.archivedAt === null || user.id === current);
  });
  protected readonly moveTargets = computed(() =>
    (this.stories.value()?.items ?? []).filter((story) => story.id !== this.task()?.parentStoryId),
  );
  protected readonly progress = computed(() => {
    const items = this.subtasks();
    const done = new Set(
      (this.statuses.value() ?? []).filter((s) => s.category === 'DONE').map((s) => s.id),
    );
    return { done: items.filter((s) => done.has(s.statusId)).length, total: items.length };
  });

  /** Only the changed fields are sent (and recorded in history). */
  protected readonly patch = computed<UpdateTaskInput>(() => {
    const task = this.task();
    if (!task) return {};
    const patch: UpdateTaskInput = {};
    if (this.title().trim() !== task.title) patch.title = this.title();
    if (this.description() !== task.descriptionMarkdown) {
      patch.descriptionMarkdown = this.description();
    }
    if (this.priority() !== task.priority) patch.priority = this.priority();
    if (this.statusId() !== task.statusId) patch.statusId = this.statusId();
    if (this.assigneeUserId() !== task.assigneeUserId) patch.assigneeUserId = this.assigneeUserId();
    if (this.startDate() !== task.startDate) patch.startDate = this.startDate();
    if (this.dueDate() !== task.dueDate) patch.dueDate = this.dueDate();
    const labels = [...this.labelIds()].sort();
    if (labels.join() !== [...task.labelIds].sort().join()) patch.labelIds = labels;
    return patch;
  });
  readonly dirty = computed(() => Object.keys(this.patch()).length > 0);
  readonly discardMessage = () => this.i18n.t('task.discardChanges');

  constructor() {
    if (!this.users.loaded()) void this.users.load().catch(() => undefined);
    effect(() => {
      const id = this.taskId();
      untracked(() => {
        this.conflict.set(null);
        this.error.set(null);
        this.saved.set(false);
        void this.load(id);
      });
    });
  }

  protected async load(id = this.taskId()): Promise<void> {
    this.loadError.set(null);
    try {
      this.task.set(await this.api.tasks.get(id));
    } catch (error) {
      this.task.set(null);
      this.loadError.set(this.i18n.errorMessage(error));
    }
  }

  protected toggleLabel(id: string): void {
    this.labelIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    this.saved.set(false);
  }

  protected edited(): void {
    this.saved.set(false);
  }

  protected async save(): Promise<void> {
    const task = this.task();
    if (!task || !this.dirty() || !this.titleValid() || !this.datesValid() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      this.task.set(await this.api.tasks.update(task.id, task.version, this.patch()));
      this.saved.set(true);
      this.conflict.set(null);
    } catch (error) {
      if (isAppErrorInfo(error) && error.message === 'errors.staleTask') {
        this.conflict.set({ title: this.title(), descriptionMarkdown: this.description() });
      } else {
        this.error.set(this.i18n.errorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Discards edits: the form returns to the saved task. */
  protected cancel(): void {
    const task = this.task();
    if (task) this.task.set({ ...task });
    this.error.set(null);
    this.saved.set(false);
  }

  /** Loads the latest version after a conflict; the draft panel keeps the user's text. */
  protected async reloadAfterConflict(): Promise<void> {
    await this.load();
  }

  protected async copyDraft(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  // --- Subtasks (story view) ----------------------------------------------------

  protected async addSubtask(): Promise<void> {
    const task = this.task();
    const title = this.newSubtaskTitle().trim();
    if (!task || !title) return;
    await this.subtaskAction(async () => {
      await this.api.tasks.create({
        projectId: task.projectId,
        type: 'SUBTASK',
        parentStoryId: task.id,
        title,
      });
      this.newSubtaskTitle.set('');
    });
  }

  /** TASK-08: quick status changes save immediately; failures show the real state again. */
  protected async setSubtaskStatus(subtask: TaskSummary, select: HTMLSelectElement): Promise<void> {
    const ok = await this.subtaskAction(() =>
      this.api.tasks.update(subtask.id, subtask.version, { statusId: select.value }),
    );
    // An unchanged [selected] binding is not re-applied, so undo the browser's selection.
    if (!ok) select.value = subtask.statusId;
  }

  private async subtaskAction(action: () => Promise<unknown>): Promise<boolean> {
    this.subtaskError.set(null);
    let ok = true;
    try {
      await action();
    } catch (error) {
      ok = false;
      this.subtaskError.set(this.i18n.errorMessage(error));
    }
    await this.refreshSubtasks();
    this.historyBump.update((n) => n + 1);
    return ok;
  }

  // --- Attachments and history ----------------------------------------------------

  protected async attachmentsChanged(): Promise<void> {
    const task = this.task();
    if (!task) return;
    try {
      this.attachments.set(await this.api.attachments.list(task.id));
    } catch {
      // The task vanished; the next save or load reports it.
    }
    this.historyBump.update((n) => n + 1);
  }

  /** D10: adds `![name](attachment:<id>)` at the cursor (or at the end) of the description. */
  protected insertImage(file: AttachmentMetadata): void {
    // Brackets and backslashes in the name would break the Markdown image syntax.
    const alt = file.originalName.replace(/[[\]\\]/g, '');
    const reference = `![${alt}](attachment:${file.id})`;
    const text = this.description();
    const input = this.tab() === 'edit' ? this.descriptionInput()?.nativeElement : undefined;
    const at = input ? input.selectionStart : text.length;
    const before = text.slice(0, at);
    const separator = before === '' || before.endsWith('\n') ? '' : '\n';
    this.description.set(`${before}${separator}${reference}\n${text.slice(at)}`);
    this.edited();
    if (input) {
      const caret = before.length + separator.length + reference.length + 1;
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(caret, caret);
      });
    }
  }

  protected openVersions(eventId: string | null): void {
    this.versionsEventId.set(eventId);
    this.versionsOpen.set(true);
  }

  private async refreshSubtasks(): Promise<void> {
    const task = this.task();
    if (!task) return;
    try {
      this.subtasks.set((await this.api.tasks.get(task.id)).subtasks);
    } catch {
      // The story itself vanished; the next save or load reports it.
    }
  }

  // --- Subtask move and trash ---------------------------------------------------

  protected async moveToStory(): Promise<void> {
    const task = this.task();
    const target = this.moveTarget();
    if (!task || !target) return;
    this.error.set(null);
    try {
      await this.api.tasks.moveToStory(task.id, task.version, target);
      this.moveTarget.set('');
      await this.load();
    } catch (error) {
      if (isAppErrorInfo(error) && error.message === 'errors.staleTask') {
        this.conflict.set({ title: this.title(), descriptionMarkdown: this.description() });
      } else {
        this.error.set(this.i18n.errorMessage(error));
      }
    }
  }

  protected async trash(): Promise<void> {
    const task = this.task();
    if (!task) return;
    try {
      await this.api.tasks.trash(task.id);
      this.trashOpen.set(false);
      // Nothing left to protect: skip the unsaved-changes guard.
      this.task.set(null);
      await this.router.navigate(
        task.parentStoryId
          ? ['/projects', task.projectId, 'tasks', task.parentStoryId]
          : ['/projects', task.projectId],
      );
    } catch (error) {
      this.trashOpen.set(false);
      this.error.set(this.i18n.errorMessage(error));
    }
  }

  protected statusName(id: string): string {
    return this.statuses.value()?.find((status) => status.id === id)?.name ?? '';
  }
}
