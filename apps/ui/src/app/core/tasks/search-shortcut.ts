import { Injectable, signal } from '@angular/core';

/** Ctrl+F (D41): the shell counts requests, the search page focuses its field on each one. */
@Injectable({ providedIn: 'root' })
export class SearchShortcut {
  readonly focusRequests = signal(0);

  requestFocus(): void {
    this.focusRequests.update((count) => count + 1);
  }
}
