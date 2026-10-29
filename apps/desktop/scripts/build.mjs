// Bundles the Electron main and preload scripts with esbuild and copies the built renderer.
//
// Bundling is required: a sandboxed preload cannot `require` workspace packages, and the
// main process should not depend on workspace symlinks at runtime (ADR 0002). Native and
// Electron modules stay external.

import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const rendererSource = join(root, '..', 'ui', 'dist', 'browser');

/** @param {{ dev?: boolean }} options  dev: skip the renderer copy (served by ng serve). */
export async function buildDesktop({ dev = false } = {}) {
  rmSync(outDir, { recursive: true, force: true });

  const common = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    sourcemap: 'linked',
    external: ['electron', 'better-sqlite3'],
    logLevel: 'info',
  };

  await build({
    ...common,
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(outDir, 'main.cjs'),
  });

  await build({
    ...common,
    entryPoints: [join(root, 'src', 'preload.ts')],
    outfile: join(outDir, 'preload.cjs'),
  });

  // Linux window icon (Windows takes the icon from the executable).
  cpSync(join(root, 'build', 'icon.png'), join(outDir, 'icon.png'));

  if (dev) return;
  if (!existsSync(join(rendererSource, 'index.html'))) {
    throw new Error('Renderer build missing: run the @glacier-tasks/ui build first');
  }
  cpSync(rendererSource, join(outDir, 'renderer'), { recursive: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await buildDesktop();
}
