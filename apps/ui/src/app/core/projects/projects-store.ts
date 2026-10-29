import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  CreateProjectInput,
  Project,
  ProjectSummary,
  UpdateProjectInput,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../api/glacier-api';

/** Live projects for the sidebar switcher and dashboard (PROJ-02). Writes reload the list. */
@Injectable({ providedIn: 'root' })
export class ProjectsStore {
  private readonly api = inject(GLACIER_API);

  readonly projects = signal<ProjectSummary[]>([]);
  readonly loaded = signal(false);
  /** Set by any "New project" button; the shell hosts the dialog. */
  readonly createDialogOpen = signal(false);

  private readonly byId = computed(() => new Map(this.projects().map((p) => [p.id, p])));

  find(id: string | null | undefined): ProjectSummary | undefined {
    return id ? this.byId().get(id) : undefined;
  }

  async load(): Promise<void> {
    this.projects.set(await this.api.projects.list());
    this.loaded.set(true);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const project = await this.api.projects.create(input);
    await this.load();
    return project;
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    const project = await this.api.projects.update(id, patch);
    await this.load();
    return project;
  }
}
