// Preload script (sandboxed). M1 exposes the typed GlacierTasksAPI here via contextBridge;
// it must never expose ipcRenderer, Node APIs or generic invoke functions (ADR 0004).

import { contextBridge } from 'electron';
import { API_GLOBAL_NAME } from '@glacier-tasks/domain';

contextBridge.exposeInMainWorld(API_GLOBAL_NAME, Object.freeze({}));
