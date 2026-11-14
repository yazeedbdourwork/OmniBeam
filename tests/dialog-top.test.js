// Dialogs sit at the top, just under the header bar, instead of the middle of the screen, so the Pair devices
// dialog no longer jumps up and down when Scan / Code / Rooms (each a different height) are switched.
// With SHOTS=dir set, it also saves phone screenshots of each tab in every style (for the pull request).
const { test, expect, devices } = require('@playwright/test');
const path = require('path');

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent };

async function phone(browser, storage) {
  const context = await browser.newContext(PHONE);
  await context.addInitScript((storage) => {
    localStorage.setItem('omnibeam-name', 'Test Phone');
    localStorage.setItem('omnibeam-tour', 'done');
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }, storage);
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  return { context, page };
}

const looks = [
  ['light', { 'omnibeam-lang': 'en', 'omnibeam-theme': 'light' }],
  ['dark', { 'omnibeam-lang': 'en', 'omnibeam-theme': 'dark' }],
  ['glass', { 'omnibeam-lang': 'en', 'omnibeam-theme': 'light', 'omnibeam-look': 'glass' }],
  ['glass-dark', { 'omnibeam-lang': 'en', 'omnibeam-theme': 'dark', 'omnibeam-look': 'glass' }],
  ['arabic', { 'omnibeam-lang': 'ar', 'omnibeam-theme': 'light', 'omnibeam-look': 'glass' }],
];

for (const [look, storage] of looks) {
  test(`Pair devices stays put under the header when its tabs change (${look})`, async ({ browser }) => {
    const { context, page } = await phone(browser, storage);
    await page.locator('#btn-pair').click();
    const dlg = page.locator('#dlg-pair');
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(400); // the opening animation
    const header = await page.locator('header').boundingBox();
    const tops = [];
    for (const tab of ['scan', 'code', 'rooms']) {
      await page.locator(`[data-pair-tab="${tab}"]`).click();
      await page.waitForTimeout(150);
      const box = await dlg.boundingBox();
      tops.push(box.y);
      // Below the header bar, not over it, and fully on screen
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${look}-${tab}.png`) });
    }
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    await context.close();
  });
}

test('the photo viewer and other small dialogs: viewer, lock screen and chat keep their own place, a short dialog is at the top', async ({ browser }) => {
  const { context, page } = await phone(browser, { 'omnibeam-lang': 'en' });
  const r = await page.evaluate(() => {
    const top = (cls) => {
      const d = document.createElement('dialog'); if (cls) d.className = cls;
      d.style.height = '200px'; document.body.append(d); d.showModal();
      const y = d.getBoundingClientRect().top; d.close(); d.remove(); return y;
    };
    return { plain: top(''), viewer: top('viewer'), lock: top('lock-dialog'), chat: top('chat-dialog') };
  });
  expect(r.plain).toBeLessThan(140);
  expect(r.viewer).toBeGreaterThan(250);
  expect(r.lock).toBeGreaterThan(250);
  // The chat places itself (full screen on phones, chat.js), so the top rule leaves it alone
  expect(r.chat).toBeGreaterThan(250);
  await context.close();
});
