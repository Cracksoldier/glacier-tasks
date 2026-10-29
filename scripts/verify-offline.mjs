// Fails if the built renderer references remote resources (spec §2: no CDNs, no external
// fonts or assets). Run after `npm run build`.

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const browserDir = path.join(root, 'apps', 'ui', 'dist', 'browser');
const files = [path.join(root, 'apps', 'ui', 'src', 'index.html')];

if (fs.existsSync(browserDir)) {
  for (const entry of fs.readdirSync(browserDir)) {
    if (/\.(?:html|css|js)$/.test(entry)) files.push(path.join(browserDir, entry));
  }
} else {
  files.push(path.join(browserDir, 'index.html'));
}

const checks = [
  {
    label: 'remote HTML resource',
    pattern: /<(?:script|link|img|iframe|source)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi,
  },
  {
    label: 'remote CSS import or URL',
    pattern: /(?:@import\s+|url\(\s*)["']?(?:https?:)?\/\//gi,
  },
  {
    label: 'remote font provider',
    pattern: /fonts\.(?:googleapis|gstatic)\.com|use\.fontawesome\.com|cdnjs\.cloudflare\.com/gi,
  },
];

const failures = [];
for (const file of files) {
  if (!fs.existsSync(file)) {
    failures.push(`Missing build input: ${path.relative(root, file)}`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf-8');
  for (const check of checks) {
    for (const match of source.matchAll(check.pattern)) {
      failures.push(
        `${path.relative(root, file)}: ${check.label}: ${match[0].replace(/\s+/g, ' ')}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('Offline verification failed:\n' + failures.map((item) => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Offline verification passed for ${files.length} renderer resource files.`);
}
