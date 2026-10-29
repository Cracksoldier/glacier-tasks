import { ChangeDetectionStrategy, Component } from '@angular/core';
import { APP_NAME, PRIORITIES } from '@glacier-tasks/domain';

// M0 placeholder: proves that the renderer resolves the shared domain package.
// The real shell (theme, i18n, navigation) is built in M1.
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>{{ appName }}</h1>
      <p data-testid="priorities">{{ priorities.join(' · ') }}</p>
    </main>
  `,
  styles: `
    main {
      padding: 2rem;
    }
  `,
})
export class App {
  protected readonly appName = APP_NAME;
  protected readonly priorities = PRIORITIES;
}
