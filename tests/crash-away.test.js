// Crash check on phones (report.js v5, 2026-11-23): a page that loses focus without being hidden (the Camera app
// opened from Control Center to scan a computer's pairing code, the app switcher) is noted 'away', so iOS closing the
// tab there to free memory is not reported as a crash. Computers keep 'visible' (a window without focus is still in
// view there). These tests only read the note in sessionStorage: nothing is sent to /api/report.
const { test, expect } = require('@playwright/test');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const state = (page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem('omnibeam-alive') || 'null') || {}).state);

async function open(browser, phone) {
  const context = await browser.newContext(phone
    ? { userAgent: IPHONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
  await context.addInitScript(() => {
    localStorage.setItem('omnibeam-lang', 'en');
    localStorage.setItem('omnibeam-tour', 'done');
    localStorage.setItem('omnibeam-rights', '1');
  });
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  await expect.poll(() => state(page)).toBeTruthy();
  return { context, page };
}

test('phone: the Pair window losing focus to another app is noted "away", not "visible"', async ({ browser }) => {
  const { context, page } = await open(browser, true);
  try {
    await page.locator('#btn-pair').click();
    await expect(page.locator('#dlg-pair')).toBeVisible();
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await state(page)).toBe('away');
    expect(await page.evaluate(() => (JSON.parse(sessionStorage.getItem('omnibeam-alive')).d))).toMatch(/window: dlg-pair/);
  } finally { await context.close(); }
});

test('computer: a window without focus is still "visible" (a crash there is still reported)', async ({ browser }) => {
  const { context, page } = await open(browser, false);
  try {
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await state(page)).toBe('visible');
  } finally { await context.close(); }
});
