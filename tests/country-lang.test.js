// Language and flag by the visitor's country (2026-11-28): a first visit with no language of its own gets its
// country's language (Cloudflare's /cdn-cgi/trace says where it is), the visitor's own choice and a browser set to
// another language win, search engines and test tools are never moved, and the flag shows beside the language menu.
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close().catch(() => {});
  devices = [];
});

// A real visitor (not a test tool) in country `cc`; counts the country lookups
function visitor(cc, asked, fresh = true) {
  return async (context) => {
    await context.addInitScript((fresh) => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      // A first visit: no language chosen yet (the tests' helper sets English); later loads keep what was picked
      if (fresh && window === top && !sessionStorage.getItem('t-fresh')) { sessionStorage.setItem('t-fresh', '1'); localStorage.removeItem('omnibeam-lang'); }
    }, fresh);
    await context.route('**/cdn-cgi/trace', (route) => {
      asked.n++;
      route.fulfill({ status: 200, contentType: 'text/plain', body: `fl=1\nh=omnibeam.site\nip=203.0.113.9\nloc=${cc}\ntls=TLSv1.3\n` });
    });
  };
}

test('first visit from Jordan with an English browser opens the Arabic page with the Jordan flag', async ({ browser }) => {
  const asked = { n: 0 };
  const a = await openDevice(browser, 'JO Visitor', { setup: visitor('JO', asked) });
  devices.push(a);
  const page = a.page;
  await expect(page).toHaveURL(/\/ar\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#lang-flag img')).toHaveAttribute('src', '/flags/jo.svg');
  await expect.poll(() => page.locator('#lang-flag img').evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-country')).cc)).toBe('JO');
  // Asked once: the Arabic page uses the saved country
  expect(asked.n).toBe(1);
  // Picking English is kept: the next visit stays English
  await page.locator('#btn-lang').selectOption('en');
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.waitForLoadState('load');
  await page.reload();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#lang-flag')).toHaveAttribute('title', 'Jordan');
  expect(a.errors).toEqual([]);
});

test('a chosen language wins over the country', async ({ browser }) => {
  const asked = { n: 0 };
  const a = await openDevice(browser, 'Chosen EN', { storage: { 'omnibeam-lang': 'en' }, setup: visitor('FR', asked, false) });
  devices.push(a);
  await expect(a.page.locator('#lang-flag img')).toHaveAttribute('src', '/flags/fr.svg');
  await expect(a.page).toHaveURL(/:\d+\/$/);
  await expect(a.page.locator('html')).toHaveAttribute('lang', 'en');
  expect(a.errors).toEqual([]);
});

test('a browser set to another language wins over the country', async ({ browser }) => {
  const asked = { n: 0 };
  const a = await openDevice(browser, 'German Browser', {
    storage: { 'omnibeam-lang': null },
    setup: async (context) => {
      await visitor('JP', asked)(context);
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['de-DE', 'en'] }));
    },
  });
  devices.push(a);
  await expect(a.page).toHaveURL(/\/de\/$/);
  await expect(a.page.locator('#lang-flag')).toHaveAttribute('title', 'Japan');
  expect(a.errors).toEqual([]);
});

test('a country without its own language stays English, with its flag', async ({ browser }) => {
  const asked = { n: 0 };
  const a = await openDevice(browser, 'US Visitor', { storage: { 'omnibeam-lang': null }, setup: visitor('US', asked) });
  devices.push(a);
  await expect(a.page.locator('#lang-flag img')).toHaveAttribute('src', '/flags/us.svg');
  await expect(a.page).toHaveURL(/:\d+\/$/);
  await expect(a.page.locator('html')).toHaveAttribute('lang', 'en');
  expect(a.errors).toEqual([]);
});

test('test tools and search engines are not moved and do not ask', async ({ browser }) => {
  const asked = { n: 0 };
  const a = await openDevice(browser, 'Robot', {
    storage: { 'omnibeam-lang': null },
    setup: (context) => context.route('**/cdn-cgi/trace', (route) => { asked.n++; route.fulfill({ body: 'loc=JO\n' }); }),
  });
  devices.push(a);
  await a.page.waitForTimeout(1000);
  await expect(a.page).toHaveURL(/:\d+\/$/);
  await expect(a.page.locator('#lang-flag')).toHaveCount(0);
  expect(asked.n).toBe(0);
});

test('every country the language list names has a flag', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../public/i18n.js'), 'utf8');
  const codes = [...src.matchAll(/\b[a-z]{2}: '([A-Z]{2}(?: [A-Z]{2})*)'/g)].flatMap((m) => m[1].split(' '));
  expect(codes.length).toBeGreaterThan(80);
  for (const cc of codes) expect(fs.existsSync(require('path').join(__dirname, '..', 'public', 'flags', cc.toLowerCase() + '.svg')), cc).toBe(true);
});
