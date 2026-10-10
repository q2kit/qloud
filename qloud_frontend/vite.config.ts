import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Keep the browser's Host (changeOrigin: false; Vite's string shorthand would rewrite
// it), so URLs Django builds from the request, such as OAuth callbacks, point at
// the dev server the user actually opened.
const apiTarget = {
  target: process.env.QLOUD_API_TARGET ?? 'http://localhost:8000',
  changeOrigin: false,
};
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(rootDirectory, 'src') },
  },
  server: {
    // `vite preview` reuses this proxy. E2E points it at its own backend port.
    proxy: {
      '/api': apiTarget,
      '/admin': apiTarget,
      // Django admin assets (STATIC_URL = /static/).
      '/static': apiTarget,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/**/*.d.ts',
        'src/components/ui/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
