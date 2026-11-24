// The Sent list (and the chat bubble) says "Cancelled" only when someone pressed Stop. When the other device
// stopped the transfer because of a problem (e.g. it could not save the file) it says "Not finished" (2026-11-25),
// with the reason under it in the chat.
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function startSend(a, b) {
  const target = await card(a.page, b.name);
  await card(b.page, a.name);
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('big.bin', 45 * 1048576)]);
  const ask = b.page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
  await b.page.waitForFunction((n) => [...peers.values()].find((p) => p.info.name === n)?.incoming, a.name);
}
const lastResult = (a) => a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-sent') || '[]')[0]?.result);

test('a problem on the receiving device reads "Not finished" on the sender, not "Cancelled"', async ({ browser }) => {
  test.setTimeout(90000);
  const a = await open(browser, 'Result A');
  const b = await open(browser, 'Result B');
  await startSend(a, b);
  await b.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).abort('Could not save the file'), a.name);
  await expect.poll(() => lastResult(a), { timeout: 20000 }).toBe('failed');
  // And why, under "Not finished" in the chat
  const why = await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-sent'))[0].why);
  expect(why).toContain('Could not save the file');
  await a.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), b.name);
  await expect(a.page.locator('#dlg-chat .bubble.out.failed .chat-why')).toContainText('Could not save the file');
});

test('Stop on the sending device still reads "Cancelled"', async ({ browser }) => {
  test.setTimeout(90000);
  const a = await open(browser, 'Stop A');
  const b = await open(browser, 'Stop B');
  await startSend(a, b);
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).cancelTransfer(), b.name);
  await expect.poll(() => lastResult(a), { timeout: 20000 }).toBe('cancelled');
});
