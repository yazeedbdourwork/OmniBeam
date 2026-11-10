// Liquid Glass style (2026-11-08): Settings > Style switches between Classic and Liquid Glass (frosted see-through
// panels). It works with Automatic, Light and Dark, is kept after a reload (look.js puts it on the page before it is
// drawn), other open tabs follow, the browser bar colour follows, and the words are translated (Arabic shown here).
const { test, expect } = require('@playwright/test');
const { openDevice, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

const look = (page) => page.evaluate(() => document.documentElement.dataset.look || '');
const blur = (page, sel) => page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel));
  return cs.backdropFilter || cs.webkitBackdropFilter || 'none';
}, sel);

test('Settings > Style turns Liquid Glass on and off, and it stays after a reload', async ({ browser }) => {
  const d = await openDevice(browser, 'Glass PC');
  devices.push(d);
  const page = d.page;
  expect(await look(page)).toBe('');
  expect(await blur(page, 'header')).toBe('none');
  await menu(page, 'btn-settings');
  const dlg = page.locator('#dlg-settings');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#look-choice input[value=""]')).toBeChecked();
  await dlg.locator('#look-choice label', { hasText: 'Liquid Glass' }).click();
  expect(await look(page)).toBe('glass');
  expect(await page.evaluate(() => localStorage.getItem('omnibeam-look'))).toBe('glass');
  expect(await blur(page, 'header')).toContain('blur');
  // A second tab follows
  const other = await d.context.newPage();
  await other.goto('/');
  expect(await look(other)).toBe('glass');
  await page.reload();
  // Already on before app.js runs (look.js in <head>)
  expect(await page.evaluate(() => document.documentElement.dataset.look)).toBe('glass');
  await expect(page.locator('#me-name')).toHaveText('Glass PC');
  await menu(page, 'btn-settings');
  await expect(dlg.locator('#look-choice input[value="glass"]')).toBeChecked();
  await dlg.locator('#look-choice label', { hasText: 'Classic' }).click();
  expect(await look(page)).toBe('');
  await expect.poll(() => look(other)).toBe('');
  expect(d.errors).toEqual([]);
});

test('Liquid Glass in light and dark: panels see-through, text readable, bar colour follows', async ({ browser }) => {
  const d = await openDevice(browser, 'Glass Phone', { storage: { 'omnibeam-look': 'glass', 'omnibeam-theme': 'dark' } });
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await look(page)).toBe('glass');
  const bar = () => page.evaluate(() => [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content));
  expect(await bar()).toEqual(['#12152a', '#12152a']);
  // Dark: light text on the glass
  const fg = () => page.evaluate(() => getComputedStyle(document.body).color);
  await expect.poll(fg).toBe('rgb(238, 240, 248)');
  // The ⋯ menu's Light mode switch keeps the glass
  await menu(page, 'btn-theme');
  expect(await look(page)).toBe('glass');
  expect(await bar()).toEqual(['#eef1f8', '#eef1f8']);
  await expect.poll(fg).toBe('rgb(29, 34, 51)'); // after the colour fade
  // The panel is see-through (its fill is a gradient of translucent white)
  const fill = await page.evaluate(() => getComputedStyle(document.querySelector('.me-card')).backgroundImage);
  expect(fill).toMatch(/linear-gradient\(.*rgba\(255, 255, 255, 0\.\d+\)/);
  // Nothing sticks out sideways on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(d.errors).toEqual([]);
});

test('Style words are translated and the choice fits in Arabic (right to left)', async ({ browser }) => {
  const d = await openDevice(browser, 'Glass AR', { path: '/ar/', storage: { 'omnibeam-lang': 'ar' } });
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 360, height: 780 });
  await menu(page, 'btn-settings');
  const dlg = page.locator('#dlg-settings');
  await expect(dlg.locator('#look-choice')).toContainText('زجاج سائل');
  await expect(dlg.locator('#look-choice')).toContainText('كلاسيكي');
  await expect(dlg.locator('#look-choice').locator('xpath=preceding-sibling::p[1]')).toHaveText('النمط');
  await dlg.locator('#look-choice label', { hasText: 'زجاج سائل' }).click();
  expect(await look(page)).toBe('glass');
  const fits = await dlg.evaluate((el) => [...el.querySelectorAll('#look-choice label')].every((l) => l.scrollWidth <= l.clientWidth + 1));
  expect(fits).toBe(true);
  expect(d.errors).toEqual([]);
});

