// How to Use: each feature has its own short video in the page's language (English voice, translated captions),
// under that feature's title. A picture until pressed (no video bytes before), then it plays in place. The AMP copy
// keeps only the picture as a link (no <video>, no script).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const LANGS = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh'];
const FEATURES = ['getting-started', 'send-files', 'chat', 'more-menu', 'ring-device', 'share-link', 'request-files', 'event-album',
  'tv-mode', 'phone-webcam', 'share-folder', 'rooms', 'settings', 'languages'];

test('every How to Use page has the 14 feature videos in its own language, and the files exist', () => {
  for (const code of LANGS) {
    const p = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    const hrefs = [...p.matchAll(/<a class="howto-video" href="\/media\/f-([a-z-]+)-([a-z]+)\.mp4\?v=1">/g)];
    expect(hrefs.map((m) => m[1]).sort(), code).toEqual([...FEATURES].sort());
    for (const m of hrefs) {
      expect(m[2], code).toBe(code);
      for (const ext of ['mp4', 'webp']) expect(fs.existsSync(path.join(__dirname, '..', 'public', 'media', `f-${m[1]}-${code}.${ext}`)), `${m[1]} ${code} ${ext}`).toBe(true);
    }
    expect(p, code).toContain('<script src="/howto-video.js?v=1" defer></script>');
  }
});

test('a feature video is a picture until pressed, then plays in place; the AMP copy has no video', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mp4 = [];
  page.on('request', (r) => { if (/\.mp4/.test(r.url())) mp4.push(r.url()); });
  await page.goto('/fr/how-to-use');
  const album = page.locator('#event-album');
  await album.locator('summary').click();
  const link = album.locator('a.howto-video');
  await expect(link).toHaveAttribute('href', '/media/f-event-album-fr.mp4?v=1');
  await expect(link.locator('img')).toBeVisible();
  expect(mp4).toEqual([]);
  await link.click();
  const video = album.locator('.howto-video video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('src', /\/media\/f-event-album-fr\.mp4\?v=1$/);
  await expect.poll(() => mp4.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const amp = await (await page.request.get('/amp/fr/how-to-use')).text();
  expect(amp).toContain('f-event-album-fr.webp');
  expect(amp).not.toContain('<video');
  expect(amp).not.toContain('howto-video.js');
});
