const { defineConfig } = require('@playwright/test');

const port = Number(process.env.EDA_WEBVIEWS_DEV_PORT || 4173);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: {
    timeout: 30_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true
  },
  webServer: {
    command: `npm run webviews:dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 180_000
  }
});
