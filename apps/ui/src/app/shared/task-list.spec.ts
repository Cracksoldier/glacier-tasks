import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SettingsStore } from '../core/settings/settings-store';
import type { GlacierApiStub } from '../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../testing/providers';
import { type ListQuery, TaskList } from './task-list';

let stub: GlacierApiStub;
let projectId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  // jsdom has no layout; the virtual scroll viewport calls scrollTo when focusing far rows.
  Element.prototype.scrollTo ??= () => undefined;
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideRouter([])] });
  await TestBed.inject(SettingsStore).load();
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  const inventory = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' });
  await stub.api.tasks.create({
    projectId,
    type: 'SUBTASK',
    parentStoryId: inventory.id,
    title: 'Tooltips',
  });
  await stub.api.tasks.create({
    projectId,
    type: 'SUBTASK',
    parentStoryId: inventory.id,
    title: 'Slots',
    priority: 'HIGH',
  });
  await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Save game' });
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

async function renderList(query: Partial<ListQuery> = {}, columns = ['status', 'priority']) {
  const fixture = TestBed.createComponent(TaskList);
  fixture.componentRef.setInput('query', { projectId, ...query });
  fixture.componentRef.setInput('columns', columns);
  await settle(fixture);
  const root = fixture.nativeElement as HTMLElement;
  const rows = () =>
    [...root.querySelectorAll<HTMLElement>('[data-testid="list-row"]')].map(
      (row) =>
        `${row.classList.contains('dimmed') ? '~' : ''}${row.dataset['kind'] === 'subtask' ? '  ' : ''}${
          row.querySelector('[data-testid="list-title"]')?.textContent
        }`,
    );
  const row = (title: string) =>
    [...root.querySelectorAll<HTMLElement>('[data-testid="list-row"]')].find(
      (r) => r.querySelector('[data-testid="list-title"]')?.textContent === title,
    ) as HTMLElement;
  return { fixture, root, rows, row };
}

describe('TaskList (LIST-01..05)', () => {
  it('shows story rows and expands subtasks on demand', async () => {
    const { fixture, root, rows, row } = await renderList();
    expect(rows()).toEqual(['Inventory', 'Save game']);
    expect(root.querySelector('[data-testid="list-total"]')?.textContent?.trim()).toBe('2 stories');
    expect(row('Inventory').getAttribute('aria-expanded')).toBe('false');

    (row('Inventory').querySelector('[data-testid="list-toggle"]') as HTMLElement).click();
    await settle(fixture);
    expect(rows()).toEqual(['Inventory', '  Tooltips', '  Slots', 'Save game']);
    expect(row('Inventory').getAttribute('aria-expanded')).toBe('true');
    expect(row('Tooltips').getAttribute('aria-level')).toBe('2');
  });

  it('shows matching subtasks expanded beneath a dimmed parent (D09)', async () => {
    const { rows } = await renderList({ priorities: ['HIGH'] });
    expect(rows()).toEqual(['~Inventory', '  Slots']);

    const search = await renderList({ text: 'tool' });
    expect(search.rows()).toEqual(['~Inventory', '  Tooltips']);
  });

  it('distinguishes an empty project from an empty result', async () => {
    const none = await renderList({ text: 'nothing like this' });
    expect(none.root.querySelector('[data-testid="list-empty"] h2')?.textContent).toBe(
      'No matching tasks',
    );
    stub.tasks = [];
    const empty = await renderList();
    expect(empty.root.querySelector('[data-testid="list-empty"] h2')?.textContent).toBe('No tasks');
  });

  it('shows the chosen columns and reports changes in canonical order (D44)', async () => {
    const { fixture, root } = await renderList({}, ['priority', 'status']);
    const headers = () =>
      [...root.querySelectorAll('.header [role="columnheader"]')].map((h) => h.textContent?.trim());
    expect(headers()).toEqual(['Show subtasks', 'Key', 'Title', 'Status', 'Priority']);

    const changes: string[][] = [];
    fixture.componentInstance.columnsChange.subscribe((columns) => changes.push(columns));
    const option = root.querySelector<HTMLInputElement>(
      '[data-testid="list-columns-option"][data-value="type"]',
    ) as HTMLInputElement;
    option.click();
    expect(changes).toEqual([['type', 'status', 'priority']]);
  });

  it('navigates with the keyboard as a treegrid', async () => {
    const { fixture, root, row } = await renderList();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const grid = root.querySelector('[role="treegrid"]') as HTMLElement;
    const press = async (key: string) => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle(fixture);
    };
    const focused = () =>
      (document.activeElement as HTMLElement | null)?.querySelector('[data-testid="list-title"]')
        ?.textContent;

    row('Inventory').focus();
    await press('ArrowRight'); // expands
    expect(row('Inventory').getAttribute('aria-expanded')).toBe('true');
    await press('ArrowRight'); // moves into the children
    expect(focused()).toBe('Tooltips');
    await press('ArrowDown');
    expect(focused()).toBe('Slots');
    await press('ArrowLeft'); // back to the parent
    expect(focused()).toBe('Inventory');
    await press('ArrowLeft'); // collapses
    expect(row('Inventory').getAttribute('aria-expanded')).toBe('false');
    await press('End');
    expect(focused()).toBe('Save game');
    await press('Enter');
    expect(navigate).toHaveBeenCalledWith([
      '/projects',
      projectId,
      'tasks',
      stub.tasks.find((t) => t.title === 'Save game')?.id,
    ]);
  });
});
