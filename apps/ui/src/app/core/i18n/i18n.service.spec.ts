import { TestBed } from '@angular/core/testing';
import { provideApiStub } from '../../testing/providers';
import { SettingsStore } from '../settings/settings-store';
import { de } from './de';
import { en } from './en';
import { I18nService } from './i18n.service';

function setup() {
  const { stub, providers } = provideApiStub();
  TestBed.configureTestingModule({ providers });
  return { stub, i18n: TestBed.inject(I18nService), settings: TestBed.inject(SettingsStore) };
}

describe('I18nService (D15)', () => {
  it('has the same keys in English and German, all non-empty', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(en), ...Object.values(de)]) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('switches language reactively and updates <html lang>', async () => {
    const { i18n, settings } = setup();
    expect(i18n.t('nav.settings')).toBe('Settings');

    await settings.setLanguage('de');
    TestBed.tick();
    expect(i18n.t('nav.settings')).toBe('Einstellungen');
    expect(document.documentElement.lang).toBe('de');
  });

  it('formats dates for the selected language', async () => {
    const { i18n, settings } = setup();
    expect(i18n.formatLocalDate('2026-10-29')).toBe('Oct 29, 2026');
    await settings.setLanguage('de');
    expect(i18n.formatLocalDate('2026-10-29')).toBe('29.10.2026');
  });

  it('translates AppErrorInfo messages and falls back for unknown errors', () => {
    const { i18n } = setup();
    expect(i18n.errorMessage({ code: 'IO', message: 'errors.notAvailable' })).toBe(
      'This function is not available yet.',
    );
    expect(i18n.errorMessage({ code: 'IO', message: 'errors.somethingNew' })).toBe(
      en['errors.unexpected'],
    );
    expect(i18n.errorMessage(new Error('boom'))).toBe(en['errors.unexpected']);
  });
});
