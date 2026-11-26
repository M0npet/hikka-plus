import { defineConfig } from '@playwright/test';

// Перед запуском — `npm run build` (тест вантажить .output/chrome-mv3). Браузер — Chromium Playwright
// (`npx playwright install chromium`) або свій Chrome for Testing / Chromium: HP_CHROME=<шлях>.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  outputDir: '../.output/e2e',
});
