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
  {
    path: 'projects/:projectId',
    loadComponent: () => import('./pages/projects/project-page').then((m) => m.ProjectPage),
  },
  {
    path: 'projects/:projectId/tasks/:taskId',
    loadComponent: () => import('./pages/task/task-editor-page').then((m) => m.TaskEditorPage),
    canDeactivate: [
      (page: import('./pages/task/task-editor-page').TaskEditorPage) =>
        !page.dirty() || window.confirm(page.discardMessage()),
    ],
  },
  {
    path: 'projects/:projectId/settings',
    loadComponent: () =>
      import('./pages/projects/project-settings-page').then((m) => m.ProjectSettingsPage),
  },
  {
    path: 'search',
    loadComponent: () => import('./pages/search/search-page').then((m) => m.SearchPage),
  },
  {
    path: 'profiles',
    loadComponent: () => import('./pages/profiles/profiles-page').then((m) => m.ProfilesPage),
  },
  {
    path: 'trash',
    loadComponent: () => import('./pages/trash/trash-page').then((m) => m.TrashPage),
  },
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
