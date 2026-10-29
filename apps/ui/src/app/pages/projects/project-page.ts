import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';

/** Project home. Remembers the project as last opened (PROJ-02); the board follows in M4. */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (project(); as project) {
      <section class="page">
        <header class="page-header">
          <div>
            <span class="key mono" data-testid="project-key-badge">{{ project.key }}</span>
            <h1 data-testid="project-title">{{ project.name }}</h1>
          </div>
          <a
            class="btn"
            [routerLink]="['/projects', project.id, 'settings']"
            data-testid="project-settings-link"
          >
            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
            {{ i18n.t('projectSettings.title') }}
          </a>
        </header>
        @if (project.description) {
          <p class="description">{{ project.description }}</p>
        }
        <div class="empty-state">
          <h2>{{ i18n.t('project.boardSoonTitle') }}</h2>
          <p>{{ i18n.t('project.boardSoonBody') }}</p>
        </div>
      </section>
    }
  `,
  styles: `
    .key {
      color: var(--color-accent);
      font-size: 12px;
      font-weight: 600;
    }
    h1 {
      overflow-wrap: anywhere;
    }
    .description {
      margin: -8px 0 24px;
      color: var(--color-text-muted);
      white-space: pre-line;
    }
  `,
})
export class ProjectPage {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(ProjectsStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  /** Bound from the route parameter. */
  readonly projectId = input.required<string>();
  protected readonly project = computed(() => this.store.find(this.projectId()));

  constructor() {
    effect(() => {
      if (!this.store.loaded()) return;
      const project = this.project();
      untracked(() => {
        if (project) {
          void this.settings.setLastProject(project.id).catch(() => undefined);
        } else {
          // Unknown or trashed project, e.g. a stale last-project id.
          if (this.settings.lastProjectId() === this.projectId()) {
            void this.settings.setLastProject(null).catch(() => undefined);
          }
          void this.router.navigate(['/projects']);
        }
      });
    });
  }
}
