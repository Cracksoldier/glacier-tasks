// M6 acceptance: dropped files are copied into managed storage, previewable images render
// inline only for the same task (D10, D33), removal needs confirmation and leaves a history
// entry (D03), description versions can be compared (D11), and the project activity tab and
// profile history show events (D12). Selectors use test ids (D15).

import { expect, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

/** A valid 1×1 PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Seed {
  projectId: string;
  storyId: string;
  otherAttachmentId: string;
}

async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async () => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const project = await api.projects.create({ key: 'GAME', name: 'Game Dev' });
    const story = await api.tasks.create({
      projectId: project.id,
      type: 'STORY',
      title: 'Inventory',
    });
    const other = await api.tasks.create({ projectId: project.id, type: 'STORY', title: 'Other' });
    const [foreign] = await api.attachments.addFiles(other.id, [
      { name: 'foreign.txt', bytes: new TextEncoder().encode('not yours') },
    ]);
    return { projectId: project.id, storyId: story.id, otherAttachmentId: foreign?.id ?? '' };
  });
}

async function openTask(page: Page, projectId: string, taskId: string): Promise<void> {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#/projects/${projectId}/tasks/${taskId}`);
  await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-1');
}

/** Drops files on the attachment zone through a real DataTransfer. */
async function drop(
  page: Page,
  files: Array<{ name: string; base64?: string; text?: string; size?: number }>,
) {
  const transfer = await page.evaluateHandle((specs) => {
    const data = new DataTransfer();
    for (const spec of specs) {
      const bytes = spec.base64
        ? Uint8Array.from(atob(spec.base64), (c) => c.charCodeAt(0))
        : spec.size
          ? new Uint8Array(spec.size)
          : new TextEncoder().encode(spec.text ?? '');
      data.items.add(new File([bytes], spec.name));
    }
    return data;
  }, files);
  await page.getByTestId('attachment-drop').dispatchEvent('drop', { dataTransfer: transfer });
}

test('attachments render inline for their own task, removal is recorded, versions compare', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    const { projectId, storyId, otherAttachmentId } = await seed(page);
    await openTask(page, projectId, storyId);

    await drop(page, [
      { name: 'pixel.png', base64: PNG_BASE64 },
      { name: 'notes.txt', text: 'hello' },
    ]);
    await expect(page.getByTestId('attachment-item')).toHaveCount(2);
    await expect(page.getByTestId('attachment-preview')).toHaveCount(1);

    // Insert the image, then add a foreign attachment reference and a remote image.
    await page.getByTestId('attachment-insert').click();
    const description = page.getByTestId('task-description');
    await description.press('End');
    await description.pressSequentially(
      `![foreign](attachment:${otherAttachmentId}) ![remote](https://example.com/x.png)`,
    );
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-save')).toBeDisabled();

    await page.getByTestId('tab-preview').click();
    const images = page.locator('[data-testid="task-preview"] img');
    await expect(images).toHaveCount(1);
    await expect
      .poll(() => images.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(1);
    await expect(page.locator('[data-testid="task-preview"] .md-image')).toHaveCount(2);

    // D03: removal needs confirmation and stays in the history.
    await page
      .locator(
        '[data-testid="attachment-item"][data-name="notes.txt"] [data-testid="attachment-remove"]',
      )
      .click();
    await page.getByTestId('attachment-remove-confirm').click();
    await expect(page.getByTestId('attachment-item')).toHaveCount(1);
    await expect(page.getByTestId('activity-entry').first()).toContainText('notes.txt');

    // A second description version, then compare it with the first (D11).
    await page.getByTestId('tab-edit').click();
    await description.press('Control+End');
    await description.pressSequentially('\nSecond line');
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-save')).toBeDisabled();
    await page.getByTestId('task-versions').click();
    await expect(page.getByTestId('version-item')).toHaveCount(3);
    await page.getByTestId('version-mode-compare').click();
    await expect(page.locator('[data-testid="version-diff"] [data-kind="added"]')).toHaveText(
      /Second line/,
    );
  } finally {
    await app.close();
  }
});

test('size limit, project activity and profile history', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    const { projectId, storyId } = await seed(page);
    await page.evaluate(async () => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const user = await api.users.create({ name: 'Anne' });
      await api.users.update(user.id, { name: 'Ann' });
      await api.settings.updateDevice({ attachmentMaxMiB: 1 });
    });
    await page.reload();
    await openTask(page, projectId, storyId);

    await drop(page, [{ name: 'big.bin', size: 2 * 1024 * 1024 }]);
    await expect(page.getByTestId('attachment-error')).toBeVisible();
    await expect(page.getByTestId('attachment-item')).toHaveCount(0);

    await page.evaluate((hash) => {
      location.hash = hash;
    }, `#/projects/${projectId}`);
    await page.getByTestId('view-activity').click();
    await expect(page.getByTestId('project-activity')).toBeVisible();
    // project.created, two task.created, task.attachmentAdded on the other story
    await expect(page.getByTestId('activity-entry')).toHaveCount(4);

    await page.getByTestId('nav-profiles').click();
    await page.getByTestId('profile-history').click();
    await expect(
      page.locator('[data-testid="profile-history-dialog"] [data-testid="activity-entry"]'),
    ).toHaveCount(2);
    await expect(page.getByTestId('profile-history-dialog')).toContainText('Anne');
  } finally {
    await app.close();
  }
});
