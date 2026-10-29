// Assertions use test ids: the UI language follows the OS on first launch (D15).
// M2 acceptance: two independent projects, global profiles with a managed avatar that
// survives deletion of its source file, last-project persistence and stored activity events.

import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { APP_DIR, createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

async function createProject(page: Page, name: string, key: string): Promise<void> {
  await page.getByTestId('project-new').click();
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-key').fill(key);
  await page.getByTestId('project-create-submit').click();
  await expect(page.getByTestId('project-title')).toHaveText(name);
}

test('projects, profiles and avatars persist locally (M2)', async () => {
  // A real PNG outside the app data directory; it is deleted after the import.
  const sourcePng = join(userData.dir, '..', `glacier-e2e-avatar-${Date.now()}.png`);
  copyFileSync(join(APP_DIR, 'build', 'icons', '64x64.png'), sourcePng);

  const first = await launchApp(userData.dir);
  const { page } = first;
  try {
    await expect(page.getByTestId('project-new-empty')).toBeVisible();
    await createProject(page, 'Alpha', 'ALPHA');
    await createProject(page, 'Beta Project', 'BETA');

    // D08: keys are unique, case-insensitively.
    await page.getByTestId('project-new').click();
    await page.getByTestId('project-name').fill('Duplicate');
    await page.getByTestId('project-key').fill('alpha');
    await page.getByTestId('project-create-submit').click();
    await expect(page.getByTestId('project-key-error')).toBeVisible();
    await page.keyboard.press('Escape');

    // Each project has its own seeded workflow (D32).
    await page.locator('[data-project-key="ALPHA"]').click();
    await page.getByTestId('project-settings-link').click();
    await expect(page.getByTestId('status-list').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('status-list')).toContainText('In Progress');

    // A global profile with an avatar picked through the (stubbed) native dialog.
    await page.getByTestId('nav-profiles').click();
    await page.getByTestId('profile-new').click();
    await page.getByTestId('profile-name').fill('Ann Example');
    await page.getByTestId('profile-save').click();
    await first.app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as never;
    }, sourcePng);
    await page.getByTestId('avatar-choose').click();
    await expect(page.getByTestId('avatar-remove')).toBeVisible();
    await page.getByTestId('profile-close').click();
    rmSync(sourcePng);

    // Last opened project (PROJ-02).
    await page.locator('[data-project-key="BETA"]').click();
    await expect(page.getByTestId('project-title')).toHaveText('Beta Project');
  } finally {
    rmSync(sourcePng, { force: true });
    await first.app.close();
  }

  const second = await launchApp(userData.dir);
  try {
    const page2 = second.page;
    await expect(page2.getByTestId('project-title')).toHaveText('Beta Project');

    await page2.getByTestId('nav-profiles').click();
    const ann = page2.locator('[data-profile-name="Ann Example"]');
    const image = ann.getByTestId('avatar-image');
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(64);

    // D29: archive hides the profile from the default list, nothing is deleted.
    await ann.getByTestId('profile-archive').click();
    await expect(ann).toHaveCount(0);
    await page2.getByTestId('show-archived').check();
    await expect(ann.getByTestId('profile-archived-badge')).toBeVisible();

    // D12: project and profile events are stored.
    const events = await page2.evaluate(async () => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const alpha = (await api.projects.list()).find((p) => p.key === 'ALPHA');
      const user = (await api.users.list(true)).find((u) => u.name === 'Ann Example');
      if (!alpha || !user) throw new Error('seed data missing');
      return {
        project: (await api.activity.forProject(alpha.id)).items.map((e) => e.eventType),
        user: (await api.activity.forEntity('USER', user.id)).map((e) => e.eventType),
      };
    });
    expect(events).toEqual({
      project: ['project.created'],
      user: ['user.archived', 'user.avatarChanged', 'user.created'],
    });
  } finally {
    await second.app.close();
  }
});

test('a missing avatar file falls back to initials', async () => {
  const sourcePng = join(userData.dir, '..', `glacier-e2e-avatar-${Date.now()}-b.png`);
  copyFileSync(join(APP_DIR, 'build', 'icons', '32x32.png'), sourcePng);
  const first = await launchApp(userData.dir);
  try {
    await first.page.getByTestId('nav-profiles').click();
    await first.page.getByTestId('profile-new').click();
    await first.page.getByTestId('profile-name').fill('Bob Builder');
    await first.page.getByTestId('profile-save').click();
    await first.app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as never;
    }, sourcePng);
    await first.page.getByTestId('avatar-choose').click();
    await expect(first.page.getByTestId('avatar-remove')).toBeVisible();
  } finally {
    rmSync(sourcePng, { force: true });
    await first.app.close();
  }

  // Delete the managed bytes behind the app's back; the profile keeps working.
  rmSync(join(userData.dir, 'avatars'), { recursive: true, force: true });

  const second = await launchApp(userData.dir);
  try {
    await second.page.getByTestId('nav-profiles').click();
    const bob = second.page.locator('[data-profile-name="Bob Builder"]');
    await expect(bob.getByTestId('avatar-initials')).toHaveText('BB');
  } finally {
    await second.app.close();
  }
});
