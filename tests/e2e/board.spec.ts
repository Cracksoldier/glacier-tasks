// M4 acceptance: Kanban board with story cards only, drag & drop and keyboard moves that
// persist, subtask status changes from the expanded card, and the status delete wizard that
// migrates live and trashed tasks atomically (UJ-02, UJ-04). Selectors use test ids (D15).

import { expect, type Locator, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

/** Seeds a project through the API and opens its board. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const project = await api.projects.create({ key: 'GAME', name: 'Game Dev' });
    const inventory = await api.tasks.create({
      projectId: project.id,
      type: 'STORY',
      title: 'Implement inventory',
    });
    await api.tasks.create({
      projectId: project.id,
      type: 'SUBTASK',
      parentStoryId: inventory.id,
      title: 'Design slots',
    });
    await api.tasks.create({
      projectId: project.id,
      type: 'SUBTASK',
      parentStoryId: inventory.id,
      title: 'Drag items',
    });
    await api.tasks.create({ projectId: project.id, type: 'STORY', title: 'Save game' });
  });
  await page.reload();
  await page.locator('[data-project-key="GAME"]').click();
  await expect(page.getByTestId('board')).toBeVisible();
}

const column = (page: Page, name: string): Locator =>
  page.locator(`[data-column="${name}"] .card-item`);

/** CDK drag needs real pointer movement with intermediate steps. */
async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag target not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 15 });
  await page.mouse.up();
}

