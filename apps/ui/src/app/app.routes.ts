import { APP_BASE_HREF } from '@angular/common';
import { type EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import {
  type CanActivateFn,
  provideRouter,
  Router,
  type Routes,
  withComponentInputBinding,
  withHashLocation,
} from '@angular/router';
import { ProjectsStore } from './core/projects/projects-store';
import { SettingsStore } from './core/settings/settings-store';
import { PlaceholderPage } from './pages/placeholder-page';
import { ProjectPage } from './pages/projects/project-page';
import { ProjectsPage } from './pages/projects/projects-page';

/** Start page: the last opened project if it still exists, otherwise the dashboard (PROJ-02). */
export const startPage: CanActivateFn = () => {
  const lastProjectId = inject(SettingsStore).lastProjectId();
  const project = inject(ProjectsStore).find(lastProjectId);
  return inject(Router).createUrlTree(project ? ['/projects', project.id] : ['/projects']);
};

// Hash-based routes (D36) so deep links work when the renderer is loaded from file://.
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [startPage], children: [] },
  { path: 'projects', component: ProjectsPage },
  { path: 'projects/:projectId', component: ProjectPage },
  {
    path: 'projects/:projectId/settings',
    loadComponent: () =>
      import('./pages/projects/project-settings-page').then((m) => m.ProjectSettingsPage),
  },
  {
    path: 'profiles',
    loadComponent: () => import('./pages/profiles/profiles-page').then((m) => m.ProfilesPage),
  },
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
