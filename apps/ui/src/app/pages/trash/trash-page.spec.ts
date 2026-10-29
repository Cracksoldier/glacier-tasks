import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings-store';
import { LabelManager } from '../projects/label-manager';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { TrashPage } from './trash-page';

let stub: GlacierApiStub;
let projectId: string;

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ providers: setup.providers });
  await TestBed.inject(SettingsStore).load();
  projectId = (await stub.api.projects.create({ key: 'GAME', name: 'Game' })).id;
});

async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

describe('TrashPage (D39)', () => {
  it('restores items and explains when the parent must come first', async () => {
    const story = await stub.api.tasks.create({ projectId, type: 'STORY', title: 'Story' });
    const sub = await stub.api.tasks.create({
      projectId,
      type: 'SUBTASK',
      parentStoryId: story.id,
      title: 'Step',
    });
    await stub.api.tasks.trash(sub.id);
    await stub.api.tasks.trash(story.id);

    const fixture = TestBed.createComponent(TrashPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const row = (title: string) =>
      root.querySelector(`[data-trash-title="${title}"]`) as HTMLElement;
    expect(row('Story').textContent).toContain('GAME-1');

    (row('Step').querySelector('[data-testid="trash-restore"]') as HTMLElement).click();
    await settle(fixture);
    expect(row('Step').querySelector('[data-testid="trash-error"]')?.textContent).toContain(
      'parent story first',
    );

    (row('Story').querySelector('[data-testid="trash-restore"]') as HTMLElement).click();
    await settle(fixture);
    expect(row('Story')).toBeNull();
    expect(stub.tasks.find((t) => t.id === story.id)?.trashedAt).toBeNull();
  });

  it('shows an empty state', async () => {
    const fixture = TestBed.createComponent(TrashPage);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The trash is empty');
  });
});

describe('LabelManager (D25)', () => {
  it('creates and recolors labels', async () => {
    const fixture = TestBed.createComponent(LabelManager);
    fixture.componentRef.setInput('projectId', projectId);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('[data-testid="label-new-name"]') as HTMLInputElement;
    input.value = 'Bug';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (root.querySelector('[data-testid="label-create"]') as HTMLElement).click();
    await settle(fixture);
    expect(stub.labels.map((l) => [l.name, l.color])).toEqual([['Bug', 'slate']]);

    (root.querySelector('[data-testid="label-color-red"]') as HTMLElement).click();
    await settle(fixture);
    expect(stub.labels[0]?.color).toBe('red');
    expect(
      root.querySelector('[data-testid="label-color-red"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    const i18n = TestBed.inject(I18nService);
    expect(root.querySelector('[data-testid="label-color-red"]')?.getAttribute('aria-label')).toBe(
      `${i18n.t('labels.color')}: ${i18n.t('labels.colorName.red')}`,
    );
  });
});
