import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import { type Language, type Theme } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService, type TranslationKey } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings-store';

interface Choice<T> {
  value: T;
  label: TranslationKey | null;
  /** Language names are shown in their own language, untranslated. */
  nativeLabel?: string;
  icon?: string;
}

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsStore);
  private readonly api = inject(GLACIER_API);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly error = signal<string | null>(null);
  protected readonly info = resource({ loader: () => this.api.app.info() });

  protected readonly themes: Choice<Theme>[] = [
    { value: 'light', label: 'settings.theme.light', icon: 'fa-sun' },
    { value: 'dark', label: 'settings.theme.dark', icon: 'fa-moon' },
    { value: 'system', label: 'settings.theme.system', icon: 'fa-circle-half-stroke' },
  ];
  protected readonly languages: Choice<Language>[] = [
    { value: 'en', label: null, nativeLabel: 'English' },
    { value: 'de', label: null, nativeLabel: 'Deutsch' },
  ];

  protected async selectTheme(theme: Theme): Promise<void> {
    await this.save('theme', () => this.settings.setTheme(theme), this.settings.theme);
  }

  protected async selectLanguage(language: Language): Promise<void> {
    await this.save('language', () => this.settings.setLanguage(language), this.settings.language);
  }

  private async save(group: string, action: () => Promise<void>, current: () => string) {
    this.error.set(null);
    try {
      await action();
    } catch {
      this.error.set(this.i18n.t('settings.saveFailed'));
      // The browser already moved the radio selection; the [checked] bindings did not change
      // (the store rolled back to the old value), so restore the DOM state explicitly.
      const radios = this.host.nativeElement.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${group}"]`,
      );
      for (const radio of radios) radio.checked = radio.value === current();
    }
  }
}
