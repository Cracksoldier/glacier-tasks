import { inject, Injectable, signal, type WritableSignal } from '@angular/core';
import { DEFAULT_THEME, type Language, type Theme } from '@glacier-tasks/domain';
import { GLACIER_API } from '../api/glacier-api';

/** Device settings held as signals; writes go through IPC and roll back on failure. */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(GLACIER_API);

  readonly theme = signal<Theme>(DEFAULT_THEME);
  readonly language = signal<Language>('en');
  /** Last opened project (PROJ-02); validated by the main process on write. */
  readonly lastProjectId = signal<string | null>(null);

  async load(): Promise<void> {
    const settings = await this.api.settings.getDevice();
    this.theme.set(settings.theme);
    this.language.set(settings.language);
    this.lastProjectId.set(settings.lastProjectId);
  }

  setTheme(theme: Theme): Promise<void> {
    return this.optimistic(this.theme, theme, () => this.api.settings.updateDevice({ theme }));
  }

  setLanguage(language: Language): Promise<void> {
    return this.optimistic(this.language, language, () =>
      this.api.settings.updateDevice({ language }),
    );
  }

  setLastProject(lastProjectId: string | null): Promise<void> {
    if (this.lastProjectId() === lastProjectId) return Promise.resolve();
    return this.optimistic(this.lastProjectId, lastProjectId, () =>
      this.api.settings.updateDevice({ lastProjectId }),
    );
  }

  private async optimistic<T>(
    target: WritableSignal<T>,
    value: T,
    persist: () => Promise<unknown>,
  ): Promise<void> {
    const previous = target();
    target.set(value);
    try {
      await persist();
    } catch (error) {
      target.set(previous);
      throw error;
    }
  }
}
