import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * Modal dialog on the native <dialog> element: the browser provides the focus trap,
 * Esc handling, inert background and focus return.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog [class.wide]="wide()" [attr.aria-labelledby]="titleId" (close)="closed.emit()">
      <h2 [id]="titleId">{{ heading() }}</h2>
      <ng-content />
    </dialog>
  `,
  styles: `
    dialog {
      width: min(520px, calc(100vw - 48px));
      padding: 24px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background-color: var(--color-surface);
      color: var(--color-text);
      box-shadow: 0 12px 32px var(--color-shadow);

      &.wide {
        width: min(1000px, calc(100vw - 48px));
      }
    }
    dialog::backdrop {
      background-color: var(--color-backdrop);
    }
    h2 {
      margin: 0 0 20px;
      font-size: 17px;
    }
  `,
})
export class Dialog {
  private static nextId = 0;

  readonly open = input.required<boolean>();
  readonly heading = input.required<string>();
  /** For lists, previews and comparisons. */
  readonly wide = input(false);
  /** Emitted when the dialog closes, including via Esc. */
  readonly closed = output<void>();

  protected readonly titleId = `dialog-title-${Dialog.nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        // jsdom (unit tests) lacks showModal; the open attribute is enough there.
        if (typeof element.showModal === 'function') element.showModal();
        else element.open = true;
      }
      if (!this.open() && element.open) {
        if (typeof element.close === 'function') element.close();
        else element.open = false;
      }
    });
  }
}
