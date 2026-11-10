// Five upgrades (2026-11-10): links open on the other device (banner "Open link", chat button, Settings -> Open links
// for paired devices), Ring my device (beeps, Stop, the ringer hears it was found; offline paired devices ring when
// they come back), Send to all my devices (online and offline paired ones, files or a message, untick some), the
// Invite a friend picture (square and story, QR code), and pinned notes per chat.
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => {
  const d = await openDevice(...args);
  devices.push(d);
  // The links in these tests open a small page instead of the real sites
  await d.context.route(/^https?:\/\/example\.(com|org)\//, (r) => r.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }));
  return d;
};
// A browser that blocks sound until the page is tapped (headless Chrome allows it at once)
const blockSound = (page) => page.evaluate(() => {
  window.AudioContext = function () { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; };
  window.AudioContext.prototype.resume = () => Promise.resolve();
  audioCtx = null;
});
const sendFrom = (page, to, text) => page.evaluate(([n, s]) => [...peers.values()].find((p) => p.info.name === n).sendText(s), [to, text]);
// Sound that "works": a fake AudioContext counting its oscillators, and the tap that allows sound
const fakeAudio = (page) => page.evaluate(() => {
  window.__tones = 0;
  const node = () => ({ connect: (x) => x || node(), gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: {}, start() {}, stop() {} });
  window.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; };
  window.AudioContext.prototype.createOscillator = () => { window.__tones++; return node(); };
  window.AudioContext.prototype.createGain = node;
  window.AudioContext.prototype.resume = () => Promise.resolve();
  audioCtx = null;
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
function pairStorage(names) {
  // Every pair of names shares one secret: { name: [{ secret, name: other }] }
  const out = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const secret = crypto.randomBytes(32).toString('hex');
    out[names[i]].push({ secret, name: names[j], at: Date.now(), seen: Date.now(), auto: false, trusted: true });
    out[names[j]].push({ secret, name: names[i], at: Date.now(), seen: Date.now(), auto: false, trusted: true });
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { 'omnibeam-paired': JSON.stringify(v) }]));
}

