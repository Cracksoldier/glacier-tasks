import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideAppRouter } from '../../app.routes';
import { SettingsStore } from '../../core/settings/settings-store';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';

let stub: GlacierApiStub;
let projectId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  await TestBed.inject(SettingsStore).load();
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
});

/** Lets chained IPC promises settle. */
async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

async function open(taskId: string) {
  const harness = await RouterTestingHarness.create(`/projects/${projectId}/tasks/${taskId}`);
  await settle(harness);
  const root = harness.routeNativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement>(id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as T;
  const type = (id: string, value: string) => {
    const field = byTestId<HTMLInputElement>(id);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  const change = (id: string, value: string) => {
    const field = byTestId<HTMLInputElement | HTMLSelectElement>(id);
    field.value = value;
    field.dispatchEvent(new Event('change'));
  };
  return { harness, root, byTestId, type, change };
}

describe('TaskEditorPage (TASK-03, TASK-08, TASK-10)', () => {
  it('saves only the changed fields with the loaded version', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' });
    const update = vi.spyOn(stub.api.tasks, 'update');
    const { harness, byTestId, type } = await open(story.id);

    expect(byTestId('task-issue-key').textContent).toBe('GAME-1');
    expect(byTestId<HTMLButtonElement>('task-save').disabled).toBe(true);
    type('task-title', 'Inventory v2');
    await settle(harness);
    byTestId('task-save').click();
    await settle(harness);

    expect(update).toHaveBeenCalledWith(story.id, 1, { title: 'Inventory v2' });
    expect(byTestId('task-saved')).not.toBeNull();
    expect(stub.tasks[0]).toMatchObject({ title: 'Inventory v2', version: 2 });
  });

  it('keeps the draft visible after a stale save and reloads on request (UJ-09)', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' });
    const { harness, byTestId, type, root } = await open(story.id);
    type('task-title', 'My title');
    type('task-description', 'My long text');
    // Someone else changes the task meanwhile.
    await stub.api.tasks.update(story.id, 1, { priority: 'HIGH' });
    await settle(harness);

    byTestId('task-save').click();
    await settle(harness);
    expect(byTestId('task-conflict')).not.toBeNull();
    expect(byTestId('task-draft').textContent).toContain('My long text');
    expect(stub.tasks[0]).toMatchObject({ title: 'Inventory', priority: 'HIGH' });

    byTestId('task-reload').click();
    await settle(harness);
    expect(byTestId<HTMLInputElement>('task-title').value).toBe('Inventory');
    expect(byTestId<HTMLSelectElement>('task-priority').value).toBe('HIGH');
    expect(byTestId('task-draft').textContent).toContain('My long text');
    expect(root.textContent).toContain('My title');
  });

  it('blocks saving an invalid date range', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Dates' });
    const { harness, byTestId, change } = await open(story.id);
    change('task-start', '2026-11-10');
    change('task-due', '2026-11-01');
    await settle(harness);
    expect(byTestId('date-error')).not.toBeNull();
    expect(byTestId<HTMLButtonElement>('task-save').disabled).toBe(true);
  });

  it('shows an archived assignee but never offers other archived profiles (I09)', async () => {
    const ann = await stub.api.users.create({ name: 'Ann' });
    const bob = await stub.api.users.create({ name: 'Bob' });
    const cleo = await stub.api.users.create({ name: 'Cleo' });
    const story = await stub.api.tasks.create({
      projectId,
      type: 'STORY',
      title: 'Assigned',
      assigneeUserId: ann.id,
    });
    await stub.api.users.archive(ann.id);
    await stub.api.users.archive(bob.id);
    const { byTestId } = await open(story.id);
    const options = [...byTestId<HTMLSelectElement>('task-assignee').options].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['Unassigned', 'Ann (Archived)', 'Cleo']);
    expect(cleo.archivedAt).toBeNull();
  });

  it('renders the Markdown preview without executing HTML', async () => {
    const story = await stub.api.tasks.create({
      projectId,
      type: 'STORY',
      title: 'Docs',
      descriptionMarkdown: '## Plan\n\n- [x] one\n\n<img src=x onerror="alert(1)">',
    });
    const { harness, byTestId } = await open(story.id);
    byTestId('tab-preview').click();
    await settle(harness);
    const preview = byTestId('task-preview');
    expect(preview.querySelector('h2')?.textContent).toBe('Plan');
    expect(preview.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(preview.querySelector('img')).toBeNull();
  });

  it('adds subtasks and changes their status immediately (TASK-08)', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Parent' });
    const { harness, byTestId, type, root } = await open(story.id);
    type('subtask-new-title', 'First step');
    await settle(harness);
    byTestId('subtask-add').click();
    await settle(harness);
    expect(byTestId('subtask-list').textContent).toContain('First step');
    expect(byTestId('subtask-progress').textContent).toBe('0/1');

    const select = root.querySelector('[data-testid="subtask-status"]') as HTMLSelectElement;
    select.value = `${projectId}-status-2`;
    select.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(stub.tasks.find((t) => t.title === 'First step')?.statusId).toBe(
      `${projectId}-status-2`,
    );
    // The parent's own status is untouched (TASK-05).
    expect(stub.tasks[0]?.statusId).toBe(`${projectId}-status-0`);
  });

  it('reports a failed quick status change and shows the real state again', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Parent' });
    await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Step',
    });
    const { harness, root } = await open(story.id);
    stub.api.tasks.update = () => Promise.reject({ code: 'CONFLICT', message: 'errors.staleTask' });
    const select = root.querySelector('[data-testid="subtask-status"]') as HTMLSelectElement;
    select.value = `${projectId}-status-2`;
    select.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(root.textContent).toContain('changed elsewhere');
    expect((root.querySelector('[data-testid="subtask-status"]') as HTMLSelectElement).value).toBe(
      `${projectId}-status-0`,
    );
  });

  it('moves a subtask to another story (D04)', async () => {
    const first = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'First' });
    const second = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Second' });
    const sub = await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: first.id,
      title: 'Step',
    });
    const { harness, byTestId, change } = await open(sub.id);
    expect(byTestId('parent-link').textContent).toContain('First');
    change('task-move-target', second.id);
    await settle(harness);
    byTestId('task-move').click();
    await settle(harness);
    expect(stub.tasks.find((t) => t.id === sub.id)?.parentStoryId).toBe(second.id);
    expect(byTestId('parent-link').textContent).toContain('Second');
  });
});
