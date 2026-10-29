// Fails if the built renderer references remote resources (spec §2: no CDNs, no external
// fonts or assets). Run after `npm run build`.

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const browserDir = path.join(root, 'apps', 'ui', 'dist', 'browser');
const files = [path.join(root, 'apps', 'ui', 'src', 'index.html')];

if (fs.existsSync(browserDir)) {
  for (const entry of fs.readdirSync(browserDir, { recursive: true })) {
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
  {
    // Catches URLs that bundled code could fetch, load or assign at runtime. Every URL in the
    // bundle must be on the allowlist below.
    label: 'remote URL in JavaScript',
    pattern: /https?:\/\/[^\s"'`()<>\\]*/gi,
    extensions: ['.js'],
    allow: [
      // XML namespace identifiers (SVG, MathML, XHTML, XLink, XML) used by Angular and
      // DOMPurify; they are compared as strings, never requested.
      /^http:\/\/www\.w3\.org\/(?:2000\/svg|1998\/Math\/MathML|1999\/xhtml|1999\/xlink|XML\/1998\/namespace|2000\/xmlns\/)$/,
      // Documentation links inside library error messages.
      /^https:\/\/angular\.dev\//,
      /^https:\/\/github\.com\/markedjs\/marked\.?$/,
      // Angular's dummy base for parsing relative URLs, and the scheme marked prefixes to
      // `www.` autolinks (rendered links are never loaded).
      /^http:\/\/fake$/,
      /^http:\/\/$/,
    ],
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
    if (check.extensions && !check.extensions.includes(path.extname(file))) continue;
    for (const match of source.matchAll(check.pattern)) {
      if (check.allow?.some((allowed) => allowed.test(match[0]))) continue;
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
