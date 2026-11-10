// The Microsoft Store app (PWABuilder) and the Chrome Web Store: what the stores read from the site
const { test, expect } = require('@playwright/test');

test('the app manifest has its screenshots and no errors', async ({ page, request }) => {
  await page.goto('/');
  const cdp = await page.context().newCDPSession(page);
  const { errors } = await cdp.send('Page.getAppManifest');
  expect(errors).toEqual([]);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.screenshots.length).toBeGreaterThanOrEqual(2);
  for (const s of manifest.screenshots) {
    const res = await request.get(s.src);
    expect(res.status(), s.src).toBe(200);
  }
});

test('with no internet the installed app shows a page that says so', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/how-to-use').catch(() => {});
  await expect(page.locator('h1')).toHaveText("You're offline");
  await context.setOffline(false);
  await page.goto('/how-to-use');
  await expect(page.locator('h1')).not.toHaveText("You're offline");
});

test('the privacy policy covers notifications, the extension, the Windows app, camera/microphone/screen and secret notes', async ({ page }) => {
  for (const path of ['/privacy', '/ar/privacy', '/es/privacy', '/fr/privacy', '/tr/privacy', '/de/privacy', '/pt/privacy', '/hi/privacy', '/id/privacy', '/ru/privacy', '/ja/privacy', '/zh/privacy', '/ko/privacy', '/it/privacy', '/ur/privacy']) {
    await page.goto(path);
    await expect(page.locator('main h2, article h2')).toHaveCount(20); // 18 since the website box, Telegram bot and status page (2026-11-05)
  }
  await page.goto('/privacy');
  for (const h of ['Notifications', 'Browser extension', 'OmniBeam app for Windows', 'Camera, microphone and screen', 'Secret notes']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
});

test('the Firefox version of the extension is built for Firefox Add-ons', async () => {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'deploy.js'), '--store'], { encoding: 'utf8' });
  expect(r.status, r.stdout + r.stderr).toBe(0);
  const zip = fs.readFileSync(path.join(root, 'deploy', 'omnibeam-firefox.zip'));
  // The manifest is stored first, uncompressed or deflated: find it by its text
  const zlib = require('zlib');
  const nameLen = zip.readUInt16LE(26), extraLen = zip.readUInt16LE(28), method = zip.readUInt16LE(8), size = zip.readUInt32LE(18);
  expect(zip.toString('utf8', 30, 30 + nameLen)).toBe('manifest.json');
  const raw = zip.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size);
  const manifest = JSON.parse((method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'));
  expect(manifest.background).toEqual({ scripts: ['background.js'] });
  expect(manifest.browser_specific_settings.gecko.id).toBe('omnibeam@omnibeam.site');
  expect(JSON.stringify(manifest)).not.toContain('localhost');
});
