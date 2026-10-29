// Security hardening for sessions and web contents (docs/threat-model.md T1, T6, T7).

import { type App, Menu, type Session, shell, type WebContents } from 'electron';

export interface SecurityOptions {
  /** Angular dev server origin, only set in development. */
  devUrl?: string;
  /** Called for every blocked remote request (smoke mode records them). */
  onRemoteRequest?: (url: string) => void;
}

const REMOTE_URL = /^(?:https?|wss?|ftp):/i;

export function hardenApp(app: App, options: SecurityOptions): void {
  // D38: no native menu bar; standard edit shortcuts still work in text fields.
  Menu.setApplicationMenu(null);

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, options));
}

export function hardenSession(session: Session, options: SecurityOptions): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  // T7: the app never talks to the network. Only the dev server (HTTP + HMR websocket) is
  // reachable in development.
  const devOrigins = options.devUrl
    ? [options.devUrl, options.devUrl.replace(/^http/, 'ws')].map((url) => `${url}/`)
    : [];
  session.webRequest.onBeforeRequest((details, callback) => {
    const isDevServer =
      devOrigins.some((origin) => details.url.startsWith(origin)) ||
      (options.devUrl !== undefined && details.url === options.devUrl);
    const isRemote = REMOTE_URL.test(details.url) && !isDevServer;
    if (isRemote) options.onRemoteRequest?.(details.url);
    callback({ cancel: isRemote });
  });
}

function hardenWebContents(contents: WebContents, options: SecurityOptions): void {
  contents.on('will-navigate', (event, url) => {
    const isDevReload = options.devUrl !== undefined && url.startsWith(options.devUrl);
    if (!isDevReload) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    // External links are handed to the OS browser only on explicit user action (MD-03).
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (options.devUrl) {
    contents.on('before-input-event', (_event, input) => {
      const toggle =
        input.type === 'keyDown' &&
        (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I'));
      if (toggle) contents.toggleDevTools();
    });
  }
}
