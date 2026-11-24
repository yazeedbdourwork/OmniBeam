// Share links upload their 4 MB parts a few at a time (much faster through Cloudflare than one by one): the server
// takes parts in any order, writes each at its place, and the file downloads byte for byte.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, makeFile, sha, menu } = require('./helpers');

const PART = 4 * 1024 * 1024;
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

test('server: parts in any order and at the same time, retries are fine', async ({ request }) => {
  const size = 2 * PART + 1000;
  const c = await (await request.post('/api/drop', { data: { size, hours: 1, meta: 'A'.repeat(40) } })).json();
  expect(c.part).toBe(PART);
  const parts = [Buffer.alloc(PART + 16, 1), Buffer.alloc(PART + 16, 2), Buffer.alloc(1000 + 16, 3)];
  const put = (n, body = parts[n]) => request.put(`/api/drop/${c.id}/${n}`, { headers: { 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: body });
  // Not ready while parts are missing
  expect((await put(2)).status()).toBe(200);
  expect((await request.get(`/api/drop/${c.id}`)).status()).toBe(404);
  // The same part again (a retry after a lost answer): OK, nothing changes
  const again = await (await put(2)).json();
  expect(again.got).toBe(1);
  // Wrong size, or a part that doesn't exist: refused
  expect((await put(1, Buffer.alloc(10))).status()).toBe(400);
  expect((await put(3, Buffer.alloc(16))).status()).toBe(400);
  // The other two at the same time
  const [r0, r1] = await Promise.all([put(1), put(0)]);
  expect(r0.ok() && r1.ok()).toBe(true);
  const info = await (await request.get(`/api/drop/${c.id}`)).json();
  expect(info.size).toBe(size);
  const data = await (await request.get(`/api/drop/${c.id}/data`)).body();
  expect(data.length).toBe(size + 3 * 16);
  expect(sha(data)).toBe(sha(Buffer.concat(parts)));
});

test('a link with several parts uploads them side by side and downloads the same file', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop');
  devices.push(a);
  // Count how many parts are uploading at once
  await a.page.evaluate(() => {
    window.__up = { now: 0, max: 0 };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__part = m === 'PUT' && /\/api\/drop\//.test(u); return open.call(this, m, u, ...rest); };
    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__part) {
        window.__up.now++;
        window.__up.max = Math.max(window.__up.max, window.__up.now);
        this.addEventListener('loadend', () => { window.__up.now--; });
      }
      return send.apply(this, args);
    };
  });
  await menu(a.page, 'btn-sendto');
  const dlg = a.page.locator('#dlg-link');
  await expect(dlg).toBeVisible();
  const file = makeFile('holiday.mp4', 5 * PART + 12345, 'video/mp4');
  const chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([file]);
  await expect(a.page.locator('#link-done')).toBeVisible({ timeout: 60000 });
  expect(await a.page.evaluate(() => window.__up.max)).toBeGreaterThan(1);
  const url = await a.page.locator('#link-url').textContent();

  const ctx = await browser.newContext({ acceptDownloads: true });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('#drop-files')).toContainText('holiday.mp4');
  const download = page.waitForEvent('download');
  await page.locator('#drop-get').click();
  const d = await download;
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(file.buffer));
  expect(a.errors).toEqual([]);
});
