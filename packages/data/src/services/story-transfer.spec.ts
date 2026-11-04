// Story export/import (DATA-11, D58).

import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CreateTaskData,
  STORY_EXPORT_FORMAT,
  type StoryTransfer,
  storyTransferSchema,
  type TaskCreatedPayload,
} from '@glacier-tasks/domain';
import { migrate, MIGRATIONS, openDatabase } from '../index.js';
import { ActivityService } from './activity.js';
import { createServiceContext, type ServiceContext } from './context.js';
import { LabelService } from './labels.js';
import { ProjectService } from './projects.js';
import { type StoryImportPlan, StoryTransferService } from './story-transfer.js';
import { TaskService } from './tasks.js';
import { UserService } from './users.js';
import { WorkflowService } from './workflows.js';

const TOKEN = '11111111-1111-4111-8111-111111111111';

let db: Database;
let ctx: ServiceContext;
let projects: ProjectService;
let tasks: TaskService;
let labels: LabelService;
let users: UserService;
let workflows: WorkflowService;
let transfer: StoryTransferService;
let game: string;
let sound: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, MIGRATIONS);
  let tick = 0;
  let idCounter = 0;
  ctx = createServiceContext(db, {
    now: () => new Date(Date.UTC(2026, 10, 4, 10, 0, tick++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  });
  projects = new ProjectService(ctx);
  tasks = new TaskService(ctx, projects);
  labels = new LabelService(ctx);
  users = new UserService(ctx);
  workflows = new WorkflowService(ctx);
  transfer = new StoryTransferService(ctx, projects, tasks, labels);
  game = projects.create({ key: 'GAME', name: 'Game' }).id;
  sound = projects.create({ key: 'SND', name: 'Sound' }).id;
});

afterEach(() => db.close());

function status(projectId: string, name: string): string {
  const found = workflows.list(projectId).find((s) => s.name === name);
  if (!found) throw new Error(`no status ${name}`);
  return found.id;
}

function create(overrides: Partial<CreateTaskData>) {
  return tasks.create({
    projectId: game,
    type: 'STORY',
    parentStoryId: null,
    title: 'Story',
    descriptionMarkdown: '',
    priority: 'MEDIUM',
    assigneeUserId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    ...overrides,
  });
}

/** A story with two subtasks, a label and an assignee in GAME. */
function seed() {
  const ada = users.create({ name: 'Ada' });
  const ui = labels.create(game, { name: 'UI', color: 'blue' });
  const story = create({
    title: 'Login',
    descriptionMarkdown: 'See ![shot](attachment:0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10)',
    priority: 'HIGH',
    assigneeUserId: ada.id,
    labelIds: [ui.id],
    startDate: '2026-11-01',
    dueDate: '2026-11-20',
  });
  const first = create({
    type: 'SUBTASK',
    parentStoryId: story.id,
    title: 'Form',
    statusId: status(game, 'In Progress'),
  });
  const second = create({
    type: 'SUBTASK',
    parentStoryId: story.id,
    title: 'Tests',
    statusId: status(game, 'Done'),
  });
  return { ada, ui, story, first, second };
}

function importInto(
  projectId: string,
  doc: StoryTransfer,
  plan: StoryImportPlan,
  assignee: string | null,
) {
  return transfer.import(doc, {
    token: TOKEN,
    projectId,
    statusMap: Object.fromEntries(plan.statuses.map((s) => [s.sourceId, s.suggestedStatusId])),
    assigneeUserId: assignee,
  });
}

