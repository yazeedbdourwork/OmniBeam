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

// ---------- Easier for everyone: screen readers, keyboard only, large text, high contrast ----------
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// axe-core (the checker browsers' own accessibility tools use) on the WCAG 2.2 A and AA rules. Only what is on screen
// is checked, so each window is opened in turn.
async function axeCheck(page, include) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async (inc) => window.axe.run(inc ? { include: [inc] } : document,
    { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }), include || null);
  return res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
}

test('no WCAG AA problems on the home page and its windows, in both styles, light and dark, high contrast too', async ({ browser }) => {
  test.setTimeout(240000);
  for (const storage of [
    {}, { 'omnibeam-theme': 'dark' }, { 'omnibeam-look': 'glass' }, { 'omnibeam-look': 'glass', 'omnibeam-theme': 'dark' },
    { 'omnibeam-contrast': 'more' }, { 'omnibeam-contrast': 'more', 'omnibeam-theme': 'dark', 'omnibeam-look': 'glass' },
  ]) {
    const d = await openDevice(browser, 'Test Laptop', { storage });
    try {
      const where = JSON.stringify(storage);
      expect(await axeCheck(d.page), `${where} home`).toEqual([]);
      for (const id of await d.page.$$eval('dialog', (l) => l.map((x) => x.id))) {
        await d.page.evaluate((id) => { document.querySelectorAll('dialog[open]').forEach((x) => x.close()); document.getElementById(id).showModal(); }, id);
        // Colours are checked once the window has finished fading in
        await d.page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect?.getTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {}))));
        expect(await axeCheck(d.page, `#${id}`), `${where} #${id}`).toEqual([]);
      }
    } finally { await d.close(); }
  }
});

test('no WCAG AA problems on the guides and the other pages', async ({ page }) => {
  test.setTimeout(120000);
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  for (const path of ['/how-to-use', '/guides', '/omnibeam-vs-airdrop', '/about', '/privacy', '/ar/how-to-use', '/drop.html', '/request.html', '/no-such-page']) {
    await page.goto(path);
    expect(await axeCheck(page), path).toEqual([]);
  }
});

test('keyboard: the first Tab offers a skip link that jumps past the top bar', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  await a.page.evaluate(() => document.activeElement?.blur());
  await a.page.keyboard.press('Tab');
  const skip = a.page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await a.page.keyboard.press('Enter');
  await expect(a.page.locator('main')).toBeFocused();
});

test('Text size and Contrast in Settings: saved, shown before the page is drawn, and nothing sticks out sideways', async ({ browser }) => {
  a = await openDevice(browser, 'Test Phone');
  await a.page.setViewportSize({ width: 360, height: 740 });
  await a.page.click('#bar-settings, #btn-menu');
  if (!(await a.page.locator('#dlg-settings').isVisible())) await a.page.click('#btn-settings');
  await a.page.locator('#text-choice label', { hasText: 'Largest' }).click();
  await a.page.locator('#contrast-choice label', { hasText: 'High' }).click();
  const html = a.page.locator('html');
  await expect(html).toHaveAttribute('data-text', 'xl');
  await expect(html).toHaveAttribute('data-contrast', 'more');
  expect(await a.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThan(21);
  // After a reload look.js puts both back before app.js runs
  await a.page.reload();
  await expect(html).toHaveAttribute('data-text', 'xl');
  await expect(html).toHaveAttribute('data-contrast', 'more');
  // The page fits the phone's width with the biggest text
  await a.page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((x) => x.close()));
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // High contrast gives every button a solid edge instead of a soft shadow
  expect(await a.page.locator('#btn-pair').evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 2px/);
  // Contrast "Automatic" follows the device's own setting
  await a.page.evaluate(() => localStorage.removeItem('omnibeam-contrast'));
  await a.page.emulateMedia({ contrast: 'more' });
  await a.page.reload();
  await expect(html).toHaveAttribute('data-contrast', 'more');
  await a.page.emulateMedia({ contrast: 'no-preference' });
  await a.page.reload();
  await expect(html).not.toHaveAttribute('data-contrast', 'more');
});

test('screen readers hear when a device arrives and leaves, and transfers have a progress bar', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  await a.page.waitForTimeout(4200); // the devices already there when the page opens aren't announced one by one
  b = await openDevice(browser, 'Test Phone');
  const live = a.page.locator('#sr-live');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText('Test Phone is here');
  const bar = (await card(a.page, 'Test Phone')).locator('.xfer-bar');
  await expect(bar).toHaveAttribute('role', 'progressbar');
  await expect(bar).toHaveAttribute('aria-label', 'Transfer with Test Phone');
  await b.close();
  b = null;
  await expect(live).toHaveText('Test Phone left');
});

test('the new settings and announcements are translated in every language', async () => {
  const keys = ['Skip to main content', '{name} is here', '{name} left', 'Sent to {name}', 'Received from {name}', 'Transfer with {name}',
    'Text size', 'Normal', 'Large', 'Largest', 'Contrast', 'High', "High contrast: solid colours with clear edges. Automatic follows your device's setting."];
  for (const f of fs.readdirSync(require('path').join(__dirname, '..', 'public', 'lang'))) {
    const pack = require(`../public/lang/${f}`);
    expect(keys.filter((k) => !pack.strings[k]), f).toEqual([]);
  }
});
