import { defineConfig, devices } from '@playwright/test';

/**
 * Remote smoke tests against an already-running deployment.
 *
 * Deliberately separate from `playwright.config.ts`:
 *  - no `webServer`, so nothing is built or started locally;
 *  - `testDir` points at tests/smoke, which the local E2E config never scans;
 *  - the target is whatever `REMOTE_BASE_URL` names.
 *
 * These tests create one uniquely named post and clean it up. They never
 * migrate, seed or reset anything, and they touch no pre-existing content.
 */

const baseURL = process.env.REMOTE_BASE_URL;

if (!baseURL) {
  throw new Error(
    'REMOTE_BASE_URL is not set.\n\n' +
      'Usage:\n' +
      '  REMOTE_BASE_URL=https://your-app.example.com \\\n' +
      '  REMOTE_AUTHOR_EMAIL=... REMOTE_AUTHOR_PASSWORD=... \\\n' +
      '  REMOTE_EDITOR_EMAIL=... REMOTE_EDITOR_PASSWORD=... \\\n' +
      '  pnpm test:smoke:remote',
  );
}

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  // One worker: a smoke test should not put concurrent load on a live instance,
  // and the editorial flow is inherently sequential.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A free-tier host may cold-start on the very first request.
  retries: 1,
  timeout: 5 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: baseURL.replace(/\/+$/, ''),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Generous, because the first hit may wake a sleeping instance.
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
