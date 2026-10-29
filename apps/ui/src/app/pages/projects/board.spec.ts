import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import type { TaskSummary } from '@glacier-tasks/domain';
import { SettingsStore } from '../../core/settings/settings-store';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { Board } from './board';
import { WorkflowEditor } from './workflow-editor';

let stub: GlacierApiStub;
let projectId: string;
const status = (i: number) => `${projectId}-status-${i}`;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideRouter([])] });
  await TestBed.inject(SettingsStore).load();
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function renderBoard() {
  const fixture = TestBed.createComponent(Board);
  fixture.componentRef.setInput('projectId', projectId);
  await settle(fixture);
  const root = fixture.nativeElement as HTMLElement;
  const column = (name: string) =>
    [...root.querySelectorAll(`[data-column="${name}"] .card-item`)].map((card) =>
      card.getAttribute('data-issue-key'),
    );
  return { fixture, root, column };
}

function card(root: HTMLElement, key: string): HTMLElement {
  return root.querySelector(`.card-item[data-issue-key="${key}"]`) as HTMLElement;
}

describe('Board (BOARD-01..05)', () => {
  it('shows one column per status with story cards only', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' });
    await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Sub',
    });
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Save', statusId: status(1) });
    const { root, column } = await renderBoard();

    expect([...root.querySelectorAll('.column h2')].map((h) => h.textContent)).toEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
    expect(column('To Do')).toEqual(['GAME-1']);
    expect(column('In Progress')).toEqual(['GAME-3']);
    expect(root.querySelectorAll('.card-item').length).toBe(2);
  });

  it('expands a card and changes a subtask status from it (D06)', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' });
    await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Sub',
    });
    const { fixture, root } = await renderBoard();
    (card(root, 'GAME-1').querySelector('[data-testid="card-progress"]') as HTMLElement).click();
    await settle(fixture);

    const select = card(root, 'GAME-1').querySelector(
      '[data-testid="card-subtask-status"]',
    ) as HTMLSelectElement;
    select.value = status(2);
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(stub.tasks.find((t) => t.title === 'Sub')?.statusId).toBe(status(2));
    expect(stub.tasks.find((t) => t.title === 'Inventory')?.statusId).toBe(status(0));
    expect(
      card(root, 'GAME-1').querySelector('[data-testid="card-progress"]')?.textContent,
    ).toContain('1/1');
  });

  it('moves a card with the keyboard status select (non-drag alternative)', async () => {
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'A' });
    const move = vi.spyOn(stub.api.tasks, 'move');
    const { fixture, root, column } = await renderBoard();
    const select = card(root, 'GAME-1').querySelector(
      '[data-testid="card-status"]',
    ) as HTMLSelectElement;
    select.value = status(2);
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(move).toHaveBeenCalledWith(expect.any(String), 1, status(2));
    expect(column('Done')).toEqual(['GAME-1']);
  });

  it('persists a drop within a column with a key between its neighbours', async () => {
    for (const title of ['A', 'B', 'C']) {
      await stub.api.tasks.create({ projectId, type: 'STORY', title });
    }
    const move = vi.spyOn(stub.api.tasks, 'move');
    const { fixture } = await renderBoard();
    const board = fixture.componentInstance as unknown as {
      columns(): Array<{ status: { id: string }; stories: TaskSummary[] }>;
      drop(event: unknown): Promise<void>;
    };
    const todo = board.columns()[0]!;
    const [a, b, c] = todo.stories as [TaskSummary, TaskSummary, TaskSummary];
    await board.drop({
      item: { data: c },
      previousContainer: { data: todo },
      container: { data: todo },
      previousIndex: 2,
      currentIndex: 0,
    } as unknown as CdkDragDrop<unknown>);
    const key = move.mock.calls[0]?.[3] as string;
    expect(move.mock.calls[0]?.slice(0, 3)).toEqual([c.id, 1, status(0)]);
    expect(key < a.sortOrder).toBe(true);
    expect(b.sortOrder > a.sortOrder).toBe(true);
  });

  it('moves a card to the top of another column and rolls back on failure', async () => {
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'A' });
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'B', statusId: status(1) });
    const { fixture, root, column } = await renderBoard();
    const board = fixture.componentInstance as unknown as {
      columns(): Array<{ status: { id: string }; stories: TaskSummary[] }>;
      drop(event: unknown): Promise<void>;
    };
    stub.api.tasks.move = () => Promise.reject({ code: 'CONFLICT', message: 'errors.staleTask' });
    const [todo, doing] = board.columns() as [
      { status: { id: string }; stories: TaskSummary[] },
      { status: { id: string }; stories: TaskSummary[] },
    ];
    await board.drop({
      item: { data: todo.stories[0] },
      previousContainer: { data: todo },
      container: { data: doing },
      previousIndex: 0,
      currentIndex: 1,
    });
    await settle(fixture);
    expect(root.querySelector('[data-testid="board-error"]')?.textContent).toContain('refreshed');
    expect(column('To Do')).toEqual(['GAME-1']);
    expect(column('In Progress')).toEqual(['GAME-2']);
  });
});

