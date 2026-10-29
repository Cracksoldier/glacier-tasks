import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';
import { ProjectsStore } from '../core/projects/projects-store';
import { SearchShortcut } from '../core/tasks/search-shortcut';
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
  host: { '(document:keydown.control.f)': 'openSearch($event)' },
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly i18n = inject(I18nService);
  protected readonly projects = inject(ProjectsStore);
  private readonly router = inject(Router);
  private readonly searchShortcut = inject(SearchShortcut);

  protected readonly primaryNav: NavItem[] = [
    {
      path: '/projects',
      label: 'nav.projects',
      icon: 'fa-diagram-project',
      exact: true,
      testId: 'nav-projects',
    },
    { path: '/search', label: 'nav.search', icon: 'fa-magnifying-glass', testId: 'nav-search' },
    { path: '/profiles', label: 'nav.profiles', icon: 'fa-users', testId: 'nav-profiles' },
    { path: '/trash', label: 'nav.trash', icon: 'fa-trash-can', testId: 'nav-trash' },
  ];
  protected readonly settingsNav: NavItem = {
    path: '/settings',
    label: 'nav.settings',
    icon: 'fa-gear',
    testId: 'nav-settings',
  };

  /** Ctrl+F opens search (D41), or focuses its field when it is already open. */
  protected openSearch(event: Event): void {
    event.preventDefault();
    if (!this.router.url.startsWith('/search')) void this.router.navigate(['/search']);
    this.searchShortcut.requestFocus();
  }
}
