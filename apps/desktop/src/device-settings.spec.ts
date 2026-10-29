import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSettingsStore, languageFromPreferences } from './device-settings.js';
import { silentLogger } from './logger.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glacier-settings-'));
  file = join(dir, 'device-settings.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('languageFromPreferences (D15)', () => {
  it.each([
    [['de-DE', 'en-US'], 'de'],
    [['de'], 'de'],
    [['de-AT'], 'de'],
    [['en-US', 'de-DE'], 'en'],
    [['fr-FR'], 'en'],
    [[], 'en'],
  ])('%j → %s', (languages, expected) => {
    expect(languageFromPreferences(languages)).toBe(expected);
  });
});

describe('DeviceSettingsStore', () => {
  it('starts with dark theme and OS language without writing a file (D18)', () => {
    const store = new DeviceSettingsStore(file, ['de-DE'], silentLogger);
    expect(store.get()).toMatchObject({ theme: 'dark', language: 'de', lastView: 'board' });
    expect(store.get().autoBackup).toMatchObject({
      enabled: false,
      intervalHours: 24,
      retention: 7,
    });
    expect(existsSync(file)).toBe(false);
  });

  it('persists updates across instances', () => {
    new DeviceSettingsStore(file, ['en-US'], silentLogger).update({
      theme: 'light',
      language: 'de',
      autoBackup: { retention: 3 },
    });
    const reloaded = new DeviceSettingsStore(file, ['en-US'], silentLogger).get();
    expect(reloaded).toMatchObject({ theme: 'light', language: 'de' });
    expect(reloaded.autoBackup).toMatchObject({ retention: 3, intervalHours: 24, enabled: false });
  });

  it('keeps window state internal', () => {
    const store = new DeviceSettingsStore(file, [], silentLogger);
    store.setWindowState({ bounds: { x: 1, y: 2, width: 1000, height: 700 }, isMaximized: true });
    expect(store.get()).not.toHaveProperty('window');
    expect(new DeviceSettingsStore(file, [], silentLogger).getWindowState()).toEqual({
      bounds: { x: 1, y: 2, width: 1000, height: 700 },
      isMaximized: true,
    });
  });

  it('rejects invalid patches', () => {
    const store = new DeviceSettingsStore(file, [], silentLogger);
    expect(() => store.update({ theme: 'blue' as never })).toThrow();
    expect(store.get().theme).toBe('dark');
  });

  it('recovers from a corrupt file by keeping a copy and using defaults', () => {
    writeFileSync(file, '{ not json');
    const warn = vi.fn();
    const store = new DeviceSettingsStore(
      file,
      ['en'],
      { ...silentLogger, warn },
      () => new Date(42),
    );
    expect(store.get().theme).toBe('dark');
    expect(warn).toHaveBeenCalledOnce();
    expect(readdirSync(dir)).toEqual(['device-settings.json.corrupt-42']);

    store.update({ theme: 'light' });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({
      schemaVersion: 1,
      theme: 'light',
    });
  });

  it('treats a structurally invalid file as corrupt', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, theme: 'neon' }));
    const store = new DeviceSettingsStore(file, [], silentLogger);
    expect(store.get().theme).toBe('dark');
  });

  it('keeps the attachment size limit within 1–2048 MiB (D47)', () => {
    const store = new DeviceSettingsStore(file, ['en-US'], silentLogger);
    expect(store.get().attachmentMaxMiB).toBe(100);
    store.update({ attachmentMaxMiB: 250 });
    expect(new DeviceSettingsStore(file, ['en-US'], silentLogger).get().attachmentMaxMiB).toBe(250);
    expect(() => store.update({ attachmentMaxMiB: 0 })).toThrow();
    expect(() => store.update({ attachmentMaxMiB: 4096 })).toThrow();
    expect(() => store.update({ attachmentMaxMiB: 1.5 })).toThrow();
  });

  describe('project views (D42)', () => {
    const P1 = '00000000-0000-4000-8000-000000000001';
    const P2 = '00000000-0000-4000-8000-000000000002';
    /** A view as stored before M7, without `boardGroup`. */
    const legacyView = {
      sortBy: 'title' as const,
      sortDirection: 'desc' as const,
      filters: {
        types: [],
        statusIds: [],
        statusCategories: [],
        priorities: ['HIGH' as const],
        assigneeUserIds: [null],
        labelIds: [],
        dueFrom: null,
        dueTo: null,
      },
      columns: ['status' as const, 'labels' as const],
    };
    const view = { ...legacyView, boardGroup: 'subtasks' as const };

    it('stores, persists and forgets a view per project', () => {
      const store = new DeviceSettingsStore(file, ['en-US'], silentLogger);
      expect(store.get().projectViews).toEqual({});
      store.setProjectView(P1, view);
      expect(new DeviceSettingsStore(file, ['en-US'], silentLogger).get().projectViews).toEqual({
        [P1]: view,
      });
      expect(store.setProjectView(P1, null).projectViews).toEqual({});
      expect(() => store.setProjectView(P1, { ...view, columns: ['title'] } as never)).toThrow();
    });

    it('reads files from before M5 and drops unreadable views only', () => {
      const store = new DeviceSettingsStore(file, ['en-US'], silentLogger);
      store.update({ theme: 'light' });
      const stored = JSON.parse(readFileSync(file, 'utf-8'));
      delete stored.projectViews;
      writeFileSync(file, JSON.stringify(stored));
      expect(new DeviceSettingsStore(file, ['en-US'], silentLogger).get()).toMatchObject({
        theme: 'light',
        projectViews: {},
      });

      stored.projectViews = { [P1]: legacyView, [P2]: { sortBy: 'nonsense' }, 'not-a-uuid': view };
      writeFileSync(file, JSON.stringify(stored));
      expect(new DeviceSettingsStore(file, ['en-US'], silentLogger).get()).toMatchObject({
        theme: 'light',
        // Views stored before M7 get the default grouping (D51).
        projectViews: { [P1]: { ...legacyView, boardGroup: 'stories' } },
      });
    });

    it('prunes views of unknown projects', () => {
      const store = new DeviceSettingsStore(file, ['en-US'], silentLogger);
      store.setProjectView(P1, view);
      store.setProjectView(P2, view);
      store.pruneProjectViews((id) => id === P2);
      expect(
        Object.keys(new DeviceSettingsStore(file, ['en-US'], silentLogger).get().projectViews),
      ).toEqual([P2]);
    });
  });
});
