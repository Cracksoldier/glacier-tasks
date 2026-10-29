import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideAppRouter } from './app.routes';
import { I18nService } from './core/i18n/i18n.service';
import { ProjectsStore } from './core/projects/projects-store';
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
      const projects = inject(ProjectsStore);
      inject(I18nService);
      await settings.load();
      theme.enableTransitions();
      // The start page and the sidebar need the project list; a failure leaves it empty.
      await projects.load().catch((error: unknown) => console.error(error));
    }),
  ],
};
