// M8 accessibility check: every screen in light and dark mode has no serious or critical
// axe-core violations (WCAG 2.1 A/AA rules). Selectors use test ids (D15).

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type { AxeResults } from 'axe-core';
import { createUserDataDir, launchApp } from './app';

let userData: ReturnType<typeof createUserDataDir>;

test.beforeEach(() => {
  userData = createUserDataDir();
});

test.afterEach(() => userData.dispose());

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seed(page: Page): Promise<{ project: string; story: string }> {
  return page.evaluate(async (png) => {
    const api = window.glacierTasks;
    if (!api) throw new Error('API missing');
    const project = await api.projects.create({
      key: 'GAME',
      name: 'Game Dev',
      description: 'A game',
    });
    const ann = await api.users.create({ name: 'Ann Example' });
    const bug = await api.labels.create(project.id, { name: 'Bug', color: 'red' });
    const story = await api.tasks.create({
      projectId: project.id,
      type: 'STORY',
      title: 'Inventory',
      descriptionMarkdown: '# Plan\n\n- [x] Grid\n- [ ] Tooltips',
      assigneeUserId: ann.id,
      labelIds: [bug.id],
      dueDate: '2026-11-10',
    });
    await api.tasks.update(story.id, 1, { priority: 'HIGH' });
    await api.tasks.create({
      projectId: project.id,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Slots',
    });
    const old = await api.tasks.create({ projectId: project.id, type: 'STORY', title: 'Old idea' });
    await api.tasks.trash(old.id);
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    await api.attachments.addFiles(story.id, [
      { name: 'pixel.png', bytes },
      { name: 'notes.txt', bytes },
    ]);
    return { project: project.id, story: story.id };
  }, PNG_BASE64);
}

// Injected through the debugging protocol: the app's CSP (no inline scripts) stays untouched.
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');

/** The measured colors of a contrast failure, so a report shows what to fix. */
function contrastOf(node: AxeResults['violations'][number]['nodes'][number]): string {
  const data = node.any[0]?.data as
    | { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string }
    | undefined;
  return data?.fgColor
    ? ` [${data.fgColor} on ${data.bgColor}: ${data.contrastRatio} < ${data.expectedContrastRatio}]`
    : '';
}

async function audit(page: Page, screen: string): Promise<string[]> {
  // Let fonts, resources and transitions settle so contrast is measured on final colors.
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE_SOURCE);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: { run(o: object): Promise<AxeResults> } }).axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    }),
  );
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${screen}: ${v.id} (${v.impact}) ${v.help}\n    ${v.nodes
          .slice(0, 6)
          .map((n) => `${n.target.join(' ')}${contrastOf(n)}`)
          .join('\n    ')}`,
    );
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((target) => {
    location.hash = target;
  }, hash);
  await page.waitForTimeout(200);
}

for (const theme of ['light', 'dark'] as const) {
  test(`every screen is accessible in the ${theme} theme`, async () => {
    const { app, page } = await launchApp(userData.dir);
    try {
      const ids = await seed(page);
      await page.evaluate((t) => window.glacierTasks?.settings.updateDevice({ theme: t }), theme);
      await page.reload();
      await page.getByTestId('app-shell').waitFor();
      const problems: string[] = [];

      await go(page, '#/projects');
      problems.push(...(await audit(page, 'dashboard')));

      await go(page, `#/projects/${ids.project}`);
      await page.getByTestId('view-board').click();
      await page.getByTestId('board-group-stories').click();
      problems.push(...(await audit(page, 'board')));
      await page.getByTestId('board-group-subtasks').click();
      problems.push(...(await audit(page, 'board grouped by subtasks')));
      await page.getByTestId('view-list').click();
      await page.getByTestId('list-row').first().waitFor();
      problems.push(...(await audit(page, 'list')));
      await page.getByTestId('view-activity').click();
      await page.getByTestId('project-activity').waitFor();
      problems.push(...(await audit(page, 'activity')));

      await go(page, `#/projects/${ids.project}/tasks/${ids.story}`);
      await page.getByTestId('task-issue-key').waitFor();
      problems.push(...(await audit(page, 'task editor')));
      await page.getByTestId('tab-preview').click();
      problems.push(...(await audit(page, 'task preview')));
      await page.getByTestId('task-versions').click();
      problems.push(...(await audit(page, 'description versions')));
      await page.keyboard.press('Escape');

      await go(page, `#/projects/${ids.project}/settings`);
      problems.push(...(await audit(page, 'project settings')));
      await go(page, '#/search?q=inventory');
      await page.getByTestId('list-row').first().waitFor();
      problems.push(...(await audit(page, 'search')));
      await go(page, '#/profiles');
      problems.push(...(await audit(page, 'profiles')));
      await go(page, '#/trash');
      problems.push(...(await audit(page, 'trash')));
      await go(page, '#/settings');
      problems.push(...(await audit(page, 'settings')));

      expect(problems, problems.join('\n')).toEqual([]);
    } finally {
      await app.close();
    }
  });
}
