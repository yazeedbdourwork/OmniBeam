// The chat says when the other device isn't really there (2026-11-25): a sleeping laptop, or a phone with OmniBeam
// in the background, still looks online to the server. The chat asks it (Presence in app.js) and shows
// "Not answering"; a phone that goes to the background says so itself. A file on its way shows as a bubble with
// what it is doing and Stop, so a send never looks like nothing happened.
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile } = require('./helpers');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const openChat = (d, name) => d.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), name);
const ask = (d, name) => d.page.evaluate((n) => Presence.ask([...peers.values()].find((p) => p.info.name === n), 3000), name);

test('a device whose page is frozen (asleep) shows "Not answering", and "Online now" again when it is back', async ({ browser }) => {
  test.setTimeout(90000);
  const a = await open(browser, 'Here A');
  const b = await open(browser, 'Sleepy B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await openChat(a, b.name);
  const state = a.page.locator('#dlg-chat .chat-state');
  await expect(state).toHaveText('Online now');
  // Its page stops running, but its connection stays open (like a laptop in sleep): nothing it gets is handled
  const sleep = (on) => b.page.evaluate((on) => {
    if (!ws.realOnMessage) { ws.realOnMessage = ws.onmessage; ws.onmessage = (e) => { if (!window.asleepForTest) ws.realOnMessage(e); }; }
    window.asleepForTest = on;
  }, on);
  await sleep(true);
  expect(await ask(a, b.name)).toBe(false);
  await expect(state).toHaveText('Not answering (asleep or in the background)');
  await expect(a.page.locator('#dlg-chat .chat-note')).toBeVisible();
  await expect(a.page.locator('#dlg-chat .chat-note')).toContainText('not answering');
  // A file sent now shows as a bubble that waits, with Stop
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.locator('#dlg-chat [data-act=attach]').click();
  await (await chooser).setFiles([makeFile('notes.bin', 200000)]);
  const xfer = a.page.locator('#dlg-chat .chat-xfer');
  await expect(xfer).toBeVisible();
  await expect(xfer).toContainText('notes.bin');
  await expect(xfer.locator('small')).toContainText('Waiting for Sleepy B');
  await xfer.locator('[data-xfer=stop]').click();
  await expect(xfer).toHaveCount(0);
  // Back on: it answers again
  await sleep(false);
  expect(await ask(a, b.name)).toBe(true);
  await expect(state).toHaveText('Online now');
  expect(a.errors).toEqual([]);
});

test('a phone that puts OmniBeam in the background says so: its chat shows "Not answering" at once', async ({ browser }) => {
  test.setTimeout(60000);
  const a = await open(browser, 'Desk A');
  const phone = await open(browser, 'Phone B', { userAgent: IPHONE });
  await card(a.page, phone.name);
  await card(phone.page, a.name);
  await openChat(a, phone.name);
  const state = a.page.locator('#dlg-chat .chat-state');
  await expect(state).toHaveText('Online now');
  await phone.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(state).toHaveText('Not answering (asleep or in the background)');
});

test('a file on its way shows its progress in the chat, and goes when done', async ({ browser }) => {
  test.setTimeout(90000);
  const a = await open(browser, 'Send A');
  const b = await open(browser, 'Take B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await openChat(a, b.name);
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.locator('#dlg-chat [data-act=attach]').click();
  await (await chooser).setFiles([makeFile('movie.bin', 30 * 1048576)]);
  const xfer = a.page.locator('#dlg-chat .chat-xfer');
  await expect(xfer).toBeVisible();
  await expect(xfer).toContainText('movie.bin');
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(xfer.locator('small')).toContainText('%', { timeout: 20000 });
  await expect(xfer).toHaveCount(0, { timeout: 60000 });
  await expect(a.page.locator('#dlg-chat .bubble.out.file.ok')).toContainText('movie.bin');
});

test('the new chat words are in all 15 languages', async () => {
  const keys = ['Not answering (asleep or in the background)', 'Waiting for {name}…',
    '{name} is not answering right now. What you send goes when it is back on screen (keep this page open).'];
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) {
      expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
      for (const part of k.match(/\{\w+\}/g) || []) expect(pack.strings[k]).toContain(part);
    }
  }
});
