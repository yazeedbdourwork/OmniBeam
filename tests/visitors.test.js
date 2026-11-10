// Visitor counting for /stats (public/visit.js -> /api/visit): a visit with its country, page, source and time,
// nothing from people who said "No thanks", and the Visitors section of the stats page.
const { test, expect } = require('@playwright/test');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const today = async (request) => {
  const r = await request.get('/api/stats?days=1', { headers: { Authorization: 'Bearer test-stats-key' } });
  const j = await r.json();
  return { day: j.days[new Date().toISOString().slice(0, 10)] || {}, now: j.now };
};
// A visitor from a country (Cloudflare's CF-IPCountry header); visit.js skips automated browsers, so look like a person
async function visitor(browser, country, ip, storage = {}) {
  const context = await browser.newContext({ userAgent: UA, extraHTTPHeaders: { 'CF-IPCountry': country, 'X-Forwarded-For': ip } });
  await context.addInitScript((storage) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    localStorage.setItem('omnibeam-tour', 'done');
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }, storage);
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  return context.newPage();
}

test('a visit is counted with its country, page, source and time; "No thanks" is not counted', async ({ browser, request }) => {
  const before = (await today(request)).day;
  const page = await visitor(browser, 'JO', '198.51.100.20');
  await page.goto('/how-to-use?utm_source=newsletter');
  await expect.poll(async () => (await today(request)).day.uc_JO || 0).toBe((before.uc_JO || 0) + 1);
  const { day, now } = await today(request);
  expect(day['vp_/how-to-use']).toBe((before['vp_/how-to-use'] || 0) + 1);
  expect(day.us_newsletter).toBe((before.us_newsletter || 0) + 1);
  expect(day.ub_Chrome).toBeGreaterThan(before.ub_Chrome || 0);
  expect(now.countries.JO).toBeGreaterThan(0);
  // Closing the page ends the visit: its seconds and the "how long" group are counted
  await page.waitForTimeout(2200);
  await page.close({ runBeforeUnload: true });
  await expect.poll(async () => (await today(request)).day.timed || 0).toBe((before.timed || 0) + 1);
  expect((await today(request)).day.tc_JO).toBeGreaterThanOrEqual((before.tc_JO || 0) + 2);

  const no = await visitor(browser, 'FR', '198.51.100.21', { 'omnibeam-analytics': 'no' });
  await no.goto('/');
  await no.waitForTimeout(1500);
  expect((await today(request)).day.uc_FR || 0).toBe(before.uc_FR || 0);
  await no.context().close();
});

test('the stats page shows visitors by country and switches periods', async ({ browser, page }) => {
  const v = await visitor(browser, 'DE', '198.51.100.30');
  await v.goto('/');
  await page.goto('/stats');
  await page.fill('#key', 'test-stats-key');
  await page.click('#login button');
  await expect(page.locator('#countries')).toContainText('Germany');
  await expect(page.locator('#now')).toContainText('on the site right now');
  await page.click('.range button[data-days="7"]');
  await expect(page.locator('#visit-tiles')).toContainText('Visitors, 7 days');
  const download = page.waitForEvent('download');
  await page.click('#csv');
  expect((await download).suggestedFilename()).toMatch(/^omnibeam-stats-.*\.csv$/);
  await v.context().close();
});
