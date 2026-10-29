// Preload script (sandboxed). Exposes exactly the typed GlacierTasksAPI (ADR 0004):
// one fixed IPC channel per method, never ipcRenderer, Node APIs or a generic invoke.

import { contextBridge, ipcRenderer } from 'electron';
import { API_GLOBAL_NAME, IPC_CHANNELS, type Result } from '@glacier-tasks/domain';

async function call(channel: string, args: unknown[]): Promise<unknown> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<unknown>;
  if (result.ok) return result.value;
  // Plain objects survive the context bridge intact; Error subclasses would lose fields.
  throw result.error;
}

const api: Record<string, Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>> = {};
for (const [group, methods] of Object.entries(IPC_CHANNELS)) {
  const members: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of methods) {
    const channel = `${group}:${method}`;
    members[method] = (...args) => call(channel, args);
  }
  api[group] = Object.freeze(members);
}

contextBridge.exposeInMainWorld(API_GLOBAL_NAME, Object.freeze(api));
