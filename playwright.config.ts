import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180000, // 3 minute timeout per test (claude CLI can be slow)
  retries: 0,
  workers: 1, // Sequential — shared server
  use: {
    baseURL: 'http://127.0.0.1:17891',
  },
});
