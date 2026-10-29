import { APP_BASE_HREF } from '@angular/common';
import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  provideRouter,
  type Routes,
  withComponentInputBinding,
  withHashLocation,
} from '@angular/router';
import { PlaceholderPage } from './pages/placeholder-page';

// Hash-based routes (D36) so deep links work when the renderer is loaded from file://.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  {
    path: 'projects',
    component: PlaceholderPage,
    data: {
      titleKey: 'projects.title',
      emptyTitleKey: 'projects.emptyTitle',
      bodyKey: 'projects.emptyBody',
    },
  },
  { path: 'profiles', component: PlaceholderPage, data: { titleKey: 'profiles.title' } },
  { path: 'trash', component: PlaceholderPage, data: { titleKey: 'trash.title' } },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: 'projects' },
];

/**
 * Router setup shared by the app and its tests. index.html deliberately has no <base> element
 * and the base href is empty: hash URLs must stay on index.html (file:///…/index.html#/settings).
 * A <base href="./"> would resolve them to the renderer directory, which neither reloads nor
 * passes the IPC sender check.
 */
export function provideAppRouter(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: APP_BASE_HREF, useValue: '' },
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
  ]);
}
