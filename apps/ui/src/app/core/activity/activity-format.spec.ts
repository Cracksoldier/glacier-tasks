import { TestBed } from '@angular/core/testing';
import type { ActivityEvent, EntityType } from '@glacier-tasks/domain';
import { I18nService } from '../i18n/i18n.service';
import { SettingsStore } from '../settings/settings-store';
import { provideApiStub } from '../../testing/providers';
import { ActivityFormatter } from './activity-format';
import { diffLines } from './line-diff';

let formatter: ActivityFormatter;
let settings: SettingsStore;

beforeEach(() => {
  TestBed.configureTestingModule({ providers: provideApiStub().providers });
  settings = TestBed.inject(SettingsStore);
  formatter = new ActivityFormatter(TestBed.inject(I18nService));
});

function event(
  eventType: string,
  payload: Record<string, unknown>,
  entityType?: EntityType,
): ActivityEvent {
  const prefix = eventType.split('.')[0] as string;
  const type =
    entityType ??
    ({ task: 'TASK', project: 'PROJECT', status: 'STATUS', label: 'LABEL', user: 'USER' } as const)[
      prefix as 'task'
    ];
  return {
    id: 'e1',
    entityType: type,
    entityId: 't1',
    projectId: 'p1',
    eventType,
    occurredAt: '2026-10-29T10:00:00.000Z',
    source: 'UI',
    payload,
  };
}

const task = { issueKey: 'GAME-1', title: 'Inventory' };
const ref = (n: number) => ({ id: `s${n}`, issueKey: `GAME-${n}`, title: `Sub ${n}` });

// Every event type the services record (spec §3.7, D12, D27) with a representative payload.
const ALL_EVENTS: Array<[string, Record<string, unknown>]> = [
  ['task.created', { ...task, descriptionMarkdown: 'Text', parent: null }],
  ['task.updated', { ...task, changes: { priority: { from: 'LOW', to: 'HIGH' } } }],
  ['task.trashed', { ...task, cascaded: [ref(2)] }],
  ['task.restored', { ...task, cascaded: [] }],
  ['task.movedToStory', { ...task, from: ref(3), to: ref(4) }],
  ['task.subtaskCreated', { subtask: ref(2) }],
  ['task.subtaskTrashed', { subtask: ref(2) }],
  ['task.subtaskRestored', { subtask: ref(2) }],
  ['task.subtaskMovedIn', { subtask: ref(2), otherStory: ref(5) }],
  ['task.subtaskMovedOut', { subtask: ref(2), otherStory: ref(5) }],
  ['task.attachmentAdded', { ...task, attachment: { name: 'shot.png' } }],
  ['task.attachmentRemoved', { ...task, attachment: { name: 'shot.png' } }],
  ['project.created', { key: 'GAME', name: 'Game' }],
  ['project.updated', { name: 'Game', changes: { name: { from: 'Old', to: 'Game' } } }],
  ['project.trashed', { key: 'GAME', name: 'Game', cascadedTaskCount: 3 }],
  ['project.restored', { key: 'GAME', name: 'Game', cascadedTaskCount: 3 }],
  ['status.created', { name: 'Review', category: 'IN_PROGRESS' }],
  ['status.updated', { name: 'Review', changes: { isDefault: { from: false, to: true } } }],
  ['status.reordered', { name: 'Review', from: 3, to: 1 }],
  [
    'status.removed',
    {
      name: 'Review',
      replacement: { id: 's', name: 'To Do', category: 'TODO' },
      defaultReassigned: true,
      migrated: { stories: 2, subtasks: 1, trashed: 0 },
    },
  ],
  ['label.created', { name: 'Bug', color: 'red' }],
  ['label.updated', { name: 'Defect', changes: { name: { from: 'Bug', to: 'Defect' } } }],
  ['label.removed', { name: 'Bug', color: 'red', affectedTasks: [ref(1)] }],
  ['user.created', { name: 'Ann' }],
  ['user.updated', { name: 'Ann', changes: { name: { from: 'Anne', to: 'Ann' } } }],
  ['user.avatarChanged', { name: 'Ann', from: null, to: 'f1' }],
  ['user.archived', { name: 'Ann' }],
  ['user.unarchived', { name: 'Ann' }],
  ['user.bulkUnassigned', { name: 'Ann', count: 4 }],
];

describe('ActivityFormatter (AUDIT-02/03)', () => {
  it.each(ALL_EVENTS)('describes %s in English and German', (type, payload) => {
    const english = formatter.format(event(type, payload));
    expect(english.summary).not.toBe(type);
    expect(english.summary).not.toMatch(/^activity\./);
    void settings.setLanguage('de').catch(() => undefined);
    const german = formatter.format(event(type, payload));
    expect(german.summary).not.toMatch(/^activity\./);
    expect(german.details.join()).not.toMatch(/activity\./);
  });

  it('lists task changes from snapshots, with the cause of side effects', () => {
    const entry = formatter.format(
      event('task.updated', {
        ...task,
        changes: {
          title: { from: 'Inv', to: 'Inventory' },
          descriptionMarkdown: { to: 'new' },
          status: {
            from: { id: 'a', name: 'To Do', category: 'TODO' },
            to: { id: 'b', name: 'Done', category: 'DONE' },
          },
          assignee: { from: { id: 'u', name: 'Ann (renamed later)' }, to: null },
          dueDate: { from: null, to: '2026-11-03' },
          labels: { added: [{ id: 'l', name: 'Bug', color: 'red' }], removed: [] },
        },
        cause: 'label.removed',
      }),
    );
    expect(entry.subject).toBe('GAME-1 Inventory');
    expect(entry.task).toEqual({ id: 't1', projectId: 'p1' });
    expect(entry.descriptionChanged).toBe(true);
    expect(entry.details).toEqual([
      'Title: Inv → Inventory',
      'Description changed',
      'Status: To Do → Done',
      'Assignee: Ann (renamed later) → unassigned',
      `Due date: none → ${TestBed.inject(I18nService).formatLocalDate('2026-11-03')}`,
      'Labels added: Bug',
      'Because the label was deleted',
    ]);
  });

  it('falls back to the raw type for unknown events', () => {
    expect(formatter.format(event('task.somethingNew', task)).summary).toBe('task.somethingNew');
  });
});

describe('diffLines (D11)', () => {
  it('marks removed and added lines around unchanged ones', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('handles empty versions and identical text', () => {
    expect(diffLines('', 'x')).toEqual([{ kind: 'added', text: 'x' }]);
    expect(diffLines('x', '')).toEqual([{ kind: 'removed', text: 'x' }]);
    expect(diffLines('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });

  it('finds the longest common subsequence in the middle', () => {
    const kinds = diffLines('h\n1\n2\n3\nt', 'h\n2\nx\n3\nt').map((l) => `${l.kind[0]}${l.text}`);
    expect(kinds).toEqual(['sh', 'r1', 's2', 'ax', 's3', 'st']);
  });
});
