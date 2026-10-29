import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { RestorePreview } from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { Dialog } from '../../shared/dialog';

const MIB = 1024 * 1024;

/**
 * Settings → Data (DATA-01..10, D13, D14, ADR 0012): complete backups, restore with a
 * validated preview and explicit confirmation, opt-in automatic backups, and the
 * export-only JSON that is clearly not a backup.
 */
@Component({
  selector: 'app-data-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog],
  template: `
    <section class="card" aria-labelledby="data-heading">
      <h2 id="data-heading">{{ i18n.t('data.title') }}</h2>
      @if (message(); as note) {
        <p class="notice" role="status" data-testid="data-notice">{{ note }}</p>
      }
      @if (error(); as text) {
        <p class="error-banner" role="alert" data-testid="data-error">{{ text }}</p>
      }

      <div class="block">
        <h3>{{ i18n.t('data.backupTitle') }}</h3>
        <p class="muted">{{ i18n.t('data.backupBody') }}</p>
        <div class="row">
          <button type="button" class="btn btn-primary" data-testid="data-backup" [disabled]="busy()" (click)="backup()">
            <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
            {{ i18n.t('data.backupNow') }}
          </button>
          <button type="button" class="btn" data-testid="data-restore" [disabled]="busy()" (click)="inspect()">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            {{ i18n.t('data.restore') }}
          </button>
        </div>
      </div>

      <div class="block">
        <h3>{{ i18n.t('data.autoTitle') }}</h3>
        <p class="muted">{{ i18n.t('data.autoBody') }}</p>
        <div class="row">
          <span class="mono folder" data-testid="auto-folder">{{ auto().folder ?? i18n.t('data.noFolder') }}</span>
          <button type="button" class="btn" data-testid="auto-choose-folder" (click)="chooseFolder()">
            {{ i18n.t('data.chooseFolder') }}
          </button>
        </div>
        <label class="check">
          <input type="checkbox" data-testid="auto-enabled" [checked]="auto().enabled"
            [disabled]="!auto().folder" (change)="setAuto({ enabled: $any($event.target).checked })" />
          {{ i18n.t('data.autoEnabled') }}
        </label>
        <div class="row numbers">
          <label>
            {{ i18n.t('data.interval') }}
            <input type="number" min="1" [max]="24 * 30" data-testid="auto-interval" [value]="auto().intervalHours"
              (change)="setNumber('intervalHours', $any($event.target), 24 * 30)" />
          </label>
          <label>
            {{ i18n.t('data.retention') }}
            <input type="number" min="1" max="100" data-testid="auto-retention" [value]="auto().retention"
              (change)="setNumber('retention', $any($event.target), 100)" />
          </label>
        </div>
        <p class="muted" data-testid="auto-last-run">
          {{ auto().lastRunAt ? i18n.t('data.lastRun', { date: i18n.formatDateTime(auto().lastRunAt!) }) : i18n.t('data.neverRun') }}
        </p>
        @if (auto().lastFailure; as failure) {
          <p class="warning" role="status" data-testid="auto-failure">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            {{ i18n.t('data.autoFailed', { date: i18n.formatDateTime(failure.at) }) }}
            {{ i18n.errorMessage({ code: 'IO', message: failure.messageKey }) }}
          </p>
        }
      </div>

      <div class="block">
        <h3>{{ i18n.t('data.exportTitle') }}</h3>
        <p class="warning-note">{{ i18n.t('data.exportNotice') }}</p>
        <div class="row">
          <select data-testid="export-scope" [attr.aria-label]="i18n.t('data.exportScope')"
            (change)="exportScope.set($any($event.target).value)">
            <option value="">{{ i18n.t('data.exportWorkspace') }}</option>
            @for (project of projects.projects(); track project.id) {
              <option [value]="project.id">{{ project.key }} · {{ project.name }}</option>
            }
          </select>
          <label class="check">
            <input type="checkbox" data-testid="export-trashed" [checked]="includeTrashed()"
              (change)="includeTrashed.set($any($event.target).checked)" />
            {{ i18n.t('data.exportTrashed') }}
          </label>
          <button type="button" class="btn" data-testid="data-export" [disabled]="busy()" (click)="exportJson()">
            <i class="fa-solid fa-file-export" aria-hidden="true"></i>
            {{ i18n.t('data.exportNow') }}
          </button>
        </div>
      </div>
    </section>

    <app-dialog [open]="preview() !== null" [heading]="i18n.t('data.restoreTitle')" (closed)="preview.set(null)">
      @if (preview(); as backup) {
        <dl class="facts" data-testid="restore-preview">
          <dt>{{ i18n.t('data.file') }}</dt>
          <dd class="mono">{{ backup.fileName }}</dd>
          <dt>{{ i18n.t('data.createdAt') }}</dt>
          <dd>{{ i18n.formatDateTime(backup.createdAt) }}</dd>
          <dt>{{ i18n.t('data.contents') }}</dt>
          <dd>{{ i18n.t('data.counts', countParams(backup)) }}</dd>
          <dt>{{ i18n.t('data.versions') }}</dt>
          <dd>{{ backup.appVersion }} · {{ i18n.t('data.schema', { version: backup.schemaVersion }) }}</dd>
        </dl>
        <p class="warning" role="alert">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          {{ i18n.t('data.restoreWarning') }}
        </p>
        <p class="muted">{{ i18n.t('data.restoreSafety') }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="preview.set(null)">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="btn btn-danger" data-testid="restore-confirm" [disabled]="busy()" (click)="restore(backup)">
            {{ i18n.t('data.restoreConfirm') }}
          </button>
        </div>
      }
    </app-dialog>
  `,
  styles: `
    .block + .block {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--color-border);
    }
    h3 {
      margin: 0 0 4px;
      font-size: 14px;
    }
    .muted {
      margin: 0 0 10px;
      color: var(--color-text-muted);
      font-size: 13px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .numbers label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }
    .numbers input {
      width: 80px;
    }
    input[type='number'],
    select {
      padding: 5px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-bg);
      color: var(--color-text);
    }
    .folder {
      overflow: hidden;
      max-width: 420px;
      color: var(--color-text-muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      font-size: 13px;
    }
    .notice {
      color: var(--color-accent);
    }
    .warning,
    .warning-note {
      display: flex;
      gap: 8px;
      color: var(--color-danger-text);
      font-size: 13px;
    }
    .warning-note {
      margin: 0 0 10px;
    }
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--color-text-muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class DataSection {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);
  private readonly settings = inject(SettingsStore);
  protected readonly projects = inject(ProjectsStore);

  protected readonly auto = this.settings.autoBackup;
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly preview = signal<RestorePreview | null>(null);
  protected readonly exportScope = signal('');
  protected readonly includeTrashed = signal(false);
  private readonly sizeFormat = computed(
    () => new Intl.NumberFormat(this.i18n.locale(), { maximumFractionDigits: 1 }),
  );

  private formatSize(bytes: number): string {
    const [value, unit] =
      bytes >= MIB ? [bytes / MIB, 'MiB'] : bytes >= 1024 ? [bytes / 1024, 'KiB'] : [bytes, 'B'];
    return `${this.sizeFormat().format(value)} ${unit}`;
  }

  protected countParams(preview: RestorePreview): Record<string, number> {
    return { ...preview.counts };
  }

  protected backup(): Promise<void> {
    return this.run(async () => {
      const result = await this.api.data.backup();
      if (result) {
        this.message.set(
          this.i18n.t('data.backupDone', {
            name: result.fileName,
            size: this.formatSize(result.byteSize),
          }),
        );
      }
    });
  }

  protected inspect(): Promise<void> {
    return this.run(async () => {
      const preview = await this.api.data.inspectRestore();
      if (preview) this.preview.set(preview);
    });
  }

  protected restore(preview: RestorePreview): Promise<void> {
    return this.run(async () => {
      await this.api.data.restore(preview.token);
      this.preview.set(null);
      // The main process restarts the app now (ADR 0012).
      this.message.set(this.i18n.t('data.restarting'));
    });
  }

  protected exportJson(): Promise<void> {
    return this.run(async () => {
      const projectId = this.exportScope();
      const result = await this.api.data.exportJson({
        scope: projectId ? { kind: 'project', projectId } : { kind: 'workspace' },
        includeTrashed: this.includeTrashed(),
      });
      if (result) this.message.set(this.i18n.t('data.exportDone', { name: result.fileName }));
    });
  }

  protected chooseFolder(): Promise<void> {
    return this.run(() => this.settings.chooseAutoBackupFolder());
  }

  protected setAuto(patch: { enabled?: boolean }): Promise<void> {
    return this.run(() => this.settings.updateAutoBackup(patch));
  }

  protected setNumber(
    field: 'intervalHours' | 'retention',
    input: HTMLInputElement,
    max: number,
  ): Promise<void> {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      input.value = String(this.auto()[field]);
      this.error.set(this.i18n.t('data.numberInvalid', { max }));
      return Promise.resolve();
    }
    return this.run(() => this.settings.updateAutoBackup({ [field]: value }));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
