// Packaged self-test (GLACIER_SMOKE=1): SQLite + FTS5 + backup API in the main process,
// renderer isolation, the preload API end to end, and zero network requests (UJ-08).
// Prints one `[smoke] {...}` line and writes it to GLACIER_SMOKE_RESULT if set.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Database } from 'better-sqlite3';
import {
  integrityCheck,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  snapshotDatabase,
} from '@glacier-tasks/data';
import { API_GLOBAL_NAME } from '@glacier-tasks/domain';
import type { AppPaths } from './paths.js';

export interface SmokeContext {
  window: BrowserWindow;
  db: Database;
  paths: AppPaths;
  remoteRequests: string[];
}

function checkDatabase(db: Database): { fts5: boolean } {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, project_key, name, next_issue_number, created_at, updated_at)
       VALUES ('smoke-p1', 'SMOKE', 'Smoke', 2, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
       VALUES ('smoke-s1', 'smoke-p1', 'To Do', 'TODO', 0, 1, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO tasks (id, project_id, issue_number, type, title, status_id, sort_order, created_at, updated_at)
       VALUES ('smoke-t1', 'smoke-p1', 1, 'STORY', 'Implement inventory', 'smoke-s1', 'V', ?, ?)`,
    ).run(now, now);
  })();
  const hits = db
    .prepare(`SELECT count(*) AS c FROM tasks_fts WHERE tasks_fts MATCH 'inventor*'`)
    .get() as { c: number };
  return { fts5: hits.c === 1 };
}

async function checkBackup(
  db: Database,
  paths: AppPaths,
): Promise<{ backup: boolean; integrity: string }> {
  const snapshotPath = join(paths.backups, 'smoke-snapshot.sqlite');
  await snapshotDatabase(db, snapshotPath);
  const snapshot = openDatabase(snapshotPath, { readonly: true });
  try {
    const rows = (snapshot.prepare('SELECT count(*) AS c FROM tasks').get() as { c: number }).c;
    return { backup: rows === 1, integrity: integrityCheck(snapshot) };
  } finally {
    snapshot.close();
  }
}

async function checkRenderer(window: BrowserWindow): Promise<Record<string, unknown>> {
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve, reject) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`Renderer failed to load: ${code} ${description}`)),
      );
    });
  }
  return (await window.webContents.executeJavaScript(`
    (async () => {
      const deadline = Date.now() + 15000;
      while (!document.querySelector('[data-testid="app-shell"]') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const api = window['${API_GLOBAL_NAME}'];
      let info = null;
      let invalidCall = null;
      try { info = await api.app.info(); } catch (error) { info = { error }; }
      try { await api.tasks.get('not-a-uuid'); invalidCall = 'resolved'; }
      catch (error) { invalidCall = error && error.code; }
      return {
        title: document.title,
        href: location.href,
        shell: !!document.querySelector('[data-testid="app-shell"]'),
        themeClass: document.documentElement.className,
        lang: document.documentElement.lang,
        nodeRequire: typeof require,
        nodeProcess: typeof process,
        apiFrozen: Object.isFrozen(api),
        info,
        invalidCall,
      };
    })()
  `)) as Record<string, unknown>;
}

export async function runSmoke(context: SmokeContext): Promise<boolean> {
  const result: Record<string, unknown> = { ok: false, electron: process.versions.electron };
  try {
    Object.assign(result, checkDatabase(context.db));
    Object.assign(result, await checkBackup(context.db, context.paths));
    const renderer = await checkRenderer(context.window);
    result['renderer'] = renderer;
    result['remoteRequests'] = context.remoteRequests;

    const info = renderer['info'] as { schemaVersion?: number } | null;
    result['ok'] =
      context.remoteRequests.length === 0 &&
      result['fts5'] === true &&
      result['backup'] === true &&
      result['integrity'] === 'ok' &&
      renderer['shell'] === true &&
      String(renderer['href']).includes('index.html#/') &&
      renderer['nodeRequire'] === 'undefined' &&
      renderer['nodeProcess'] === 'undefined' &&
      renderer['apiFrozen'] === true &&
      info?.schemaVersion === LATEST_SCHEMA_VERSION &&
      renderer['invalidCall'] === 'VALIDATION';
  } catch (error) {
    result['error'] = error instanceof Error ? error.message : String(error);
  }

  console.log(`[smoke] ${JSON.stringify(result)}`);
  const resultFile = process.env['GLACIER_SMOKE_RESULT'];
  if (resultFile) writeFileSync(resultFile, JSON.stringify(result, null, 2));
  return result['ok'] === true;
}
