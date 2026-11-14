// How to Use, tidied up (2026-11-14): the page has a quick start, topic buttons and each feature as a title that
// opens (<details>), in all 15 languages; the in-app window has a search box and the tips in topics that open.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

const LANGS = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh'];
const TOPICS = ['start', 'send', 'share', 'history', 'together', 'settings', 'apps', 'help'];

test('the How to Use page has the same topics and features in every language', () => {
  let ids = null;
  for (const code of LANGS) {
    const p = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    expect(p, code).toContain('class="howto-quick"');
    const topics = [...p.matchAll(/<section class="howto-topic" id="([a-z]+)">/g)].map((m) => m[1]);
    expect(topics, code).toEqual(TOPICS);
    for (const t of TOPICS) expect(p, `${code} ${t}`).toContain(`<a href="#${t}">`);
    const features = [...p.matchAll(/<details id="([a-z-]+)">\s*<summary>([^<]+)<\/summary>/g)];
    expect(features.length, code).toBeGreaterThan(55);
    if (!ids) ids = features.map((m) => m[1]);
    expect(features.map((m) => m[1]), code).toEqual(ids);
    // No numbers left over from the old numbered list, and Troubleshooting stays last
    expect(p, code).not.toMatch(/<h2>\d+\. /);
    expect(p.lastIndexOf('id="help"'), code).toBeGreaterThan(p.lastIndexOf('id="apps"'));
  }
});

test('How to Use page: topic buttons jump to a topic and a title opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-to-use');
  await page.locator('.howto-toc a[href="#share"]').click();
  await expect(page).toHaveURL(/#share$/);
  const album = page.locator('#event-album');
  await expect(album).not.toHaveAttribute('open', '');
  await album.locator('summary').click();
  await expect(album).toHaveAttribute('open', '');
  await expect(album).toContainText('QR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The AMP copy has the same layout
  const amp = await (await page.request.get('/amp/how-to-use')).text();
  expect(amp).toContain('<details id="event-album">');
});

test('How to Use window: topics, search and the full guide link, translated', async ({ browser, request }) => {
  const a = await openDevice(browser, 'Test Laptop');
  try {
    await a.page.locator('#btn-menu').click();
    await a.page.locator('#menu [data-open=dlg-how]').click();
    const how = a.page.locator('#dlg-how');
    await expect(how).toBeVisible();
    await expect(how.locator('.how-group')).toHaveCount(8);
    await expect(how.locator('.how-group[open]')).toHaveCount(0);
    // The search box doesn't take the focus (no keyboard popping up on phones)
    expect(await a.page.evaluate(() => document.activeElement.classList.contains('how-search'))).toBe(false);
    await how.locator('.how-search').fill('pdf');
    await expect(how.locator('li:visible')).toHaveCount(2);
    await expect(how.locator('li:visible').first()).toContainText('Scan to PDF');
    await expect(how.locator('.how-group:visible')).toHaveCount(2);
    await how.locator('.how-search').fill('qqqzzz');
    await expect(how.locator('.how-none')).toBeVisible();
    await how.locator('.how-search').fill('');
    await expect(how.locator('.how-group:visible')).toHaveCount(8);
    await expect(how.locator('.how-group[open]')).toHaveCount(0);
    await expect(how.locator('.how-full a')).toHaveAttribute('href', '/how-to-use');
    expect(a.errors).toEqual([]);
  } finally { await a.close(); }
  const ar = await (await request.get('/info-dialogs?lang=ar&v=7')).text();
  expect(ar).toContain('ابحث في الدليل');
  expect(ar).toContain('href="/ar/how-to-use"');
  expect(ar).not.toContain('>Get started<');
});
