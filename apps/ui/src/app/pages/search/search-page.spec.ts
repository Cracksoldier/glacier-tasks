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
let gameId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  Element.prototype.scrollTo ??= () => undefined;
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: [...setup.providers, provideAppRouter()] });
  gameId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  const soundId = (await stub.api.projects.create({ key: 'SND', name: 'Sound' })).id;
  await stub.api.tasks.create({ projectId: gameId, type: 'STORY', title: 'Main menu' });
  await stub.api.tasks.create({ projectId: soundId, type: 'STORY', title: 'Menu music' });
  stub.settings.lastProjectId = gameId;
  await TestBed.inject(SettingsStore).load();
  await TestBed.inject(ProjectsStore).load();
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

const byTestId = <T extends HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) as T | null;

async function search(
  root: HTMLElement,
  fixture: { whenStable(): Promise<unknown> },
  text: string,
) {
  const input = byTestId<HTMLInputElement>(root, 'filter-text') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await settle(fixture);
}

const titles = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="list-title"]')].map((a) => a.textContent);

describe('SearchPage (SEARCH-01..04, D41)', () => {
  it('searches the last project by default and all projects on request', async () => {
    const harness = await RouterTestingHarness.create('/search');
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    expect(byTestId(root, 'search-prompt')).not.toBeNull();
    expect(byTestId<HTMLInputElement>(root, 'search-scope-project')?.checked).toBe(true);

    await search(root, harness.fixture, 'menu');
    expect(titles(root)).toEqual(['Main menu']);
    expect(TestBed.inject(Router).url).toBe('/search?q=menu');

    byTestId<HTMLInputElement>(root, 'search-scope-all')?.click();
    await settle(harness.fixture);
    expect(titles(root).sort()).toEqual(['Main menu', 'Menu music']);
    expect(root.textContent).toContain('Sound'); // project column
    expect(byTestId(root, 'filter-category')).not.toBeNull();
    expect(byTestId(root, 'filter-status')).toBeNull();
    expect(byTestId(root, 'filter-label')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/search?q=menu&scope=all');
  });

  it('restores text and scope from the URL', async () => {
    const harness = await RouterTestingHarness.create('/search?q=music&scope=all');
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    expect(byTestId<HTMLInputElement>(root, 'filter-text')?.value).toBe('music');
    expect(titles(root)).toEqual(['Menu music']);
  });

  it('opens search with Ctrl+F from anywhere', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/projects');
    await settle(fixture);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    await settle(fixture);
    expect(router.url).toBe('/search');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('filter-text');
  });
});
