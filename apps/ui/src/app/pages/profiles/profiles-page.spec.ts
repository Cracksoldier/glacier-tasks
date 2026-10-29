import { TestBed } from '@angular/core/testing';
import type { GlacierApiStub } from '../../testing/glacier-api-stub';
import { FakeColorScheme, provideApiStub } from '../../testing/providers';
import { SettingsStore } from '../../core/settings/settings-store';
import { ProfilesPage } from './profiles-page';

const AVATAR_ID = '00000000-0000-4000-8000-00000000abcd';

let stub: GlacierApiStub;

async function render() {
  const fixture = TestBed.createComponent(ProfilesPage);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement>(id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as T;
  const names = () =>
    [...root.querySelectorAll('[data-profile-name]')].map((li) =>
      li.getAttribute('data-profile-name'),
    );
  return { fixture, root, byTestId, names };
}

beforeEach(async () => {
  new FakeColorScheme(true).install();
  const setup = provideApiStub();
  stub = setup.stub;
  TestBed.configureTestingModule({ imports: [ProfilesPage], providers: setup.providers });
  await TestBed.inject(SettingsStore).load();
});

describe('ProfilesPage', () => {
  it('creates a profile and offers the avatar picker right away', async () => {
    const { fixture, byTestId, names } = await render();
    byTestId('profile-new').click();
    await fixture.whenStable();
    expect(byTestId('avatar-choose')).toBeNull();

    const input = byTestId<HTMLInputElement>('profile-name');
    input.value = '  Ann Example ';
    input.dispatchEvent(new Event('input'));
    byTestId('profile-save').click();
    await fixture.whenStable();

    expect(names()).toEqual(['Ann Example']);
    expect(byTestId('avatar-choose')).not.toBeNull();

    stub.nextAvatarFileId = AVATAR_ID;
    byTestId('avatar-choose').click();
    await fixture.whenStable();
    expect(stub.users[0]?.avatarFileId).toBe(AVATAR_ID);
    expect(byTestId('avatar-remove')).not.toBeNull();
  });

  it('requires a name', async () => {
    const { fixture, byTestId, root } = await render();
    byTestId('profile-new').click();
    byTestId('profile-save').click();
    await fixture.whenStable();
    expect(stub.users).toEqual([]);
    expect(root.textContent).toContain('This field is required.');
  });

  it('hides archived profiles unless requested and can restore them (D29)', async () => {
    await stub.api.users.create({ name: 'Ann' });
    await stub.api.users.create({ name: 'Bob' });
    const { fixture, byTestId, names, root } = await render();

    (
      root.querySelector('[data-profile-name="Bob"] [data-testid="profile-archive"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    expect(names()).toEqual(['Ann']);

    byTestId('show-archived').click();
    await fixture.whenStable();
    expect(names()).toEqual(['Ann', 'Bob']);
    expect(root.querySelector('[data-profile-name="Bob"]')?.textContent).toContain('Archived');

    (root.querySelector('[data-testid="profile-unarchive"]') as HTMLElement).click();
    await fixture.whenStable();
    expect(stub.users.find((u) => u.name === 'Bob')?.archivedAt).toBeNull();
  });

  it('shows initials and falls back to them when an avatar image is missing (USER-02)', async () => {
    const ann = await stub.api.users.create({ name: 'Ann Example' });
    stub.users[0]!.avatarFileId = AVATAR_ID;
    await stub.api.users.create({ name: 'bob' });
    const { fixture, root } = await render();

    const bob = root.querySelector('[data-profile-name="bob"]') as HTMLElement;
    expect(bob.querySelector('[data-testid="avatar-initials"]')?.textContent?.trim()).toBe('B');

    const annRow = root.querySelector(`[data-profile-name="${ann.name}"]`) as HTMLElement;
    const image = annRow.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(`glacier-media://avatar/${AVATAR_ID}`);
    image.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(annRow.querySelector('img')).toBeNull();
    expect(annRow.querySelector('[data-testid="avatar-initials"]')?.textContent?.trim()).toBe('AE');
  });

  it('reports failures from the main process', async () => {
    await stub.api.users.create({ name: 'Ann' });
    const { fixture, root } = await render();
    stub.api.users.archive = () =>
      Promise.reject({ code: 'NOT_FOUND', message: 'errors.userNotFound' });
    (root.querySelector('[data-testid="profile-archive"]') as HTMLElement).click();
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('no longer exists');
  });
});
