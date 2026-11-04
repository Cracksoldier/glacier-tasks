// D59: opt-in close and minimize to the system tray.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { APP_DIR, appEnv, createUserDataDir, launchApp, processExit } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

function storedSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(userData.dir, 'device-settings.json'), 'utf-8'));
}

function windowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      minimized: window.isMinimized(),
    })),
  );
}

/** Starts a second instance, which hands over to the running one and exits (D05). */
async function launchSecondInstance(app: ElectronApplication): Promise<number | null> {
  const second = spawn(app.process().spawnfile, [APP_DIR], {
    env: appEnv(userData.dir),
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('second instance did not exit')), 20_000);
    second.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
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
      .poll(() => windowState(app).then((windows) => windows.map((window) => window.visible)))
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

test('with minimize to tray on, minimizing hides the window and a second launch brings it back', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('minimize-to-tray').check();
    await expect.poll(() => storedSettings()['minimizeToTray']).toBe(true);

    // A real minimize where possible: on Windows, bringing back a hidden, minimized window is
    // what can go wrong. Under xvfb there is no window manager, so minimize() does nothing and
    // never emits 'minimize'; emit the event the window manager would cause instead.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.minimize();
      if (window && !window.isMinimized()) window.emit('minimize');
    });
    await expect.poll(() => windowState(app).then((windows) => windows[0]?.visible)).toBe(false);
    await expect.poll(() => storedSettings()['trayHintShown']).toBe(true);

    expect(await launchSecondInstance(app)).toBe(0);
    await expect.poll(() => windowState(app)).toEqual([{ visible: true, minimized: false }]);
    await expect(page.getByTestId('minimize-to-tray')).toBeChecked();
  } finally {
    const exited = processExit(app);
    await app.close();
    await exited;
  }
});
