import { defineConfig, devices } from '@playwright/test';

// E2E runs the real stack: Django (with Postgres + Redis from docker compose) and
// the production frontend build served by `vite preview`, which proxies /api.
// Ports differ from the dev servers (8000/5173) so both can run side by side.
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 4173;
const isCI = Boolean(process.env.CI);

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
      cwd: '../qloud_backend',
      command: `uv run --frozen python manage.py migrate --noinput && uv run --frozen python manage.py runserver 127.0.0.1:${String(BACKEND_PORT)} --noreload`,
      url: `http://127.0.0.1:${String(BACKEND_PORT)}/api/v1/health`,
      env: { DJANGO_SETTINGS_MODULE: 'config.settings.test' },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `pnpm build && pnpm preview --port ${String(FRONTEND_PORT)} --strictPort`,
      url: `http://localhost:${String(FRONTEND_PORT)}`,
      env: { QLOUD_API_TARGET: `http://127.0.0.1:${String(BACKEND_PORT)}` },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
