import { inject, Injectable, signal, type WritableSignal } from '@angular/core';
import {
  type AutoBackupSettings,
  DEFAULT_ATTACHMENT_MAX_MIB,
  DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
  DEFAULT_AUTO_BACKUP_RETENTION,
  type DeviceSettings,
  DEFAULT_THEME,
  type Language,
  type ProjectView,
  type ProjectViewKind,
  type Theme,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../api/glacier-api';

/** Device settings held as signals; writes go through IPC and roll back on failure. */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(GLACIER_API);

  readonly theme = signal<Theme>(DEFAULT_THEME);
  readonly language = signal<Language>('en');
  /** Last opened project (PROJ-02); validated by the main process on write. */
  readonly lastProjectId = signal<string | null>(null);
  /** Board, list or activity on the project page (D17, D45). */
  readonly lastView = signal<ProjectViewKind>('board');
  /** Per-file attachment limit in MiB (D47). */
  readonly attachmentMaxMiB = signal(DEFAULT_ATTACHMENT_MAX_MIB);
  /** Opt-in automatic backups (D13). */
  readonly autoBackup = signal<AutoBackupSettings>({
    enabled: false,
    folder: null,
    intervalHours: DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
    retention: DEFAULT_AUTO_BACKUP_RETENTION,
    lastRunAt: null,
    lastFailure: null,
  });
  /** Sort, filters and list columns per project (D42). */
  readonly projectViews = signal<Readonly<Record<string, ProjectView>>>({});

  async load(): Promise<void> {
    const settings = await this.api.settings.getDevice();
    this.theme.set(settings.theme);
    this.language.set(settings.language);
    this.lastProjectId.set(settings.lastProjectId);
    this.lastView.set(settings.lastView);
    this.projectViews.set(settings.projectViews);
    this.attachmentMaxMiB.set(settings.attachmentMaxMiB);
    this.autoBackup.set(settings.autoBackup);
  }

  /** Enabled flag, interval and retention; the folder only comes from the native picker. */
  async updateAutoBackup(
    patch: Partial<Pick<AutoBackupSettings, 'enabled' | 'intervalHours' | 'retention'>>,
  ): Promise<void> {
    await this.optimistic(this.autoBackup, { ...this.autoBackup(), ...patch }, async () =>
      this.applyAutoBackup(await this.api.settings.updateDevice({ autoBackup: patch })),
    );
  }

  /** Opens the folder picker in the main process (D13); unchanged when cancelled. */
  async chooseAutoBackupFolder(): Promise<void> {
    this.applyAutoBackup(await this.api.settings.chooseAutoBackupFolder());
  }

  private applyAutoBackup(settings: DeviceSettings): void {
    this.autoBackup.set(settings.autoBackup);
  }

  setTheme(theme: Theme): Promise<void> {
    return this.optimistic(this.theme, theme, () => this.api.settings.updateDevice({ theme }));
  }

  setLanguage(language: Language): Promise<void> {
    return this.optimistic(this.language, language, () =>
      this.api.settings.updateDevice({ language }),
    );
  }

  setLastProject(lastProjectId: string | null): Promise<void> {
    if (this.lastProjectId() === lastProjectId) return Promise.resolve();
    return this.optimistic(this.lastProjectId, lastProjectId, () =>
      this.api.settings.updateDevice({ lastProjectId }),
    );
  }

  setAttachmentMaxMiB(attachmentMaxMiB: number): Promise<void> {
    return this.optimistic(this.attachmentMaxMiB, attachmentMaxMiB, () =>
      this.api.settings.updateDevice({ attachmentMaxMiB }),
    );
  }

  setLastView(lastView: ProjectViewKind): Promise<void> {
    return this.optimistic(this.lastView, lastView, () =>
      this.api.settings.updateDevice({ lastView }),
    );
  }

  setProjectView(projectId: string, view: ProjectView): Promise<void> {
    return this.optimistic(this.projectViews, { ...this.projectViews(), [projectId]: view }, () =>
      this.api.settings.setProjectView(projectId, view),
    );
  }

  private async optimistic<T>(
    target: WritableSignal<T>,
    value: T,
    persist: () => Promise<unknown>,
  ): Promise<void> {
    const previous = target();
    target.set(value);
    try {
      await persist();
    } catch (error) {
      target.set(previous);
      throw error;
    }
  }
}
