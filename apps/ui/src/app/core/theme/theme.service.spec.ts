import { TestBed } from '@angular/core/testing';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { SettingsStore } from '../settings/settings-store';
import { ThemeService } from './theme.service';

function setup(systemDark: boolean) {
  const scheme = new FakeColorScheme(systemDark);
  scheme.install();
  const { stub, providers } = provideApiStub();
  TestBed.configureTestingModule({ providers });
  const theme = TestBed.inject(ThemeService);
  const settings = TestBed.inject(SettingsStore);
  TestBed.tick();
  return { scheme, stub, theme, settings };
}

const rootClasses = () => document.documentElement.classList;

describe('ThemeService (UX-01)', () => {
  it('defaults to dark (D18)', () => {
    const { theme } = setup(false);
    expect(theme.resolved()).toBe('dark');
    expect(rootClasses().contains('theme-dark')).toBe(true);
    expect(rootClasses().contains('theme-light')).toBe(false);
  });

  it('applies an explicit light theme and persists it', async () => {
    const { theme, settings, stub } = setup(true);
    await settings.setTheme('light');
    TestBed.tick();
    expect(theme.resolved()).toBe('light');
    expect(rootClasses().contains('theme-light')).toBe(true);
    expect(stub.updates).toEqual([{ theme: 'light' }]);
  });

  it('follows the operating system live when set to system', async () => {
    const { theme, settings, scheme } = setup(false);
    await settings.setTheme('system');
    TestBed.tick();
    expect(theme.resolved()).toBe('light');

    scheme.set(true);
    TestBed.tick();
    expect(theme.resolved()).toBe('dark');
    expect(rootClasses().contains('theme-dark')).toBe(true);
  });

  it('rolls back when saving fails', async () => {
    const { theme, settings, stub } = setup(true);
    stub.failNextUpdate = { code: 'IO', message: 'errors.unexpected' };
    await expect(settings.setTheme('light')).rejects.toMatchObject({ code: 'IO' });
    TestBed.tick();
    expect(theme.resolved()).toBe('dark');
  });
});
