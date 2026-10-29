import { TestBed } from '@angular/core/testing';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { SettingsStore } from '../../core/settings/settings-store';
import { SettingsPage } from './settings-page';

async function render(initial = {}) {
  new FakeColorScheme(true).install();
  const { stub, providers } = provideApiStub(initial);
  TestBed.configureTestingModule({ imports: [SettingsPage], providers });
  await TestBed.inject(SettingsStore).load();
  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const query = <T extends HTMLElement>(testId: string) =>
    element.querySelector(`[data-testid="${testId}"]`) as T;
  return { fixture, stub, element, query };
}

describe('SettingsPage', () => {
  it('shows the current theme and language as checked radios', async () => {
    const { query } = await render({ theme: 'system', language: 'de' });
    expect(query<HTMLInputElement>('theme-system').checked).toBe(true);
    expect(query<HTMLInputElement>('language-de').checked).toBe(true);
    expect(query<HTMLInputElement>('theme-dark').checked).toBe(false);
  });

  it('saves a new theme and language via the API', async () => {
    const { fixture, stub, query, element } = await render();
    query<HTMLInputElement>('theme-light').click();
    query<HTMLInputElement>('language-de').click();
    await fixture.whenStable();

    expect(stub.updates).toEqual([{ theme: 'light' }, { language: 'de' }]);
    expect(element.querySelector('h1')?.textContent).toBe('Einstellungen');
  });

  it('shows the app version from the main process', async () => {
    const { fixture, query } = await render();
    await fixture.whenStable();
    expect(query('app-version').textContent).toBe('1.2.3');
  });

  it('reports a failed save and keeps the previous selection', async () => {
    const { fixture, stub, query, element } = await render();
    stub.failNextUpdate = { code: 'IO', message: 'errors.unexpected' };
    query<HTMLInputElement>('theme-light').click();
    await fixture.whenStable();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
    expect(query<HTMLInputElement>('theme-dark').checked).toBe(true);
  });
});
