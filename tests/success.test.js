// Transfer success counts for /stats (finished, failed, cancelled, by route and browser) and the
// "Worked well? Tell a friend" card under received files.
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile } = require('./helpers');

const today = async (request) => {
  const r = await request.get('/api/stats?days=1', { headers: { Authorization: 'Bearer test-stats-key' } });
  return (await r.json()).days[new Date().toISOString().slice(0, 10)] || {};
};
// The browser label /stats uses for the Chromium that runs the tests, e.g. 'Chrome · Linux' or 'Chrome · Windows'
const OS = { win32: 'Windows', darwin: 'macOS' }[process.platform] || 'Linux';
const prefixed = (day, prefix) => Object.keys(day).filter((k) => k.startsWith(prefix)).reduce((s, k) => s + day[k], 0);

async function startSend(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
  const ask = to.page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
}

test('a finished send counts for both browsers, and the card under received files shows from the second time', async ({ browser, request }) => {
  const before = await today(request);
  const a = await openDevice(browser, 'Success A');
  const b = await openDevice(browser, 'Success B', { storage: { 'omnibeam-loop': JSON.stringify({ n: 1 }) } });
  await startSend(a, b, [makeFile('one.bin', 200 * 1024)]);
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  const loop = got.locator('.loop');
  await expect(loop).toBeVisible();
  await expect(loop.locator('[data-act=tell]')).toBeVisible();
  // Chromium on Windows: the Windows app; elsewhere: the Chrome extension
  await expect(loop.locator('[data-app=chrome]')).toBeVisible({ visible: OS !== 'Windows' });
  await expect(loop.locator('[data-app=windows]')).toBeVisible({ visible: OS === 'Windows' });
  await expect(loop.locator('[data-act=install]')).toBeHidden();
  await expect(loop.locator('[data-app=rate]')).toBeHidden(); // no store page to rate on in a plain browser
  await loop.locator('[data-act=loop-no]').click();
  await expect(loop).toBeHidden();
  const st = JSON.parse(await b.page.evaluate(() => localStorage.getItem('omnibeam-loop')));
  expect(st).toMatchObject({ n: 2, no: 1 });

  await expect.poll(async () => prefixed(await today(request), 'bo_')).toBeGreaterThanOrEqual(prefixed(before, 'bo_') + 1);
  const day = await today(request);
  expect(day.transfers).toBe((before.transfers || 0) + 1);
  expect(Object.keys(day).some((k) => k === `bo_Chrome · ${OS}`)).toBe(true);

  // The next files from the same device don't show the card again for 14 days
  await got.locator('[data-act=close]').click();
  await startSend(a, b, [makeFile('two.bin', 1024)]);
  await expect(got).toBeVisible({ timeout: 60000 });
  await expect(loop).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
  await a.close();
  await b.close();
});

// The card's "Rate OmniBeam": the Chrome Web Store reviews with the Chrome extension, the Microsoft Store in the
// Windows app
test('Rate OmniBeam shows with the Chrome extension and in the Windows app', async ({ browser }) => {
  const loopSeen = { 'omnibeam-loop': JSON.stringify({ n: 1 }) };
  const a = await openDevice(browser, 'Rate A');
  const b = await openDevice(browser, 'Rate B', { storage: loopSeen });
  // What the extension's helper script (tools/omnibeam-chrome/bridge.js) says when it runs on the page
  await b.page.evaluate(() => window.postMessage({ omnibeamExt: 'hello' }, location.origin));
  await startSend(a, b, [makeFile('one.bin', 1024)]);
  const loop = b.page.locator('#dlg-received .loop');
  await expect(loop).toBeVisible({ timeout: 60000 });
  const rate = loop.locator('[data-app=rate]');
  await expect(rate).toBeVisible();
  await expect(rate).toHaveText('Rate OmniBeam');
  await expect(rate).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki/reviews');
  await expect(loop.locator('[data-app=chrome]')).toBeHidden(); // already has the extension
  await b.close();

  // The installed Windows app: a Windows browser in its own window
  const w = await openDevice(browser, 'Rate W', { storage: loopSeen });
  await w.context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0' });
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
  });
  await w.page.reload();
  await startSend(a, w, [makeFile('two.bin', 1024)]);
  const wloop = w.page.locator('#dlg-received .loop');
  await expect(wloop).toBeVisible({ timeout: 60000 });
  await expect(wloop.locator('[data-app=rate]')).toBeVisible();
  await expect(wloop.locator('[data-app=rate]')).toHaveAttribute('href', 'https://apps.microsoft.com/detail/9PLR2PMX3SQZ');
  await expect(wloop.locator('[data-app=windows]')).toBeHidden();
  // Translated in every language
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'pt', 'tr', 'ru', 'ja', 'zh', 'ko', 'it', 'ur']) {
    expect(require(`../public/lang/${code}.js`).strings['Rate OmniBeam'], code).toBeTruthy();
  }
  expect(a.errors.concat(w.errors)).toEqual([]);
  await a.close();
  await w.close();
});

test('a cancelled send counts as cancelled, a send whose receiver goes away as failed', async ({ browser, request }) => {
  const before = await today(request);
  const a = await openDevice(browser, 'Fail A', { relayOnly: true });
  const b = await openDevice(browser, 'Fail B', { relayOnly: true });
  // On one computer the relay can finish before the test presses Stop: hold each chunk a little
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(20); return wait.call(this); };
  });
  await startSend(a, b, [makeFile('big.bin', 45 * 1024 * 1024)]);
  const bar = (await card(a.page, b.name)).locator('.xfer-cancel');
  await expect(bar).toBeVisible({ timeout: 30000 });
  await bar.click();
  await expect.poll(async () => (await today(request)).tcancel || 0).toBe((before.tcancel || 0) + 1);

  await startSend(a, b, [makeFile('big2.bin', 45 * 1024 * 1024)]);
  await expect((await card(a.page, b.name)).locator('.xfer-cancel')).toBeVisible({ timeout: 30000 });
  await b.close();
  await expect.poll(async () => (await today(request)).tfail || 0).toBe((before.tfail || 0) + 1);
  const day = await today(request);
  expect(day.tw_lost).toBe((before.tw_lost || 0) + 1);
  expect(day.tf_relay).toBe((before.tf_relay || 0) + 1);
  expect(prefixed(day, 'bf_')).toBeGreaterThan(prefixed(before, 'bf_'));
  expect(day.tcancel).toBe((before.tcancel || 0) + 1); // the drop wasn't also counted as a cancel
  await a.close();
});

test('the stats page shows whether transfers finished', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('omnibeam-stats-key', 'test-stats-key'));
  await page.goto('/stats');
  await expect(page.locator('#success-tiles .tile').first()).toContainText('Finished');
  await expect(page.locator('#success-routes')).toContainText('OmniBeam server relay');
  await expect(page.locator('#success-browsers')).toContainText(`Chrome · ${OS}`);
});
