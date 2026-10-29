// Main window creation with persisted bounds (ported from Glacier Notes' window-state.ts).

import { join } from 'node:path';
import { BrowserWindow, type Rectangle, screen } from 'electron';
import { APP_NAME } from '@glacier-tasks/domain';
import type { DeviceSettingsStore, WindowState } from './device-settings.js';

const DEFAULT_SIZE = { width: 1280, height: 800 };
const MIN_SIZE = { width: 900, height: 600 };
const SAVE_DEBOUNCE_MS = 500;

/** Matches --color-bg of the Glacier tokens, so no white flash appears before the UI paints. */
export const WINDOW_BACKGROUND = { dark: '#0d1b2a', light: '#f4f7fa' } as const;

export interface MainWindowOptions {
  settings: DeviceSettingsStore;
  backgroundColor: string;
  show: boolean;
  devUrl?: string;
  iconPath?: string;
}

function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: area }) => {
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function restoredBounds(state: WindowState | null): Partial<Rectangle> {
  const bounds = state?.bounds;
  if (
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    isVisibleOnSomeDisplay(bounds as Rectangle)
  ) {
    return bounds;
  }
  return {
    width: Math.max(bounds?.width ?? DEFAULT_SIZE.width, MIN_SIZE.width),
    height: Math.max(bounds?.height ?? DEFAULT_SIZE.height, MIN_SIZE.height),
  };
}

export function rendererDir(): string {
  return join(__dirname, 'renderer');
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const state = options.settings.getWindowState();
  const window = new BrowserWindow({
    ...restoredBounds(state),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: APP_NAME,
    backgroundColor: options.backgroundColor,
    autoHideMenuBar: true,
    ...(options.iconPath ? { icon: options.iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (state?.isMaximized) window.maximize();
  if (options.show) window.once('ready-to-show', () => window.show());

  let saveTimer: NodeJS.Timeout | undefined;
  const save = () => {
    if (window.isDestroyed()) return;
    const isMaximized = window.isMaximized();
    options.settings.setWindowState({
      bounds: isMaximized ? window.getNormalBounds() : window.getBounds(),
      isMaximized,
    });
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event as 'resize', scheduleSave);
  }
  window.on('close', () => {
    clearTimeout(saveTimer);
    save();
  });

  if (options.devUrl) {
    // Surface renderer errors (CSP violations, exceptions) in the dev terminal.
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error' || details.level === 'warning') {
        console.log(`[renderer:${details.level}] ${details.message}`);
      }
    });
    void window.loadURL(options.devUrl);
  } else {
    void window.loadFile(join(rendererDir(), 'index.html'));
  }
  return window;
}
