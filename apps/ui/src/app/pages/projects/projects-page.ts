import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';

/** Project dashboard (PROJ-02): all live projects with their story counts. */
@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <h1>{{ i18n.t('projects.title') }}</h1>
        @if (store.projects().length > 0) {
          <button type="button" class="btn btn-primary" (click)="store.createDialogOpen.set(true)">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            {{ i18n.t('projects.new') }}
          </button>
        }
      </header>

      @if (store.projects().length === 0) {
        <div class="empty-state">
          <h2>{{ i18n.t('projects.emptyTitle') }}</h2>
          <p>{{ i18n.t('projects.emptyBody') }}</p>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="project-new-empty"
            (click)="store.createDialogOpen.set(true)"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            {{ i18n.t('projects.new') }}
          </button>
        </div>
      } @else {
        <ul class="grid" data-testid="project-cards">
          @for (project of store.projects(); track project.id) {
            <li>
              <a class="card project-card" [routerLink]="['/projects', project.id]">
                <span class="key mono">{{ project.key }}</span>
                <span class="name">{{ project.name }}</span>
                @if (project.description) {
                  <span class="description">{{ project.description }}</span>
                }
                <span class="counts">
                  {{
                    i18n.t('projects.counts', {
                      open: project.openStoryCount,
                      done: project.doneStoryCount,
                    })
                  }}
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .project-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      height: 100%;
      color: var(--color-text);
      text-decoration: none;

      &:hover {
        border-color: var(--color-accent);
      }
    }
    .key {
      color: var(--color-accent);
      font-size: 12px;
      font-weight: 600;
    }
    .name {
      font-size: 16px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .description {
      display: -webkit-box;
      overflow: hidden;
      color: var(--color-text-muted);
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      white-space: pre-line;
    }
    .counts {
      margin-top: auto;
      padding-top: 8px;
      color: var(--color-text-muted);
      font-size: 12px;
    }
  `,
})
export class ProjectsPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ProjectsStore);

  constructor() {
    // Story counts change with every task write, which doesn't reload the store.
    void this.store.load().catch((error: unknown) => console.error(error));
  }
}
