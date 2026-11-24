import { defineConfig, devices } from '@playwright/test'

// `npm run test:e2e` runs `vite build` first; each server below then serves dist/client exactly like `npm start`.
// Every viewport gets its own server and data folder, so both walk the real first-run onboarding. The servers are
// stateful (one active dataset), so tests run one at a time and project dependencies fix the order:
// onboarding -> dashboard tests -> push API and accuracy checks (which replace the dataset).
const targets = [
  { name: 'desktop', port: 8804, use: { viewport: { width: 1440, height: 900 } } },
  { name: 'mobile', port: 5184, use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
] as const

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: targets.flatMap((t) => {
    const use = { ...devices['Desktop Chrome'], ...t.use, baseURL: `http://127.0.0.1:${t.port}` }
    return [
      { name: `${t.name}-onboarding`, testMatch: /onboarding\.spec\.ts/, use },
      { name: t.name, testMatch: /dashboard\.spec\.ts|exploratory\.spec\.ts/, dependencies: [`${t.name}-onboarding`], use },
      // The API checks do not depend on the viewport; one server is enough.
      ...(t.name === 'desktop' ? [{ name: 'api', testMatch: /(push-api|accuracy)\.spec\.ts/, dependencies: [t.name], use }] : []),
    ]
  }),
  webServer: targets.map((t) => ({
    command: 'npx tsx e2e/support/serve.ts --static',
    url: `http://127.0.0.1:${t.port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(t.port),
      SALES_PULSE_DATA_DIR: `.local-data/e2e/${t.name}`,
      SALES_PULSE_LLM_MOCK: '1',
      SALES_PULSE_TELEGRAM_MOCK: '1',
    },
  })),
})
