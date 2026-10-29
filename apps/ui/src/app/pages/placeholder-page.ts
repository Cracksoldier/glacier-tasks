import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService, type TranslationKey } from '../core/i18n/i18n.service';

/** Temporary page for areas built in later milestones (projects M2, profiles M2, trash M7). */
@Component({
  selector: 'app-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ i18n.t(titleKey()) }}</h1>
      <div class="empty">
        @if (emptyTitleKey(); as emptyTitle) {
          <h2>{{ i18n.t(emptyTitle) }}</h2>
        }
        <p>{{ i18n.t(bodyKey()) }}</p>
      </div>
    </section>
  `,
  styles: `
    .page {
      padding: 24px 32px;
    }
    h1 {
      margin: 0 0 24px;
      font-size: 22px;
    }
    .empty {
      padding: 48px 24px;
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-lg);
      color: var(--color-text-muted);
      text-align: center;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 16px;
      color: var(--color-text);
    }
    p {
      margin: 0;
    }
  `,
})
export class PlaceholderPage {
  protected readonly i18n = inject(I18nService);

  // Bound from route data via withComponentInputBinding().
  readonly titleKey = input.required<TranslationKey>();
  readonly emptyTitleKey = input<TranslationKey | null>(null);
  readonly bodyKey = input<TranslationKey>('common.comingSoon');
}
