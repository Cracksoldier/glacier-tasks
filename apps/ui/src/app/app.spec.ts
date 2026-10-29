import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { provideAppRouter } from './app.routes';
import { SettingsStore } from './core/settings/settings-store';
import { FakeColorScheme, provideApiStub } from './testing/providers';

describe('App shell', () => {
  beforeEach(async () => {
    new FakeColorScheme(true).install();
    const { providers } = provideApiStub();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [...providers, provideAppRouter()],
    });
    await TestBed.inject(SettingsStore).load();
  });

  it('renders the navigation with translated labels', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const labels = [...element.querySelectorAll('.nav-link span')].map((n) => n.textContent);
    expect(labels).toEqual(['Projects', 'Profiles', 'Trash', 'Settings']);
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
  });

  it('opens the projects page by default and marks it as current', async () => {
    const harness = await RouterTestingHarness.create('/');
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Projects');
    expect(element.textContent).toContain('No projects yet');
  });

  it('redirects unknown routes to projects', async () => {
    const harness = await RouterTestingHarness.create('/does-not-exist');
    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Projects',
    );
  });
});
