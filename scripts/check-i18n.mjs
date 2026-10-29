// Translation hygiene (M8): every key in en.ts must be used somewhere: in the renderer, or as
// an error message key thrown by the main process or the data services.
// Missing keys are already compile errors: `de.ts` satisfies Record<TranslationKey, string>,
// and Angular's strict templates type-check every i18n.t('…') argument. Keys built at run
// time (e.g. `activity.${type}`) are recognised through the prefixes listed below.

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const appDir = path.join(root, 'apps', 'ui', 'src', 'app');
const en = fs.readFileSync(path.join(appDir, 'core', 'i18n', 'en.ts'), 'utf-8');
const keys = [...en.matchAll(/^\s*'([A-Za-z0-9_.]+)':/gm)].map((match) => match[1]);

/** Prefixes of keys that the code assembles from a value (template strings, enum maps). */
const DYNAMIC_PREFIXES = [
  'activity.task.',
  'activity.project.',
  'activity.user.',
  'activity.status.',
  'activity.label.',
];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    if (!/\.(ts|html)$/.test(entry.name) || /\.spec\.ts$/.test(entry.name)) return [];
    if (/[\\/]i18n[\\/](en|de)\.ts$/.test(full)) return [];
    return [full];
  });
}

const mainProcess = ['apps/desktop/src', 'packages/data/src', 'packages/domain/src'].map((dir) =>
  path.join(root, dir),
);
const code = [appDir, ...mainProcess]
  .flatMap(sources)
  .map((file) => fs.readFileSync(file, 'utf-8'))
  .join('\n');

const unused = keys.filter(
  (key) =>
    !code.includes(`'${key}'`) &&
    !code.includes(`"${key}"`) &&
    !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
);

if (unused.length > 0) {
  console.error(
    `Unused translation keys (${unused.length}):\n${unused.map((k) => `- ${k}`).join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(`Translation check passed: ${keys.length} keys, all in use.`);
}
