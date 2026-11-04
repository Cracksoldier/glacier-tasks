// Story export and import (DATA-11, D58): a story with its subtasks is exported to JSON and
// imported into another project whose workflow differs; the user maps the missing status and
// picks one profile for all tasks. Native dialogs are replaced by GLACIER_TEST_DIALOG_PATH.
// Selectors use test ids (D15).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

interface Seed {
  game: string;
  sound: string;
  storyId: string;
  bob: string;
}

async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async () => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const game = await api.projects.create({ key: 'GAME', name: 'Game Dev' });
    const sound = await api.projects.create({ key: 'SND', name: 'Sound' });
    const ann = await api.users.create({ name: 'Ann' });
    const bob = await api.users.create({ name: 'Bob' });
    const label = await api.labels.create(game.id, { name: 'Combat', color: 'red' });
    const statuses = await api.workflows.list(game.id);
    const inProgress = statuses.find((s) => s.name === 'In Progress');
    const story = await api.tasks.create({
      projectId: game.id,
      type: 'STORY',
      title: 'Boss fight',
      descriptionMarkdown: 'Phase **one**',
      priority: 'HIGH',
      assigneeUserId: ann.id,
      labelIds: [label.id],
    });
    await api.tasks.create({
      projectId: game.id,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Arena',
      statusId: inProgress?.id,
    });
    await api.tasks.create({
      projectId: game.id,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Music cue',
    });
    // The target project calls its in-progress column differently.
    const doing = (await api.workflows.list(sound.id)).find((s) => s.name === 'In Progress');
    if (doing) await api.workflows.update(doing.id, { name: 'Doing' });
    return { game: game.id, sound: sound.id, storyId: story.id, bob: bob.id };
  });
}

test('a story with subtasks moves to another project with mapped statuses', async () => {
  const file = join(files, 'GAME-1.story.json');
  const { app, page } = await launchApp(userData.dir, { GLACIER_TEST_DIALOG_PATH: file });
  try {
    const ids = await seed(page);
    await page.reload();

    await page.evaluate((url) => {
      location.hash = url;
    }, `#/projects/${ids.game}/tasks/${ids.storyId}`);
    await expect(page.getByTestId('task-issue-key')).toHaveText('GAME-1');
    await page.getByTestId('task-export').click();
    await expect(page.getByTestId('task-export-done')).toContainText('GAME-1.story.json');
    const document = JSON.parse(readFileSync(file, 'utf-8')) as {
      format: string;
      statuses: Array<{ id: string; name: string }>;
      story: { subtasks: unknown[] };
    };
    expect(document.format).toBe('glacier-tasks-story');
    expect(document.story.subtasks).toHaveLength(2);
    const inProgress = document.statuses.find((s) => s.name === 'In Progress');

    await page.evaluate((url) => {
      location.hash = url;
    }, `#/projects/${ids.sound}`);
    await expect(page.getByTestId('project-title')).toHaveText('Sound');
    await page.getByTestId('story-import').click();
    await expect(page.getByTestId('story-import-preview')).toContainText('Boss fight');
    await expect(page.getByTestId('story-import-mapping')).toBeVisible();
    await expect(page.getByTestId('story-import-new-labels')).toContainText('Combat');
    await page
      .getByTestId(`story-import-status-${inProgress?.id}`)
      .selectOption({ label: 'Doing' });
    await page.getByTestId('story-import-assignee').selectOption({ label: 'Bob' });
    await page.getByTestId('story-import-confirm').click();

    await expect(page.getByTestId('task-issue-key')).toHaveText('SND-1');
    const imported = await page.evaluate(async (soundId) => {
      const api = window.glacierTasks;
      if (!api) throw new Error('API missing');
      const statuses = await api.workflows.list(soundId);
      const name = (id: string) => statuses.find((s) => s.id === id)?.name;
      const rows = (await api.tasks.list({ projectId: soundId })).items;
      const story = await api.tasks.get(rows[0]?.story.id ?? '');
      const labels = await api.labels.list(soundId);
      return {
        story: [story.issueKey, story.title, story.priority, name(story.statusId)],
        subtasks: story.subtasks.map((s) => [s.issueKey, s.title, name(s.statusId)]),
        assignees: [story, ...story.subtasks].map((t) => t.assigneeUserId),
        labels: labels.map((l) => [l.name, l.color]),
      };
    }, ids.sound);
    expect(imported.story).toEqual(['SND-1', 'Boss fight', 'HIGH', 'To Do']);
    expect(imported.subtasks).toEqual([
      ['SND-2', 'Arena', 'Doing'],
      ['SND-3', 'Music cue', 'To Do'],
    ]);
    expect(imported.assignees).toEqual([ids.bob, ids.bob, ids.bob]);
    expect(imported.labels).toEqual([['Combat', 'red']]);
  } finally {
    await app.close();
  }
});
