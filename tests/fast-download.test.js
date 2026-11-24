// Share links download like a download manager (2026-11-24): links without a download limit are fetched a few 4 MB
// parts at once from /api/drop/<id>/p/<k>/<n> (answers Cloudflare may keep near the visitor), a part that stops
// moving is asked for again, a dropped connection pauses the download and "Resume download" carries on from the
// parts it has, and the bar shows the speed and the time left. Links with a download limit keep the one stream.
// The links here are made by the test itself (encrypted like drop.js does), from addresses of their own, so the
// other link tests keep their 20 links an hour.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { sha } = require('./helpers');

const PART = 4 * 1024 * 1024;
const ivFor = (n, meta = false) => {
  const v = Buffer.alloc(12);
  v[0] = meta ? 1 : 0;
  v.writeUInt32BE(n, 8);
  return v;
};
const seal = (key, iv, data) => {
  const c = crypto.createCipheriv('aes-128-gcm', key, iv);
  return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
};
// files: [{ name, type, data }] -> { id, token, url, all (the plain bytes, one file after the other) }
async function makeLink(request, ip, files, opts = {}) {
  const key = crypto.randomBytes(16);
  const all = Buffer.concat(files.map((f) => f.data));
  const meta = seal(key, ivFor(0, true), Buffer.from(JSON.stringify({ files: files.map((f) => ({ name: f.name, type: f.type, size: f.data.length })) }))).toString('base64url');
  const headers = { 'X-Forwarded-For': ip };
  const c = await (await request.post('/api/drop', { headers, data: { size: all.length, hours: 1, meta, ...opts } })).json();
  expect(c.part).toBe(PART);
  const parts = Math.max(1, Math.ceil(all.length / PART));
  for (let n = 0; n < parts; n++) {
    const r = await request.put(`/api/drop/${c.id}/${n}`, { headers: { ...headers, 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: seal(key, ivFor(n), all.subarray(n * PART, (n + 1) * PART)) });
    expect(r.ok()).toBe(true);
  }
  return { ...c, all, url: `/d/${c.id}#${key.toString('base64url')}` };
}
const owner = async (request, link) => (await request.get(`/api/drop/${link.id}`, { headers: { 'X-Drop-Token': link.token } })).json();

test('server: parts by number with a key, kept by Cloudflare, counted once when the page has them all', async ({ request }) => {
  const free = await makeLink(request, '203.0.113.91', [{ name: 'a.bin', type: '', data: crypto.randomBytes(PART + 5000) }]);
  const info = await (await request.get(`/api/drop/${free.id}`)).json();
  expect(info.k).toMatch(/^[A-Za-z0-9_-]{22}$/);
  // The same key on the next visit (so Cloudflare's copies serve everyone)
  expect((await (await request.get(`/api/drop/${free.id}`)).json()).k).toBe(info.k);
  const p0 = await request.get(`/api/drop/${free.id}/p/${info.k}/0`);
  expect(p0.status()).toBe(200);
  expect(p0.headers()['cloudflare-cdn-cache-control']).toMatch(/^max-age=\d+$/);
  expect(p0.headers()['cache-control']).toBe('no-store');
  const p1 = await (await request.get(`/api/drop/${free.id}/p/${info.k}/1`)).body();
  const whole = await (await request.get(`/api/drop/${free.id}/data`, { headers: { Range: 'bytes=0-99999999' } })).body();
  expect(sha(Buffer.concat([await p0.body(), p1]))).toBe(sha(whole));
  expect(p1.length).toBe(5000 + 16);
  // A wrong key, a part that doesn't exist: nothing
  expect((await request.get(`/api/drop/${free.id}/p/${'A'.repeat(22)}/0`)).status()).toBe(404);
  expect((await request.get(`/api/drop/${free.id}/p/${info.k}/2`)).status()).toBe(404);
  // Parts aren't downloads; "done" is, once per network in a while, and only with the key
  expect((await owner(request, free)).downloads).toBe(0);
  expect((await request.post(`/api/drop/${free.id}/done`, { headers: { 'X-Drop-Key': 'B'.repeat(22) } })).status()).toBe(404);
  expect((await request.post(`/api/drop/${free.id}/done`, { headers: { 'X-Drop-Key': info.k, 'X-Forwarded-For': '203.0.113.92' } })).ok()).toBe(true);
  expect((await request.post(`/api/drop/${free.id}/done`, { headers: { 'X-Drop-Key': info.k, 'X-Forwarded-For': '203.0.113.92' } })).ok()).toBe(true);
  expect((await owner(request, free)).downloads).toBe(1);
  // A link with a download limit has no key: it is downloaded in one go and counted by the server
  const limited = await makeLink(request, '203.0.113.91', [{ name: 'b.bin', type: '', data: crypto.randomBytes(100) }], { max: 3 });
  const li = await (await request.get(`/api/drop/${limited.id}`)).json();
  expect(li.k).toBeUndefined();
  expect((await request.get(`/api/drop/${limited.id}/p/${info.k}/0`)).status()).toBe(404);
  // Deleted: the parts are gone too
  await request.delete(`/api/drop/${free.id}`, { headers: { 'X-Drop-Token': free.token } });
  expect((await request.get(`/api/drop/${free.id}/p/${info.k}/0`)).status()).toBe(404);
});

test('the page downloads several parts at once, shows the speed, and the ZIP is right', async ({ browser, request }) => {
  const a = { name: 'holiday.mp4', type: 'video/mp4', data: crypto.randomBytes(5 * PART + 777) };
  const b = { name: 'notes.txt', type: 'text/plain', data: crypto.randomBytes(2 * PART + 4321) };
  const link = await makeLink(request, '203.0.113.93', [a, b]);
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__dl = { now: 0, max: 0, parts: [] };
    window.__said = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('drop-status');
      new MutationObserver(() => window.__said.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const f = window.fetch;
    window.fetch = function (u, ...rest) {
      const m = /\/p\/[^/]+\/(\d+)$/.exec(String(u));
      if (!m) return f.call(this, u, ...rest);
      window.__dl.parts.push(Number(m[1]));
      window.__dl.now++;
      window.__dl.max = Math.max(window.__dl.max, window.__dl.now);
      // A little slower than this computer, so several are on the way at the same time and the speed shows
      return new Promise((ok) => setTimeout(ok, 600)).then(() => f.call(this, u, ...rest)).finally(() => { window.__dl.now--; });
    };
  });
  await page.goto(link.url);
  await expect(page.locator('#drop-files')).toContainText('holiday.mp4');
  await page.locator('#drop-get').click();
  await expect(page.locator('#drop-zip')).toBeVisible({ timeout: 60000 });
  // The speed and the time left while it ran
  expect((await page.evaluate(() => window.__said)).some((s) => /\d% · [\d.]+ [KMG]?B\/s · .+ left$/.test(s))).toBe(true);
  const dl = await page.evaluate(() => window.__dl);
  expect(dl.max).toBeGreaterThan(2);
  expect(dl.parts.sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  const zipped = page.waitForEvent('download');
  await page.locator('#drop-zip').click();
  const zip = fs.readFileSync(await (await zipped).path());
  // Each file's bytes and CRC in the ZIP (worked out part by part, in order, while the parts came in any order)
  let at = 0;
  for (const f of [a, b]) {
    expect(zip.readUInt32LE(at)).toBe(0x04034b50);
    const crc = zip.readUInt32LE(at + 14);
    const size = zip.readUInt32LE(at + 18);
    const start = at + 30 + zip.readUInt16LE(at + 26);
    expect(size).toBe(f.data.length);
    expect(sha(zip.subarray(start, start + size))).toBe(sha(f.data));
    if (zlib.crc32) expect(crc).toBe(zlib.crc32(f.data));
    at = start + size;
  }
  await expect.poll(async () => (await owner(request, link)).downloads).toBe(1);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('a stuck part is asked for again, and a lost connection resumes from the parts it has', async ({ browser, request }) => {
  const file = { name: 'film.mov', type: 'video/quicktime', data: crypto.randomBytes(4 * PART + 99) };
  const link = await makeLink(request, '203.0.113.94', [file]);
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.omnibeamStallMs = 1500; window.omnibeamRetryMs = 300; });
  const asked = [];
  let hung = false;
  let down = false;
  await page.route(/\/api\/drop\/[^/]+\/p\/[^/]+\/\d+$/, async (route) => {
    const n = Number(route.request().url().split('/').pop());
    asked.push(n);
    if (n === 1 && !hung) { hung = true; return; } // never answered: the page gives up on it after 1.5 s
    if (down && n >= 3) return route.abort('internetdisconnected');
    return route.continue();
  });
  await page.goto(link.url);
  await expect(page.locator('#drop-files')).toContainText('film.mov');
  // Parts 3 and 4 can't come: after its tries the download pauses
  down = true;
  await page.locator('#drop-get').click();
  await expect(page.locator('#drop-get')).toHaveText('Resume download', { timeout: 30000 });
  await expect(page.locator('#drop-status')).toContainText('paused');
  const before = asked.length;
  expect(asked.filter((n) => n === 1).length).toBe(2); // the stuck one, then again
  // Back: only the missing parts are fetched
  down = false;
  const saved = page.waitForEvent('download');
  await page.locator('#drop-get').click();
  const d = await saved;
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(file.data));
  expect(asked.slice(before).sort()).toEqual([3, 4]);
  await ctx.close();
});

test('a link with a download limit still downloads in one go', async ({ browser, request }) => {
  const file = { name: 'once.pdf', type: 'application/pdf', data: crypto.randomBytes(PART + 10) };
  const link = await makeLink(request, '203.0.113.95', [file], { max: 2 });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const parts = [];
  page.on('request', (r) => { if (/\/p\//.test(r.url())) parts.push(r.url()); });
  await page.goto(link.url);
  const saved = page.waitForEvent('download');
  await page.locator('#drop-get').click();
  expect(sha(fs.readFileSync(await (await saved).path()))).toBe(sha(file.data));
  expect(parts).toEqual([]);
  await expect.poll(async () => (await owner(request, link)).downloads).toBe(1);
  await ctx.close();
});