test('stories move by drag and keyboard and stay there after a restart (BOARD-01..05)', async () => {
  const first = await launchApp(userData.dir);
  const { page } = first;
  try {
    await seed(page);
    await expect(page.locator('[data-column] h2')).toHaveText(['To Do', 'In Progress', 'Done']);
    // Subtasks are never top-level cards (BOARD-03).
    await expect(page.locator('.card-item')).toHaveCount(2);
    await expect(column(page, 'To Do')).toHaveCount(2);

    await drag(
      page,
      page.locator('.card-item[data-issue-key="GAME-1"] .story-card'),
      page.locator('[data-column="In Progress"] .cards'),
    );
    await expect(column(page, 'In Progress')).toHaveCount(1);
    await expect(column(page, 'In Progress').first()).toHaveAttribute('data-issue-key', 'GAME-1');

    // Keyboard alternative: the card's status select.
    await page
      .locator('.card-item[data-issue-key="GAME-4"] [data-testid="card-status"]')
      .selectOption({ label: 'Done' });
    await expect(column(page, 'Done')).toHaveCount(1);
    await expect(column(page, 'To Do')).toHaveCount(0);
  } finally {
    await first.app.close();
  }

  const second = await launchApp(userData.dir);
  try {
    const page2 = second.page;
    await expect(page2.getByTestId('board')).toBeVisible();
    await expect(column(page2, 'In Progress').first()).toHaveAttribute('data-issue-key', 'GAME-1');
    await expect(column(page2, 'Done').first()).toHaveAttribute('data-issue-key', 'GAME-4');
    // Moving the story did not touch its subtasks (TASK-05).
    await page2
      .locator('.card-item[data-issue-key="GAME-1"] [data-testid="card-progress"]')
      .click();
    const statuses = page2.locator(
      '.card-item[data-issue-key="GAME-1"] [data-testid="card-subtask-status"]',
    );
    await expect(statuses).toHaveCount(2);
    for (const select of await statuses.all()) {
      expect(await select.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe(
        'To Do',
      );
    }
  } finally {
    await second.app.close();
  }
});

test('finishing all subtasks on the card never completes the story (UJ-02, D06)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await seed(page);
    const card = page.locator('.card-item[data-issue-key="GAME-1"]');
    await card.getByTestId('card-progress').click();
    for (const key of ['GAME-2', 'GAME-3']) {
      await card
        .locator(`[data-issue-key="${key}"] [data-testid="card-subtask-status"]`)
        .selectOption({ label: 'Done' });
    }
    await expect(card.getByTestId('card-progress')).toContainText('2/2');
    await expect(column(page, 'To Do').first()).toHaveAttribute('data-issue-key', 'GAME-1');
    await expect(column(page, 'Done')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('deleting a status migrates live and trashed tasks (UJ-04, D01, D07)', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    await seed(page);
    await page.getByTestId('project-settings-link').click();
    await page.getByTestId('status-new-name').fill('Review');
    await page.getByTestId('status-add').click();
    await expect(page.locator('[data-status-name="Review"]')).toBeVisible();

    // A live and a trashed story in "Review".
    await page.evaluate(async () => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const [project] = await api.projects.list();
      const statuses = await api.workflows.list(project?.id ?? '');
      const review = statuses.find((s) => s.name === 'Review');
      const { items } = await api.tasks.query({ projectId: project?.id ?? null, types: ['STORY'] });
      for (const story of items) await api.tasks.move(story.id, story.version, review?.id ?? '');
      const save = (
        await api.tasks.query({ projectId: project?.id ?? null, types: ['STORY'] })
      ).items.find((s) => s.title === 'Save game');
      await api.tasks.trash(save?.id ?? '');
    });

    // D07: the only Done status cannot go.
    await page.locator('[data-status-name="Done"] [data-testid="status-delete"]').click();
    await page.getByTestId('wizard-replacement').selectOption({ label: 'To Do' });
    await page.getByTestId('wizard-confirm').click();
    await expect(page.getByTestId('wizard-error')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('[data-status-name="Review"] [data-testid="status-delete"]').click();
    await expect(page.getByTestId('wizard-usage')).toContainText('1');
    await page.getByTestId('wizard-replacement').selectOption({ label: 'In Progress' });
    await page.getByTestId('wizard-confirm').click();
    await expect(page.locator('[data-status-name="Review"]')).toHaveCount(0);

    await page.locator('[data-project-key="GAME"]').click();
    await expect(column(page, 'In Progress').first()).toHaveAttribute('data-issue-key', 'GAME-1');

    await page.getByTestId('nav-trash').click();
    await page.locator('[data-trash-title="Save game"] [data-testid="trash-restore"]').click();
    await page.locator('[data-project-key="GAME"]').click();
    await expect(column(page, 'In Progress')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('grouped by subtasks, a subtask is dragged into another status on its own (BOARD-07, D51)', async () => {
  const first = await launchApp(userData.dir);
  try {
    const { page } = first;
    await seed(page);
    await page.getByTestId('board-group-subtasks').click();
    const lane = page.locator('[data-lane="GAME-1"]');
    await expect(lane.locator('[data-column="To Do"] [data-testid="lane-card"]')).toHaveCount(2);
    await expect(page.locator('[data-lane="other"] [data-testid="lane-card"]')).toHaveCount(1);

    const card = lane.locator('[data-testid="lane-card"][data-issue-key="GAME-2"]');
    await drag(page, card, lane.locator('[data-column="Done"] .lane-cards'));
    await expect(lane.locator('[data-column="Done"] [data-testid="lane-card"]')).toHaveCount(1);

    const states = await page.evaluate(async () => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const [project] = await api.projects.list();
      const statuses = new Map(
        (await api.workflows.list(project?.id as string)).map((s) => [s.id, s.name]),
      );
      const tasks = (await api.tasks.query({ projectId: project?.id as string })).items;
      return Object.fromEntries(tasks.map((t) => [t.issueKey, statuses.get(t.statusId)]));
    });
    expect(states).toMatchObject({ 'GAME-1': 'To Do', 'GAME-2': 'Done', 'GAME-3': 'To Do' });
  } finally {
    await first.app.close();
  }

  // The grouping is remembered per project (D51).
  const second = await launchApp(userData.dir);
  try {
    await expect(second.page.getByTestId('board-lanes')).toBeVisible();
    await expect(second.page.getByTestId('board-group-subtasks')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  } finally {
    await second.app.close();
  }
});
