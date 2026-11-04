// Opt-in system tray (D59): closing or minimizing the window can hide it to the tray. The tray
// icon only exists while one of the two options is on.

import { join } from 'node:path';
import {
  type BrowserWindow,
  Menu,
  type NativeImage,
  Notification,
  nativeImage,
  Tray,
} from 'electron';
import { APP_NAME, type DeviceSettings, type Language } from '@glacier-tasks/domain';
import type { DeviceSettingsStore } from './device-settings.js';
import type { Logger } from './logger.js';

const TRAY_TEXT = {
  en: {
    open: `Open ${APP_NAME}`,
    quit: 'Quit',
    hint: `${APP_NAME} is still running in the system tray. Use the tray icon to open or quit it.`,
  },
  de: {
    open: `${APP_NAME} öffnen`,
    quit: 'Beenden',
    hint: `${APP_NAME} läuft im Infobereich weiter. Über das Symbol dort öffnen oder beenden.`,
  },
} as const satisfies Record<Language, Record<string, string>>;

export interface TrayControllerOptions {
  settings: DeviceSettingsStore;
  logger: Logger;
  /** Really quits the app; called from the tray menu. */
  onQuit: () => void;
}

function trayIcon(): NativeImage {
  // Windows: 16 px with a @2x variant for HiDPI. Linux panels draw tray icons at 22–24 px.
  const file = process.platform === 'linux' ? 'tray-linux.png' : 'tray.png';
  return nativeImage.createFromPath(join(__dirname, file));
}

export class TrayController {
  private tray: Tray | undefined;
  private window: BrowserWindow | undefined;
  private language: Language | undefined;
  private closeToTray = false;
  private minimizeToTray = false;
  private quitting = false;
  /** Set while the window is hidden in the tray, so a window that isn't shown yet is left alone. */
  private hiddenInTray = false;

  constructor(private readonly options: TrayControllerOptions) {}

  /** Hooks the window's close and minimize events; call once after creating it. */
  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('close', (event) => {
      if (this.quitting || !this.tray || !this.closeToTray) return;
      event.preventDefault();
      this.hideWindow();
    });
    window.on('minimize', () => {
      if (this.tray && this.minimizeToTray) this.hideWindow();
    });
    // Windows shutdown or logoff: let the window close so the session can end.
    window.on('query-session-end', () => this.markQuitting());
    window.on('session-end', () => this.markQuitting());
    window.on('closed', () => {
      this.window = undefined;
    });
  }

  /** Creates, updates or removes the tray icon to match the settings. */
  sync(settings: DeviceSettings): void {
    this.closeToTray = settings.closeToTray;
    this.minimizeToTray = settings.minimizeToTray;
    const wanted = settings.closeToTray || settings.minimizeToTray;

    if (!wanted) {
      this.tray?.destroy();
      this.tray = undefined;
      this.language = undefined;
      // Never leave the window hidden without a way back.
      if (this.hiddenInTray) this.show();
      return;
    }
    if (!this.tray) {
      try {
        this.tray = new Tray(trayIcon());
      } catch (error) {
        this.options.logger.error('tray icon could not be created', { error });
        return;
      }
      this.tray.setToolTip(APP_NAME);
      this.tray.on('click', () => this.show());
    }
    if (this.language !== settings.language) {
      this.language = settings.language;
      const text = TRAY_TEXT[settings.language];
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: text.open, click: () => this.show() },
          { type: 'separator' },
          { label: text.quit, click: () => this.options.onQuit() },
        ]),
      );
    }
  }

  /** Brings the window back, from the tray or from being minimized (also on a second launch). */
  show(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    this.hiddenInTray = false;
    // A window hidden by minimizing is still minimized.
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  }

  /** From now on, closing the window really closes it. */
  markQuitting(): void {
    this.quitting = true;
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private hideWindow(): void {
    if (!this.window) return;
    this.hiddenInTray = true;
    this.window.hide();
    this.showHintOnce();
  }

  private showHintOnce(): void {
    const { settings, logger } = this.options;
    if (settings.trayHintShown()) return;
    // Without notification support there is nothing to show, now or later.
    settings.markTrayHintShown();
    if (!Notification.isSupported()) return;
    try {
      new Notification({
        title: APP_NAME,
        body: TRAY_TEXT[this.language ?? settings.get().language].hint,
        silent: true,
      }).show();
    } catch (error) {
      logger.warn('tray hint could not be shown', { error });
    }
  }
}
