// Runs the unpacked packaged app in smoke mode and verifies its result file.
// Usage: node scripts/smoke-packaged.mjs [win32|linux]   (defaults to the current platform)

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const requestedPlatform = process.argv[2] ?? process.platform;
const releaseDir = path.resolve('apps', 'desktop', 'release');
const executables = {
  linux: path.join(releaseDir, 'linux-unpacked', 'glacier-tasks'),
  win32: path.join(releaseDir, 'win-unpacked', 'Glacier Tasks.exe'),
};
const executable = executables[requestedPlatform];

if (!executable) throw new Error(`Unsupported smoke platform: ${requestedPlatform}`);
if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glacier-tasks-packaged-smoke-'));
const resultFile = path.join(tempDir, 'result.json');
const child = spawn(executable, [], {
  env: {
    ...process.env,
    GLACIER_SMOKE: '1',
    GLACIER_SMOKE_RESULT: resultFile,
    GLACIER_USER_DATA: path.join(tempDir, 'user-data'),
  },
  stdio: 'inherit',
});

const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
const exitResult = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timer);

try {
  if (!fs.existsSync(resultFile)) {
    throw new Error(`Packaged app wrote no smoke result (exit ${JSON.stringify(exitResult)})`);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
  console.log(JSON.stringify(result, null, 2));
  if (exitResult.code !== 0 || result.ok !== true) {
    throw new Error(`Packaged ${requestedPlatform} smoke verification failed`);
  }
  console.log(`Packaged ${requestedPlatform} smoke verification passed.`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
