// M7 acceptance: a complete backup/restore keeps two projects, profiles, stories, subtasks,
// history and attachment bytes, search works right after the restore and device settings
// stay as they are (D17, D20); a broken archive changes nothing (T9); permanent deletion needs
// the typed key and removes the bytes (D50); the JSON export is not restorable (D14).
// Native dialogs are replaced by GLACIER_TEST_DIALOG_PATH. Selectors use test ids (D15).

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;
let files: string;

test.beforeEach(() => {
  userData = createUserDataDir();
  files = mkdtempSync(join(tmpdir(), 'glacier-tasks-e2e-files-'));
});

test.afterEach(() => {
  userData.dispose();
  rmSync(files, { recursive: true, force: true });
});

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Seed {
  game: string;
  storyId: string;
}

async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async (png) => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const game = await api.projects.create({ key: 'GAME', name: 'Game Dev' });
    const sound = await api.projects.create({ key: 'SND', name: 'Sound' });
    const ann = await api.users.create({ name: 'Ann' });
    const story = await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Inventory slots',
      descriptionMarkdown: 'First version',
      assigneeUserId: ann.id,
    });
    await api.tasks.update(story.id, 1, { descriptionMarkdown: 'Second version' });
    await api.tasks.create({
      projectId: game.id,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Tooltip',
    });
    await api.tasks.create({ projectId: sound.id, type: 'STORY', title: 'Menu music' });
    const trashed = await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Old idea',
    });
    await api.tasks.trash(trashed.id);
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    await api.attachments.addFiles(story.id, [{ name: 'pixel.png', bytes }]);
    return { game: game.id, storyId: story.id };
  }, PNG_BASE64);
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('data-backup')).toBeVisible();
}

const attachmentFiles = () =>
  readdirSync(join(userData.dir, 'attachments')).filter((name) => name !== '.staging');

test('a complete backup restores everything and search works right away', async () => {
  const archive = join(files, 'backup.glaciertasks');
  const env = { GLACIER_TEST_DIALOG_PATH: archive };
  const first = await launchApp(userData.dir, env);
  let seeded: Seed;
  try {
    seeded = await seed(first.page);
    await first.page.reload();
    await openSettings(first.page);
    await first.page.getByTestId('data-backup').click();
    await expect(first.page.getByTestId('data-notice')).toContainText('backup.glaciertasks');
    expect(existsSync(archive)).toBe(true);

    // Change data and a device setting after the backup.
    await first.page.evaluate(async () => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      await api.projects.create({ key: 'NEW', name: 'Added later' });
      await api.settings.updateDevice({ theme: 'light' });
    });

    await first.page.getByTestId('data-restore').click();
    await expect(first.page.getByTestId('restore-preview')).toContainText('backup.glaciertasks');
    const closed = first.app.waitForEvent('close');
    await first.page.getByTestId('restore-confirm').click();
    await closed;
  } catch (error) {
    await first.app.close().catch(() => undefined);
    throw error;
  }

  // The next start activates the staged restore.
  const second = await launchApp(userData.dir, env);
  try {
    const { page } = second;
    await expect(page.getByTestId('notice-restored')).toBeVisible();
    const state = await page.evaluate(async (game) => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const projects = (await api.projects.list()).map((p) => p.key);
      const hits = await api.tasks.list({ projectId: game, text: 'slots' });
      const trash = await api.trash.list();
      const settings = await api.settings.getDevice();
      return {
        projects,
        hits: hits.items.map((r) => r.story.title),
        trash: trash.length,
        theme: settings.theme,
      };
    }, seeded.game);
    expect(state).toEqual({
      projects: ['GAME', 'SND'],
      hits: ['Inventory slots'],
      trash: 1,
      theme: 'light',
    });

    await page.evaluate(
      ({ game, story }) => {
        location.hash = `#/projects/${game}/tasks/${story}`;
      },
      { game: seeded.game, story: seeded.storyId },
    );
    await expect(page.getByTestId('task-description')).toHaveValue('Second version');
    await expect(page.getByTestId('subtask-list')).toContainText('Tooltip');
    const thumb = page.locator('[data-testid="attachment-preview"] img');
    await expect
      .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(1);
    await page.getByTestId('task-versions').click();
    await expect(page.getByTestId('version-item')).toHaveCount(2);
  } finally {
    await second.app.close();
  }
});

test('a damaged archive is rejected and nothing changes', async () => {
  const archive = join(files, 'broken.glaciertasks');
  writeFileSync(archive, 'PK\u0003\u0004 not really a zip');
  const { app, page } = await launchApp(userData.dir, { GLACIER_TEST_DIALOG_PATH: archive });
  try {
    await seed(page);
    await page.reload();
    await openSettings(page);
    await page.getByTestId('data-restore').click();
    await expect(page.getByTestId('data-error')).toBeVisible();
    await expect(page.getByTestId('restore-preview')).toHaveCount(0);
    expect(existsSync(join(userData.dir, 'restore-pending.json'))).toBe(false);
    const projects = await page.evaluate(
      async () => (await window.glacierTasks?.projects.list())?.length,
    );
    expect(projects).toBe(2);
  } finally {
    await app.close();
  }
});

test('permanent deletion needs the typed key and removes attachment bytes', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    const { storyId } = await seed(page);
    await page.evaluate(async (id) => {
      await window.glacierTasks?.tasks.trash(id);
    }, storyId);
    expect(attachmentFiles()).toHaveLength(1);

    await page.getByTestId('nav-trash').click();
    const row = page.locator('[data-trash-title="Inventory slots"]');
    await row.getByTestId('trash-purge').click();
    await expect(page.getByTestId('trash-confirm')).toBeDisabled();
    await page.getByTestId('trash-confirm-input').fill('GAME-9');
    await expect(page.getByTestId('trash-confirm')).toBeDisabled();
    await page.getByTestId('trash-confirm-input').fill('GAME-1');
    await page.getByTestId('trash-confirm').click();
    await expect(row).toHaveCount(0);
    await expect(page.locator('[data-trash-title="Old idea"]')).toHaveCount(1);
    expect(attachmentFiles()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test('the JSON export is clearly not a backup and cannot be restored', async () => {
  const exported = join(files, 'export.json');
  const { app, page } = await launchApp(userData.dir, { GLACIER_TEST_DIALOG_PATH: exported });
  try {
    await seed(page);
    await page.reload();
    await openSettings(page);
    await page.getByTestId('data-export').click();
    await expect(page.getByTestId('data-notice')).toContainText('export.json');
    const document = JSON.parse(readFileSync(exported, 'utf-8')) as Record<string, unknown>;
    expect(document['format']).toBe('glacier-tasks-export');
    expect(String(document['notice'])).toContain('NOT a backup');
    expect(JSON.stringify(document)).not.toContain(PNG_BASE64);

    await page.getByTestId('data-restore').click();
    await expect(page.getByTestId('data-error')).toBeVisible();
  } finally {
    await app.close();
  }
});
