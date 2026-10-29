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
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR], env: appEnv(userDataDir) });
  const page = await app.firstWindow();
  await page.getByTestId('app-shell').waitFor();
  return { app, page };
}
