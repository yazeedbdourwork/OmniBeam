// Shared helpers for the tests: open OmniBeam as a "device" (its own browser profile), find another device's
// card, send files to it and accept them on the other side.
const crypto = require('crypto');
const fs = require('fs');
const { expect } = require('@playwright/test');

// Opens OmniBeam in a fresh browser profile with a fixed device name.
//   relayOnly: block direct connections (as on a network where they fail), so everything goes through the server
//   clipboard: allow the page to read and write the clipboard (Chrome asks the user otherwise)
//   userAgent: open it as another kind of device (e.g. an Android phone)
async function openDevice(browser, name, { relayOnly = false, clipboard = false, path = '/', storage = {}, userAgent } = {}) {
  const context = await browser.newContext({
    acceptDownloads: true,
    ...(userAgent ? { userAgent } : {}),
    permissions: clipboard ? ['clipboard-read', 'clipboard-write'] : [],
  });
  await context.addInitScript(({ name, storage }) => {
    localStorage.setItem('omnibeam-name', name);
    if (!localStorage.getItem('omnibeam-lang')) localStorage.setItem('omnibeam-lang', 'en');
    // The first-visit walkthrough would cover the page: seen already, unless a test sets it
    if (!('omnibeam-tour' in storage) && !localStorage.getItem('omnibeam-tour')) localStorage.setItem('omnibeam-tour', 'done');
    for (const [k, v] of Object.entries(storage)) if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  }, { name, storage });
  if (relayOnly) {
    // Allow only TURN routes, and there is no TURN server here: the direct attempt fails like on a strict network
    await context.addInitScript(() => {
      const Real = window.RTCPeerConnection;
      window.RTCPeerConnection = function (cfg) { return new Real({ ...(cfg || {}), iceTransportPolicy: 'relay' }); };
      window.RTCPeerConnection.prototype = Real.prototype;
    });
  }
  // Fonts and other outside services aren't needed (and may be unreachable where the tests run)
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Content Security Policy blocks and script errors; the test fails on any of them
    if (m.type() === 'error' && !/Failed to load resource|ERR_|WebSocket connection/.test(m.text())) errors.push(m.text());
  });
  await page.goto(path);
  await expect(page.locator('#me-name')).toHaveText(name);
  return { context, page, errors, name, close: () => context.close() };
}

// The card of the device called `name`, once it shows up
async function card(page, name) {
  const el = page.locator('.peer:not(.offline)').filter({ has: page.locator('.name', { hasText: name }) });
  await expect(el).toBeVisible();
  return el;
}

// Random test files: [{ name, mimeType, buffer }]
function makeFile(name, size, mimeType = 'application/octet-stream') {
  return { name, mimeType, buffer: crypto.randomBytes(size) };
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Send files from one device to another through the card, accept them there and return the downloaded bytes
async function sendAndReceive(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
  const ask = to.page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
  const got = to.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  const download = to.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const d = await download;
  const buf = fs.readFileSync(await d.path());
  await expect(got).toBeHidden();
  return { name: d.suggestedFilename(), buf };
}

// Settings, Test speed, Share files by link… are in the ⋯ menu at the top: open it and choose the item
// Settings, Light/Dark and TV mode are buttons in the top bar (2026-11-08); the ⋯ menu has them only when the bar is
// too narrow. This clicks the bar button when it is shown, else the menu item.
const BAR = { 'btn-settings': 'bar-settings', 'btn-theme': 'bar-theme', 'menu-tv': 'bar-tv' };
async function menu(page, id) {
  if (BAR[id] && await page.locator(`#${BAR[id]}`).isVisible()) return page.locator(`#${BAR[id]}`).click();
  await page.locator('#btn-menu').click();
  await page.locator(`#menu #${id}`).click();
}

// Settings shows one group at a time (2026-11-10): Device, Transfers, Clipboard, Apps. This opens one.
async function settingsTab(page, name) {
  await page.locator(`#set-tab-${name}`).click();
  await page.locator(`#set-pane-${name}`).waitFor();
}

module.exports = { openDevice, card, makeFile, sha, sendAndReceive, menu, settingsTab };
