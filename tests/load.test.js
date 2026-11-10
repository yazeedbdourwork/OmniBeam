// The home page loads quickly on phones: pages and scripts are sent with brotli where the browser takes it (gzip
// otherwise), versioned files are kept for a year, and the app's script (and the language's) is fetched early.
const { test, expect } = require('@playwright/test');

test('brotli for pages and scripts, gzip for browsers without it, early fetch of the scripts', async ({ request }) => {
  const home = await request.get('/', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
  expect(home.headers()['content-encoding']).toBe('br');
  expect(home.headers()['cache-control']).toBe('no-cache');
  const html = await home.text();
  const app = html.match(/<script src="(\/app\.js\?v=\d+)"/)[1];
  expect(html).toContain(`<link rel="preload" href="${app}" as="script">`);
  const js = await request.get(app, { headers: { 'Accept-Encoding': 'br' } });
  expect(js.headers()['content-encoding']).toBe('br');
  expect(js.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await js.text()).length).toBeGreaterThan(50000);
  const gz = await request.get(app, { headers: { 'Accept-Encoding': 'gzip' } });
  expect(gz.headers()['content-encoding']).toBe('gzip');
  // Another language: its translations are fetched early too
  const de = await (await request.get('/de/', { headers: { 'Accept-Encoding': 'br' } })).text();
  const lang = de.match(/<script src="(\/lang\/de\.js\?v=[^"]+)"/)[1];
  expect(de).toContain(`<link rel="preload" href="${lang}" as="script">`);
});
