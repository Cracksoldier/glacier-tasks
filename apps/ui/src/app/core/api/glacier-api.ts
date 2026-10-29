import { InjectionToken } from '@angular/core';
import { API_GLOBAL_NAME, type GlacierTasksAPI } from '@glacier-tasks/domain';

declare global {
  interface Window {
    glacierTasks?: GlacierTasksAPI;
  }
}

/**
 * The typed main-process API exposed by the preload script (ADR 0004).
 * Tests provide `createGlacierApiStub()` instead.
 */
export const GLACIER_API = new InjectionToken<GlacierTasksAPI>('GLACIER_API', {
  providedIn: 'root',
  factory: () => {
    const api = window[API_GLOBAL_NAME];
    if (!api)
      throw new Error('Glacier Tasks API unavailable: the UI must run inside the desktop app');
    return api;
  },
});
