// M5 acceptance: the list view, full-text search, filters and sorting. Search finds titles,
// descriptions and task keys including subtasks (D09: matching subtasks under a dimmed
// parent), sort/filters/columns survive a restart (D42), the board shares the filters (D43)
// and trashed tasks never appear. Selectors use test ids (D15).

import { expect, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

/** GAME-1 Inventory (HIGH) with GAME-2/3, GAME-4 Save game (trashed GAME-5), SND-1 in a second project. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const game = await api.projects.create({ key: 'GAME', name: 'Game Dev' });
    const sound = await api.projects.create({ key: 'SND', name: 'Sound' });
    const inventory = await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Implement inventory',
      priority: 'HIGH',
    });
    await api.tasks.create({
      projectId: game.id,
      type: 'SUBTASK',
      parentStoryId: inventory.id,
      title: 'Design slots',
    });
    await api.tasks.create({
      projectId: game.id,
      type: 'SUBTASK',
      parentStoryId: inventory.id,
      title: 'Item tooltips',
      descriptionMarkdown: 'Show the **weight** of every item.',
    });
    await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Save game',
      priority: 'LOW',
    });
    const trashed = await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Abandoned weight idea',
    });
    await api.tasks.trash(trashed.id);
    await api.tasks.create({ projectId: sound.id, type: 'STORY', title: 'Menu music weight' });
  });
  await page.reload();
}

const rows = (page: Page) => page.getByTestId('list-row');

async function rowLabels(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((elements) =>
    elements.map((row) => {
      const title = row.querySelector('[data-testid="list-title"]')?.textContent ?? '';
      const kind = (row as HTMLElement).dataset['kind'] === 'subtask' ? '  ' : '';
      return `${row.classList.contains('dimmed') ? '~' : ''}${kind}${title}`;
    }),
  );
}

async function pick(page: Page, filter: string, value: string): Promise<void> {
  await page.getByTestId(filter).locator('summary').click();
  await page.locator(`[data-testid="${filter}-option"][data-value="${value}"]`).check();
  await page.keyboard.press('Escape');
}

test('list view filters, sorts and remembers its state; the board shares the filters', async () => {
  const first = await launchApp(userData.dir);
  try {
    await seed(first.page);
    const { page } = first;
    await page.locator('[data-project-key="GAME"]').click();
    await page.getByTestId('view-list').click();
    await expect.poll(() => rowLabels(page)).toEqual(['Implement inventory', 'Save game']);

    // Search finds a subtask by description and by key, under its dimmed parent (D09).
    await page.getByTestId('filter-text').fill('weight');
    await expect.poll(() => rowLabels(page)).toEqual(['~Implement inventory', '  Item tooltips']);
    await page.getByTestId('filter-text').fill('GAME-2');
    await expect.poll(() => rowLabels(page)).toEqual(['~Implement inventory', '  Design slots']);
    await page.getByTestId('filter-text').fill('');

    await pick(page, 'filter-priority', 'LOW');
    await expect.poll(() => rowLabels(page)).toEqual(['Save game']);
    await page.getByTestId('filter-clear').click();
    await pick(page, 'filter-priority', 'HIGH');
    await page.getByTestId('sort-by').selectOption('title');
    await pick(page, 'list-columns', 'type');
    await expect(page.locator('[data-testid="list-row"] [data-column="type"]')).toHaveCount(1);
    await expect.poll(() => rowLabels(page)).toEqual(['Implement inventory']);

    // The board applies the same filter to story cards only.
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('card-title')).toHaveText(['Implement inventory']);
  } finally {
    await first.app.close();
  }

  const second = await launchApp(userData.dir);
  try {
    const { page } = second;
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('card-title')).toHaveText(['Implement inventory']);
    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('sort-by')).toHaveValue('title');
    await expect(page.locator('[data-testid="list-row"] [data-column="type"]')).toHaveCount(1);
    await expect(page.getByTestId('filter-priority').locator('.count')).toHaveText('1');
  } finally {
    await second.app.close();
  }
});

test('search covers one or all projects and never shows trashed tasks', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await seed(page);
    await page.locator('[data-project-key="GAME"]').click();
    // Opening the project makes it the last project, which search uses by default.
    await expect(page.getByTestId('project-key-badge')).toHaveText('GAME');
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('filter-text')).toBeFocused();
    await page.keyboard.type('weight');
    await expect.poll(() => rowLabels(page)).toEqual(['~Implement inventory', '  Item tooltips']);

    await page.getByTestId('search-scope-all').check();
    await expect
      .poll(async () => (await rowLabels(page)).sort())
      .toEqual(['  Item tooltips', 'Menu music weight', '~Implement inventory']);

    // Opening a hit and going back keeps the search (text and scope live in the URL).
    await page.getByTestId('list-title').filter({ hasText: 'Menu music weight' }).click();
    await expect(page.getByTestId('task-issue-key')).toHaveText('SND-1');
    await page.goBack();
    await expect(page.getByTestId('filter-text')).toHaveValue('weight');
    await expect(page.getByTestId('search-scope-all')).toBeChecked();
  } finally {
    await app.close();
  }
});
