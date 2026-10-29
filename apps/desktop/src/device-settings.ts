// Device settings, stored as JSON outside the workspace database (D17): never part of
// backups and never replaced by a restore.

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { z } from 'zod';
import {
  DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
  DEFAULT_AUTO_BACKUP_RETENTION,
  DEFAULT_THEME,
  type DeviceSettings,
  type DeviceSettingsPatch,
  deviceSettingsPatchSchema,
  LANGUAGES,
  type Language,
  type ProjectView,
  projectViewSchema,
  THEMES,
} from '@glacier-tasks/domain';
import { writeFileAtomic } from './fs-safe.js';
import type { Logger } from './logger.js';

export interface WindowState {
  bounds: { x?: number; y?: number; width: number; height: number };
  isMaximized: boolean;
}

interface StoredSettings extends DeviceSettings {
  window: WindowState | null;
}

const storedSchema = z.object({
  schemaVersion: z.literal(1),
  theme: z.enum(THEMES),
  language: z.enum(LANGUAGES),
  lastProjectId: z.uuid().nullable(),
  lastView: z.enum(['board', 'list']),
  autoBackup: z.object({
    enabled: z.boolean(),
    folder: z.string().nullable(),
    intervalHours: z.int().min(1),
    retention: z.int().min(1),
    lastRunAt: z.string().nullable(),
  }),
  // Added in M5 (D42). One unreadable view is dropped instead of resetting every setting.
  projectViews: z
    .record(z.string(), z.unknown())
    .default({})
    .transform((views) => {
      const valid: Record<string, ProjectView> = {};
      for (const [id, view] of Object.entries(views)) {
        const parsed = projectViewSchema.safeParse(view);
        if (z.uuid().safeParse(id).success && parsed.success) valid[id] = parsed.data;
      }
      return valid;
    }),
  window: z
    .object({
      bounds: z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
      isMaximized: z.boolean(),
    })
    .nullable(),
});

/** German if the user's first preferred OS language is German, English otherwise (D15). */
export function languageFromPreferences(preferredLanguages: ReadonlyArray<string>): Language {
  return preferredLanguages[0]?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function defaultDeviceSettings(preferredLanguages: ReadonlyArray<string>): StoredSettings {
  return {
    theme: DEFAULT_THEME,
    language: languageFromPreferences(preferredLanguages),
    lastProjectId: null,
    lastView: 'board',
    autoBackup: {
      enabled: false,
      folder: null,
      intervalHours: DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
      retention: DEFAULT_AUTO_BACKUP_RETENTION,
      lastRunAt: null,
    },
    projectViews: {},
    window: null,
  };
}

export class DeviceSettingsStore {
  private current: StoredSettings;

  constructor(
    private readonly filePath: string,
    preferredLanguages: ReadonlyArray<string>,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.current = this.load(defaultDeviceSettings(preferredLanguages));
  }

  /** Renderer-visible settings (window state stays internal). */
  get(): DeviceSettings {
    const { window: _window, ...visible } = this.current;
    return structuredClone(visible);
  }

  update(patch: DeviceSettingsPatch): DeviceSettings {
    const parsed = deviceSettingsPatchSchema.parse(patch);
    const { autoBackup, ...rest } = parsed;
    this.current = {
      ...this.current,
      ...rest,
      autoBackup: { ...this.current.autoBackup, ...autoBackup },
    };
    this.persist();
    return this.get();
  }

  /** Stores a project's sort, filters and columns, or forgets them with `null` (D42). */
  setProjectView(projectId: string, view: ProjectView | null): DeviceSettings {
    const projectViews = { ...this.current.projectViews };
    if (view) projectViews[projectId] = projectViewSchema.parse(view);
    else delete projectViews[projectId];
    this.current = { ...this.current, projectViews };
    this.persist();
    return this.get();
  }

  /** Forgets the views of projects that no longer exist (permanently deleted or unknown). */
  pruneProjectViews(isKnownProject: (projectId: string) => boolean): void {
    const projectViews: Record<string, ProjectView> = {};
    for (const [id, view] of Object.entries(this.current.projectViews)) {
      if (isKnownProject(id)) projectViews[id] = view;
    }
    if (Object.keys(projectViews).length === Object.keys(this.current.projectViews).length) return;
    this.current = { ...this.current, projectViews };
    this.persist();
  }

  getWindowState(): WindowState | null {
    return this.current.window ? structuredClone(this.current.window) : null;
  }

  setWindowState(state: WindowState): void {
    this.current = { ...this.current, window: structuredClone(state) };
    this.persist();
  }

  private load(defaults: StoredSettings): StoredSettings {
    if (!existsSync(this.filePath)) return defaults;
    try {
      const parsed = storedSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
      const { schemaVersion: _version, ...settings } = parsed;
      return settings;
    } catch (error) {
      const corruptPath = `${this.filePath}.corrupt-${this.now().getTime()}`;
      try {
        renameSync(this.filePath, corruptPath);
      } catch {
        // If even the rename fails, the next successful write replaces the file.
      }
      this.logger.warn('device settings unreadable; using defaults', { error });
      return defaults;
    }
  }

  private persist(): void {
    try {
      writeFileAtomic(
        this.filePath,
        `${JSON.stringify({ schemaVersion: 1, ...this.current }, null, 2)}\n`,
      );
    } catch (error) {
      this.logger.error('device settings could not be saved', { error });
    }
  }
}
