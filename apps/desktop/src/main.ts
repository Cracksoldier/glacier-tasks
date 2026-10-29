// Electron main process: wiring only. Logic lives in the imported modules.
//
// Environment:
//   GLACIER_DEV=1          load the Angular dev server, enable DevTools shortcuts
//   GLACIER_USER_DATA=dir  use another app data directory (smoke and E2E runs)
//   GLACIER_SMOKE=1        run the packaged self-test and exit (see smoke.ts)

import { join } from 'node:path';
import { app, type BrowserWindow, ipcMain, nativeTheme, session } from 'electron';
import type { Database } from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '@glacier-tasks/data';
import { type AppError, allIpcChannels, type Theme } from '@glacier-tasks/domain';
import { DeviceSettingsStore } from './device-settings.js';
import { createDispatcher, createSenderCheck, type IpcHandlers } from './ipc.js';
import { createLogger } from './logger.js';
import { ensureAppDirectories, resolveAppPaths } from './paths.js';
import { hardenApp, hardenSession } from './security.js';
import { runSmoke } from './smoke.js';
import { showStartupError } from './startup-error.js';
import { createMainWindow, rendererDir, WINDOW_BACKGROUND } from './window.js';
import { openWorkspace } from './workspace.js';

const isDev = process.env['GLACIER_DEV'] === '1';
const isSmoke = process.env['GLACIER_SMOKE'] === '1';
const devUrl = isDev ? 'http://localhost:4200' : undefined;

const userDataOverride = process.env['GLACIER_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

let workspace: Database | undefined;
let mainWindow: BrowserWindow | undefined;
const remoteRequests: string[] = [];

function backgroundFor(theme: Theme): string {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}

function iconPath(): string | undefined {
  // Windows takes the icon from the executable; Linux needs it on the window.
  return process.platform === 'linux' ? join(__dirname, 'icon.png') : undefined;
}

async function start(): Promise<void> {
  const paths = resolveAppPaths(app.getPath('userData'));
  ensureAppDirectories(paths);
  const logger = createLogger(paths.logs, { echo: isDev || isSmoke });
  logger.info('app starting', { version: app.getVersion(), electron: process.versions.electron });

  const settings = new DeviceSettingsStore(
    paths.deviceSettings,
    app.getPreferredSystemLanguages(),
    logger,
  );
  nativeTheme.themeSource = settings.get().theme;

  const securityOptions = {
    ...(devUrl ? { devUrl } : {}),
    onRemoteRequest: (url: string) => remoteRequests.push(url),
  };
  hardenApp(app, securityOptions);
  hardenSession(session.defaultSession, securityOptions);

  try {
    workspace = (
      await openWorkspace({
        dbPath: paths.workspaceDb,
        backupsDir: paths.backups,
        migrations: MIGRATIONS,
        logger,
      })
    ).db;
  } catch (error) {
    await showStartupError(error as AppError, settings.get().language, paths.root);
    app.exit(1);
    return;
  }

  const handlers: IpcHandlers = {
    app: {
      info: () => ({ version: app.getVersion(), schemaVersion: LATEST_SCHEMA_VERSION }),
    },
    settings: {
      getDevice: () => settings.get(),
      updateDevice: (patch) => {
        const updated = settings.update(patch);
        if (patch.theme) {
          nativeTheme.themeSource = updated.theme;
          mainWindow?.setBackgroundColor(backgroundFor(updated.theme));
        }
        return updated;
      },
    },
  };
  const dispatch = createDispatcher({
    handlers,
    isTrustedSender: createSenderCheck({
      rendererDir: rendererDir(),
      ...(devUrl ? { devUrl } : {}),
    }),
    logger,
  });
  for (const channel of allIpcChannels()) {
    ipcMain.handle(channel, (event, ...args) =>
      dispatch(channel, event.senderFrame?.url ?? '', args),
    );
  }

  mainWindow = createMainWindow({
    settings,
    backgroundColor: backgroundFor(settings.get().theme),
    show: !isSmoke,
    ...(devUrl ? { devUrl } : {}),
    ...(iconPath() ? { iconPath: iconPath() as string } : {}),
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  if (isSmoke) {
    const ok = await runSmoke({ window: mainWindow, db: workspace, paths, remoteRequests });
    workspace.close();
    workspace = undefined;
    app.exit(ok ? 0 : 1);
  }
}

if (!app.requestSingleInstanceLock()) {
  // A second launch hands over to the running instance and exits (D05).
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(start);

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    workspace?.close();
    workspace = undefined;
  });
}
