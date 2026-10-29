// Electron main process — M0 skeleton.
//
// Establishes the security baseline (docs/threat-model.md) and the workspace database
// lifecycle. Smoke mode (GLACIER_SMOKE=1) exercises SQLite, FTS5, the backup API and the
// renderer in a packaged build and prints one `[smoke] {...}` JSON line.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import type { Database } from 'better-sqlite3';
import {
  integrityCheck,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrate,
  openDatabase,
  snapshotDatabase,
} from '@glacier-tasks/data';
import { API_GLOBAL_NAME, APP_NAME } from '@glacier-tasks/domain';

const isSmoke = process.env['GLACIER_SMOKE'] === '1';
const WORKSPACE_FILE = 'glacier-tasks.sqlite';

if (isSmoke) {
  app.setPath(
    'userData',
    process.env['GLACIER_SMOKE_USER_DATA'] ?? mkdtempSync(join(tmpdir(), 'glacier-tasks-smoke-')),
  );
}

let workspace: Database | undefined;
let mainWindow: BrowserWindow | undefined;

function createWindow(show: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show,
    title: APP_NAME,
    backgroundColor: '#0d1b2a',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // No in-app navigation away from the bundled renderer, no new windows (threat model T6).
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
  return window;
}

function openWorkspace(): Database {
  const db = openDatabase(join(app.getPath('userData'), WORKSPACE_FILE), { wal: true });
  migrate(db, MIGRATIONS);
  return db;
}

async function runSmoke(): Promise<void> {
  const result: Record<string, unknown> = { ok: false, electron: process.versions.electron };
  // Offline guarantee (UJ-08): record and cancel every network request.
  const remoteRequests: string[] = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const isRemote = /^(?:https?|wss?|ftp):/i.test(details.url);
    if (isRemote) remoteRequests.push(details.url);
    callback({ cancel: isRemote });
  });
  try {
    const db = openWorkspace();
    workspace = db;
    result['schemaVersion'] = LATEST_SCHEMA_VERSION;

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO projects (id, project_key, name, next_issue_number, created_at, updated_at)
         VALUES ('p1', 'GAME', 'Game Dev', 2, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
         VALUES ('s1', 'p1', 'To Do', 'TODO', 0, 1, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO tasks (id, project_id, issue_number, type, title, status_id, sort_order, created_at, updated_at)
         VALUES ('t1', 'p1', 1, 'STORY', 'Implement inventory', 's1', 'V', ?, ?)`,
      ).run(now, now);
    })();
    const hits = db
      .prepare(`SELECT count(*) AS c FROM tasks_fts WHERE tasks_fts MATCH 'inventor*'`)
      .get() as { c: number };
    result['fts5'] = hits.c === 1;

    const snapshotPath = join(app.getPath('userData'), 'snapshot.sqlite');
    await snapshotDatabase(db, snapshotPath);
    const snapshot = openDatabase(snapshotPath, { readonly: true });
    result['integrity'] = integrityCheck(snapshot);
    result['backup'] =
      (snapshot.prepare('SELECT count(*) AS c FROM tasks').get() as { c: number }).c === 1;
    snapshot.close();

    const window = createWindow(false);
    mainWindow = window;
    await new Promise<void>((resolve, reject) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.once('did-fail-load', (_e, code, description) =>
        reject(new Error(`Renderer failed to load: ${code} ${description}`)),
      );
    });
    const renderer = (await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          const heading = document.querySelector('h1');
          if (heading || Date.now() > deadline) {
            resolve({
              title: document.title,
              heading: heading ? heading.textContent : null,
              nodeRequire: typeof require,
              nodeProcess: typeof process,
              api: typeof window['${API_GLOBAL_NAME}'],
            });
          } else {
            setTimeout(poll, 50);
          }
        };
        poll();
      })
    `)) as Record<string, unknown>;
    result['renderer'] = renderer;
    result['remoteRequests'] = remoteRequests;

    result['ok'] =
      remoteRequests.length === 0 &&
      result['fts5'] === true &&
      result['backup'] === true &&
      result['integrity'] === 'ok' &&
      renderer['heading'] === APP_NAME &&
      renderer['nodeRequire'] === 'undefined' &&
      renderer['nodeProcess'] === 'undefined' &&
      renderer['api'] === 'object';
  } catch (error) {
    result['error'] = error instanceof Error ? error.message : String(error);
  }
  console.log(`[smoke] ${JSON.stringify(result)}`);
  const resultFile = process.env['GLACIER_SMOKE_RESULT'];
  if (resultFile) writeFileSync(resultFile, JSON.stringify(result, null, 2));
  workspace?.close();
  workspace = undefined;
  app.exit(result['ok'] === true ? 0 : 1);
}

if (!isSmoke && !app.requestSingleInstanceLock()) {
  // A second launch focuses the existing window (D05).
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  void app.whenReady().then(async () => {
    if (isSmoke) {
      await runSmoke();
      return;
    }
    workspace = openWorkspace();
    mainWindow = createWindow(true);
  });

  app.on('window-all-closed', () => {
    workspace?.close();
    workspace = undefined;
    app.quit();
  });
}
