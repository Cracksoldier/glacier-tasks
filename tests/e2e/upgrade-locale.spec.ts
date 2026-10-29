// M8 recovery and language checks: a workspace from an older schema version is upgraded on
// start with a safety copy and stays searchable (§11, D28 path for live data); native date
// fields follow the UI language after a restart (D52). Selectors use test ids (D15).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { MIGRATIONS, migrate, openDatabase } from '@glacier-tasks/data';
import { createUserDataDir, launchApp, processExit } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

test('a workspace from schema version 1 is upgraded with a safety copy and stays usable', async () => {
  // A schema-1 workspace with the fraction-only sort keys of that version.
  const db = openDatabase(join(userData.dir, 'glacier-tasks.sqlite'));
  migrate(db, MIGRATIONS.slice(0, 1));
  const now = '2026-10-01T10:00:00.000Z';
  db.exec(`
    INSERT INTO projects (id, project_key, name, next_issue_number, created_at, updated_at)
    VALUES ('11111111-1111-4111-8111-111111111111', 'OLD', 'Old project', 3, '${now}', '${now}');
    INSERT INTO statuses (id, project_id, name, category, position, is_default, created_at, updated_at)
    VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
            'To Do', 'TODO', 0, 1, '${now}', '${now}');
    INSERT INTO tasks (id, project_id, issue_number, type, title, status_id, sort_order, created_at, updated_at)
    VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 1,
            'STORY', 'Second card', '22222222-2222-4222-8222-222222222222', 'V', '${now}', '${now}'),
           ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 2,
            'STORY', 'First card', '22222222-2222-4222-8222-222222222222', '0V', '${now}', '${now}');
  `);
  db.close();

  const { app, page } = await launchApp(userData.dir);
  try {
    const info = await page.evaluate(() => window.glacierTasks?.app.info());
    expect(info?.schemaVersion).toBe(2);
    expect(
      readdirSync(join(userData.dir, 'backups')).some((name) =>
        name.startsWith('pre-migration-v1-'),
      ),
    ).toBe(true);

    await page.locator('[data-project-key="OLD"]').click();
    await page.getByTestId('view-board').click();
    // The migrated sort keys keep the old order.
    await expect(page.getByTestId('card-title')).toHaveText(['First card', 'Second card']);
    const hits = await page.evaluate(async () => {
      const api = window.glacierTasks;
      const [project] = (await api?.projects.list()) ?? [];
      return (await api?.tasks.query({ projectId: project?.id ?? null, text: 'second' }))?.items
        .length;
    });
    expect(hits).toBe(1);
  } finally {
    await app.close();
  }
  expect(existsSync(join(userData.dir, 'glacier-tasks.sqlite'))).toBe(true);
});

test('date fields switch to the UI language after a restart (D52)', async () => {
  // GLACIER_TEST_DIALOG_PATH puts the app in test mode, where "Restart now" only exits.
  const env = { GLACIER_TEST_DIALOG_PATH: join(userData.dir, 'unused') };

  /** Chooses a UI language in Settings, restarts, and returns Chromium's language. */
  async function switchAndRestart(language: 'en' | 'de'): Promise<string> {
    const before = await launchApp(userData.dir, env);
    try {
      await before.page.getByTestId('nav-settings').click();
      await before.page.getByTestId(`language-${language}`).check();
      // A restart is only offered when Chromium started with another language.
      const started = await before.page.evaluate(() => window.glacierTasks?.app.info());
      if (started?.startLanguage === language) {
        await expect(before.page.getByTestId('restart-hint')).toHaveCount(0);
        return before.page.evaluate(() => navigator.language);
      }
      const closed = processExit(before.app);
      await before.page.getByTestId('restart-now').click();
      await closed;
    } catch (error) {
      await before.app.close().catch(() => undefined);
      throw error;
    }
    const after = await launchApp(userData.dir, env);
    try {
      await after.page.getByTestId('nav-settings').click();
      await expect(after.page.getByTestId('restart-hint')).toHaveCount(0);
      return await after.page.evaluate(() => navigator.language);
    } finally {
      await after.app.close();
    }
  }

  expect(await switchAndRestart('en')).toMatch(/^en/);
  expect(await switchAndRestart('de')).toMatch(/^de/);
});
