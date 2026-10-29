import { defineConfig } from '@playwright/test';

// E2E tests drive the built (unpackaged) Electron app: run `npm run build` first.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
});
