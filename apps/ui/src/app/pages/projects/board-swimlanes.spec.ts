import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TaskSummary } from '@glacier-tasks/domain';
import { SettingsStore } from '../../core/settings/settings-store';
import { EMPTY_FILTERS } from '../../core/tasks/project-view';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { Board } from './board';

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
  const inventory = await stub.api.tasks.create({
    projectId,
    type: 'STORY',
    title: 'Inventory',
    priority: 'HIGH',
  });
  await stub.api.tasks.create({
    projectId,
    type: 'SUBTASK',
    parentStoryId: inventory.id,
    title: 'Slots',
  });
  await stub.api.tasks.create({
    projectId,
    type: 'SUBTASK',
    parentStoryId: inventory.id,
    title: 'Tooltips',
    statusId: status(2),
  });
  await stub.api.tasks.create({
    projectId,
    type: 'STORY',
    title: 'Save game',
    statusId: status(1),
  });
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

interface LaneColumn {
  status: { id: string };
  tasks: TaskSummary[];
}

async function render(filters = EMPTY_FILTERS) {
  const fixture = TestBed.createComponent(Board);
  fixture.componentRef.setInput('projectId', projectId);
  fixture.componentRef.setInput('group', 'subtasks');
  fixture.componentRef.setInput('filters', filters);
  await settle(fixture);
  const root = fixture.nativeElement as HTMLElement;
  const lanes = () =>
    [...root.querySelectorAll<HTMLElement>('[data-testid="board-lane"]')].map(
      (lane) => lane.dataset['lane'],
    );
  const cards = (lane: string, column: string) =>
    [
      ...root.querySelectorAll(
        `[data-lane="${lane}"] [data-column="${column}"] [data-testid="lane-card"]`,
      ),
    ].map((card) => card.getAttribute('data-issue-key'));
  const board = fixture.componentInstance as unknown as {
    lanes(): Array<{ id: string; columns: LaneColumn[] }>;
    dropInLane(event: unknown): Promise<void>;
  };
  /** Simulates a CDK drop of a card from one column of a lane to a place in another or the same. */
  const drop = async (laneIndex: number, from: number, to: number, key: string, at = 0) => {
    const lane = board.lanes()[laneIndex] as { columns: LaneColumn[] };
    const source = lane.columns[from] as LaneColumn;
    await board.dropInLane({
      item: { data: source.tasks.find((t) => t.issueKey === key) },
      previousContainer: { data: source },
      container: { data: lane.columns[to] },
      previousIndex: source.tasks.findIndex((t) => t.issueKey === key),
      currentIndex: at,
    } as unknown as CdkDragDrop<unknown>);
    await settle(fixture);
  };
  return { fixture, root, lanes, cards, drop };
}

