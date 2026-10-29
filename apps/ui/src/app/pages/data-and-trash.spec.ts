// M7 UI: trash filter and permanent deletion (D49, D50), the Data section (DATA-01..10, D13,
// D14) and the shell notices after a restore or a failed automatic backup.

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from '../app';
import { provideAppRouter } from '../app.routes';
import { ProjectsStore } from '../core/projects/projects-store';
import { SettingsStore } from '../core/settings/settings-store';
import type { GlacierApiStub } from '../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../testing/providers';

let stub: GlacierApiStub;
let game: string;
let sound: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  game = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  sound = (await stub.api.projects.create({ key: 'SND', name: 'Sound' })).id;
  for (const [projectId, title] of [
    [game, 'Inventory'],
    [game, 'Save game'],
    [sound, 'Music'],
  ] as const) {
    const task = await stub.api.tasks.create({ projectId, type: 'STORY', title });
    await stub.api.tasks.trash(task.id);
  }
  await TestBed.inject(SettingsStore).load();
  await TestBed.inject(ProjectsStore).load();
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

const byTestId = <T extends HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) as T;
const titles = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-trash-title]')].map((li) => li.getAttribute('data-trash-title'));
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('trash (TRASH-03/05, D49, D50)', () => {
  it('filters by project and links from the project page', async () => {
    const harness = await RouterTestingHarness.create(`/projects/${game}`);
    await settle(harness.fixture);
    const link = byTestId(harness.routeNativeElement as HTMLElement, 'project-trash-link');
    expect(link.textContent).toContain('Trash (2)');
    expect(link.getAttribute('href')).toContain(`/trash?project=${game}`);

    await harness.navigateByUrl(`/trash?project=${game}`);
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    expect(titles(root).sort()).toEqual(['Inventory', 'Save game']);
    const filter = byTestId<HTMLSelectElement>(root, 'trash-project-filter');
    filter.value = '';
    filter.dispatchEvent(new Event('change'));
    await settle(harness.fixture);
    expect(titles(harness.routeNativeElement as HTMLElement)).toHaveLength(3);
  });

  it('deletes permanently only after the key is typed', async () => {
    const harness = await RouterTestingHarness.create('/trash');
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    const row = root.querySelector('[data-trash-title="Music"]') as HTMLElement;
    byTestId(row, 'trash-purge').click();
    await settle(harness.fixture);

    const confirm = byTestId<HTMLButtonElement>(root, 'trash-confirm');
    expect(confirm.disabled).toBe(true);
    type(byTestId(root, 'trash-confirm-input'), 'SND-2');
    await settle(harness.fixture);
    expect(confirm.disabled).toBe(true);
    type(byTestId(root, 'trash-confirm-input'), 'snd-1');
    await settle(harness.fixture);
    confirm.click();
    await settle(harness.fixture);
    expect(titles(root).sort()).toEqual(['Inventory', 'Save game']);
    expect(stub.tasks.some((t) => t.title === 'Music')).toBe(false);
  });

  it('empties the filtered trash after typing the confirmation word', async () => {
    const harness = await RouterTestingHarness.create(`/trash?project=${game}`);
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    byTestId(root, 'trash-empty').click();
    await settle(harness.fixture);
    type(byTestId(root, 'trash-confirm-input'), ' DELETE ');
    await settle(harness.fixture);
    byTestId(root, 'trash-confirm').click();
    await settle(harness.fixture);
    expect(stub.tasks.map((t) => t.title)).toEqual(['Music']);
  });
});

