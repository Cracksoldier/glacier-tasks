// D59: opt-in close and minimize to the system tray.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createUserDataDir, launchApp, processExit } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

function storedSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(userData.dir, 'device-settings.json'), 'utf-8'));
}

test('closing the window quits the app by default', async () => {
  const { app, page } = await launchApp(userData.dir);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('close-to-tray')).not.toBeChecked();
  await expect(page.getByTestId('minimize-to-tray')).not.toBeChecked();

  const exited = processExit(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await exited;
});

test('with close to tray on, closing hides the window and quitting still works', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('close-to-tray').check();
    await expect.poll(() => storedSettings()['closeToTray']).toBe(true);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => window.isVisible()),
        ),
      )
      .toEqual([false]);
    expect(app.process().exitCode).toBeNull();
    // The one-off "still running" hint is remembered.
    await expect.poll(() => storedSettings()['trayHintShown']).toBe(true);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect(page.getByTestId('close-to-tray')).toBeChecked();
  } finally {
    const exited = processExit(app);
    await app.close();
    await exited;
  }
});
