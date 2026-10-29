// M1 acceptance: renderer isolation, persisted theme/language, single instance, routing.

import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { APP_DIR, appEnv, createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

test('renderer has no Node access and only the typed API (T1)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    const probe = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      api: typeof window.glacierTasks,
      groups: Object.keys(window.glacierTasks ?? {}).sort(),
    }));
    expect(probe).toEqual({
      require: 'undefined',
      process: 'undefined',
      api: 'object',
      groups: [
        'activity',
        'app',
        'attachments',
        'data',
        'labels',
        'projects',
        'settings',
        'tasks',
        'trash',
        'users',
        'workflows',
      ],
    });

    const error = await page.evaluate(() =>
      window.glacierTasks?.tasks.get('../../secret').catch((e: unknown) => e),
    );
    expect(error).toMatchObject({ code: 'VALIDATION' });
  } finally {
    await app.close();
  }
});

test('a fresh profile starts dark (D18) and theme + language survive a restart', async () => {
  const first = await launchApp(userData.dir);
  try {
    await expect(first.page.locator('html')).toHaveClass(/theme-dark/);

    await first.page.getByTestId('nav-settings').click();
    await first.page.getByTestId('theme-light').check();
    await first.page.getByTestId('language-de').check();
    await expect(first.page.locator('html')).toHaveClass(/theme-light/);
    await expect(first.page.locator('h1')).toHaveText('Einstellungen');
  } finally {
    await first.app.close();
  }

  const second = await launchApp(userData.dir);
  try {
    await expect(second.page.locator('html')).toHaveClass(/theme-light/);
    await expect(second.page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(second.page.getByTestId('nav-settings')).toHaveText('Einstellungen');
  } finally {
    await second.app.close();
  }
});

test('routes keep index.html and survive a reload (D36)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await page.getByTestId('nav-settings').click();
    await expect(page).toHaveURL(/index\.html#\/settings$/);
    await page.reload();
    await page.getByTestId('app-shell').waitFor();
    await expect(page.getByTestId('theme-dark')).toBeVisible();
    await expect(page.getByTestId('app-version')).not.toHaveText('…');
  } finally {
    await app.close();
  }
});

test('a second launch exits and leaves the first window open (D05)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    const electronPath = app.process().spawnfile;
    const second = spawn(electronPath, [APP_DIR], { env: appEnv(userData.dir), stdio: 'ignore' });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('second instance did not exit')), 20_000);
      second.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});
