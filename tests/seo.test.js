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
  // Images: modern format, not larger than shown (SEO image checks). The GitHub star count (shields.io) is
  // an SVG, so it passes as it is. The SaaSHub listing badge is the one
  // outside image we can't change: SaaSHub only serves it as a PNG and checks that exact badge is on the page.
  const OUTSIDE_BADGES = ['https://cdn-b.saashub.com/img/badges/approved-color.png?v=1'];
  expect(await page.evaluate((skip) => [...document.images].filter((i) => !skip.includes(i.src) && !/\.(webp|avif|svg)(\?|$)/.test(i.src)).map((i) => i.src), OUTSIDE_BADGES)).toEqual([]);
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

// What Seobility checks on the home page as sent (before scripts run): not too many headings for the text (dialog
// titles are <div role="heading">, the same to screen readers), no followed internal link with ?parameters, no
// anchor text used for two followed internal links, and no placeholder href="#" links
test('home page HTML: few headings, unique internal link texts, no ?parameter links', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect((html.match(/<h[1-6][\s>]/g) || []).length).toBeLessThanOrEqual(16);
  const links = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: (attrs.match(/\shref="([^"]*)"/) || [])[1],
    follow: !/\brel="[^"]*\bnofollow\b/.test(attrs),
    text: inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  })).filter((l) => l.href !== undefined && /^(\/(?!\/)|#|https:\/\/omnibeam\.site)/.test(l.href));
  expect(links.filter((l) => l.href === '#')).toEqual([]);
  expect(links.filter((l) => l.follow && l.href.includes('?'))).toEqual([]);
  const seen = new Map();
  const twice = links.filter((l) => l.follow && l.text && (seen.has(l.text) ? true : (seen.set(l.text, 1), false)));
  expect(twice).toEqual([]);
});

// What SEOptimer checks on the home page as sent: more than one heading level, no clear-text email address, and a
// width and height on every image (so nothing jumps while images load). Translated pages too.
test('home page HTML: H3s under H2s, no clear-text emails, images sized', async ({ request }) => {
  for (const path of ['/', '/ar/']) {
    const html = await (await request.get(path)).text();
    expect((html.match(/<h3[\s>]/g) || []).length, path).toBeGreaterThan(0);
    expect(html.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi), path).toBeNull();
    const unsized = (html.match(/<img\s[^>]*>/g) || []).filter((tag) => !/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag));
    expect(unsized, path).toEqual([]);
    // The intro poster offers a 720 px copy (shown at most 696 px wide), in this page's language
    const lang = path === '/' ? 'en' : 'ar';
    expect(html, path).toContain(`srcset="/media/intro-${lang}-720.webp?v=4 720w, /media/intro-${lang}.webp?v=4 1280w"`);
    expect((await request.get(`/media/intro-${lang}-720.webp?v=4`)).status(), path).toBe(200);
    // The FAQ and contact still reach search engines through the structured data
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const org = ld['@graph'].find((n) => n['@type'] === 'Organization' || (Array.isArray(n['@type']) && n['@type'].includes('Organization')));
    expect(org.email, path).toContain('@');
  }
});
