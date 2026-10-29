import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { DeviceSettings } from '@glacier-tasks/domain';
import { App } from './app';
import { provideAppRouter } from './app.routes';
import { ProjectsStore } from './core/projects/projects-store';
import { SettingsStore } from './core/settings/settings-store';
import type { GlacierApiStub } from './testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from './testing/providers';

async function setup(
  seed: (stub: GlacierApiStub) => Promise<void> = async () => undefined,
  settings: Partial<DeviceSettings> = {},
): Promise<GlacierApiStub> {
  new FakeColorScheme(true).install();
  const { stub, providers } = provideApiStub(settings);
  await seed(stub);
  TestBed.configureTestingModule({
    imports: [App],
    providers: [...providers, provideAppRouter()],
  });
  await TestBed.inject(SettingsStore).load();
  await TestBed.inject(ProjectsStore).load();
  return stub;
}

describe('App shell', () => {
  it('renders the navigation with translated labels', async () => {
    await setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const labels = [...element.querySelectorAll('.nav-link span')].map((n) => n.textContent);
    expect(labels).toEqual(['Projects', 'Profiles', 'Trash', 'Settings']);
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
    expect(element.textContent).toContain('No projects yet');
  });

  it('opens the empty projects dashboard by default', async () => {
    await setup();
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Projects');
    expect(element.textContent).toContain('No projects yet');
  });

  it('redirects unknown routes to projects', async () => {
    await setup();
    const harness = await RouterTestingHarness.create('/does-not-exist');
    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Projects',
    );
  });

  it('lists projects in the sidebar switcher', async () => {
    await setup(async (stub) => {
      await stub.api.projects.create({ key: 'BETA', name: 'Beta' });
      await stub.api.projects.create({ key: 'ALPHA', name: 'Alpha' });
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const keys = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-project-key]'),
    ].map((link) => link.getAttribute('data-project-key'));
    expect(keys).toEqual(['ALPHA', 'BETA']);
  });
});

describe('start page (PROJ-02)', () => {
  it('opens the last project and remembers it', async () => {
    let betaId = '';
    const stub = await setup(async (stub) => {
      await stub.api.projects.create({ key: 'ALPHA', name: 'Alpha' });
      betaId = (await stub.api.projects.create({ key: 'BETA', name: 'Beta' })).id;
      stub.settings.lastProjectId = betaId;
    });
    const harness = await RouterTestingHarness.create('/');
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="project-title"]')?.textContent).toBe('Beta');
    // Already the last project: no redundant write.
    expect(stub.updates).toEqual([]);
  });

  it('stores the project when it is opened', async () => {
    let alphaId = '';
    const stub = await setup(async (stub) => {
      alphaId = (await stub.api.projects.create({ key: 'ALPHA', name: 'Alpha' })).id;
    });
    const harness = await RouterTestingHarness.create(`/projects/${alphaId}`);
    await harness.fixture.whenStable();
    expect(stub.updates).toEqual([{ lastProjectId: alphaId }]);
  });

  it('falls back to the dashboard for a stale last project', async () => {
    const stale = '00000000-0000-4000-8000-0000000000ff';
    await setup(async () => undefined, { lastProjectId: stale });
    const harness = await RouterTestingHarness.create('/');
    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Projects',
    );
  });

  it('leaves an unknown project page and clears it as last project', async () => {
    const stale = '00000000-0000-4000-8000-0000000000ff';
    const stub = await setup(async () => undefined, { lastProjectId: stale });
    const harness = await RouterTestingHarness.create(`/projects/${stale}`);
    await harness.fixture.whenStable();
    expect(TestBed.inject(SettingsStore).lastProjectId()).toBeNull();
    expect(stub.updates).toEqual([{ lastProjectId: null }]);
    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Projects',
    );
  });
});
