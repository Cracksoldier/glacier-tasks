import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';
import { ProjectsStore } from '../core/projects/projects-store';
import { ProjectCreateDialog } from '../pages/projects/project-create-dialog';

interface NavItem {
  path: string;
  label: TranslationKey;
  icon: string;
  /** Only highlight on the exact path (the dashboard, not every project below it). */
  exact?: boolean;
  testId: string;
}

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectCreateDialog, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly i18n = inject(I18nService);
  protected readonly projects = inject(ProjectsStore);

  protected readonly primaryNav: NavItem[] = [
    {
      path: '/projects',
      label: 'nav.projects',
      icon: 'fa-diagram-project',
      exact: true,
      testId: 'nav-projects',
    },
    { path: '/profiles', label: 'nav.profiles', icon: 'fa-users', testId: 'nav-profiles' },
    { path: '/trash', label: 'nav.trash', icon: 'fa-trash-can', testId: 'nav-trash' },
  ];
  protected readonly settingsNav: NavItem = {
    path: '/settings',
    label: 'nav.settings',
    icon: 'fa-gear',
    testId: 'nav-settings',
  };
}
