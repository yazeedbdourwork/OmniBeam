// A second OmniBeam tab in the same browser is this same device: it gets no card of its own (2026-11-25: an
// iPhone showed itself as "Yazeed Bdour · iOS Safari · other tab in this browser", Paired, Online now)
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

test('another tab of this browser shows no card, on either tab; other devices still do', async ({ browser }) => {
  const phone = await openDevice(browser, 'Test Phone');
  devices.push(phone);
  const laptop = await openDevice(browser, 'Test Laptop');
  devices.push(laptop);
  await card(phone.page, laptop.name);
  // A second tab in the phone's browser (same profile, so the same name)
  const tab2 = await phone.context.newPage();
  await tab2.goto('/');
  await expect(tab2.locator('#me-name')).toHaveText(phone.name);
  await card(tab2, laptop.name);
  // The laptop sees both tabs, which is fine; the phone's tabs don't see each other
  await expect(laptop.page.locator('.peer:not(.offline) .name', { hasText: phone.name })).toHaveCount(2);
  await tab2.waitForTimeout(1500);
  for (const page of [phone.page, tab2]) {
    await expect(page.locator('.peer:not(.offline) .name', { hasText: phone.name })).toHaveCount(0);
    await expect(page.locator('#btn-send-all')).toBeHidden();
  }
  // Only the laptop's card
  await expect(phone.page.locator('.peer:not(.offline)')).toHaveCount(1);
  expect(phone.errors).toEqual([]);
});
