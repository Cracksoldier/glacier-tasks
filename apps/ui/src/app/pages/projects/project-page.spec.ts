import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { DeviceSettings } from '@glacier-tasks/domain';
import { provideAppRouter } from '../../app.routes';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { DEFAULT_PROJECT_VIEW } from '../../core/tasks/project-view';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';

let stub: GlacierApiStub;
let projectId: string;

async function setup(settings: Partial<DeviceSettings> = {}) {
  new FakeColorScheme(true).install();
  Element.prototype.scrollTo ??= () => undefined;
  const provided = provideApiStub(settings);
  stub = provided.stub;
  TestBed.configureTestingModule({ providers: [...provided.providers, provideAppRouter()] });
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Boss fight', priority: 'HIGH' });
  await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Credits', priority: 'LOW' });
}

async function open(settings: Partial<DeviceSettings> = {}) {
  Object.assign(stub.settings, settings);
  await TestBed.inject(SettingsStore).load();
  await TestBed.inject(ProjectsStore).load();
  const harness = await RouterTestingHarness.create(`/projects/${projectId}`);
  await settle(harness.fixture);
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

const byTestId = <T extends HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) as T | null;

describe('project list view (LIST-01..04, D42)', () => {
  it('filters and sorts the list and remembers both per project', async () => {
    await setup({ lastView: 'list' });
    const { harness, root } = await open();
    const titles = () =>
      [...root.querySelectorAll('[data-testid="list-title"]')].map((a) => a.textContent);
    expect(titles()).toEqual(['Boss fight', 'Credits']);

    (
      root.querySelector(
        '[data-testid="filter-priority-option"][data-value="LOW"]',
      ) as HTMLInputElement
    ).click();
    await settle(harness.fixture);
    expect(titles()).toEqual(['Credits']);
    expect(stub.settings.projectViews[projectId]?.filters.priorities).toEqual(['LOW']);

    byTestId<HTMLButtonElement>(root, 'filter-clear')?.click();
    const sort = byTestId<HTMLSelectElement>(root, 'sort-by') as HTMLSelectElement;
    sort.value = 'title';
    sort.dispatchEvent(new Event('change'));
    await settle(harness.fixture);
    byTestId<HTMLButtonElement>(root, 'sort-direction')?.click();
    await settle(harness.fixture);
    expect(titles()).toEqual(['Credits', 'Boss fight']);
    expect(stub.settings.projectViews[projectId]).toMatchObject({
      sortBy: 'title',
      sortDirection: 'desc',
      filters: { priorities: [] },
    });
    // Relevance needs search text and is offered on the search page only.
    expect([...sort.options].map((o) => o.value)).not.toContain('relevance');
  });

  it('keeps the search text out of the remembered view', async () => {
    await setup({ lastView: 'list' });
    const { harness, root } = await open();
    const input = byTestId<HTMLInputElement>(root, 'filter-text') as HTMLInputElement;
    input.value = 'boss';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(harness.fixture);
    expect(
      [...root.querySelectorAll('[data-testid="list-title"]')].map((a) => a.textContent),
    ).toEqual(['Boss fight']);
    expect(stub.settings.projectViews[projectId]).toBeUndefined();
  });
});

describe('board filters (BOARD-06, D43)', () => {
  it('applies the shared filters to story cards and hides list-only controls', async () => {
    await setup();
    const { root } = await open({
      projectViews: {
        [projectId]: {
          ...DEFAULT_PROJECT_VIEW,
          filters: { ...DEFAULT_PROJECT_VIEW.filters, priorities: ['HIGH'] },
        },
      },
    });
    expect(
      [...root.querySelectorAll('[data-testid="card-title"]')].map((a) => a.textContent),
    ).toEqual(['Boss fight']);
    for (const id of ['filter-text', 'filter-status', 'filter-type', 'sort-by']) {
      expect(byTestId(root, id), id).toBeNull();
    }
    expect(byTestId(root, 'filter-priority')).not.toBeNull();
  });
});
