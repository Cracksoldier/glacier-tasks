import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { StoryImportPreview } from '@glacier-tasks/domain';
import { provideAppRouter } from '../../app.routes';
import { ProjectsStore } from '../../core/projects/projects-store';
import { SettingsStore } from '../../core/settings/settings-store';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';

// Story export and import (DATA-11, D58).

const TOKEN = '11111111-1111-4111-8111-111111111111';
const SOURCE = {
  todo: 'aaaaaaaa-0000-4000-8000-000000000001',
  review: 'aaaaaaaa-0000-4000-8000-000000000002',
};

let stub: GlacierApiStub;
let projectId: string;
let storyId: string;
let subtaskId: string;
let adaId: string;

async function setup() {
  new FakeColorScheme(true).install();
  Element.prototype.scrollTo ??= () => undefined;
  const provided = provideApiStub();
  stub = provided.stub;
  TestBed.configureTestingModule({ providers: [...provided.providers, provideAppRouter()] });
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
  storyId = (await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Boss fight' })).id;
  subtaskId = (
    await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: storyId,
      title: 'Arena',
    })
  ).id;
  adaId = (await stub.api.users.create({ name: 'Ada' })).id;
  await stub.api.users.create({ name: 'Bob' });
  await TestBed.inject(SettingsStore).load();
  await TestBed.inject(ProjectsStore).load();
}

function preview(overrides: Partial<StoryImportPreview> = {}): StoryImportPreview {
  return {
    token: TOKEN,
    fileName: 'OLD-3.story.json',
    source: { projectKey: 'OLD', projectName: 'Old project' },
    story: { issueKey: 'OLD-3', title: 'Imported story' },
    subtaskCount: 2,
    statuses: [
      {
        sourceId: SOURCE.todo,
        name: 'To Do',
        category: 'TODO',
        taskCount: 2,
        matchedByName: true,
        suggestedStatusId: `${projectId}-status-0`,
      },
      {
        sourceId: SOURCE.review,
        name: 'Review',
        category: 'IN_PROGRESS',
        taskCount: 1,
        matchedByName: false,
        suggestedStatusId: `${projectId}-status-1`,
      },
    ],
    needsMapping: true,
    assignee: { name: 'Ada', suggestedUserId: adaId },
    labels: { reused: [], created: ['Combat'] },
    hasAttachmentRefs: true,
    ...overrides,
  };
}

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

const byTestId = <T extends HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) as T | null;

function choose(select: HTMLSelectElement | null, value: string): void {
  if (!select) throw new Error('select missing');
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('story import (DATA-11, D58)', () => {
  it('maps unmatched statuses, assigns one profile and opens the imported story', async () => {
    await setup();
    stub.storyImportPreview = preview();
    const harness = await RouterTestingHarness.create(`/projects/${projectId}`);
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;

    byTestId<HTMLButtonElement>(root, 'story-import')?.click();
    await settle(harness.fixture);
    expect(byTestId(root, 'story-import-preview')?.textContent).toContain('Imported story');
    expect(byTestId(root, 'story-import-mapping')).not.toBeNull();
    expect(byTestId(root, 'story-import-new-labels')?.textContent).toContain('Combat');
    expect(byTestId(root, 'story-import-attachments')).not.toBeNull();
    const assignee = byTestId<HTMLSelectElement>(root, 'story-import-assignee');
    expect(assignee?.value).toBe(adaId);

    choose(byTestId(root, `story-import-status-${SOURCE.review}`), `${projectId}-status-2`);
    choose(assignee, '');
    byTestId<HTMLButtonElement>(root, 'story-import-confirm')?.click();
    await settle(harness.fixture);

    expect(stub.storyImports).toEqual([
      {
        token: TOKEN,
        projectId,
        statusMap: {
          [SOURCE.todo]: `${projectId}-status-0`,
          [SOURCE.review]: `${projectId}-status-2`,
        },
        assigneeUserId: null,
      },
    ]);
    const imported = stub.tasks.find((t) => t.title === 'Imported story');
    expect(imported).toBeDefined();
    expect(byTestId(harness.routeNativeElement as HTMLElement, 'task-issue-key')?.textContent).toBe(
      imported?.issueKey,
    );
  });

  it('skips the mapping step when every status matches by name', async () => {
    await setup();
    stub.storyImportPreview = preview({
      needsMapping: false,
      statuses: [preview().statuses[0] as StoryImportPreview['statuses'][number]],
      assignee: { name: 'Zed', suggestedUserId: null },
      hasAttachmentRefs: false,
    });
    const harness = await RouterTestingHarness.create(`/projects/${projectId}`);
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    byTestId<HTMLButtonElement>(root, 'story-import')?.click();
    await settle(harness.fixture);

    expect(byTestId(root, 'story-import-preview')).not.toBeNull();
    expect(byTestId(root, 'story-import-mapping')).toBeNull();
    expect(byTestId(root, 'story-import-attachments')).toBeNull();
    expect(byTestId<HTMLSelectElement>(root, 'story-import-assignee')?.value).toBe('');
  });

  it('does nothing when the file dialog is cancelled and shows file errors', async () => {
    await setup();
    const harness = await RouterTestingHarness.create(`/projects/${projectId}`);
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    byTestId<HTMLButtonElement>(root, 'story-import')?.click();
    await settle(harness.fixture);
    expect(byTestId(root, 'story-import-preview')).toBeNull();

    stub.api.data.inspectStoryImport = () =>
      Promise.reject({ code: 'VALIDATION', message: 'errors.importInvalid' });
    byTestId<HTMLButtonElement>(root, 'story-import')?.click();
    await settle(harness.fixture);
    expect(byTestId(root, 'story-import-error')?.textContent).toContain('not a valid');
  });
});

describe('story export (DATA-11)', () => {
  it('is offered for stories only', async () => {
    await setup();
    const harness = await RouterTestingHarness.create(`/projects/${projectId}/tasks/${storyId}`);
    await settle(harness.fixture);
    let root = harness.routeNativeElement as HTMLElement;
    byTestId<HTMLButtonElement>(root, 'task-export')?.click();
    await settle(harness.fixture);
    expect(stub.storyExports).toEqual([storyId]);
    expect(byTestId(root, 'task-export-done')?.textContent).toContain('GAME-1.story.json');

    await harness.navigateByUrl(`/projects/${projectId}/tasks/${subtaskId}`);
    await settle(harness.fixture);
    root = harness.routeNativeElement as HTMLElement;
    expect(byTestId(root, 'task-issue-key')?.textContent).toBe('GAME-2');
    expect(byTestId(root, 'task-export')).toBeNull();
  });
});
