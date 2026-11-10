// The site's pages: the home page and guides in all nine languages load without errors
const { test, expect } = require('@playwright/test');

const LANGS = ['', 'ar/', 'fr/', 'es/', 'tr/', 'de/', 'pt/', 'hi/', 'id/', 'ru/', 'ja/', 'zh/', 'ko/', 'it/', 'ur/'];

for (const l of LANGS) {
  test(`home page /${l} loads without errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
    await page.addInitScript((lang) => localStorage.setItem('omnibeam-lang', lang || 'en'), l.slice(0, 2));
    const res = await page.goto('/' + l);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.locator('#me-name')).not.toHaveText('');
    if (l === 'ar/') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(errors).toEqual([]);
  });

  test(`guides /${l}guides load`, async ({ page }) => {
    const res = await page.goto(`/${l}guides`);
    expect(res.status()).toBe(200);
    const links = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(links.length).toBeGreaterThan(3);
    for (const href of links.filter((h) => h.startsWith('/')).slice(0, 12)) {
      const r = await page.request.get(href);
      expect(r.status(), href).toBe(200);
    }
  });
  test(`comparison pages /${l}compare load and link to all four`, async ({ page }) => {
    const res = await page.goto(`/${l}compare`);
    expect(res.status()).toBe(200);
    const links = await page.locator('main a[href*="omnibeam-vs-"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    expect(links.sort()).toEqual(['airdrop', 'localsend', 'pairdrop', 'snapdrop'].map((n) => `/${l}omnibeam-vs-${n}`));
    await page.goto(links[0]);
    await expect(page.locator('table.compare tbody tr').first()).toBeVisible();
    if (l) await expect(page.locator('html')).toHaveAttribute('lang', l.slice(0, 2));
  });
}


// The "how to" guides added 2026-10-30, in every language, listed on the guides page and in the sitemap
const NEW_GUIDES = ['send-large-video-without-whatsapp', 'send-files-android-to-mac', 'transfer-files-between-computers', 'airdrop-not-working'];
test('the new how-to guides exist in all nine languages', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const l of LANGS) {
    const hub = await (await request.get(`/${l}guides`)).text();
    for (const slug of NEW_GUIDES) {
      const r = await request.get(`/${l}${slug}`);
      expect(r.status(), `/${l}${slug}`).toBe(200);
      expect(await r.text()).toMatch(/<h1>[^<]{10,}<\/h1>/);
      expect(hub, `/${l}guides lists ${slug}`).toContain(`/${l}${slug}"`);
      expect(sitemap).toContain(`/${l}${slug}<`);
    }
  }
});

// The landing pages for top searches added 2026-11-02: in every language, with a Q&A section and enough text
const LANDING = ['send-files-iphone-to-android', 'quick-share-alternative', 'wetransfer-alternative', 'share-files-mac-and-windows', 'shareit-alternative'];
test('the landing pages for top searches exist in all nine languages', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const l of LANGS) {
    const hub = await (await request.get(`/${l}guides`)).text();
    for (const slug of LANDING) {
      const r = await page.goto(`/${l}${slug}`);
      expect(r.status(), `/${l}${slug}`).toBe(200);
      const info = await page.evaluate(() => ({
        title: document.title, h1: document.querySelector('h1').textContent,
        qa: document.querySelectorAll('section.qa h3').length,
        words: (document.querySelector('main') || document.body).innerText.split(/\s+/).filter(Boolean).length,
        chars: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, '').length,
      }));
      expect(info.h1, `/${l}${slug}`).not.toBe(info.title);
      expect(info.qa, `/${l}${slug} Q&A`).toBeGreaterThanOrEqual(5);
      // Chinese, Japanese and Korean pack more into each word (or have no spaces): count characters there
      if (['ja/', 'zh/', 'ko/'].includes(l)) expect(info.chars, `/${l}${slug} characters`).toBeGreaterThan(1000);
      else expect(info.words, `/${l}${slug} words`).toBeGreaterThan(500);
      expect(hub, `/${l}guides lists ${slug}`).toContain(`/${l}${slug}"`);
      expect(sitemap).toContain(`/${l}${slug}<`);
    }
  }
});

test('sitemap and robots.txt are served', async ({ request }) => {
  expect((await request.get('/sitemap.xml')).status()).toBe(200);
  expect((await request.get('/robots.txt')).status()).toBe(200);
});
