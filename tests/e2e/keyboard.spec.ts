// M8 keyboard paths: the core CRUD and status flows work without a mouse — focus, type and
// press Enter/Space/Escape only — and dialogs give the focus back when they close.
// Selectors use test ids (D15).

import { expect, type Page, test } from '@playwright/test';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

/** Moves the keyboard focus to a control and activates it with Enter. */
async function press(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).focus();
  await page.keyboard.press('Enter');
}

test('projects, stories, subtasks, status changes and trash work by keyboard', async () => {
  const { app, page } = await launchApp(userData.dir);
  try {
    // A project through the create dialog.
    await press(page, 'project-new');
    await expect(page.getByTestId('project-name')).toBeFocused();
    await page.keyboard.type('Keyboard Project');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('project-key-badge')).toHaveText('KP');

    // A story, then a subtask in the editor.
    await press(page, 'story-new');
    await expect(page.getByTestId('story-title')).toBeFocused();
    await page.keyboard.type('Write the manual');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-issue-key')).toHaveText('KP-1');
    await page.getByTestId('subtask-new-title').focus();
    await page.keyboard.type('Chapter one');
    await press(page, 'subtask-add');
    await expect(page.getByTestId('subtask-list')).toContainText('Chapter one');

    // Edit and save with the keyboard.
    await page.getByTestId('task-title').focus();
    await page.keyboard.press('End');
    await page.keyboard.type(' v2');
    await expect(page.getByTestId('task-save')).toBeEnabled();
    await press(page, 'task-save');
    await expect(page.getByTestId('task-saved')).toBeVisible();

    // Trash with the confirmation dialog; Escape closes it and returns the focus.
    await press(page, 'task-trash');
    await expect(page.getByTestId('task-trash-confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-trash')).toBeFocused();
    await press(page, 'task-trash');
    await expect(page.getByTestId('task-trash-confirm')).toBeVisible();
    await page.getByTestId('task-trash-confirm').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('project-key-badge')).toHaveText('KP');

    // Restore from the trash page.
    await press(page, 'nav-trash');
    await press(page, 'trash-restore');
    await expect(page.getByTestId('trash-list')).toHaveCount(0);

    // Back on the board, the card's status select is the keyboard alternative to dragging.
    await page.locator('[data-project-key="KP"]').focus();
    await page.keyboard.press('Enter');
    await press(page, 'view-board');
    const select = page.getByTestId('card-status');
    await select.focus();
    await select.selectOption({ index: 2 });
    await expect(page.locator('[data-column="Done"] .card-item')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
