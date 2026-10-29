// In-memory fake of GlacierTasksAPI for renderer unit tests. Methods not implemented yet
// reject like the main process does for channels without a handler.

import {
  type AppErrorInfo,
  type DeviceSettings,
  type DeviceSettingsPatch,
  type GlacierTasksAPI,
  IPC_CHANNELS,
} from '@glacier-tasks/domain';

export interface GlacierApiStub {
  api: GlacierTasksAPI;
  settings: DeviceSettings;
  /** Makes the next settings update fail with this error. */
  failNextUpdate: AppErrorInfo | null;
  updates: DeviceSettingsPatch[];
}

export function defaultTestSettings(): DeviceSettings {
  return {
    theme: 'dark',
    language: 'en',
    lastProjectId: null,
    lastView: 'board',
    autoBackup: { enabled: false, folder: null, intervalHours: 24, retention: 7, lastRunAt: null },
  };
}

export function createGlacierApiStub(initial: Partial<DeviceSettings> = {}): GlacierApiStub {
  const notAvailable: AppErrorInfo = { code: 'IO', message: 'errors.notAvailable' };
  const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [group, methods] of Object.entries(IPC_CHANNELS)) {
    api[group] = {};
    for (const method of methods) {
      api[group][method] = () => Promise.reject(notAvailable);
    }
  }

  const stub: GlacierApiStub = {
    api: api as unknown as GlacierTasksAPI,
    settings: { ...defaultTestSettings(), ...initial },
    failNextUpdate: null,
    updates: [],
  };

  api['app']!['info'] = async () => ({ version: '1.2.3', schemaVersion: 1 });
  api['settings']!['getDevice'] = async () => structuredClone(stub.settings);
  api['settings']!['updateDevice'] = async (patch) => {
    if (stub.failNextUpdate) {
      const error = stub.failNextUpdate;
      stub.failNextUpdate = null;
      throw error;
    }
    const { autoBackup, ...rest } = patch as DeviceSettingsPatch;
    stub.updates.push(patch as DeviceSettingsPatch);
    stub.settings = {
      ...stub.settings,
      ...rest,
      autoBackup: { ...stub.settings.autoBackup, ...autoBackup },
    };
    return structuredClone(stub.settings);
  };
  return stub;
}
