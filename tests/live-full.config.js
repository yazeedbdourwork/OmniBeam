// The full check of the LIVE site (tests/live-full.check.js): every feature the live build has, with two or
// three browsers on this PC acting as devices. Run:  npx playwright test -c tests/live-full.config.js
// Like live.config.js it uses the real server (small test files, short-lived share links) with ?analytics=off.
const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /live-full\.check\.js$/,
  // Not .results-live: Playwright empties its output folder on every run, and the reports are kept there
  outputDir: path.join(__dirname, '.results-live-full'),
  timeout: 180 * 1000,
  expect: { timeout: 30 * 1000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, '.results-live-full', 'results.json') }]],
  use: {
    baseURL: (process.env.SITE || 'https://omnibeam.site').replace(/\/$/, ''),
    headless: true,
    acceptDownloads: true,
  },
});
