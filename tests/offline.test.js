// The offline app (service-worker.js, served as /sw.js): the app's files are kept on the device, OmniBeam opens without internet,
// and a deploy always replaces what was saved.
const { test, expect } = require('@playwright/test');

async function controlled(page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => {
    await page.reload();
    return page.evaluate(() => !!navigator.serviceWorker.controller);
  }).toBe(true);
}

test('the service worker has this deploy\'s version and is never cached', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.headers()['cache-control']).toContain('no-store');
  const src = await res.text();
  expect(src).toMatch(/const VERSION = '[0-9a-f]{12}';/);
  expect(src).toContain("'/more.js?v=");
  expect(src).toContain("'/qrcode.js?v=");
  const home = await (await request.get('/')).text();
  expect(home).toMatch(/<meta name="omnibeam-build" content="[0-9a-f]{12}">/);
});

test('the app opens without internet, in its language, from the files saved on the device', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('omnibeam-tour', 'done'));
  await page.goto('/fr/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => {
    await page.reload();
    return page.evaluate(() => !!navigator.serviceWorker.controller);
  }).toBe(true);
  const saved = await page.evaluate(async () => {
    const keys = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) keys.push(new URL(r.url).pathname + new URL(r.url).search);
    return keys;
  });
  for (const f of ['/', '/fr/', '/more.js?v=', '/lang/fr.js?v=', '/app.js?v=']) {
    expect(saved.some((k) => k.startsWith(f)), f).toBe(true);
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#me-name')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('h1').first()).not.toHaveText("You're offline");
  // Files loaded on demand (the speed test, QR codes) also work offline
  expect(await page.evaluate(async () => (await fetch('/more.js?v=7')).ok)).toBe(true);
  await context.setOffline(false);
});

test('a new version of the site removes the files saved from the old one', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const old = await caches.open('omnibeam-0123456789ab');
    await old.put('/app.js?v=1', new Response('old'));
  });
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('omnibeam-0123456789ab');
  const names = await page.evaluate(() => caches.keys());
  expect(names.filter((n) => n.startsWith('omnibeam-'))).toHaveLength(1);
});

test('pages are always asked from the network first, so a deploy shows at once', async ({ page, context }) => {
  await controlled(page);
  // Put a fake old copy of the home page in the cache: the network one must still win
  await page.evaluate(async () => {
    const [name] = (await caches.keys()).filter((n) => n.startsWith('omnibeam-'));
    await (await caches.open(name)).put('/', new Response('<!doctype html><title>OLD COPY</title>', { headers: { 'Content-Type': 'text/html' } }));
  });
  await page.reload();
  await expect(page).not.toHaveTitle('OLD COPY');
  // ...and the good answer replaced the saved copy
  const savedTitle = await page.evaluate(async () => {
    const [name] = (await caches.keys()).filter((n) => n.startsWith('omnibeam-'));
    return (await (await (await caches.open(name)).match('/')).text()).match(/<title>(.*?)<\/title>/)[1];
  });
  expect(savedTitle).not.toBe('OLD COPY');
  // Offline, a guide that was read before is still there
  await page.goto('/how-to-use');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).not.toHaveText("You're offline");
  await context.setOffline(false);
});
