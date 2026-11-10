// A lighter first visit and a simpler top bar: rarely used parts (more.js, qrcode.js) load only when needed, the
// font comes from this site, and Settings, Test speed, Share by link… are in the ⋯ menu
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close().catch(() => {});
  devices = [];
});

test('first visit loads only what the main screen needs', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop');
  devices.push(a);
  await a.page.reload();
  await expect(a.page.locator('#me-scope')).not.toHaveText(/Connecting/);
  const scripts = await a.page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name)));
  const paths = scripts.map((u) => u.pathname);
  expect(paths).not.toContain('/more.js');
  expect(paths).not.toContain('/qrcode.js');
  expect(paths).toContain('/fonts/plus-jakarta-sans-latin.woff2');
  // Nothing from Google Fonts (the font is served by OmniBeam itself)
  expect(scripts.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u.host))).toEqual([]);
  // The top bar: pair, received files, Light/Dark, Settings and the menu (and TV mode, a link)
  await expect(a.page.locator('header .actions > :is(button, .menu-wrap)')).toHaveCount(5);
  await expect(a.page.locator('header .actions > a#bar-tv')).toHaveCount(1);
  // Opening the pairing dialog fetches the QR code script then
  await a.page.locator('#btn-pair').click();
  await expect(a.page.locator('#pair-qr svg')).toBeVisible();
  expect(await a.page.evaluate(() => typeof qrcode)).toBe('function');
  expect(a.errors).toEqual([]);
});

test('the ⋯ menu opens, closes and runs its items', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop');
  const b = await openDevice(browser, 'Test Phone');
  devices.push(a, b);
  const { page } = a;
  const m = page.locator('#menu');
  await expect(m).toBeHidden();
  // Opens, and closes with Escape or a click elsewhere
  await page.locator('#btn-menu').click();
  await expect(m).toBeVisible();
  await expect(page.locator('#btn-menu')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(m).toBeHidden();
  await page.locator('#btn-menu').click();
  await page.mouse.click(10, 400);
  await expect(m).toBeHidden();
  // Dark mode / Light mode
  await page.emulateMedia({ colorScheme: 'light' });
  // (a button in the top bar since 2026-11-08: a moon while light, a sun while dark)
  await expect(page.locator('#bar-theme')).toHaveAttribute('aria-label', 'Dark mode');
  await page.locator('#bar-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#bar-theme')).toHaveAttribute('aria-label', 'Light mode');
  await expect(page.locator('#bar-theme .i-sun')).toBeVisible();
  // Not repeated in the ⋯ menu when the bar has room
  await page.locator('#btn-menu').click();
  await expect(page.locator('#menu #btn-theme')).toBeHidden();
  await expect(page.locator('#menu #btn-settings')).toBeHidden();
  await page.keyboard.press('Escape');
  // Connection check: loads more.js on first use
  expect(await page.evaluate(() => typeof window.More)).toBe('undefined');
  await card(page, 'Test Phone');
  await menu(page, 'menu-check');
  await expect(page.locator('#dlg-check')).toBeVisible();
  await expect(page.locator('#dlg-check .check-list')).toContainText('Test Phone');
  expect(await page.evaluate(() => typeof window.More)).toBe('object');
  await page.locator('#dlg-check [data-act=close]').first().click();
  // Settings, the quick tour, How to Use
  await menu(page, 'btn-settings');
  await expect(page.locator('#dlg-settings')).toBeVisible();
  await page.locator('#dlg-settings [data-close]').click();
  await menu(page, 'menu-tour');
  await expect(page.locator('#dlg-tour')).toBeVisible();
  await page.locator('#dlg-tour [data-tour=skip]').click();
  await page.locator('#btn-menu').click();
  await page.locator('#menu [data-open=dlg-how]').click();
  await expect(page.locator('#dlg-how')).toBeVisible();
  expect(a.errors).toEqual([]);
});

test('the menu is translated', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop', { path: '/ar/', storage: { 'omnibeam-lang': 'ar' } });
  devices.push(a);
  await expect(a.page.locator('#btn-menu')).toHaveAttribute('aria-label', 'المزيد');
  await a.page.emulateMedia({ colorScheme: 'light' });
  await expect(a.page.locator('#bar-theme')).toHaveAttribute('aria-label', 'الوضع الداكن');
  await expect(a.page.locator('#bar-settings')).toHaveAttribute('aria-label', 'الإعدادات');
  await a.page.locator('#btn-menu').click();
  await expect(a.page.locator('#menu-speed')).toHaveText('اختبر السرعة');
  expect(a.errors).toEqual([]);
});
