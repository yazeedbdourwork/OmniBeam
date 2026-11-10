// Sending between two browsers: files directly, files through the server relay, messages, several files as
// a ZIP, and the route each transfer took
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha, sendAndReceive } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

test('devices on the same network see each other', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  await card(a.page, 'Test Phone');
  await card(b.page, 'Test Laptop');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a file arrives intact over a direct connection', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  const file = makeFile('photo.jpg', 3 * 1024 * 1024 + 123, 'image/jpeg');
  const got = await sendAndReceive(a, b, [file]);
  expect(got.name).toBe('photo.jpg');
  expect(sha(got.buf)).toBe(sha(file.buffer));
  // The sender noted which route it used: on one computer that's the local network
  const route = await a.page.evaluate(() => [...peers.values()][0].lastRoute);
  expect(route).toBe('lan');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a file arrives intact through the server relay when direct fails', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { relayOnly: true });
  b = await openDevice(browser, 'Test Phone', { relayOnly: true });
  const file = makeFile('report.pdf', 2 * 1024 * 1024 + 7, 'application/pdf');
  const got = await sendAndReceive(a, b, [file]);
  expect(sha(got.buf)).toBe(sha(file.buffer));
  const route = await a.page.evaluate(() => [...peers.values()][0].lastRoute);
  expect(route).toBe('relay');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('several files arrive as one ZIP', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  const files = [makeFile('one.txt', 1000, 'text/plain'), makeFile('two.bin', 200 * 1024)];
  const got = await sendAndReceive(a, b, files);
  expect(got.name).toMatch(/\.zip$/);
  // A stored ZIP holds the files as they are: both must be in it byte for byte
  for (const f of files) expect(got.buf.includes(f.buffer)).toBe(true);
});

test('a message arrives', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  const target = await card(a.page, 'Test Phone');
  // Right-click -> Send message opens the chat with that device (there is no separate message window any more)
  await target.click({ button: 'right' });
  const dlg = a.page.locator('#dlg-chat');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#chat-title')).toHaveText('Test Phone');
  await expect(a.page.locator('#dlg-send-text')).toHaveCount(0);
  await dlg.locator('textarea').fill('Hello from the test https://omnibeam.site');
  await dlg.locator('[data-act=send]').click();
  await expect(dlg.locator('.bubble.out')).toContainText('Hello from the test');
  // On the phone (nothing else open there): the chat with the laptop opens by itself, no message window
  const chat = b.page.locator('#dlg-chat');
  await expect(chat.locator('#chat-title')).toHaveText('Test Laptop');
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await expect(chat.locator('.bubble.in .msg-text')).toContainText('Hello from the test');
  await expect(chat.locator('.bubble.in .msg-text a')).toHaveAttribute('href', 'https://omnibeam.site');
});

test('the receiver can decline', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop');
  b = await openDevice(browser, 'Test Phone');
  const target = await card(a.page, 'Test Phone');
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('no.bin', 5000)]);
  await b.page.locator('#dlg-request [data-act=decline]').click();
  await expect(a.page.locator('.toast, #toast').filter({ hasText: 'declined' }).first()).toBeVisible();
});
