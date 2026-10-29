import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { avatarUrl, profileInitials } from '@glacier-tasks/domain';

const PALETTE_SIZE = 6;

/**
 * Profile avatar (USER-02, D24): the managed image via the media protocol, square-cropped,
 * or generated initials when there is no image or it cannot be loaded.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--avatar-size.px]': 'size()',
    '[style.--avatar-bg]': 'background()',
    '[class.archived]': 'archived()',
  },
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" (error)="broken.set(true)" data-testid="avatar-image" />
    } @else {
      <span class="initials" aria-hidden="true" data-testid="avatar-initials">{{
        initials()
      }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: var(--avatar-size);
      height: var(--avatar-size);
      overflow: hidden;
      border-radius: 50%;
      background-color: var(--avatar-bg);
      color: var(--avatar-text);
      font-size: calc(var(--avatar-size) * 0.4);
      font-weight: 600;
      line-height: 1;
      user-select: none;
    }
    :host(.archived) {
      opacity: 0.5;
      filter: grayscale(1);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .initials {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }
  `,
})
export class Avatar {
  readonly userId = input.required<string>();
  readonly name = input.required<string>();
  readonly avatarFileId = input<string | null>(null);
  readonly size = input(32);
  readonly archived = input(false);

  /** Reset whenever another image is shown; a missing file falls back to initials. */
  protected readonly broken = linkedSignal({ source: this.avatarFileId, computation: () => false });

  protected readonly src = computed(() => {
    const fileId = this.avatarFileId();
    return fileId && !this.broken() ? avatarUrl(fileId) : null;
  });
  protected readonly initials = computed(() => profileInitials(this.name()));
  protected readonly background = computed(() => {
    let hash = 0;
    for (const char of this.userId()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `var(--avatar-${(hash % PALETTE_SIZE) + 1})`;
  });
}
