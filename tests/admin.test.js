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

  // Status: parts, uptime and incidents (only here now), and the TURN server
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
  for (const t of ['overview', 'visitors', 'transfers', 'features', 'problems', 'log', 'status', 'settings']) {
    await page.click(`#tab-${t}`);
    await expect(page.locator(`#p-${t}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

test('Error log tab: every report in full, newest first, with kind and search filters', async ({ page, request }) => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
  const crash = await request.post('/api/report', {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.71', 'User-Agent': ua },
    data: { k: 'crash', m: 'The page stopped without closing (browser crash or out of memory)', busy: false, up: 3, page: 'app', v: '95', d: 'window: dlg-how' },
  });
  expect(crash.status()).toBe(204);
  await request.post('/api/report', {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.72', 'User-Agent': ua },
    data: { k: 'js', m: 'TypeError: Error log test', src: '/app.js', line: 42, v: '95' },
  });
  await signIn(page, '/admin#log');
  await expect(page.locator('#tab-log')).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('#log-list .log-row.k-crash').filter({ hasText: 'The page stopped' }).first();
  await expect(row).toBeVisible();
  await row.locator('summary').click();
  const full = row.locator('pre');
  await expect(full).toContainText('What the page was doing: window: dlg-how');
  await expect(full).toContainText('Transfer running: no');
  await expect(full).toContainText('Page open for: 3 min');
  await expect(full).toContainText('App version: v95');
  await expect(full).toContainText('Browser: Safari 27');
  // Filters: by kind, then by text
  await page.selectOption('#log-kind', 'js');
  await expect(page.locator('#log-list .log-row.k-crash')).toHaveCount(0);
  await expect(page.locator('#log-list .log-row.k-js').filter({ hasText: 'Error log test' })).toHaveCount(1);
  await page.selectOption('#log-kind', '');
  await page.fill('#log-search', 'dlg-how');
  await expect(page.locator('#log-list .log-row')).not.toHaveCount(0);
  for (const text of await page.locator('#log-list .log-row pre').allTextContents()) expect(text).toContain('dlg-how');
  // Download (JSON) gives the shown reports
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#log-json')]);
  expect(dl.suggestedFilename()).toMatch(/^omnibeam-error-log-\d{4}-\d{2}-\d{2}\.json$/);
});
