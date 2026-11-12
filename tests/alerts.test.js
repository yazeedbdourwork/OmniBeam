// Alerts when problem reports spike: a test alert from /stats, then a real spike from several networks.
// The test server writes emails to tests/.data/outbox.txt instead of sending them (see playwright.config.js).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const OUTBOX = path.join(__dirname, '.data', 'outbox.txt');
const mail = () => {
  let raw = '';
  try { raw = fs.readFileSync(OUTBOX, 'utf8'); } catch {}
  // Bodies are base64: decode them so the test can read the text
  return raw.replace(/\n\n([A-Za-z0-9+/=\n]+)\n/g, (m, b64) => '\n\n' + Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf8') + '\n')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (m, b64) => Buffer.from(b64, 'base64').toString('utf8'));
};
const report = (request, ip, m) => request.post('/api/report', {
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1' },
  data: { k: 'transfer', m },
});

test('the stats page shows the alert settings and sends a test alert', async ({ page }) => {
  await page.goto('/admin#settings');
  await page.fill('#key', 'test-stats-key');
  await page.click('#login button');
  await expect(page.locator('#alerts')).toContainText('email to o…@example.com');
  await page.click('#alert-test');
  await expect(page.locator('#alert-result')).toHaveText('Sent by email.');
  const m = mail();
  expect(m).toContain('To: owner@example.com');
  expect(m).toContain('Subject: OmniBeam test alert');
});

test('a spike of problem reports from several networks sends one alert, not one per report', async ({ request }) => {
  // One network alone never counts as a spike, however many reports it sends
  for (let i = 0; i < 8; i++) expect((await report(request, '203.0.113.7', 'Connection lost')).status()).toBe(204);
  expect(mail()).not.toContain('problem reports in 15 minutes');
  // A second network: now it's a spike
  expect((await report(request, '198.51.100.9', 'Connection lost')).status()).toBe(204);
  await expect.poll(() => mail()).toContain('problem reports in 15 minutes');
  const m = mail();
  expect(m).toContain('× transfer: Connection lost');
  expect(m).toContain('Safari 18 on iOS');
  expect(m).toContain('/admin');
  // More reports right after: no second alert for an hour
  for (let i = 0; i < 5; i++) await report(request, `192.0.2.${i + 1}`, 'Connection lost');
  expect(mail().split('problem reports in 15 minutes').length - 1).toBe(1);
});
