// Checks the LIVE site (https://omnibeam.site) after an upload, the way a visitor would use it. Double-click
// live-check.cmd in the omni folder, or:  npx playwright test -c tests/live.config.js
// Another address: set SITE first, e.g.  set SITE=https://omnibeam.site  (Windows) / SITE=... npx playwright ...
// It uses the real server, so it sends a few small test files and makes one short-lived share link
// (deleted after its first download). Visits are sent with ?analytics=off, so statistics stay clean.
const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /live\.check\.js$/,
  outputDir: path.join(__dirname, '.results-live'),
  timeout: 120 * 1000,
  expect: { timeout: 30 * 1000 },
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: (process.env.SITE || 'https://omnibeam.site').replace(/\/$/, ''),
    headless: true,
    acceptDownloads: true,
  },
});
