import { loaded } from '../core/api/loaded';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';
import { GLACIER_API } from '../core/api/glacier-api';
import { ProjectsStore } from '../core/projects/projects-store';
import { SettingsStore } from '../core/settings/settings-store';
import { SearchShortcut } from '../core/tasks/search-shortcut';
import { ProjectCreateDialog } from '../pages/projects/project-create-dialog';

interface Notice {
  id: 'restored' | 'restore-failed' | 'auto-backup';
  tone: 'success' | 'danger';
  icon: string;
  text: string;
}

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
  private readonly api = inject(GLACIER_API);
  private readonly settings = inject(SettingsStore);
  private readonly info = resource({ loader: () => this.api.app.info() });
  private readonly dismissed = signal<ReadonlySet<Notice['id']>>(new Set());

  /** Restore outcome after the restart and a failed automatic backup (DATA-06, D13). */
  protected readonly notices = computed<Notice[]>(() => {
    const notices: Notice[] = [];
    const info = loaded(this.info);
    if (info?.lastRestore) {
      notices.push({
        id: 'restored',
        tone: 'success',
        icon: 'fa-circle-check',
        text: this.i18n.t('data.restored', {
          safety: info.lastRestore.safetyBackupFileName ?? '–',
        }),
      });
    }
    if (info?.restoreFailed) {
      notices.push({
        id: 'restore-failed',
        tone: 'danger',
        icon: 'fa-triangle-exclamation',
        text: this.i18n.t('data.restoreFailed'),
      });
    }
    const failure = this.settings.autoBackup().lastFailure;
    if (failure) {
      notices.push({
        id: 'auto-backup',
        tone: 'danger',
        icon: 'fa-triangle-exclamation',
        text: this.i18n.t('data.autoFailed', { date: this.i18n.formatDateTime(failure.at) }),
      });
    }
    return notices.filter((notice) => !this.dismissed().has(notice.id));
  });
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

  protected dismiss(id: Notice['id']): void {
    this.dismissed.update((ids) => new Set([...ids, id]));
  }

  /** Ctrl+F opens search (D41), or focuses its field when it is already open. */
  protected openSearch(event: Event): void {
    event.preventDefault();
    if (!this.router.url.startsWith('/search')) void this.router.navigate(['/search']);
    this.searchShortcut.requestFocus();
  }
}
