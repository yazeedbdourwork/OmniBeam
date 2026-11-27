// Phones went to sleep while sending (2026-11-27). The screen now stays on from the moment a send or receive starts
// (getting photos ready, shrinking and waiting for the other side to accept count too, not only moving bytes), a wake
// lock the phone refused or let go is asked for again by itself, the tiny keep-awake video is in the page (a video
// that isn't in the page doesn't keep an iPhone awake) and plays on iPhones as well as the wake lock, and the share
// link page, the request page and the event album keep the screen on while they download or upload.
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile } = require('./helpers');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

// A Wake Lock API that counts what the page asks for. refuse: how many requests fail first (like a phone in battery
// saver for a while)
const fakeWakeLock = (refuse = 0) => async (context) => {
  await context.addInitScript((refuse) => {
    window.locks = [];
    window.lockAsks = 0;
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({ request: async () => {
      window.lockAsks++;
      if (window.lockAsks <= refuse) throw new DOMException('Not allowed', 'NotAllowedError');
      const lock = new EventTarget();
      lock.released = false;
      lock.release = async () => { if (!lock.released) { lock.released = true; lock.dispatchEvent(new Event('release')); } };
      window.locks.push(lock);
      return lock;
    } }) });
  }, refuse);
};
const held = (page) => page.evaluate(() => window.locks.filter((l) => !l.released).length);

let devs = [];
test.afterEach(async () => {
  for (const d of devs) await d.close();
  devs = [];
});

test('the screen stays on from the moment a send starts, before any bytes move', async ({ browser }) => {
  const pc = await openDevice(browser, 'Test Laptop');
  const ph = await openDevice(browser, 'Test Phone', { setup: fakeWakeLock() });
  devs.push(pc, ph);
  await ph.page.evaluate(() => { isPhone = true; });
  const target = await card(ph.page, pc.name);
  const chooser = ph.page.waitForEvent('filechooser');
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('a.bin', 2 * 1024 * 1024)]);
  // Still waiting for the laptop to accept: nothing sent yet, and the screen is already kept on
  await expect(pc.page.locator('#dlg-request')).toBeVisible();
  await expect.poll(() => held(ph.page)).toBe(1);
  expect(await ph.page.evaluate(() => [...peers.values()].some((p) => p.prog))).toBe(false);
  await pc.page.locator('#dlg-request [data-act=accept]').click();
  await expect(pc.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => held(ph.page)).toBe(0);
  expect(ph.errors).toEqual([]);
});

test('a refused wake lock is asked for again by itself, without a tap', async ({ browser }) => {
  const ph = await openDevice(browser, 'Test Phone', { setup: fakeWakeLock(1) });
  devs.push(ph);
  await ph.page.evaluate(() => { isPhone = true; keepAwake('test', true); });
  await expect.poll(() => ph.page.evaluate(() => window.lockAsks)).toBe(1);
  await expect.poll(() => held(ph.page), { timeout: 12000 }).toBe(1);
  // Let go by the phone (battery saver): asked for again
  await ph.page.evaluate(() => window.locks[0].release());
  await expect.poll(() => held(ph.page), { timeout: 12000 }).toBe(1);
  await ph.page.evaluate(() => keepAwake('test', false));
  await expect.poll(() => held(ph.page)).toBe(0);
  expect(ph.errors).toEqual([]);
});

test('on an iPhone the keep-awake video is in the page and plays as well as the wake lock, only while needed', async ({ browser }) => {
  const ph = await openDevice(browser, 'Test iPhone', { userAgent: IPHONE, setup: fakeWakeLock() });
  devs.push(ph);
  await ph.page.mouse.click(5, 5); // a tap readies the video
  await ph.page.evaluate(() => keepAwake('test', true));
  await expect.poll(() => held(ph.page)).toBe(1);
  await expect.poll(() => ph.page.evaluate(() => KeepAwakeVideo.playing)).toBe(true);
  await expect.poll(() => ph.page.evaluate(() => KeepAwakeVideo.el.currentTime), { timeout: 5000 }).toBeGreaterThan(0);
  const box = await ph.page.evaluate(() => {
    const r = KeepAwakeVideo.el.getBoundingClientRect();
    return { inPage: KeepAwakeVideo.el.isConnected, w: r.width, h: r.height, hidden: KeepAwakeVideo.el.getAttribute('aria-hidden') };
  });
  expect(box).toEqual({ inPage: true, w: 1, h: 1, hidden: 'true' });
  await ph.page.evaluate(() => keepAwake('test', false));
  await expect.poll(() => ph.page.evaluate(() => KeepAwakeVideo.playing)).toBe(false);
  await expect.poll(() => held(ph.page)).toBe(0);
  expect(ph.errors).toEqual([]);
});

// A share link made the way drop.js makes one (see fast-download.test.js), from an address of its own
const PART = 4 * 1024 * 1024;
const ivFor = (n, meta = false) => { const v = Buffer.alloc(12); v[0] = meta ? 1 : 0; v.writeUInt32BE(n, 8); return v; };
const seal = (key, iv, data) => { const c = crypto.createCipheriv('aes-128-gcm', key, iv); return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); };
async function makeLink(request, ip, data) {
  const key = crypto.randomBytes(16);
  const meta = seal(key, ivFor(0, true), Buffer.from(JSON.stringify({ files: [{ name: 'a.bin', type: '', size: data.length }] }))).toString('base64url');
  const headers = { 'X-Forwarded-For': ip };
  const c = await (await request.post('/api/drop', { headers, data: { size: data.length, hours: 1, meta } })).json();
  for (let n = 0; n < Math.ceil(data.length / PART); n++) {
    const r = await request.put(`/api/drop/${c.id}/${n}`, { headers: { ...headers, 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: seal(key, ivFor(n), data.subarray(n * PART, (n + 1) * PART)) });
    expect(r.ok()).toBe(true);
  }
  return `/d/${c.id}#${key.toString('base64url')}`;
}

test('the share link page keeps an iPhone screen on while it downloads', async ({ browser, request }) => {
  const url = await makeLink(request, '203.0.113.141', crypto.randomBytes(PART * 2 + 999));
  const context = await browser.newContext({ userAgent: IPHONE, acceptDownloads: true });
  await fakeWakeLock()(context);
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  // Slow parts, so the download is still going when it's looked at
  await context.route(/\/api\/drop\/[^/]+\/p\//, async (route) => { await new Promise((r) => setTimeout(r, 1500)); route.continue(); });
  const page = await context.newPage();
  devs.push({ close: () => context.close() });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.locator('#drop-get').click();
  await expect.poll(() => held(page)).toBe(1);
  await expect.poll(() => page.evaluate(() => { const v = document.querySelector('body > video[aria-hidden]'); return !!v && !v.paused && v.currentTime > 0; }), { timeout: 8000 }).toBe(true);
  await expect(page.locator('#drop-status')).toContainText('Done', { timeout: 30000 });
  await expect.poll(() => held(page)).toBe(0);
  expect(await page.evaluate(() => document.querySelector('body > video[aria-hidden]').paused)).toBe(true);
  expect(errors).toEqual([]);
});