describe('settings data section (DATA-01..10)', () => {
  async function openSettings() {
    const harness = await RouterTestingHarness.create('/settings');
    await settle(harness.fixture);
    return { harness, root: harness.routeNativeElement as HTMLElement };
  }

  it('creates a backup and reports the file', async () => {
    const { harness, root } = await openSettings();
    byTestId(root, 'data-backup').click();
    await settle(harness.fixture);
    expect(byTestId(root, 'data-notice').textContent).toContain(
      'glacier-tasks-2026-10-29.glaciertasks',
    );
    expect(byTestId(root, 'data-notice').textContent).toContain('3 MiB');
  });

  it('shows the validated backup and restores only after confirmation', async () => {
    stub.restorePreview = {
      token: '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10',
      fileName: 'old.glaciertasks',
      createdAt: '2026-10-01T10:00:00.000Z',
      appVersion: '0.9.0',
      schemaVersion: 1,
      counts: { projects: 2, users: 1, tasks: 7, attachments: 3, avatars: 1 },
    };
    const { harness, root } = await openSettings();
    byTestId(root, 'data-restore').click();
    await settle(harness.fixture);
    const preview = byTestId(root, 'restore-preview');
    expect(preview.textContent).toContain('old.glaciertasks');
    expect(preview.textContent).toContain(
      '2 projects, 7 tasks, 1 profiles, 3 attachments, 1 pictures',
    );
    expect(stub.restored).toEqual([]);
    byTestId(root, 'restore-confirm').click();
    await settle(harness.fixture);
    expect(stub.restored).toEqual([stub.restorePreview.token]);
    expect(byTestId(root, 'data-notice').textContent).toContain('Restarting');
  });

  it('exports JSON for one project with trashed items', async () => {
    const { harness, root } = await openSettings();
    const scope = byTestId<HTMLSelectElement>(root, 'export-scope');
    scope.value = game;
    scope.dispatchEvent(new Event('change'));
    byTestId(root, 'export-trashed').click();
    byTestId(root, 'data-export').click();
    await settle(harness.fixture);
    expect(stub.exports).toEqual([
      { scope: { kind: 'project', projectId: game }, includeTrashed: true },
    ]);
    expect(byTestId(root, 'data-notice').textContent).toContain('.export.json');
  });

  it('enables automatic backups only after a folder was chosen (D13)', async () => {
    const { harness, root } = await openSettings();
    expect(byTestId<HTMLInputElement>(root, 'auto-enabled').disabled).toBe(true);
    byTestId(root, 'auto-choose-folder').click();
    await settle(harness.fixture);
    expect(byTestId(root, 'auto-folder').textContent).toBe('D:/Backups');
    byTestId(root, 'auto-enabled').click();
    const retention = byTestId<HTMLInputElement>(root, 'auto-retention');
    retention.value = '3';
    retention.dispatchEvent(new Event('change'));
    await settle(harness.fixture);
    expect(stub.settings.autoBackup).toMatchObject({
      enabled: true,
      retention: 3,
      folder: 'D:/Backups',
    });
  });
});

describe('shell notices', () => {
  it('reports a finished restore and a failed automatic backup, each dismissible', async () => {
    stub.info = {
      ...stub.info,
      lastRestore: {
        restoredAt: '2026-10-29T10:00:00.000Z',
        schemaVersion: 2,
        safetyBackupFileName: 'pre-restore.glaciertasks',
      },
    };
    stub.settings.autoBackup.lastFailure = {
      at: '2026-10-29T09:00:00.000Z',
      messageKey: 'errors.autoBackupFolderUnavailable',
    };
    await TestBed.inject(SettingsStore).load();
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/projects');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(byTestId(root, 'notice-restored').textContent).toContain('pre-restore.glaciertasks');
    expect(byTestId(root, 'notice-auto-backup').textContent).toContain('failed');
    (byTestId(root, 'notice-restored').querySelector('button') as HTMLElement).click();
    await settle(fixture);
    expect(root.querySelector('[data-testid="notice-restored"]')).toBeNull();
  });

  it('reports a failed restore', async () => {
    stub.info = { ...stub.info, restoreFailed: true };
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/projects');
    await settle(fixture);
    expect(
      byTestId(fixture.nativeElement as HTMLElement, 'notice-restore-failed').textContent,
    ).toContain('previous data was kept');
  });
});
