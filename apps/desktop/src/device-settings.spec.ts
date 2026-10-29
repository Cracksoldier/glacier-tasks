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
});
