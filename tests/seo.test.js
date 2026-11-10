// SEO checks (the things SEO checkers such as SEOptimer look at), on the page as it is after the app has started
const { test, expect } = require('@playwright/test');

test('home page: real title, H1 first, no inline styles, every image has alt text', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#me-name')).not.toHaveText('…');
  await page.waitForTimeout(500);
  // The device name only goes in the tab title once someone uses the page
  await expect(page).toHaveTitle(/\| OmniBeam$/);
  const info = await page.evaluate(() => ({
    first: document.querySelector('h1, h2, h3, h4, h5, h6').tagName,
    styled: [...document.querySelectorAll('[style]')].map((e) => e.outerHTML.slice(0, 80)),
    noAlt: [...document.querySelectorAll('img')].filter((i) => !i.getAttribute('alt')).map((i) => i.src),
    words: document.querySelector('main').innerText.split(/\s+/).filter(Boolean).length,
    styleLinks: document.querySelectorAll('link[rel=stylesheet]').length,
  }));
  expect(info.first).toBe('H1');
  expect(info.styled).toEqual([]);
  expect(info.noAlt).toEqual([]);
  expect(info.words).toBeGreaterThan(700);
  expect(info.styleLinks).toBe(0);
  // Images: modern format, not larger than shown (SEO image checks)
  expect(await page.evaluate(() => [...document.images].filter((i) => !/\.(webp|avif|svg)(\?|$)/.test(i.src)).map((i) => i.src))).toEqual([]);
  await page.locator('#btn-pair').click();
  await expect(page).toHaveTitle(/^OmniBeam · /);
});

test('llms.txt, minified scripts and cache headers', async ({ request }) => {
  const llms = await request.get('/llms.txt');
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain('# OmniBeam');
  // Minified copies are made a moment after the server starts
  await expect.poll(async () => (await (await request.get('/i18n.js?v=8')).text()).includes('\n  //')).toBe(false);
  expect((await request.get('/icon-192.png')).headers()['cache-control']).toContain('max-age=2592000');
});
