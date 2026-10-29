import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from './shell/shell';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Shell],
  template: '<app-shell />',
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class App {}
