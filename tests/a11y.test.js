// Accessibility: everything works with the keyboard alone, and screen readers get names for what's on screen
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

test('a device card can be used with the keyboard', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  // Playwright catches the file chooser only once it has told the browser to (a round trip that starts with the
  // first listener). Listening from the start, the chooser that Enter opens below can't slip past that.
  a.page.on('filechooser', () => {});
  const target = await card(a.page, 'Test Phone');
  // The card is a named group; its avatar is the main button (no buttons inside buttons)
  await expect(target).toHaveAttribute('role', 'group');
  const main = target.locator('.peer-main');
  await expect(main).toHaveAttribute('aria-label', 'Send to Test Phone');
  expect(await target.locator('button button').count()).toBe(0);
  await main.focus();
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.keyboard.press('Enter');
  await chooser;
  // Tab moves on to the card's other actions, which show up while focused
  await a.page.keyboard.press('Tab');
  await expect(target.locator('[data-act=files]')).toBeFocused();
  await expect(target.locator('.peer-actions')).toHaveCSS('opacity', '1');
});

test('dialogs are named after their title', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  const unnamed = await a.page.$$eval('dialog', (list) => list.filter((d) => {
    const id = d.getAttribute('aria-labelledby');
    return !(d.getAttribute('aria-label') || (id && document.getElementById(id)?.textContent.trim()));
  }).map((d) => d.id));
  expect(unnamed).toEqual([]);
});
