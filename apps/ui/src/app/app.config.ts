import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideAppRouter } from './app.routes';
import { I18nService } from './core/i18n/i18n.service';
import { SettingsStore } from './core/settings/settings-store';
import { ThemeService } from './core/theme/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppRouter(),
    // Load device settings before the first render so the theme never flashes (D18).
    provideAppInitializer(async () => {
      const settings = inject(SettingsStore);
      const theme = inject(ThemeService);
      inject(I18nService);
      await settings.load();
      theme.enableTransitions();
    }),
  ],
};
