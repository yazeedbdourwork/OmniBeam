// Automatic tests: two browsers on this computer find each other and send files and messages, the way two
// devices on the same Wi-Fi would. Run them before every upload:
//   npm install                     (once: downloads the test tool)
//   npx playwright install chromium (once: downloads the browser it drives)
//   npm test
// The tests start their own OmniBeam server on port 3999 with its data in tests/.data, so the real site,
// its statistics and its shared links are never touched.
const path = require('path');
const { defineConfig } = require('@playwright/test');

const PORT = 3999;
// A fresh start for the alert tests (only once, in the main process: the test workers load this file too)
if (!process.env.TEST_WORKER_INDEX) {
  // errors.json too: the problem counts of an earlier run made the TV-report tests count 2 instead of 1
  for (const f of ['alert.json', 'outbox.txt', 'emails.jsonl', 'instant.jsonl', 'errors.json', 'status.json', 'telegram.json', 'supporters.json']) { try { require('fs').unlinkSync(path.join(__dirname, '.data', f)); } catch {} }
}
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.test\.js$/,
  outputDir: path.join(__dirname, '.results'),
  timeout: 90 * 1000,
  expect: { timeout: 20 * 1000 },
  // One at a time: every browser here is on the same "network", so devices from tests running side by side
  // would see each other
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    acceptDownloads: true,
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'node server.js',
    cwd: path.join(__dirname, '..'),
    url: `http://localhost:${PORT}/config.json`,
    reuseExistingServer: false,
    timeout: 30 * 1000,
    // GA_ID " " turns Google Analytics off for the tests
    env: { PORT: String(PORT), DATA_DIR: path.join(__dirname, '.data'), GA_ID: ' ', STATS_KEY: 'test-stats-key', NODE_ENV: 'test',
      // Problem-report alerts by email, written to a file instead of sent
      ALERT_EMAIL: 'owner@example.com', ALERT_OUTBOX: path.join(__dirname, '.data', 'outbox.txt'), ALERT_MIN: '6',
      // The "Support OmniBeam" links (hidden when it's empty)
      SUPPORT_URL: 'https://ko-fi.com/omnibeam-test',
      // Emails from the server (Resend), written to a file instead of sent
      EMAIL_OUTBOX: path.join(__dirname, '.data', 'emails.jsonl'), EMAIL_PER_IP_DAY: '50',
      // Crash and stuck-transfer alerts (Telegram), written to a file instead of sent, without the waiting
      INSTANT_OUTBOX: path.join(__dirname, '.data', 'instant.jsonl'), INSTANT_GATHER_MS: '300', INSTANT_EVERY_MIN: '0.01',
      // The status page: the uptime Worker's secret
      STATUS_KEY: 'test-status-key',
      // Supporter codes (Settings -> Supporter, /stats -> Supporters)
      SUPPORTER_KEY: 'test-supporter-key',
      // The Telegram bot, talking to a fake Telegram API that tests/upgrades-1105.test.js starts on port 3998
      TG_BOT_TOKEN: 'test-token', TG_API_BASE: 'http://localhost:3998', TG_BOT_NAME: 'OmniBeam_test_bot', TG_WEBHOOK: 'off' },
  },
});
