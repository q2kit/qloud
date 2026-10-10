import { defineConfig, devices } from '@playwright/test';

// E2E runs the real stack: Django (with Postgres, Redis and Mailpit from docker
// compose) and the production frontend build served by `vite preview`, which
// proxies /api. Google and GitHub are replaced by e2e/oauth-provider.ts.
// Ports differ from the dev servers (8000/5173) so both can run side by side.
// PREVIEW_DEV=1 exercises React's development StrictMode effect replay as well.
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 4173;
const OAUTH_PROVIDER_PORT = 8002;
const isCI = Boolean(process.env.CI);
const previewDev = process.env.PREVIEW_DEV === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(FRONTEND_PORT)}`,
    locale: 'vi-VN',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      // Smallest supported width (AGENTS.md). Chromium only, like CI installs.
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 740 },
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/oauth-provider.ts',
      url: `http://127.0.0.1:${String(OAUTH_PROVIDER_PORT)}/health`,
      env: { PORT: String(OAUTH_PROVIDER_PORT) },
      reuseExistingServer: !isCI,
    },
    {
      cwd: '../qloud_backend',
      command: `uv run --frozen python manage.py migrate --noinput && uv run --frozen python manage.py runserver 127.0.0.1:${String(BACKEND_PORT)} --noreload`,
      url: `http://127.0.0.1:${String(BACKEND_PORT)}/api/v1/health`,
      env: {
        DJANGO_SETTINGS_MODULE: 'config.settings.e2e',
        // Links in emails lead back to the frontend below.
        APP_BASE_URL: `http://localhost:${String(FRONTEND_PORT)}`,
        E2E_OAUTH_URL: `http://127.0.0.1:${String(OAUTH_PROVIDER_PORT)}`,
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: previewDev
        ? `pnpm dev --port ${String(FRONTEND_PORT)} --strictPort`
        : `pnpm build && pnpm preview --port ${String(FRONTEND_PORT)} --strictPort`,
      url: `http://localhost:${String(FRONTEND_PORT)}`,
      env: { QLOUD_API_TARGET: `http://127.0.0.1:${String(BACKEND_PORT)}` },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
