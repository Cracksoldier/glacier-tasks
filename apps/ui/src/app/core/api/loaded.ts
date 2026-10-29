import type { Resource } from '@angular/core';

/**
 * A resource's value, or `undefined` while it loads or after it failed. Angular's
 * `resource.value()` throws in the error state, which would take down the whole view; screens
 * read through this and show `resource.error()` themselves.
 */
export function loaded<T>(resource: Resource<T>): T | undefined {
  return resource.hasValue() ? resource.value() : undefined;
}
