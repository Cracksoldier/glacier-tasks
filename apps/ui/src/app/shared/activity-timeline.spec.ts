// History list collapsing (D57): task and profile history show the newest 10 entries until
// expanded; the project activity tab, which pages on the server, shows everything it loaded.

import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ActivityEvent } from '@glacier-tasks/domain';
import { SettingsStore } from '../core/settings/settings-store';
import { FakeColorScheme, provideApiStub } from '../testing/providers';
import { ActivityTimeline } from './activity-timeline';

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  TestBed.configureTestingModule({ providers: [...setup.providers, provideRouter([])] });
  await TestBed.inject(SettingsStore).load();
});

/** `count` title changes, newest first like the API returns them. */
function events(count: number, entityId = 'task-1'): ActivityEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const n = count - i;
    return {
      id: `${entityId}-event-${n}`,
      entityType: 'TASK',
      entityId,
      projectId: 'project-1',
      eventType: 'task.updated',
      occurredAt: `2026-11-04T10:00:${String(n).padStart(2, '0')}.000Z`,
      source: 'UI',
      payload: {
        issueKey: 'GAME-1',
        title: `Title ${n}`,
        changes: { title: { from: `Title ${n - 1}`, to: `Title ${n}` } },
      },
    };
  });
}

function render(list: ActivityEvent[], collapsible = true, listKey: string | null = 'task-1') {
  const fixture: ComponentFixture<ActivityTimeline> = TestBed.createComponent(ActivityTimeline);
  fixture.componentRef.setInput('events', list);
  fixture.componentRef.setInput('collapsible', collapsible);
  fixture.componentRef.setInput('listKey', listKey);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const entries = () =>
    [...root.querySelectorAll('[data-testid="activity-entry"]')].map((e) => e.textContent ?? '');
  const toggle = () => root.querySelector<HTMLElement>('[data-testid="activity-toggle"]');
  const click = () => {
    toggle()?.click();
    fixture.detectChanges();
  };
  return { fixture, entries, toggle, click };
}

describe('collapsible history (D57)', () => {
  it('shows up to 10 entries without a toggle', () => {
    const { entries, toggle } = render(events(10));
    expect(entries()).toHaveLength(10);
    expect(toggle()).toBeNull();
  });

  it('shows the newest 10 of a longer history and expands and collapses it', () => {
    const { entries, toggle, click } = render(events(11));
    expect(entries()).toHaveLength(10);
    expect(entries()[0]).toContain('Title 11');
    expect(toggle()?.textContent).toContain('Show all (11)');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');

    click();
    expect(entries()).toHaveLength(11);
    expect(entries().at(-1)).toContain('Title 1');
    expect(toggle()?.textContent).toContain('Show less');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

    click();
    expect(entries()).toHaveLength(10);
  });

  it('stays expanded on reloaded events and collapses for another task', () => {
    const { fixture, entries, click } = render(events(11));
    click();
    fixture.componentRef.setInput('events', events(12));
    fixture.detectChanges();
    expect(entries()).toHaveLength(12);

    fixture.componentRef.setInput('events', events(15, 'task-2'));
    fixture.componentRef.setInput('listKey', 'task-2');
    fixture.detectChanges();
    expect(entries()).toHaveLength(10);
  });

  it('shows every entry when not collapsible (project activity, D45)', () => {
    const { entries, toggle } = render(events(11), false, null);
    expect(entries()).toHaveLength(11);
    expect(toggle()).toBeNull();
  });
});
