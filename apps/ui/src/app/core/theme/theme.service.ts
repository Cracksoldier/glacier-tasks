import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SettingsStore } from '../settings/settings-store';

export type ResolvedTheme = 'dark' | 'light';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies `.theme-dark` / `.theme-light` to <html> (UX-01). "Follow System" tracks the OS
 * setting live; main mirrors the choice to nativeTheme, so prefers-color-scheme matches it.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(SettingsStore);
  private readonly document = inject(DOCUMENT);
  private readonly systemPrefersDark = signal(true);

  readonly resolved = computed<ResolvedTheme>(() => {
    const theme = this.settings.theme();
    if (theme === 'system') return this.systemPrefersDark() ? 'dark' : 'light';
    return theme;
  });

  constructor() {
    const view = this.document.defaultView;
    const query = view?.matchMedia?.(DARK_QUERY);
    if (query) {
      this.systemPrefersDark.set(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.systemPrefersDark.set(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }

    effect(() => {
      const root = this.document.documentElement;
      const resolved = this.resolved();
      root.classList.toggle('theme-dark', resolved === 'dark');
      root.classList.toggle('theme-light', resolved === 'light');
    });
  }

  /**
   * Turns on theme-switch transitions once the stored theme has been applied and painted,
   * so the first paint never animates from the default theme. Called after settings load.
   */
  enableTransitions(): void {
    const view = this.document.defaultView;
    const root = this.document.documentElement;
    if (!view?.requestAnimationFrame) {
      root.classList.add('theme-ready');
      return;
    }
    view.requestAnimationFrame(() =>
      view.requestAnimationFrame(() => root.classList.add('theme-ready')),
    );
  }
}
