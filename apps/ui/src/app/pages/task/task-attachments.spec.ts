import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideAppRouter } from '../../app.routes';
import { SettingsStore } from '../../core/settings/settings-store';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';

let stub: GlacierApiStub;
let projectId: string;
let storyId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  await TestBed.inject(SettingsStore).load();
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  storyId = (await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Inventory' })).id;
});

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

async function open() {
  const harness = await RouterTestingHarness.create(`/projects/${projectId}/tasks/${storyId}`);
  await settle(harness);
  const root = harness.routeNativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement>(id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as T;
  const all = (id: string) => [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const drop = async (...names: string[]) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    const files = names.map((name) => new File([new Uint8Array([1, 2, 3])], name));
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    byTestId('attachment-drop').dispatchEvent(event);
    await settle(harness);
  };
  const history = () => all('activity-entry').map((entry) => entry.textContent ?? '');
  return { harness, root, byTestId, all, drop, history };
}

describe('task attachments (FILE-01..05, D03, D10)', () => {
  it('adds dropped files as bytes and records them in the history', async () => {
    const addFiles = vi.spyOn(stub.api.attachments, 'addFiles');
    const { all, drop, history } = await open();
    await drop('shot.png', 'notes.txt');

    expect(addFiles).toHaveBeenCalledWith(storyId, [
      { name: 'shot.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'notes.txt', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(all('attachment-item').map((item) => item.dataset['name'])).toEqual([
      'notes.txt',
      'shot.png',
    ]);
    expect(all('attachment-preview')).toHaveLength(1);
    expect(history()[0]).toContain('Attachment added: notes.txt');
  });

  it('confirms before opening a file without preview and before removing (T11, D03)', async () => {
    const { harness, byTestId, all, drop, history } = await open();
    await drop('notes.txt');

    byTestId('attachment-open').click();
    await settle(harness);
    expect(stub.opened).toEqual([]);
    byTestId('attachment-open-confirm').click();
    await settle(harness);
    expect(stub.opened).toHaveLength(1);

    byTestId('attachment-remove').click();
    await settle(harness);
    expect(all('attachment-item')).toHaveLength(1);
    byTestId('attachment-remove-confirm').click();
    await settle(harness);
    expect(all('attachment-item')).toHaveLength(0);
    expect(history()[0]).toContain('Attachment removed: notes.txt');
  });

  it('inserts an image reference that the preview renders inline (D10)', async () => {
    const { harness, root, byTestId, drop } = await open();
    await drop('shot.png');
    const id = stub.attachments[0]?.id;

    byTestId('attachment-insert').click();
    await settle(harness);
    expect(byTestId<HTMLTextAreaElement>('task-description').value).toBe(
      `![shot.png](attachment:${id})\n`,
    );
    expect(byTestId<HTMLButtonElement>('task-save').disabled).toBe(false);

    byTestId('tab-preview').click();
    await settle(harness);
    const image = root.querySelector('[data-testid="task-preview"] img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(`glacier-media://attachment/${id}`);
  });

  it('reports a file over the size limit', async () => {
    stub.settings.attachmentMaxMiB = 0;
    const { byTestId, all, drop } = await open();
    await drop('big.bin');
    expect(byTestId('attachment-error').textContent).toContain('larger than the maximum size');
    expect(all('attachment-item')).toHaveLength(0);
  });
});

describe('description versions (AUDIT-04, D11)', () => {
  it('shows a version rendered, as source and compared with the one before', async () => {
    const event = (id: string, eventType: string, payload: Record<string, unknown>) => ({
      id,
      entityType: 'TASK' as const,
      entityId: storyId,
      projectId,
      eventType,
      occurredAt: `2026-10-29T10:00:0${id.length}.000Z`,
      source: 'UI' as const,
      payload: { issueKey: 'GAME-1', title: 'Inventory', ...payload },
    });
    stub.events.push(
      event('a', 'task.created', { descriptionMarkdown: 'line one\nline two' }),
      event('bb', 'task.updated', { changes: { descriptionMarkdown: { to: 'line one\nline 2' } } }),
    );
    const { harness, root, byTestId, all } = await open();

    expect(all('activity-versions')).toHaveLength(2);
    all('activity-versions')[0]?.click();
    await settle(harness);
    expect(all('version-item')).toHaveLength(2);
    expect(byTestId('version-rendered').textContent).toContain('line 2');

    byTestId('version-mode-source').click();
    await settle(harness);
    expect(byTestId('version-source').textContent).toBe('line one\nline 2');

    byTestId('version-mode-compare').click();
    await settle(harness);
    const lines = [...root.querySelectorAll('[data-testid="version-diff"] .diff-line')].map(
      (line) => `${(line as HTMLElement).dataset['kind']}:${line.lastElementChild?.textContent}`,
    );
    expect(lines).toEqual(['same:line one', 'removed:line two', 'added:line 2']);
  });
});
