// "Support OmniBeam": the links to the donation page, and the one thank-you note after a few sends
const { test, expect } = require('@playwright/test');
const { openDevice, makeFile, sendAndReceive } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

test('the Support links go to the donation page', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  await expect(a.page.locator('#footer-support')).toBeVisible();
  await expect(a.page.locator('#footer-support')).toHaveAttribute('href', 'https://ko-fi.com/omnibeam-test');
  await a.page.locator('#btn-menu').click();
  await expect(a.page.locator('#menu-support')).toBeVisible();
  await expect(a.page.locator('#menu-support')).toHaveAttribute('target', '_blank');
});

test('after a few sends a thank-you note mentions it, once', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { storage: { 'omnibeam-support-nudge': '4' } });
  b = await openDevice(browser, 'Test Phone');
  await sendAndReceive(a, b, [makeFile('one.txt', 100, 'text/plain')]);
  await expect(a.page.locator('#toast')).toContainText('You can support it', { timeout: 10000 });
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-support-nudge'))).toBe('-1');
});
