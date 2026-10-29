import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { LabelColor } from '@glacier-tasks/domain';

/** A project label in its palette color (D25). */
@Component({
  selector: 'app-label-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--chip-bg]': 'background()',
    '[style.--chip-fg]': 'foreground()',
  },
  template: `{{ name() }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      max-width: 160px;
      padding: 1px 8px;
      overflow: hidden;
      border-radius: 999px;
      background-color: var(--chip-bg);
      color: var(--chip-fg);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.6;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class LabelChip {
  readonly name = input.required<string>();
  readonly color = input<LabelColor | null>(null);

  protected readonly background = computed(() => `var(--label-${this.color() ?? 'none'}-bg)`);
  protected readonly foreground = computed(() => `var(--label-${this.color() ?? 'none'}-fg)`);
}
