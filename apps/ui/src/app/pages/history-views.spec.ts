// History outside the task page (D12, D45, D46) and the attachment size setting (D47).

import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ActivityEvent } from '@glacier-tasks/domain';
import { provideAppRouter } from '../app.routes';
import { ProjectsStore } from '../core/projects/projects-store';
import { SettingsStore } from '../core/settings/settings-store';
import { UsersStore } from '../core/users/users-store';
import type { GlacierApiStub } from '../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../testing/providers';

let stub: GlacierApiStub;
let projectId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
});

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

function event(n: number, overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: `event-${n}`,
    entityType: 'TASK',
    entityId: 'task-1',
    projectId,
    eventType: 'task.created',
    occurredAt: `2026-10-29T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
    source: 'UI',
    payload: { issueKey: 'GAME-1', title: 'Inventory', descriptionMarkdown: '' },
    ...overrides,
  };
}

const entries = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="activity-entry"]')].map((e) => e.textContent ?? '');

describe('project activity tab (PROJ-06, D45)', () => {
  it('lists project events newest first with task links and pages on demand', async () => {
    stub.events.push(
      event(1, {}),
      event(2, {
        entityType: 'LABEL',
        entityId: 'label-1',
        eventType: 'label.created',
        payload: { name: 'Bug', color: 'red' },
      }),
    );
    for (let n = 3; n <= 55; n++)
      stub.events.push(
        event(n, {
          eventType: 'task.updated',
          payload: { issueKey: 'GAME-1', title: 'Inventory', changes: {} },
        }),
      );
    stub.settings.lastView = 'activity';
    await TestBed.inject(SettingsStore).load();
    await TestBed.inject(ProjectsStore).load();
    const harness = await RouterTestingHarness.create(`/projects/${projectId}`);
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="filter-priority"]')).toBeNull();
    expect(entries(root)).toHaveLength(50);
    expect(entries(root)[0]).toContain('GAME-1 Inventory');
    expect(root.querySelector('[data-testid="activity-entry"] a')?.getAttribute('href')).toContain(
      `/projects/${projectId}/tasks/task-1`,
    );
    (root.querySelector('[data-testid="activity-more"]') as HTMLElement).click();
    await settle(harness);
    expect(entries(root)).toHaveLength(55);
    expect(entries(root).at(-2)).toContain('Label Bug');
    expect(root.querySelector('[data-testid="activity-more"]')).toBeNull();
  });
});

describe('profile history (D12, D46)', () => {
  it('shows the events of one profile in a dialog', async () => {
    await TestBed.inject(SettingsStore).load();
    const ann = await stub.api.users.create({ name: 'Ann' });
    stub.events.push(
      event(1, {
        entityType: 'USER',
        entityId: ann.id,
        projectId: null,
        eventType: 'user.created',
        payload: { name: 'Anne' },
      }),
      event(2, {
        entityType: 'USER',
        entityId: ann.id,
        projectId: null,
        eventType: 'user.updated',
        payload: { name: 'Ann', changes: { name: { from: 'Anne', to: 'Ann' } } },
      }),
    );
    await TestBed.inject(UsersStore).load();
    const harness = await RouterTestingHarness.create('/profiles');
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    (root.querySelector('[data-testid="profile-history"]') as HTMLElement).click();
    await settle(harness);
    const dialog = root.querySelector('[data-testid="profile-history-dialog"]') as HTMLElement;
    expect(entries(dialog)).toHaveLength(2);
    expect(entries(dialog)[0]).toContain('Name: Anne → Ann');
  });
});

describe('attachment size setting (D47)', () => {
  it('saves whole MiB values and rejects others', async () => {
    await TestBed.inject(SettingsStore).load();
    const harness = await RouterTestingHarness.create('/settings');
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    const input = root.querySelector('[data-testid="attachment-max"]') as HTMLInputElement;
    expect(input.value).toBe('100');

    input.value = '250';
    input.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(stub.settings.attachmentMaxMiB).toBe(250);

    input.value = '0';
    input.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(input.value).toBe('250');
    expect(stub.settings.attachmentMaxMiB).toBe(250);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('between 1 and 2048');
  });
});
