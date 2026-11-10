// A phone's screen turns off in the middle of a transfer. iPhones pause the page then and its connections break;
// when the phone is back, the transfer must continue by itself within seconds, and both sides say why it stopped.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

// The page is told the screen turned off / on, the way Safari tells it
async function setHidden(page, hidden) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('a transfer to a phone continues by itself after its screen was off', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { relayOnly: true });
  b = await openDevice(browser, 'Test Phone', { relayOnly: true });
  await b.page.evaluate(() => { isPhone = true; });
  // On a fast computer the relay can finish before the screen turns off: hold each chunk a little
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(20); return wait.call(this); };
  });
  const file = makeFile('clip.mov', 40 * 1024 * 1024 + 77, 'video/quicktime');
  const target = await card(a.page, b.name);
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([file]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect.poll(() => b.page.evaluate(() => [...peers.values()][0]?.prog?.done || 0), { timeout: 60000 }).toBeGreaterThan(4 * 1024 * 1024);
  // The phone shows the "keep the screen on" line on its card while receiving
  await expect(b.page.locator('.peer .xfer-hint')).toBeVisible();
  // The screen turns off: the laptop is told why
  await setHidden(b.page, true);
  await expect(a.page.locator('#toast')).toContainText('The screen of Test Phone turned off');
  // The page is paused: its connection to the server goes silent but still looks open
  await b.page.evaluate(() => { ws.send = () => {}; ws.onmessage = null; hiddenAt = Date.now() - 10000; });
  // The screen is back on: the dead connection is noticed within seconds (not after half a minute) and the
  // transfer continues where it stopped
  const back = Date.now();
  await setHidden(b.page, false);
  await expect(b.page.locator('#toast')).toContainText(/screen turned off|Continuing the transfer from Test Laptop/, { timeout: 15000 });
  await expect(b.page.locator('#toast')).toContainText('Continuing the transfer from Test Laptop', { timeout: 20000 });
  expect(Date.now() - back).toBeLessThan(20000);
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 90000 });
  await expect(got.locator('.info .muted.intact')).toHaveCount(1);
  const download = b.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('the server answers the wake-up check', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  const ok = await a.page.evaluate(() => new Promise((done) => {
    const at = Date.now();
    wsSend({ type: 'ping' });
    setTimeout(() => done(ws.pongAt >= at), 1500);
  }));
  expect(ok).toBe(true);
});

test('the keep-screen-on line is in every language', async () => {
  const keys = ['Keep OmniBeam open and the screen on until this finishes',
    'Your phone may turn the screen off: tap it now and then until this finishes',
    'The transfer paused because the screen turned off. It continues by itself in a moment (keep this page open).',
    'The screen of {name} turned off, which pauses the transfer. It continues by itself when {name} is back.'];
  for (const f of fs.readdirSync(`${__dirname}/../public/lang`)) {
    const lang = require(`../public/lang/${f}`);
    for (const k of keys) expect(lang.strings[k], `${f}: ${k}`).toBeTruthy();
    expect(lang.strings[keys[3]]).toContain('{name}');
  }
});