// Pairing window tabs (2026-11-08): Scan / Code / Rooms, plus Devices when some are remembered. One part at a time,
// the last one used opens next time, Code opens while a code is active, keyboard arrows move between tabs.
test('pairing window: Scan, Code and Rooms tabs, one part at a time, remembered', async ({ browser }) => {
  const d = await openDevice(browser, 'Tabs Phone');
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const dlg = page.locator('#dlg-pair');
  await page.locator('#btn-pair').click();
  await expect(dlg.locator('#pair-tab-scan')).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('#pair-qr svg')).toBeVisible();
  await expect(dlg.locator('#pair-code')).toBeHidden();
  await expect(dlg.locator('#pair-tab-devices')).toBeHidden();
  // Short enough for a phone without scrolling
  expect(await dlg.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await dlg.locator('#pair-tab-rooms').click();
  await expect(dlg.locator('#public-code')).toBeVisible();
  await expect(dlg.locator('#team-name')).toBeVisible();
  await expect(dlg.locator('#pair-qr')).toBeHidden();
  // Arrow keys
  await dlg.locator('#pair-tab-rooms').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dlg.locator('#pair-tab-code')).toBeFocused();
  await expect(dlg.locator('#pair-code')).toBeVisible();
  await dlg.locator('[data-act=close]').click();
  // Opens on the tab used last
  await page.locator('#btn-pair').click();
  await expect(dlg.locator('#pair-tab-code')).toHaveAttribute('aria-selected', 'true');
  await dlg.locator('[data-act=create]').click();
  await expect(dlg.locator('#pair-show')).toHaveText(/\d{3} \d{3}/);
  await dlg.locator('#pair-tab-scan').click();
  await dlg.locator('[data-act=close]').click();
  // While a code is active it opens on Code
  await page.locator('#btn-pair').click();
  await expect(dlg.locator('#pair-show')).toBeVisible();
  expect(d.errors).toEqual([]);
});

test('pairing window: Devices tab only with remembered devices; translated in Arabic', async ({ browser }) => {
  const paired = [{ secret: 'a'.repeat(64), name: 'LAPTOP', at: Date.now(), seen: Date.now() }];
  const d = await openDevice(browser, 'Tabs AR', { path: '/ar/', storage: { 'omnibeam-lang': 'ar', 'omnibeam-paired': JSON.stringify(paired) } });
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 360, height: 780 });
  const dlg = page.locator('#dlg-pair');
  await page.locator('#btn-pair').click();
  await expect(dlg.locator('#pair-tab-code')).toHaveText('رمز');
  await expect(dlg.locator('#pair-tab-rooms')).toHaveText('غرف');
  await expect(dlg.locator('#pair-tab-devices')).toHaveText('أجهزة');
  await dlg.locator('#pair-tab-devices').click();
  await expect(dlg.locator('#paired-list .paired-row')).toHaveCount(1);
  // Tab labels fit
  expect(await dlg.locator('.pair-tabs .tab:not([hidden])').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1))).toBe(true);
  // Forgetting the last one hides the tab and goes back to Scan
  page.on('dialog', (x) => x.accept());
  await dlg.locator('[data-forget]').click();
  await expect(dlg.locator('#pair-tab-devices')).toBeHidden();
  await expect(dlg.locator('#pair-tab-scan')).toHaveAttribute('aria-selected', 'true');
  expect(d.errors).toEqual([]);
});

// Top bar (2026-11-08): Light/Dark, TV mode and Settings are buttons there; on phones TV mode (and the ♥) move to the
// ⋯ menu so the bar still fits on one line; below 360px all three are in the menu.
for (const [width, bar, inMenu] of [
  [1280, ['bar-theme', 'bar-tv', 'bar-settings'], []],
  [390, ['bar-theme', 'bar-settings'], ['menu-tv']],
  [340, [], ['btn-theme', 'menu-tv', 'btn-settings']],
]) {
  test(`top bar buttons fit at ${width}px`, async ({ browser }) => {
    const d = await openDevice(browser, 'Bar Test', { path: width === 390 ? '/ar/' : '/', storage: width === 390 ? { 'omnibeam-lang': 'ar' } : {} });
    devices.push(d);
    const page = d.page;
    await page.setViewportSize({ width, height: 700 });
    for (const id of bar) await expect(page.locator(`#${id}`)).toBeVisible();
    // Everything in the bar is inside it, nothing scrolls sideways
    expect(await page.evaluate(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      return [...document.querySelectorAll('header .brand, header .icon-btn')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && (r.left < h.left - 1 || r.right > h.right + 1 || r.top < h.top - 1 || r.bottom > h.bottom + 1);
      }).map((e) => e.id || e.className);
    })).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#btn-menu').click();
    for (const id of inMenu) await expect(page.locator(`#menu #${id}`)).toBeVisible();
    await page.keyboard.press('Escape');
    // Settings opens from wherever it is
    await menu(page, 'btn-settings');
    await expect(page.locator('#dlg-settings')).toBeVisible();
    expect(d.errors).toEqual([]);
  });
}

test('top bar Light/Dark button switches and follows the Theme setting', async ({ browser }) => {
  const d = await openDevice(browser, 'Bar Theme');
  devices.push(d);
  const page = d.page;
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#bar-theme')).toHaveAttribute('aria-label', 'Light mode');
  await page.locator('#bar-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#bar-theme .i-moon')).toBeVisible();
  // Automatic in Settings follows the system again
  await menu(page, 'btn-settings');
  await page.locator('#theme-choice label', { hasText: 'Automatic' }).click();
  await expect(page.locator('#bar-theme')).toHaveAttribute('aria-label', 'Light mode');
  await expect(page.locator('#bar-tv')).toHaveAttribute('href', '/tv');
  expect(d.errors).toEqual([]);
});