describe('board grouped by subtasks (BOARD-07, D51, D56)', () => {
  it('shows a lane per story with subtasks and the other stories last', async () => {
    const { root, lanes, cards } = await render();
    expect(lanes()).toEqual(['GAME-1', 'other']);
    expect(cards('GAME-1', 'To Do')).toEqual(['GAME-2']);
    expect(cards('GAME-1', 'Done')).toEqual(['GAME-3']);
    expect(cards('other', 'In Progress')).toEqual(['GAME-4']);
    expect(root.querySelector('[data-testid="lane-count"]')?.textContent?.trim()).toBe(
      '1/2 subtasks done',
    );
  });

  it('changes only the subtask status when a subtask is dropped into another column', async () => {
    const moveSubtask = vi.spyOn(stub.api.tasks, 'moveSubtask');
    const { cards, drop } = await render();
    await drop(0, 0, 1, 'GAME-2');
    expect(moveSubtask).toHaveBeenCalledWith(stub.tasks[1]?.id, 1, status(1), expect.any(String));
    expect(cards('GAME-1', 'In Progress')).toEqual(['GAME-2']);
    expect(stub.tasks[0]?.statusId).toBe(status(0)); // the story keeps its status (D06)
  });

  it('reorders subtasks within a column and keeps the drop position in another (D56)', async () => {
    await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: stub.tasks[0]?.id as string,
      title: 'Icons',
    });
    const { cards, drop } = await render();
    expect(cards('GAME-1', 'To Do')).toEqual(['GAME-2', 'GAME-5']);

    await drop(0, 0, 0, 'GAME-5', 0);
    expect(cards('GAME-1', 'To Do')).toEqual(['GAME-5', 'GAME-2']);
    expect(stub.tasks[4]).toMatchObject({ statusId: status(0), version: 2 });

    await drop(0, 0, 2, 'GAME-2', 0);
    expect(cards('GAME-1', 'To Do')).toEqual(['GAME-5']);
    expect(cards('GAME-1', 'Done')).toEqual(['GAME-2', 'GAME-3']);
  });

  it('reorders other stories within a column and moves them to the top of another', async () => {
    await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Audio', statusId: status(1) });
    const move = vi.spyOn(stub.api.tasks, 'move');
    const update = vi.spyOn(stub.api.tasks, 'update');
    const { cards, drop } = await render();
    expect(cards('other', 'In Progress')).toEqual(['GAME-4', 'GAME-5']);

    await drop(1, 1, 1, 'GAME-4', 0);
    expect(move).not.toHaveBeenCalled(); // dropped where it was

    await drop(1, 1, 1, 'GAME-5', 0);
    expect(move).toHaveBeenCalledWith(stub.tasks[4]?.id, 1, status(1), expect.any(String));
    expect(cards('other', 'In Progress')).toEqual(['GAME-5', 'GAME-4']);

    await drop(1, 1, 2, 'GAME-4', 1);
    expect(move).toHaveBeenLastCalledWith(stub.tasks[3]?.id, 1, status(2), undefined);
    expect(cards('other', 'Done')).toEqual(['GAME-4']);
    expect(update).not.toHaveBeenCalled();
  });

  it('offers the status select as keyboard alternative and collapses lanes', async () => {
    const { fixture, root, cards } = await render();
    const select = root.querySelector(
      '[data-lane="GAME-1"] [data-testid="card-subtask-status"]',
    ) as HTMLSelectElement;
    select.value = status(2);
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(cards('GAME-1', 'Done')).toEqual(['GAME-2', 'GAME-3']);

    (root.querySelector('[data-lane="GAME-1"] [data-testid="lane-toggle"]') as HTMLElement).click();
    await settle(fixture);
    expect(cards('GAME-1', 'Done')).toEqual([]);
    expect(
      root
        .querySelector('[data-lane="GAME-1"] [data-testid="lane-toggle"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('applies the story filters to the lanes (D43)', async () => {
    const { lanes } = await render({ ...EMPTY_FILTERS, priorities: ['HIGH'] });
    expect(lanes()).toEqual(['GAME-1']);
  });

  it('asks the page to remember a grouping change', async () => {
    const { fixture, root } = await render();
    const changes: string[] = [];
    fixture.componentInstance.groupChange.subscribe((group) => changes.push(group));
    (root.querySelector('[data-testid="board-group-stories"]') as HTMLElement).click();
    expect(changes).toEqual(['stories']);
  });
});

describe('board load states (M8)', () => {
  it('reports a failed load instead of showing an empty board', async () => {
    stub.api.workflows.list = async () => {
      throw { code: 'NOT_FOUND', message: 'errors.projectNotFound' };
    };
    const { root } = await render();
    expect(root.querySelector('[data-testid="board-load-error"]')?.textContent).toContain(
      'project',
    );
  });
});

describe('long columns (M8 performance)', () => {
  it('renders the first 100 cards per column and shows more on request', async () => {
    for (let i = 0; i < 120; i++) {
      await stub.api.tasks.create({ projectId, type: 'STORY', title: `Bulk ${i}` });
    }
    const fixture = TestBed.createComponent(Board);
    fixture.componentRef.setInput('projectId', projectId);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const todoCards = () => root.querySelectorAll('[data-column="To Do"] .card-item').length;
    expect(todoCards()).toBe(100);
    const more = root.querySelector('[data-testid="column-show-more"]') as HTMLElement;
    expect(more.textContent).toContain('21');
    more.click();
    await settle(fixture);
    expect(todoCards()).toBe(121);
    expect(root.querySelector('[data-testid="column-show-more"]')).toBeNull();
  });
});
