import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

export interface MultiSelectOption<T> {
  value: T;
  label: string;
}

/**
 * Filter dropdown with checkboxes, built on a native `<details>` so it needs no overlay:
 * the summary is the keyboard-focusable trigger, Escape and outside clicks close it.
 */
@Component({
  selector: 'app-multi-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeOnOutside($event)',
    '(keydown.escape)': 'close(true)',
  },
  template: `
    <details #menu class="menu" [attr.data-testid]="testId()">
      <summary class="btn trigger" [class.active]="selected().length > 0">
        {{ label() }}
        @if (selected().length > 0) {
          <span class="count">{{ selected().length }}</span>
        }
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </summary>
      <fieldset class="panel">
        <legend class="visually-hidden">{{ label() }}</legend>
        @for (option of options(); track option.value) {
          <label class="option">
            <input
              type="checkbox"
              [checked]="isSelected(option.value)"
              [attr.data-testid]="testId() + '-option'"
              [attr.data-value]="option.value ?? ''"
              (change)="toggle(option.value)"
            />
            <span>{{ option.label }}</span>
          </label>
        } @empty {
          <span class="none">{{ emptyText() }}</span>
        }
      </fieldset>
    </details>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    summary {
      list-style: none;
      gap: 6px;

      &::-webkit-details-marker {
        display: none;
      }
      &.active {
        border-color: var(--color-accent);
      }
      i {
        font-size: 10px;
        color: var(--color-text-muted);
      }
    }
    .count {
      min-width: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background-color: var(--color-accent);
      color: var(--color-accent-contrast);
      font-size: 11px;
      text-align: center;
    }
    .panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      display: flex;
      flex-direction: column;
      min-width: 200px;
      max-height: 320px;
      margin: 0;
      padding: 6px;
      overflow-y: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background-color: var(--color-surface-elevated);
      box-shadow: 0 8px 20px var(--color-shadow);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;

      &:hover {
        background-color: var(--color-surface-hover);
      }
    }
    .none {
      padding: 5px 6px;
      color: var(--color-text-muted);
    }
  `,
})
export class MultiSelect<T extends string | null> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly menu = viewChild.required<ElementRef<HTMLDetailsElement>>('menu');

  readonly label = input.required<string>();
  readonly options = input.required<ReadonlyArray<MultiSelectOption<T>>>();
  readonly selected = input.required<ReadonlyArray<T>>();
  readonly testId = input.required<string>();
  readonly emptyText = input('');
  readonly selectedChange = output<T[]>();

  private readonly selectedSet = computed(() => new Set<T>(this.selected()));

  protected isSelected(value: T): boolean {
    return this.selectedSet().has(value);
  }

  protected toggle(value: T): void {
    const next = this.selected().filter((v) => v !== value);
    if (next.length === this.selected().length) next.push(value);
    this.selectedChange.emit(next);
  }

  protected closeOnOutside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  protected close(focusTrigger: boolean): void {
    const menu = this.menu().nativeElement;
    if (!menu.open) return;
    menu.open = false;
    if (focusTrigger) menu.querySelector('summary')?.focus();
  }
}
