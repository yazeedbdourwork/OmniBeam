// Nearby (2026-11-27): devices on the same Wi-Fi find each other with no code or QR and their cards say Nearby.
// Settings -> Privacy can hide this device from them (kept as omnibeam-nearby = 'off'); paired devices still connect.
// Plus the new words in all 15 languages and the How to Use entry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const named = (page, name) => page.locator('.peer:not(.offline)').filter({ has: page.locator('.name', { hasText: name }) });

test('same Wi-Fi: cards say Nearby; hiding in Settings takes this device off the others, and back', async ({ browser }) => {
  const a = await open(browser, 'Near Laptop');
  const b = await open(browser, 'Near Phone');
  const onA = await card(a.page, 'Near Phone');
  await expect(onA.locator('.tag')).toHaveText('Nearby');
  await expect(onA.locator('.tag')).toHaveClass(/nearby-tag/);
  await expect((await card(b.page, 'Near Laptop')).locator('.tag')).toHaveText('Nearby');

  // The phone hides: both lose each other's card, the phone's own line says so
  await menu(b.page, 'btn-settings');
  await settingsTab(b.page, 'privacy');
  const box = b.page.locator('#nearby-on');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(named(a.page, 'Near Phone')).toHaveCount(0);
  await expect(named(b.page, 'Near Laptop')).toHaveCount(0);
  await expect(b.page.locator('#me-network')).toContainText('Hidden from Nearby');
  expect(await b.page.evaluate(() => localStorage.getItem('omnibeam-nearby'))).toBe('off');

  // Still hidden after a reload (the setting is sent with the intro)
  await b.page.reload();
  await expect(b.page.locator('#me-name')).toHaveText('Near Phone');
  await a.page.waitForTimeout(1500);
  await expect(named(a.page, 'Near Phone')).toHaveCount(0);
  await expect(named(b.page, 'Near Laptop')).toHaveCount(0);

  // Turned back on: they see each other again
  await menu(b.page, 'btn-settings');
  await settingsTab(b.page, 'privacy');
  await expect(b.page.locator('#nearby-on')).not.toBeChecked();
  await b.page.locator('#nearby-on').check();
  await expect((await card(a.page, 'Near Phone')).locator('.tag')).toHaveText('Nearby');
  await expect(named(b.page, 'Near Laptop')).toHaveCount(1);
  expect(await b.page.evaluate(() => localStorage.getItem('omnibeam-nearby'))).toBe(null);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('hidden from Nearby: paired devices still find each other (tag says Paired)', async ({ browser }) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now() }]);
  const a = await open(browser, 'Pair Laptop', { storage: { 'omnibeam-paired': paired('Pair Phone'), 'omnibeam-nearby': 'off' } });
  const b = await open(browser, 'Pair Phone', { storage: { 'omnibeam-paired': paired('Pair Laptop') } });
  const stranger = await open(browser, 'Stranger Tablet');
  await expect((await card(a.page, 'Pair Phone')).locator('.tag')).toHaveText('Paired');
  await expect((await card(b.page, 'Pair Laptop')).locator('.tag')).toHaveText('Paired');
  // The unpaired device on the same network doesn't see the hidden one, and the hidden one doesn't see it
  await expect((await card(stranger.page, 'Pair Phone')).locator('.tag')).toHaveText('Nearby');
  await expect(named(stranger.page, 'Pair Laptop')).toHaveCount(0);
  await expect(named(a.page, 'Stranger Tablet')).toHaveCount(0);
  expect([...a.errors, ...b.errors, ...stranger.errors]).toEqual([]);
});

test('Nearby words in all 15 languages, in the How to Use page and window', async ({ page }) => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'nearby.keys.json'), 'utf8'));
  const src = ['app.js', 'index.html', 'parts/info.html']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
  for (const k of keys) expect(src.includes(k), `used: ${k}`).toBe(true);
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
  }
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    expect(html, code).toContain('<details id="nearby">');
  }
  await page.goto('/fr/how-to-use');
  await expect(page.locator('#nearby summary')).toContainText('À proximité');
});
