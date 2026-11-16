// Heartbeat during direct transfers: when the direct link goes silent without closing (a Wi-Fi that hangs, a
// router that drops the route), the transfer notices within seconds, moves to the server and finishes there from
// where it got to. Without the heartbeat these transfers hang until the browser's own check gives up.
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha } = require('./helpers');
const fs = require('fs');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

// Short times for the test (the app uses 5 s and 15 s)
const storage = { 'omnibeam-hb-every': '500', 'omnibeam-hb-stall': '2500' };

// From now on, everything this page sends over its direct data channels is silently lost
async function blackHoleAfter(page, bytes) {
  await page.evaluate((bytes) => {
    const real = RTCDataChannel.prototype.send;
    let sent = 0;
    RTCDataChannel.prototype.send = function (data) {
      sent += typeof data === 'string' ? data.length : data.byteLength;
      if (sent > bytes) { window.blackHoled = true; return; }
      return real.call(this, data);
    };
  }, bytes);
}

async function run(silent) {
  a = await openDevice(browser_, 'Test Laptop', { storage });
  b = await openDevice(browser_, 'Test Phone', { storage });
  const logs = [];
  for (const d of [a, b]) d.page.on('console', (m) => logs.push(`${d.name}: ${m.text()}`));
  const file = makeFile('big.bin', 24 * 1024 * 1024 + 77);
  // Slow the sender down a little so the link can be cut in the middle
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(5); return wait.call(this); };
  });
  const target = await card(a.page, b.name);
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([file]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  // Wait until it really goes direct and some of it arrived, then cut one direction
  await expect.poll(() => b.page.evaluate(() => [...peers.values()].some((p) => p.direct && p.prog && p.prog.done > 2 * 1024 * 1024)), { timeout: 20000 }).toBe(true);
  await blackHoleAfter(silent.page, 0);
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  const download = b.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const buf = fs.readFileSync(await (await download).path());
  expect(sha(buf)).toBe(sha(file.buffer));
  expect(await silent.page.evaluate(() => window.blackHoled)).toBe(true);
  // The heartbeat noticed it (not the browser's own, much slower check), and the sender finished too
  await expect.poll(() => logs.some((l) => /Nothing from .* continuing via server/.test(l)), { timeout: 15000 }).toBe(true);
  await expect.poll(() => a.page.evaluate(() => [...peers.values()].every((p) => !p.busy)), { timeout: 15000 }).toBe(true);
  expect(await a.page.evaluate(() => Sent.items[0]?.result)).toBe('ok');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
}

let browser_;
test.beforeEach(async ({ browser }) => { browser_ = browser; });

test('the receiver notices a silent sender and the transfer finishes via the server', async () => {
  await run({ get page() { return a.page; } });
});

test('the sender notices a silent receiver and the transfer finishes via the server', async () => {
  await run({ get page() { return b.page; } });
});

test('an older device that sends no heartbeat is never cut off', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { storage });
  b = await openDevice(browser, 'Test Phone', { storage });
  // The receiver acts like an older version: no heartbeats, and it stays quiet for longer than the stall time
  await b.page.evaluate(() => { Peer.prototype.sendHeartbeat = function () { this.hbSentAt = Date.now(); }; });
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(2); return wait.call(this); };
  });
  const file = makeFile('mid.bin', 12 * 1024 * 1024);
  const target = await card(a.page, b.name);
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([file]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
  expect(await a.page.evaluate(() => [...peers.values()].every((p) => !p.useRelay))).toBe(true);
});
