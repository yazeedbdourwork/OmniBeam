// Transfers that check themselves and continue by themselves: the "file intact" badge, and a transfer that
// carries on when one device's connection drops in the middle (like a phone switching from Wi-Fi to mobile data)
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

async function pick(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}

test('received files show that they arrived intact', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  await pick(a, b, [makeFile('one.bin', 2 * 1024 * 1024 + 5), makeFile('two.txt', 3000, 'text/plain')]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible();
  await expect(got.locator('.info .muted.intact')).toHaveCount(2);
  await expect(got.locator('.info .muted').first()).toContainText('Intact');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a file that was changed on the way is flagged', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  // The sender reports a wrong checksum, as if a byte had changed on the way
  await a.page.evaluate(() => {
    const real = Peer.prototype.sendJson;
    Peer.prototype.sendJson = function (obj) { return real.call(this, obj.t === 'sum' ? { ...obj, crc: (obj.crc + 1) >>> 0 } : obj); };
  });
  await pick(a, b, [makeFile('bad.bin', 100 * 1024)]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got.locator('.info .muted.damaged')).toHaveCount(1);
  await expect(b.page.locator('#toast')).toContainText('did not arrive intact');
});

test('a transfer continues by itself after the connection drops', async ({ browser }) => {
  // Through the server (slower here than direct, so there's time to cut it off)
  a = await openDevice(browser, 'Test Laptop', { relayOnly: true });
  b = await openDevice(browser, 'Test Phone', { relayOnly: true });
  const file = makeFile('big.mov', 40 * 1024 * 1024 + 321, 'video/quicktime');
  // On one computer the relay can be fast enough to finish before the test cuts it: hold each chunk a little
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(20); return wait.call(this); };
  });
  await pick(a, b, [file]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  // Partway through, the phone's connection drops
  await expect.poll(() => b.page.evaluate(() => [...peers.values()][0]?.prog?.done || 0), { timeout: 60000 }).toBeGreaterThan(4 * 1024 * 1024);
  await b.page.evaluate(() => ws.close());
  // Both devices come back with new ids; the phone accepts the rest without asking
  await expect(b.page.locator('#toast')).toContainText('Continuing the transfer from Test Laptop', { timeout: 30000 });
  // …starting where it stopped, not from the beginning
  const startedAt = await b.page.evaluate(() => [...peers.values()][0]?.prog?.samples[0][1]);
  if (startedAt != null) expect(startedAt).toBeGreaterThan(4 * 1024 * 1024);
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 90000 });
  await expect(b.page.locator('#dlg-request')).toBeHidden();
  await expect(got.locator('.info .muted.intact')).toHaveCount(1);
  const download = b.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const d = await download;
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(file.buffer));
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
