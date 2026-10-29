// Helpers to launch the built desktop app with an isolated user data directory.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const APP_DIR = resolve(__dirname, '..', '..', 'apps', 'desktop');

export function createUserDataDir(): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'glacier-tasks-e2e-'));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export function appEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GLACIER_')) env[key] = value;
  }
  env['GLACIER_USER_DATA'] = userDataDir;
  return env;
}

export async function launchApp(
  userDataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [APP_DIR],
    env: { ...appEnv(userDataDir), ...extraEnv },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('app-shell').waitFor();
    return { app, page };
  } catch (error) {
    // The caller never gets the handle, so don't leave the process holding the profile.
    await app.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Resolves once the app's process has really exited. Playwright's 'close' event fires when its
 * debugging connection drops, which can be before the process releases the single-instance
 * lock and its files; a relaunch right then would exit at once.
 */
export function processExit(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}
