import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import {
  ATTACHMENT_DROP_MAX_FILES,
  type AttachmentMetadata,
  attachmentUrl,
  type DroppedFile,
} from '@glacier-tasks/domain';
import { GLACIER_API } from '../../core/api/glacier-api';
import { I18nService } from '../../core/i18n/i18n.service';
import { Dialog } from '../../shared/dialog';

/**
 * Attachments of one task (FILE-01..05, D03, D10, D33): picker and drag & drop (bytes only,
 * ADR 0011), previews for raster images, open with the OS after confirmation (T11), save as,
 * remove after confirmation, and inserting an `attachment:<id>` image into the description.
 */
@Component({
  selector: 'app-task-attachments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog],
  template: `
    <section class="attachments" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">{{ i18n.t('attachments.title') }}</h2>
      @if (error(); as message) {
        <p class="error-banner" role="alert" data-testid="attachment-error">{{ message }}</p>
      }
      <div
        class="drop-zone"
        data-testid="attachment-drop"
        [class.over]="dragOver()"
        (dragover)="$event.preventDefault(); dragOver.set(true)"
        (dragleave)="dragOver.set(false)"
        (drop)="dropped($event)"
      >
        <i class="fa-solid fa-paperclip" aria-hidden="true"></i>
        <span>{{ i18n.t('attachments.dropHint') }}</span>
        <button type="button" class="btn" data-testid="attachment-add" [disabled]="busy()" (click)="pick()">
          {{ i18n.t('attachments.add') }}
        </button>
      </div>

      @if (attachments().length > 0) {
        <ul class="list" data-testid="attachment-list">
          @for (file of attachments(); track file.id) {
            <li class="item" data-testid="attachment-item" [attr.data-name]="file.originalName">
              @if (file.previewable) {
                <button type="button" class="thumb" data-testid="attachment-preview"
                  [attr.aria-label]="i18n.t('attachments.preview', { name: file.originalName })"
                  (click)="previewing.set(file)">
                  <img [src]="url(file.id)" alt="" loading="lazy" />
                </button>
              } @else {
                <span class="thumb icon" aria-hidden="true"><i class="fa-solid fa-file"></i></span>
              }
              <div class="meta">
                <span class="name">{{ file.originalName }}</span>
                <span class="muted">{{ size(file.byteSize) }} · {{ i18n.formatDateTime(file.addedAt) }}</span>
              </div>
              <div class="actions">
                @if (file.previewable) {
                  <button type="button" class="btn btn-ghost" data-testid="attachment-insert"
                    [title]="i18n.t('attachments.insertHint')" (click)="insert.emit(file)">
                    {{ i18n.t('attachments.insert') }}
                  </button>
                }
                <button type="button" class="btn btn-ghost btn-icon" data-testid="attachment-open"
                  [attr.aria-label]="i18n.t('attachments.open')" [title]="i18n.t('attachments.open')"
                  (click)="file.previewable ? previewing.set(file) : confirmingOpen.set(file)">
                  <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-ghost btn-icon" data-testid="attachment-save"
                  [attr.aria-label]="i18n.t('attachments.saveAs')" [title]="i18n.t('attachments.saveAs')"
                  (click)="saveAs(file)">
                  <i class="fa-solid fa-download" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-ghost btn-icon" data-testid="attachment-remove"
                  [attr.aria-label]="i18n.t('attachments.remove')" [title]="i18n.t('attachments.remove')"
                  (click)="removing.set(file)">
                  <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    <app-dialog [open]="previewing() !== null" [wide]="true" [heading]="previewing()?.originalName ?? ''"
      (closed)="previewing.set(null)">
      @if (previewing(); as file) {
        <img class="preview" data-testid="attachment-preview-image" [src]="url(file.id)" [alt]="file.originalName" />
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="saveAs(file)">{{ i18n.t('attachments.saveAs') }}</button>
          <button type="button" class="btn" (click)="open(file)">{{ i18n.t('attachments.openExternal') }}</button>
          <button type="button" class="btn btn-primary" (click)="previewing.set(null)">{{ i18n.t('common.close') }}</button>
        </div>
      }
    </app-dialog>

    <app-dialog [open]="confirmingOpen() !== null" [heading]="i18n.t('attachments.openTitle')"
      (closed)="confirmingOpen.set(null)">
      @if (confirmingOpen(); as file) {
        <p>{{ i18n.t('attachments.openBody', { name: file.originalName }) }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="confirmingOpen.set(null)">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" data-testid="attachment-open-confirm" (click)="open(file)">
            {{ i18n.t('attachments.openExternal') }}
          </button>
        </div>
      }
    </app-dialog>

    <app-dialog [open]="removing() !== null" [heading]="i18n.t('attachments.removeTitle')"
      (closed)="removing.set(null)">
      @if (removing(); as file) {
        <p>{{ i18n.t('attachments.removeBody', { name: file.originalName }) }}</p>
        <div class="page-actions dialog-actions">
          <button type="button" class="btn" (click)="removing.set(null)">{{ i18n.t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" data-testid="attachment-remove-confirm" (click)="remove(file)">
            {{ i18n.t('attachments.remove') }}
          </button>
        </div>
      }
    </app-dialog>
  `,
  styles: `
    h2 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    .drop-zone {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-muted);

      &.over {
        border-color: var(--color-accent);
        background-color: var(--color-accent-muted);
      }
      button {
        margin-left: auto;
      }
    }
    .list {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;

      & + .item {
        border-top: 1px solid var(--color-border);
      }
    }
    .thumb {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background-color: var(--color-bg);
      color: var(--color-text-muted);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    button.thumb {
      cursor: zoom-in;
    }
    .meta {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .muted {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 2px;
    }
    .preview {
      display: block;
      max-width: 100%;
      max-height: 70vh;
      margin: 0 auto;
    }
    .dialog-actions {
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class TaskAttachments {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GLACIER_API);

  readonly taskId = input.required<string>();
  readonly attachments = input.required<ReadonlyArray<AttachmentMetadata>>();
  /** After add or remove; the page reloads the list and the history. */
  readonly changed = output<void>();
  /** "Insert into description" for a previewable image (D10). */
  readonly insert = output<AttachmentMetadata>();

  protected readonly busy = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly previewing = signal<AttachmentMetadata | null>(null);
  protected readonly confirmingOpen = signal<AttachmentMetadata | null>(null);
  protected readonly removing = signal<AttachmentMetadata | null>(null);

  protected url(id: string): string {
    return attachmentUrl(id);
  }

  protected size(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = unit === 0 ? 0 : 1;
    return `${new Intl.NumberFormat(this.i18n.locale(), { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
  }

  protected pick(): Promise<void> {
    return this.run(async () => {
      const added = await this.api.attachments.add(this.taskId());
      if (added.length > 0) this.changed.emit();
    });
  }

  protected async dropped(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOver.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    await this.run(async () => {
      for (let i = 0; i < files.length; i += ATTACHMENT_DROP_MAX_FILES) {
        const batch: DroppedFile[] = [];
        for (const file of files.slice(i, i + ATTACHMENT_DROP_MAX_FILES)) {
          batch.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        }
        await this.api.attachments.addFiles(this.taskId(), batch);
      }
      this.changed.emit();
    });
  }

  protected open(file: AttachmentMetadata): Promise<void> {
    this.confirmingOpen.set(null);
    return this.run(() => this.api.attachments.open(file.id));
  }

  protected saveAs(file: AttachmentMetadata): Promise<void> {
    return this.run(() => this.api.attachments.saveAs(file.id));
  }

  protected remove(file: AttachmentMetadata): Promise<void> {
    this.removing.set(null);
    if (this.previewing()?.id === file.id) this.previewing.set(null);
    return this.run(async () => {
      await this.api.attachments.remove(file.id);
      this.changed.emit();
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(this.i18n.errorMessage(error));
      // A partly imported drop still added files.
      this.changed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
