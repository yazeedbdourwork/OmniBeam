// The admin panel (/admin, also at /stats): one sign-in, sections in tabs, the status numbers inside it, the feature
// counts as one sorted list, and nothing wider than a phone screen.
const { test, expect } = require('@playwright/test');

const signIn = async (page, path = '/admin') => {
  await page.goto(path);
  await page.fill('#key', 'test-stats-key');
  await page.click('#login button');
  await expect(page.locator('#view')).toBeVisible();
};

test('the admin panel: sign in, Overview first, tabs, the address remembers the tab', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#key', 'wrong');
  await page.click('#login button');
  await expect(page.locator('#error')).toHaveText('Wrong key.');
  await signIn(page);
  await expect(page.locator('#tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ov-kpis .tile')).toHaveCount(5);
  await expect(page.locator('#ov-status')).toContainText(/All systems working|Not working/);
  await expect(page.locator('#glance')).toContainText('At a glance');

  // Status: the same parts and uptime as the public /status page, and the TURN server
  await page.click('#tab-status');
  await expect(page).toHaveURL(/#status$/);
  await expect(page.locator('#p-status')).toBeVisible();
  await expect(page.locator('#p-overview')).toBeHidden();
  await expect(page.locator('#period-bar')).toBeHidden();
  await expect(page.locator('#status-now')).toContainText('Website and sending');
  await expect(page.locator('#status-bars span')).toHaveCount(30);
  await expect(page.locator('#turn')).toContainText('TURN');

  // Features: one list, most used first
  await page.click('#tab-features');
  await expect(page.locator('#period-bar')).toBeVisible();
  await expect(page.locator('#features-lead')).toContainText(/feature/);

  // Arrow keys move between tabs; a reload opens the same tab
  await page.locator('#tab-features').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#tab-problems')).toBeFocused();
  await expect(page.locator('#p-problems')).toBeVisible();
  await page.reload();
  await expect(page.locator('#p-problems')).toBeVisible();

  // Old addresses still work
  expect((await request.get('/stats')).status()).toBe(200);
  const old = await request.get('/stats.html', { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe('/admin');
  expect((await request.get('/admin')).headers()['x-robots-tag']).toContain('noindex');
});

test('the admin panel fits a phone: tabs in a row, no sideways scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
  const page = await ctx.newPage();
  await signIn(page, '/admin#features');
  for (const t of ['overview', 'visitors', 'transfers', 'features', 'problems', 'status', 'settings']) {
    await page.click(`#tab-${t}`);
    await expect(page.locator(`#p-${t}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});
