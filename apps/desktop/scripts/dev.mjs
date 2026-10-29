// Development launcher: bundles main/preload, then starts Electron against the Angular dev
// server (GLACIER_DEV=1). Started by the root `npm start` once ng serve listens on :4200.
// A Node script instead of `GLACIER_DEV=1 electron .` because npm uses cmd.exe on Windows.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop } from './build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await buildDesktop({ dev: true });

const electronPath = createRequire(import.meta.url)('electron');
const child = spawn(electronPath, [root], {
  stdio: 'inherit',
  env: { ...process.env, GLACIER_DEV: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
