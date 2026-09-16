import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

/**
 * Playwright is in this stack instead of jsdom for one reason: hit-testing.
 * `document.elementFromPoint()` needs a real compositor, and the bugs it
 * catches — a control buried under a full-width rail, a marker dropped into
 * normal flow — are invisible to a DOM that never lays anything out.
 *
 * Vitest owns `src/**` and never looks in here (see `exclude` in
 * vitest.config.ts); these two are not meant to meet.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // `npm run test:e2e` starts the app itself. `predev` copies MapLibre's
  // worker into public/ on the way, which is the difference between a map and
  // a blank canvas.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