test('a link sent from another device: banner with Open link, chat button, opens in a new tab', async ({ browser }) => {
  const a = await open(browser, 'Link A');
  const b = await open(browser, 'Link B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await sendFrom(a.page, b.name, 'https://example.com/watch?v=abc');
  const banner = b.page.locator('#msg-banner.show');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.msg-banner-text')).toHaveText('example.com/watch?v=abc');
  await expect(banner.locator('.msg-banner-act')).toHaveText('· Open link');
  await expect(b.page.locator('#dlg-chat')).toHaveCount(0); // a link doesn't take over the screen with the chat
  const tab = b.context.waitForEvent('page');
  await banner.locator('.msg-banner-open').click();
  expect((await tab).url()).toContain('example.com/watch?v=abc');
  await expect(banner).toHaveCount(0);
  // In the chat, the link's bubble has Open link; plain text has none
  await sendFrom(a.page, b.name, 'see you at 8');
  const chat = b.page.locator('#dlg-chat');
  await expect(chat).toBeVisible();
  await expect(chat.locator('.bubble.in')).toHaveCount(2);
  await expect(chat.locator('.bubble.in').nth(0).locator('.chat-link-open')).toHaveText('Open link');
  await expect(chat.locator('.bubble.in').nth(1).locator('.chat-link-open')).toHaveCount(0);
  const tab2 = b.context.waitForEvent('page');
  await chat.locator('.chat-link-open').click();
  expect((await tab2).url()).toContain('example.com/watch?v=abc');
  // The banner's Chat button opens the chat instead
  await chat.locator('[data-act=close]').click();
  await sendFrom(a.page, b.name, 'http://example.org/');
  await b.page.locator('#msg-banner.show .msg-banner-chat').click();
  await expect(chat).toBeVisible();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('Open links right away: only from paired devices, and only when turned on in Settings', async ({ browser }) => {
  const st = pairStorage(['Auto A', 'Auto B']);
  const a = await open(browser, 'Auto A', { storage: st['Auto A'] });
  const b = await open(browser, 'Auto B', { storage: st['Auto B'] });
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText('Trusted');
  await card(a.page, b.name);
  await menu(b.page, 'btn-settings');
  await settingsTab(b.page, 'transfers');
  const box = b.page.locator('#open-links');
  await expect(box).not.toBeChecked();
  await box.check();
  expect(await b.page.evaluate(() => localStorage.getItem('omnibeam-open-links'))).toBe('on');
  await b.page.locator('#dlg-settings').evaluate((d) => d.close());
  // Headless Chrome lets the page open the tab here (a real browser may ask to allow pop-ups first)
  const tab = b.context.waitForEvent('page');
  await sendFrom(a.page, b.name, 'https://example.com/auto');
  expect((await tab).url()).toContain('example.com/auto');
  await expect(b.page.locator('#toast')).toHaveText('Opened a link from Auto A');
  // An unpaired device: the banner, nothing opened by itself
  const c = await open(browser, 'Auto C');
  await card(c.page, b.name);
  await card(b.page, c.name);
  let opened = false;
  b.context.on('page', () => { opened = true; });
  await sendFrom(c.page, b.name, 'https://example.com/stranger');
  await expect(b.page.locator('#msg-banner.show .msg-banner-text')).toHaveText('example.com/stranger');
  await b.page.waitForTimeout(500);
  expect(opened).toBe(false);
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('Ring this device: it beeps with a Stop button; Stop tells the device that rang', async ({ browser }) => {
  const a = await open(browser, 'Ring A');
  const b = await open(browser, 'Ring B');
  await card(b.page, a.name);
  await fakeAudio(b.page);
  // Rings even with the message sound off
  await b.page.evaluate(() => setMsgSound(false));
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=more]').click();
  await a.page.locator('#dlg-actions [data-act=ring]').click();
  const ring = b.page.locator('#dlg-ring');
  await expect(ring).toBeVisible();
  await expect(ring.locator('h3')).toHaveText('Ring A is ringing this device');
  await expect(a.page.locator('#toast')).toHaveText('Ring B is ringing');
  await expect.poll(() => b.page.evaluate(() => window.__tones)).toBeGreaterThanOrEqual(6); // 3 beeps a second
  await ring.locator('[data-act=stop]').click();
  await expect(ring).toBeHidden();
  await expect(a.page.locator('#toast')).toHaveText('Ring B was found and stopped ringing');
  const after = await b.page.evaluate(() => window.__tones);
  await b.page.waitForTimeout(1300);
  expect(await b.page.evaluate(() => window.__tones)).toBe(after);
  // Again at once: too soon (one ring per 10 s from the same device)
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).ring(), b.name);
  await expect(a.page.locator('#toast')).toHaveText(/You just rang Ring B/);
  await expect(ring).toBeHidden();
  // Sound blocked (the page was never tapped): it still shows, and the ringer is told
  const c = await open(browser, 'Ring C');
  await card(c.page, a.name);
  await blockSound(c.page);
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).ring(), 'Ring C');
  await expect(c.page.locator('#dlg-ring')).toBeVisible();
  await expect(a.page.locator('#toast')).toHaveText(/browser blocked the sound/);
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('Ring from the chat, and a paired device that is offline rings when it opens OmniBeam', async ({ browser }) => {
  const st = pairStorage(['Find A', 'Find B']);
  const a = await open(browser, 'Find A', { storage: st['Find A'] });
  let b = await open(browser, 'Find B', { storage: st['Find B'] });
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=message]').click();
  const chat = a.page.locator('#dlg-chat');
  await chat.locator('[data-act=ring]').click();
  await expect(b.page.locator('#dlg-ring')).toBeVisible();
  await b.page.locator('#dlg-ring [data-act=stop]').click();
  await chat.locator('[data-act=close]').click();
  // B goes away; its greyed card stays on A (trusted). Ring it from its chat: it rings when it's back.
  await b.close();
  devices = devices.filter((d) => d !== b);
  await expect(a.page.locator('.peer.offline')).toBeVisible();
  await a.page.evaluate(() => openChat(loadPaired()[0]));
  await expect(chat.locator('.chat-state')).toHaveText(/Last seen|Offline/);
  await chat.locator('[data-act=ring]').click();
  await expect(a.page.locator('#toast')).toHaveText(/Find B is offline.* It rings (as soon as|if) it opens OmniBeam/);
  b = await open(browser, 'Find B', { storage: st['Find B'] });
  await expect(b.page.locator('#dlg-ring')).toBeVisible();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('Send to all my devices: a message and files to every device, offline paired ones get them later', async ({ browser }) => {
  const st = pairStorage(['All A', 'All B', 'All C', 'All D']);
  const a = await open(browser, 'All A', { storage: st['All A'] });
  const b = await open(browser, 'All B', { storage: st['All B'] });
  const c = await open(browser, 'All C', { storage: st['All C'] });
  await card(a.page, b.name);
  await card(a.page, c.name);
  // D is paired but offline: its greyed card counts too
  await expect(a.page.locator('.peer.offline')).toHaveCount(1);
  const btn = a.page.locator('#btn-send-all');
  await expect(btn).toHaveText('Send to all my devices (3)');
  await btn.click();
  const dlg = a.page.locator('#dlg-send-all');
  await expect(dlg.locator('.send-all-row')).toHaveCount(3);
  await expect(dlg.locator('.send-all-row').nth(2)).toContainText('All D');
  await expect(dlg.locator('.send-all-row').nth(2)).toContainText('Offline');
  await dlg.locator('textarea').fill('meeting moved to 3pm');
  await dlg.locator('[data-act=message]').click();
  await expect(dlg).toBeHidden();
  for (const d of [b, c]) await expect(d.page.locator('#dlg-chat .bubble.in .msg-text')).toHaveText('meeting moved to 3pm');
  await expect(a.page.locator('.peer.offline .status')).toHaveText('0 file(s) waiting to send');
  expect(await a.page.evaluate(() => [...waiting.values()].map((w) => w.text))).toEqual(['meeting moved to 3pm']);
  // Files to B only (C unticked)
  for (const d of [b, c]) await d.page.locator('#dlg-chat [data-act=close]').click();
  await btn.click();
  await dlg.locator('.send-all-row input').nth(1).uncheck();
  await dlg.locator('.send-all-row input').nth(2).uncheck();
  const chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('notes.txt', 2000, 'text/plain')]);
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await c.page.waitForTimeout(800);
  await expect(c.page.locator('#dlg-request')).toBeHidden();
  // Nothing ticked: the buttons can't be used
  await b.page.locator('#dlg-request [data-act=decline]').click();
  await btn.click();
  for (const i of [0, 1, 2]) await dlg.locator('.send-all-row input').nth(i).uncheck();
  await expect(dlg.locator('[data-act=files]')).toBeDisabled();
  await expect(dlg.locator('[data-act=message]')).toBeDisabled();
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('Send to all shows with two devices (not one), and files dropped on it go to all', async ({ browser }) => {
  const a = await open(browser, 'Drop A');
  const b = await open(browser, 'Drop B');
  await card(a.page, b.name);
  await expect(a.page.locator('#btn-send-all')).toBeHidden();
  const c = await open(browser, 'Drop C');
  await card(a.page, c.name);
  await expect(a.page.locator('#btn-send-all')).toHaveText('Send to all my devices (2)');
  await a.page.evaluate(() => openSendAll([new File(['hello'], 'hi.txt', { type: 'text/plain' })]));
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await expect(c.page.locator('#dlg-request')).toBeVisible();
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('Invite a friend: square and story pictures with a QR code, in the page language', async ({ browser }) => {
  for (const lang of ['en', 'ar', 'ja']) {
    const a = await open(browser, 'Invite ' + lang, { storage: { 'omnibeam-lang': lang }, path: lang === 'en' ? '/' : `/${lang}/` });
    await a.page.locator('#btn-menu').click();
    await a.page.locator('#menu #menu-invite').click();
    const dlg = a.page.locator('#dlg-invite');
    await expect(dlg).toBeVisible();
    const img = dlg.locator('.invite-preview');
    await expect.poll(() => img.evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([1080, 1080]);
    await dlg.locator('[data-format=story]').click();
    await expect.poll(() => img.evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([1080, 1920]);
    await expect(dlg.locator('[data-format=story]')).toHaveAttribute('aria-pressed', 'true');
    if (lang === 'en') {
      const download = a.page.waitForEvent('download');
      await dlg.locator('[data-act=save]').click();
      expect((await download).suggestedFilename()).toBe('omnibeam-invite-story.png');
      await dlg.locator('[data-act=close]').click();
      // Also from "Share OmniBeam" under the app
      await a.page.locator('#share-card').click();
      await expect(dlg).toBeVisible();
    }
    expect(a.errors).toEqual([]);
  }
});

test('pinned note: pin a message or write one, stays after closing and clearing, unpin', async ({ browser }) => {
  const a = await open(browser, 'Pin A');
  const b = await open(browser, 'Pin B');
  await card(b.page, a.name);
  const target = await card(a.page, b.name);
  await sendFrom(b.page, a.name, 'Wi-Fi: HomeNet / pass 1234');
  const chat = a.page.locator('#dlg-chat');
  await expect(chat.locator('.bubble.in')).toHaveCount(1);
  const pin = chat.locator('.chat-pin');
  await expect(pin).toBeHidden();
  await chat.locator('.bubble.in .chat-acts button', { hasText: 'Pin' }).click();
  await expect(pin).toBeVisible();
  await expect(pin.locator('.pin-text')).toHaveText('Wi-Fi: HomeNet / pass 1234');
  await chat.locator('[data-act=close]').click();
  // Back again, and after Clear chat: still there
  await target.hover();
  await target.locator('[data-act=message]').click();
  await expect(pin.locator('.pin-text')).toHaveText('Wi-Fi: HomeNet / pass 1234');
  a.page.once('dialog', (d) => d.accept());
  await chat.locator('[data-act=clear]').click();
  await expect(chat.locator('.bubble')).toHaveCount(0);
  await expect(pin).toBeVisible();
  // Edit it with the pin button in the head
  a.page.once('dialog', (d) => d.accept('Door code 4321'));
  await chat.locator('.chat-head [data-act=pin]').click();
  await expect(pin.locator('.pin-text')).toHaveText('Door code 4321');
  // Only in this chat
  expect(await a.page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('omnibeam-pins'))).length)).toBe(1);
  await chat.locator('[data-act=unpin]').click();
  await expect(pin).toBeHidden();
  expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-pins')))).toEqual({});
  expect(a.errors.concat(b.errors)).toEqual([]);
});
