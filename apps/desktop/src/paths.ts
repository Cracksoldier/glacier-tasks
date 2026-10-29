// Layout of the per-user app data directory (spec §2.1, D16, D17).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AppPaths {
  root: string;
  /** Workspace database; replaced by restore. */
  workspaceDb: string;
  attachments: string;
  avatars: string;
  logs: string;
  /** Safety backups taken before migrations and restores. */
  backups: string;
  /** Device settings; never part of the workspace or backups (D17). */
  deviceSettings: string;
  /** Validated backups waiting for activation, the previous data during activation, and the
   * marker that asks the next start to activate (ADR 0012). */
  restoreStaging: string;
  restoreRollback: string;
  restorePending: string;
}

export function resolveAppPaths(root: string): AppPaths {
  return {
    root,
    workspaceDb: join(root, 'glacier-tasks.sqlite'),
    attachments: join(root, 'attachments'),
    avatars: join(root, 'avatars'),
    logs: join(root, 'logs'),
    backups: join(root, 'backups'),
    deviceSettings: join(root, 'device-settings.json'),
    restoreStaging: join(root, 'restore-staging'),
    restoreRollback: join(root, 'restore-rollback'),
    restorePending: join(root, 'restore-pending.json'),
  };
}

export function ensureAppDirectories(paths: AppPaths): void {
  for (const dir of [paths.root, paths.attachments, paths.avatars, paths.logs, paths.backups]) {
    mkdirSync(dir, { recursive: true });
  }
}