describe('WorkflowEditor (spec §3.4, UJ-04)', () => {
  async function renderEditor() {
    const fixture = TestBed.createComponent(WorkflowEditor);
    fixture.componentRef.setInput('projectId', projectId);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const names = () =>
      [...root.querySelectorAll('[data-status-name]')].map((li) =>
        li.getAttribute('data-status-name'),
      );
    const row = (name: string) => root.querySelector(`[data-status-name="${name}"]`) as HTMLElement;
    return { fixture, root, names, row };
  }

  it('adds, reorders and sets the default status', async () => {
    const { fixture, root, names, row } = await renderEditor();
    const input = root.querySelector('[data-testid="status-new-name"]') as HTMLInputElement;
    input.value = 'Review';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (root.querySelector('[data-testid="status-add"]') as HTMLElement).click();
    await settle(fixture);
    expect(names()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);

    (row('Review').querySelector('[data-testid="status-up"]') as HTMLElement).click();
    await settle(fixture);
    expect(names()).toEqual(['To Do', 'In Progress', 'Review', 'Done']);

    (row('Review').querySelector('[data-testid="status-default"]') as HTMLElement).click();
    await settle(fixture);
    expect(stub.statuses.filter((s) => s.isDefault).map((s) => s.name)).toEqual(['Review']);
  });

  it('restores the previous default radio when the change fails', async () => {
    const { fixture, row } = await renderEditor();
    stub.api.workflows.update = async () => {
      throw { code: 'IO', message: 'errors.unexpected' };
    };
    const radio = (name: string) =>
      row(name).querySelector('[data-testid="status-default"]') as HTMLInputElement;
    radio('Done').click();
    await settle(fixture);
    expect(radio('Done').checked).toBe(false);
    expect(radio('To Do').checked).toBe(true);
  });

  it('refuses to recategorize the last Done status and restores the select', async () => {
    const { fixture, root, row } = await renderEditor();
    const select = row('Done').querySelector(
      '[data-testid="status-category"]',
    ) as HTMLSelectElement;
    select.value = 'TODO';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(root.querySelector('[data-testid="workflow-error"]')?.textContent).toContain(
      'at least one status',
    );
    expect(select.value).toBe('DONE');
  });

  it('deletes through the wizard with usage counts and a required replacement', async () => {
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'A', statusId: status(1) });
    const trashed = await stub.api.tasks.create({
      projectId,
      type: 'STORY',
      title: 'B',
      statusId: status(1),
    });
    await stub.api.tasks.trash(trashed.id);
    const { fixture, root, names, row } = await renderEditor();
    (row('In Progress').querySelector('[data-testid="status-delete"]') as HTMLElement).click();
    await settle(fixture);
    expect(root.querySelector('[data-testid="wizard-usage"]')?.textContent).toContain(
      '1 stories, 0 subtasks and 1 tasks in the trash',
    );
    const confirm = root.querySelector('[data-testid="wizard-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const replacement = root.querySelector(
      '[data-testid="wizard-replacement"]',
    ) as HTMLSelectElement;
    replacement.value = status(2);
    replacement.dispatchEvent(new Event('change'));
    await settle(fixture);
    confirm.click();
    await settle(fixture);
    expect(names()).toEqual(['To Do', 'Done']);
    expect(stub.tasks.map((t) => t.statusId)).toEqual([status(2), status(2)]);
  });
});
