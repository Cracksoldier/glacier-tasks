import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import { ATTACHMENT_MAX_MIB_LIMIT, type Language, type Theme } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { loaded } from '../../core/api/loaded';
import { I18nService, type TranslationKey } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings-store';
import { DataSection } from './data-section';

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
  imports: [DataSection],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  /** Resource values without the error-state throw (see core/api/loaded). */
  protected readonly loaded = loaded;
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

  protected readonly attachmentMaxLimit = ATTACHMENT_MAX_MIB_LIMIT;

  /** D47: whole MiB within 1–2048; anything else shows the current value again. */
  protected async setAttachmentMax(input: HTMLInputElement): Promise<void> {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > ATTACHMENT_MAX_MIB_LIMIT) {
      input.value = String(this.settings.attachmentMaxMiB());
      this.error.set(
        this.i18n.t('settings.attachmentMaxInvalid', { max: ATTACHMENT_MAX_MIB_LIMIT }),
      );
      return;
    }
    this.error.set(null);
    try {
      await this.settings.setAttachmentMaxMiB(value);
    } catch {
      input.value = String(this.settings.attachmentMaxMiB());
      this.error.set(this.i18n.t('settings.saveFailed'));
    }
  }

  /** D52: native date fields switch language only with a restart. */
  protected async restart(): Promise<void> {
    await this.api.app.restart().catch(() => this.error.set(this.i18n.t('settings.saveFailed')));
  }

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
