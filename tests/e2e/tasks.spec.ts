// M3 acceptance: stories and subtasks, independent subtask completion, Markdown preview,
// subtask moves, trash/restore with cascade tracking, stale-save conflicts and restart
// persistence. Selectors use test ids because the UI language follows the OS (D15).

import { expect, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

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

async function createStory(page: Page, title: string): Promise<void> {
  await page.getByTestId('story-new').click();
  await page.getByTestId('story-title').fill(title);
  await page.getByTestId('story-create-submit').click();
  await expect(page.getByTestId('task-title')).toHaveValue(title);
}

async function addSubtask(page: Page, title: string): Promise<void> {
  await page.getByTestId('subtask-new-title').fill(title);
  await page.getByTestId('subtask-add').click();
  await expect(page.getByTestId('subtask-list')).toContainText(title);
}

function selectedText(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent?.trim());
}

test('stories, subtasks, Markdown and moves persist (UJ-01, UJ-02, D04)', async () => {
  const first = await launchApp(userData.dir);
  const { page } = first;
  try {
    await page.evaluate(async () => {
      await window.glacierTasks?.users.create({ name: 'Alex' });
      await window.glacierTasks?.users.create({ name: 'Sam' });
    });
    await createProject(page, 'Game Dev', 'GAME');
    await createStory(page, 'Implement inventory');
    await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-1');
    expect(await selectedText(page, 'task-status')).toBe('To Do');

    await addSubtask(page, 'Design slots');
    await addSubtask(page, 'Implement drag');

    // UJ-03: each subtask gets its own single assignee.
    for (const [key, name] of [
      ['GAME-2', 'Alex'],
      ['GAME-3', 'Sam'],
    ] as const) {
      await page.locator(`[data-issue-key="${key}"] .subtask-title`).click();
      await expect(page.getByTestId('task-issue-key')).toHaveText(key);
      await page.getByTestId('task-assignee').selectOption({ label: name });
      await page.getByTestId('task-save').click();
      await expect(page.getByTestId('task-saved')).toBeVisible();
      await page.getByTestId('parent-link').click();
      await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-1');
    }

    // UJ-02: finishing all subtasks never completes the story.
    for (const key of ['GAME-2', 'GAME-3']) {
      await page.locator(`[data-issue-key="${key}"] [data-testid="subtask-status"]`).selectOption({
        label: 'Done',
      });
    }
    await expect(page.getByTestId('subtask-progress')).toHaveText('2/2');
    await page.reload();
    await expect(page.getByTestId('subtask-progress')).toHaveText('2/2');
    expect(await selectedText(page, 'task-status')).toBe('To Do');

    // MD-01..05: rendered preview; scripts and remote images stay inert.
    await page
      .getByTestId('task-description')
      .fill(
        '## Plan\n\n- [x] slots\n- [ ] drag\n\n<script>window.pwned = 1</script>\n\n![remote](https://example.com/x.png)',
      );
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-saved')).toBeVisible();
    await page.getByTestId('tab-preview').click();
    const preview = page.getByTestId('task-preview');
    await expect(preview.locator('h2')).toHaveText('Plan');
    await expect(preview.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(preview.locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBe(
      undefined,
    );

    // D04: move a subtask to another story; its key stays.
    await page.getByTestId('task-issue-key').waitFor();
    await page.locator('[data-project-key="GAME"]').click();
    await createStory(page, 'Crafting');
    await page.locator('[data-project-key="GAME"]').click();
    await page.locator('[data-issue-key="GAME-1"]').click();
    await page.locator('[data-issue-key="GAME-2"] .subtask-title').click();
    await page.getByTestId('task-move-target').selectOption({ label: 'GAME-4 Crafting' });
    await page.getByTestId('task-move').click();
    await expect(page.getByTestId('parent-link')).toContainText('Crafting');
    await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-2');
  } finally {
    await first.app.close();
  }

  const second = await launchApp(userData.dir);
  try {
    const page2 = second.page;
    await expect(page2.getByTestId('project-title')).toHaveText('Game Dev');
    await expect(page2.locator('[data-issue-key="GAME-1"]')).toContainText('Implement inventory');
    await expect(
      page2.locator('[data-issue-key="GAME-1"] [data-testid="story-progress"]'),
    ).toHaveText('1/1');
    await expect(
      page2.locator('[data-issue-key="GAME-4"] [data-testid="story-progress"]'),
    ).toHaveText('1/1');
  } finally {
    await second.app.close();
  }
});

test('trash keeps independently trashed subtasks in the trash (UJ-06, D02, D39)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await createProject(page, 'Game Dev', 'GAME');
    await createStory(page, 'Inventory');
    await addSubtask(page, 'A');
    await addSubtask(page, 'B');

    await page.locator('[data-issue-key="GAME-2"] .subtask-title').click();
    await page.getByTestId('task-trash').click();
    await page.getByTestId('task-trash-confirm').click();
    await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-1');
    await expect(page.locator('[data-issue-key="GAME-2"]')).toHaveCount(0);

    await page.getByTestId('task-trash').click();
    await page.getByTestId('task-trash-confirm').click();
    await expect(page.getByTestId('project-title')).toHaveText('Game Dev');
    await expect(page.locator('[data-issue-key="GAME-1"]')).toHaveCount(0);

    await page.getByTestId('nav-trash').click();
    await expect(page.locator('[data-trash-title]')).toHaveCount(2);
    await page.locator('[data-trash-title="Inventory"] [data-testid="trash-restore"]').click();
    await expect(page.locator('[data-trash-title="Inventory"]')).toHaveCount(0);
    await expect(page.locator('[data-trash-title="A"]')).toHaveCount(1);

    await page.locator('[data-project-key="GAME"]').click();
    await page.locator('[data-issue-key="GAME-1"]').click();
    await expect(page.locator('[data-issue-key="GAME-3"]')).toContainText('B');
    await expect(page.locator('[data-issue-key="GAME-2"]')).toHaveCount(0);

    // Whole project: trash, then restore from the Trash page.
    await page.locator('[data-project-key="GAME"]').click();
    await page.getByTestId('project-settings-link').click();
    await page.getByTestId('project-trash').click();
    await page.getByTestId('project-trash-confirm').click();
    await expect(page.locator('[data-project-key="GAME"]')).toHaveCount(0);
    await page.getByTestId('nav-trash').click();
    await page.locator('[data-trash-title="Game Dev"] [data-testid="trash-restore"]').click();
    await expect(page.locator('[data-project-key="GAME"]')).toHaveCount(1);
    await expect(page.locator('[data-trash-title="A"]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('a stale save keeps the typed text and offers a reload (UJ-09, D05)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await createProject(page, 'Game Dev', 'GAME');
    await createStory(page, 'Inventory');
    await page.getByTestId('task-title').fill('My unsaved title');

    // Another writer (the M4 board, here the API) changes the story meanwhile.
    await page.evaluate(async () => {
      const api = window.glacierTasks;
      const [project] = (await api?.projects.list()) ?? [];
      const { items } = (await api?.tasks.query({ projectId: project?.id ?? null })) ?? {
        items: [],
      };
      await api?.tasks.update(items[0]?.id ?? '', 1, { priority: 'HIGH' });
    });

    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-conflict')).toBeVisible();
    await expect(page.getByTestId('task-draft')).toContainText('My unsaved title');

    await page.getByTestId('task-reload').click();
    await expect(page.getByTestId('task-title')).toHaveValue('Inventory');
    await expect(page.getByTestId('task-priority')).toHaveValue('HIGH');
    await expect(page.getByTestId('task-draft')).toContainText('My unsaved title');
  } finally {
    await app.close();
  }
});