describe('StoryTransferService.export', () => {
  it('writes the story with its live subtasks in order, by name, without attachments', () => {
    const { ada, story, first } = seed();
    const trashed = create({ type: 'SUBTASK', parentStoryId: story.id, title: 'Gone' });
    tasks.trash(trashed.id);

    const doc = transfer.export(story.id, '1.2.3');

    expect(storyTransferSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(doc.format).toBe(STORY_EXPORT_FORMAT);
    expect(doc.source).toEqual({ projectKey: 'GAME', projectName: 'Game' });
    expect(doc.story).toMatchObject({
      issueKey: 'GAME-1',
      title: 'Login',
      priority: 'HIGH',
      assigneeId: ada.id,
      labels: ['UI'],
      startDate: '2026-11-01',
      dueDate: '2026-11-20',
    });
    expect(doc.story.subtasks.map((s) => s.title)).toEqual(['Form', 'Tests']);
    expect(doc.statuses.map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(doc.statuses.find((s) => s.id === first.statusId)?.category).toBe('IN_PROGRESS');
    expect(doc.labels).toEqual([{ name: 'UI', color: 'blue' }]);
    expect(doc.assignees).toEqual([{ id: ada.id, name: 'Ada' }]);
    expect(JSON.stringify(doc)).not.toContain('sha256');
  });

  it('only exports stories', () => {
    const { first } = seed();
    expect(() => transfer.export(first.id, '1')).toThrow('errors.exportStoriesOnly');
  });

  it('does not export trashed stories', () => {
    const { story } = seed();
    tasks.trash(story.id);
    expect(() => transfer.export(story.id, '1')).toThrow('errors.taskNotFound');
  });
});

describe('StoryTransferService.preview', () => {
  it('matches every status by name in the same workflow', () => {
    const { story, ada } = seed();
    const plan = transfer.preview(game, transfer.export(story.id, '1'));
    expect(plan.needsMapping).toBe(false);
    expect(plan.statuses.every((s) => s.matchedByName)).toBe(true);
    expect(plan.statuses.map((s) => s.taskCount)).toEqual([1, 1, 1]);
    expect(plan.assignee).toEqual({ name: 'Ada', suggestedUserId: ada.id });
    expect(plan.labels).toEqual({ reused: ['UI'], created: [] });
    expect(plan.hasAttachmentRefs).toBe(true);
    expect(plan.subtaskCount).toBe(2);
  });

  it('suggests by name ignoring case, then by category, and flags the gaps', () => {
    const { story } = seed();
    workflows.update(status(sound, 'To Do'), { name: 'to do' });
    workflows.update(status(sound, 'In Progress'), { name: 'Doing' });
    const plan = transfer.preview(sound, transfer.export(story.id, '1'));
    expect(plan.needsMapping).toBe(true);
    expect(plan.statuses.map((s) => [s.name, s.matchedByName, s.suggestedStatusId])).toEqual([
      ['To Do', true, status(sound, 'to do')],
      ['In Progress', false, status(sound, 'Doing')],
      ['Done', true, status(sound, 'Done')],
    ]);
    expect(plan.labels).toEqual({ reused: [], created: ['UI'] });
  });

  it('does not suggest an archived or unknown assignee', () => {
    const { story, ada } = seed();
    const doc = transfer.export(story.id, '1');
    users.archive(ada.id);
    expect(transfer.preview(sound, doc).assignee).toEqual({ name: 'Ada', suggestedUserId: null });
  });
});

describe('StoryTransferService.import', () => {
  it('recreates the story and subtasks with new keys, mapped statuses and one assignee', () => {
    const { story } = seed();
    const doc = transfer.export(story.id, '1');
    workflows.update(status(sound, 'In Progress'), { name: 'Doing' });
    const bob = users.create({ name: 'Bob' });
    const existing = labels.create(sound, { name: 'ui', color: 'red' });
    const plan = transfer.preview(sound, doc);

    const imported = importInto(sound, doc, plan, bob.id);

    expect(imported).toMatchObject({
      issueKey: 'SND-1',
      projectId: sound,
      title: 'Login',
      priority: 'HIGH',
      assigneeUserId: bob.id,
      labelIds: [existing.id],
      statusId: status(sound, 'To Do'),
    });
    expect(
      imported.subtasks.map((s) => [s.issueKey, s.title, s.statusId, s.assigneeUserId]),
    ).toEqual([
      ['SND-2', 'Form', status(sound, 'Doing'), bob.id],
      ['SND-3', 'Tests', status(sound, 'Done'), bob.id],
    ]);
    expect(labels.list(sound)).toHaveLength(1);
    const created = new ActivityService(ctx)
      .forEntity('TASK', imported.id)
      .find((e) => e.eventType === 'task.created');
    expect((created?.payload as unknown as TaskCreatedPayload).importedFrom).toBe('GAME-1');
  });

  it('creates missing labels with their colour and can import unassigned', () => {
    const { story } = seed();
    const doc = transfer.export(story.id, '1');
    const imported = importInto(sound, doc, transfer.preview(sound, doc), null);
    expect(labels.list(sound).map((l) => [l.name, l.color])).toEqual([['UI', 'blue']]);
    expect(imported.assigneeUserId).toBeNull();
    expect(imported.subtasks.every((s) => s.assigneeUserId === null)).toBe(true);
  });

  it('imports into the same project as a copy', () => {
    const { story } = seed();
    const doc = transfer.export(story.id, '1');
    const copy = importInto(game, doc, transfer.preview(game, doc), null);
    expect(copy.issueKey).toBe('GAME-4');
    expect(copy.subtasks).toHaveLength(2);
    expect(tasks.get(story.id).subtasks).toHaveLength(2);
  });

  it('requires every used status to be mapped to a status of the target project', () => {
    const { story } = seed();
    const doc = transfer.export(story.id, '1');
    const plan = transfer.preview(sound, doc);
    const statusMap = Object.fromEntries(
      plan.statuses.map((s) => [s.sourceId, s.suggestedStatusId]),
    );
    const [firstSource] = plan.statuses;
    const partial = { ...statusMap };
    delete partial[firstSource?.sourceId as string];
    const base = { token: TOKEN, projectId: sound, assigneeUserId: null };
    expect(() => transfer.import(doc, { ...base, statusMap: partial })).toThrow(
      'errors.importStatusUnmapped',
    );
    const foreign = { ...statusMap, [firstSource?.sourceId as string]: status(game, 'To Do') };
    expect(() => transfer.import(doc, { ...base, statusMap: foreign })).toThrow(
      'errors.crossProjectReference',
    );
  });

  it('rolls everything back when a task cannot be created', () => {
    const { story, ada } = seed();
    const doc = transfer.export(story.id, '1');
    const plan = transfer.preview(sound, doc);
    users.archive(ada.id);
    expect(() => importInto(sound, doc, plan, ada.id)).toThrow('errors.assigneeArchived');
    expect(labels.list(sound)).toEqual([]);
    expect(tasks.query({ ...emptyQuery, projectId: sound }).total).toBe(0);
  });

  it('rejects a trashed target project', () => {
    const { story } = seed();
    const doc = transfer.export(story.id, '1');
    const plan = transfer.preview(sound, doc);
    projects.trash(sound);
    expect(() => importInto(sound, doc, plan, null)).toThrow('errors.projectNotFound');
  });
});

const emptyQuery = {
  text: '',
  types: [],
  statusIds: [],
  statusCategories: [],
  priorities: [],
  assigneeUserIds: [],
  labelIds: [],
  dueFrom: null,
  dueTo: null,
  sortBy: 'sortOrder' as const,
  sortDirection: 'asc' as const,
  page: { offset: 0, limit: 100 },
};
