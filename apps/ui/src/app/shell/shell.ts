import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';

interface NavItem {
  path: string;
  label: TranslationKey;
  icon: string;
}

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly i18n = inject(I18nService);

  protected readonly primaryNav: NavItem[] = [
    { path: '/projects', label: 'nav.projects', icon: 'fa-diagram-project' },
    { path: '/profiles', label: 'nav.profiles', icon: 'fa-users' },
    { path: '/trash', label: 'nav.trash', icon: 'fa-trash-can' },
  ];
  protected readonly settingsNav: NavItem = {
    path: '/settings',
    label: 'nav.settings',
    icon: 'fa-gear',
  };
}
