import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable } from '@angular/core';
import { isAppErrorInfo } from '@glacier-tasks/domain';
import { SettingsStore } from '../settings/settings-store';
import { de } from './de';
import { en, type TranslationKey } from './en';

export type { TranslationKey };

const LOCALES = { en: 'en-US', de: 'de-DE' } as const;

/** Signal-based translations (Glacier Notes pattern): templates re-render on language change. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(SettingsStore);
  private readonly document = inject(DOCUMENT);

  private readonly table = computed<Record<TranslationKey, string>>(() =>
    this.settings.language() === 'de' ? de : en,
  );
  readonly locale = computed(() => LOCALES[this.settings.language()]);

  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.settings.language();
    });
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    let text: string = this.table()[key] ?? en[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  /** Translates an AppErrorInfo message key, falling back to a generic message. */
  errorMessage(error: unknown): string {
    if (isAppErrorInfo(error) && error.message in en) {
      return this.t(error.message as TranslationKey);
    }
    return this.t('errors.unexpected');
  }

  /** Formats a UTC timestamp for the selected UI language (D15). */
  formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat(this.locale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  /** Formats a local `YYYY-MM-DD` date without shifting it through time zones. */
  formatLocalDate(date: string): string {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    return new Intl.DateTimeFormat(this.locale(), { dateStyle: 'medium' }).format(
      new Date(year, month - 1, day),
    );
  }
}
