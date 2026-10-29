import type { Provider } from '@angular/core';
import type { DeviceSettings } from '@glacier-tasks/domain';
import { GLACIER_API } from '../core/api/glacier-api';
import { createGlacierApiStub, type GlacierApiStub } from './glacier-api-stub';

/** Controllable stand-in for window.matchMedia('(prefers-color-scheme: dark)'). */
export class FakeColorScheme {
  private listeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(public matches: boolean) {}

  install(): void {
    window.matchMedia = ((query: string) => ({
      matches: this.matches,
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        this.listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        this.listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;
  }

  set(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches } as MediaQueryListEvent);
  }
}

export function provideApiStub(initial: Partial<DeviceSettings> = {}): {
  stub: GlacierApiStub;
  providers: Provider[];
} {
  const stub = createGlacierApiStub(initial);
  return { stub, providers: [{ provide: GLACIER_API, useValue: stub.api }] };
}
