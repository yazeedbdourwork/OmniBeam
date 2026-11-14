// The ⋯ button on a device card opens the "More…" list with one tap (phones don't show the hover buttons, and
// few people know to long-press). A long press still works, and doesn't also open the file picker.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

test('⋯ on a device card opens the More… list with one tap, on a phone too', async ({ browser }) => {
  const a = await openDevice(browser, 'Laptop Menu');
  const b = await openDevice(browser, 'Phone Menu');
  // A phone-sized touch screen
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('omnibeam-name', 'Touch Menu');
    localStorage.setItem('omnibeam-lang', 'en');
    localStorage.setItem('omnibeam-tour', 'done');
  });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const phone = await ctx.newPage();
  await phone.goto('/');

  const target = await card(phone, 'Laptop Menu');
  const btn = target.locator('.peer-more-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-label', 'More options for Laptop Menu');
  expect(parseFloat(await btn.evaluate((el) => getComputedStyle(el).width))).toBeGreaterThanOrEqual(32); // big enough for a finger
  await btn.tap();
  const dlg = phone.locator('#dlg-actions');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.who')).toHaveText('Laptop Menu');
  await phone.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  // Long press on the card: the list opens, the file picker doesn't, and no text gets selected
  let picker = false;
  phone.on('filechooser', () => { picker = true; });
  const c = await card(phone, 'Laptop Menu');
  expect(await c.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  const cb = await c.locator('.name').boundingBox();
  const cdp = await ctx.newCDPSession(phone);
  const point = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await phone.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(dlg).toBeVisible();
  await phone.waitForTimeout(300);
  expect(picker).toBe(false);
  expect(await phone.evaluate(() => String(getSelection()))).toBe('');

  // With a mouse the ⋯ also works (keyboard users reach it with Tab)
  const onLaptop = await card(b.page, 'Laptop Menu');
  await onLaptop.locator('.peer-more-btn').focus();
  await b.page.keyboard.press('Enter');
  await expect(b.page.locator('#dlg-actions')).toBeVisible();

  await ctx.close(); await a.close(); await b.close();
});

test('the ⋯ button label is translated in every language', () => {
  const dir = path.join(__dirname, '..', 'public', 'lang');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const lang = require(path.join(dir, f));
    expect(lang.strings['More options for {name}'], f).toContain('{name}');
  }
});
