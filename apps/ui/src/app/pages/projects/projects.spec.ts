import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from '../../app';
import { provideAppRouter } from '../../app.routes';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';

let stub: GlacierApiStub;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  await TestBed.inject(SettingsStore).load();
});

function byTestId<T extends HTMLElement>(root: ParentNode, id: string): T {
  return root.querySelector(`[data-testid="${id}"]`) as T;
}

/** Lets chained IPC promises (create → reload → navigate) settle. */
async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('project creation (PROJ-01)', () => {
  async function openDialog() {
    await TestBed.inject(ProjectsStore).load();
    // The App fixture hosts both the routed page and the dialog (in the shell).
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/projects');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    byTestId(root, 'project-new').click();
    await fixture.whenStable();
    return { fixture, root };
  }

  it('suggests a key from the name and opens the new project', async () => {
    const { fixture, root } = await openDialog();
    type(byTestId(root, 'project-name'), 'Glacier Tasks');
    await fixture.whenStable();
    expect(byTestId<HTMLInputElement>(root, 'project-key').value).toBe('GT');

    byTestId(root, 'project-create-submit').click();
    await settle(fixture);

    expect(stub.projects.map((p) => [p.key, p.name])).toEqual([['GT', 'Glacier Tasks']]);
    expect(TestBed.inject(ProjectsStore).projects().length).toBe(1);
    expect(byTestId(root, 'project-title').textContent).toBe('Glacier Tasks');
    expect(root.querySelector('dialog')?.open).toBe(false);
  });

  it('validates the key format before calling the main process (D08)', async () => {
    const { fixture, root } = await openDialog();
    type(byTestId(root, 'project-name'), 'Alpha');
    type(byTestId(root, 'project-key'), '1a');
    await fixture.whenStable();
    expect(byTestId(root, 'project-key-error').textContent).toContain('uppercase letter');

    byTestId(root, 'project-create-submit').click();
    await fixture.whenStable();
    expect(stub.projects).toEqual([]);
  });

  it('shows a taken key next to the field', async () => {
    await stub.api.projects.create({ key: 'ALPHA', name: 'Existing' });
    const { fixture, root } = await openDialog();
    type(byTestId(root, 'project-name'), 'Alpha');
    type(byTestId(root, 'project-key'), 'alpha');
    byTestId(root, 'project-create-submit').click();
    await settle(fixture);

    expect(byTestId(root, 'project-key-error').textContent).toContain('already used');
    expect(stub.projects.length).toBe(1);
  });
});

describe('project settings (PROJ-03, D30)', () => {
  async function openSettings(keyLocked: boolean) {
    const project = await stub.api.projects.create({ key: 'ALPHA', name: 'Alpha' });
    (stub.projects[0] as { keyLocked: boolean }).keyLocked = keyLocked;
    await TestBed.inject(ProjectsStore).load();
    const harness = await RouterTestingHarness.create(`/projects/${project.id}/settings`);
    await harness.fixture.whenStable();
    return { harness, root: harness.routeNativeElement as HTMLElement };
  }

  it('saves changed fields and lists the default statuses', async () => {
    const { harness, root } = await openSettings(false);
    expect(byTestId(root, 'status-list').textContent).toContain('To Do');
    expect(byTestId(root, 'status-list').querySelectorAll('li').length).toBe(3);

    type(byTestId(root, 'settings-project-name'), 'Alpha Renamed');
    type(byTestId(root, 'settings-project-key'), 'alp');
    await harness.fixture.whenStable();
    byTestId(root, 'settings-save').click();
    await harness.fixture.whenStable();

    expect(stub.projects[0]).toMatchObject({ key: 'ALP', name: 'Alpha Renamed' });
    expect(byTestId(root, 'project-saved')).not.toBeNull();
  });

  it('disables the key once task ids were issued', async () => {
    const { root } = await openSettings(true);
    expect(byTestId<HTMLInputElement>(root, 'settings-project-key').disabled).toBe(true);
    expect(byTestId(root, 'settings-key-hint').textContent).toContain('already issued');
  });
});
