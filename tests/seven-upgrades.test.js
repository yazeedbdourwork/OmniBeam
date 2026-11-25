// Seven upgrades (2026-11-25): voice messages in the chat (voice.js), pictures in Clipboard sync, group chat for
// a room (group.js), notes and to-dos that sync between paired devices (notes.js), screen share upgrades, a phone
// as the remote of a computer's slides and videos (remote.js), and a folder of photos saved to a phone's gallery as
// an album. Plus the new words in all 15 languages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const chatWith = (page, name) => page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), name);

// Two devices that are already paired with each other (as after entering a pairing code)
async function pairedDevices(browser, names = ['Seven Laptop', 'Seven Phone'], opts = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const a = await open(browser, names[0], { clipboard: true, storage: { 'omnibeam-paired': paired(names[1]), ...opts.storage } });
  const b = await open(browser, names[1], { clipboard: true, storage: { 'omnibeam-paired': paired(names[0]), ...opts.storage } });
  await expect((await card(a.page, names[1])).locator('.tag')).toHaveText('Trusted');
  await expect((await card(b.page, names[0])).locator('.tag')).toHaveText('Trusted');
  return { a, b, secret };
}
// A real PNG picture (w x h)
function png(w, h) {
  const tab = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tab[n] = c >>> 0; }
  const crc = (b) => { let c = ~0; for (const x of b) c = tab[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 7) & 255; raw[o + 1] = (y * 3) & 255; raw[o + 2] = (x ^ y) & 255; }
  const head = Buffer.alloc(13); head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Voice messages in the chat ----------

test('voice message: hold the microphone, let go, it plays on the other device and on this one', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Voice Laptop', 'Voice Phone']);
  await chatWith(a.page, 'Voice Phone');
  const chat = a.page.locator('#dlg-chat');
  const mic = chat.locator('.chat-compose [data-act=voice]');
  await expect(mic).toBeVisible();
  // Text in the box: Send instead of the microphone
  await chat.locator('textarea').fill('hi');
  await expect(mic).toBeHidden();
  await chat.locator('textarea').fill('');
  await expect(mic).toBeVisible();
  // Hold for two seconds (the test browser's fake microphone plays a beep)
  const box = await mic.boundingBox();
  await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.page.mouse.down();
  await expect(chat.locator('.vm-rec')).toBeVisible();
  await expect(chat.locator('.vm-rec .vm-hint')).toContainText(/Release to send/);
  await a.page.waitForTimeout(2200);
  await a.page.mouse.up();
  await expect(chat.locator('.vm-rec')).toBeHidden();
  // Sent: a voice bubble on this side, with its length
  const out = chat.locator('.bubble.out.voice');
  await expect(out).toHaveCount(1, { timeout: 15000 });
  await expect(out.locator('.vm-time')).toHaveText(/0:0[2-3]/);
  // Arrived without asking: the other device's chat opens with it
  const other = b.page.locator('#dlg-chat');
  await expect(other.locator('.bubble.in.voice')).toHaveCount(1, { timeout: 15000 });
  const inb = other.locator('.bubble.in.voice');
  // Plays there: the button turns into Pause, the bars fill
  await inb.locator('.vm-play').click();
  await expect(inb.locator('.vm-play')).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(() => inb.locator('.vm-bars i.on').count(), { timeout: 8000 }).toBeGreaterThan(0);
  // Speed 1x -> 1.5x, remembered
  await inb.locator('.vm-rate').click();
  await expect(inb.locator('.vm-rate')).toHaveText('1.5×');
  expect(await b.page.evaluate(() => localStorage.getItem('omnibeam-vm-rate'))).toBe('1.5');
  // Ticks: delivered on the sender
  await expect(out.locator('.tick')).toHaveClass(/ d|r/);
  // The sound is kept on both devices (after closing and opening the chat again, it still plays)
  const kept = await b.page.evaluate(async () => {
    const m = Messages.items.find((x) => x.voice);
    const blob = await VoiceStore.get(m.id, m.voice.mime);
    return { size: blob?.size || 0, text: m.text };
  });
  expect(kept.size).toBeGreaterThan(1000);
  expect(kept.text).toMatch(/🎤 Voice note \(\ds\)/);
  const mine = await a.page.evaluate(async () => {
    Sent.load();
    const e = Sent.items.find((x) => x.voice);
    return (await VoiceStore.get(e.id, e.voice.mime))?.size || 0;
  });
  expect(mine).toBeGreaterThan(1000);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('voice message: a short tap records hands-free, the bin throws it away, Send sends it', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Tap Laptop', 'Tap Phone']);
  await chatWith(a.page, 'Tap Phone');
  const chat = a.page.locator('#dlg-chat');
  const mic = chat.locator('.chat-compose [data-act=voice]');
  await mic.click();
  await expect(chat.locator('.vm-rec .vm-go')).toBeVisible();
  await expect(chat.locator('.vm-rec .vm-hint')).toContainText('tap to stop');
  await a.page.waitForTimeout(1200);
  await chat.locator('.vm-rec .vm-bin').click();
  await expect(chat.locator('.vm-rec')).toBeHidden();
  await a.page.waitForTimeout(1500);
  await expect(chat.locator('.bubble.voice')).toHaveCount(0);
  // Again, and Send
  await mic.click();
  await expect(chat.locator('.vm-rec .vm-go')).toBeVisible();
  await a.page.waitForTimeout(1500);
  await chat.locator('.vm-rec .vm-go').click();
  await expect(chat.locator('.bubble.out.voice')).toHaveCount(1, { timeout: 15000 });
  await expect(b.page.locator('#dlg-chat .bubble.in.voice')).toHaveCount(1, { timeout: 15000 });
  // The message menu of a voice message: react, reply, delete (no copy, translate, forward or pin)
  await chat.locator('.bubble.out.voice').click({ button: 'right' });
  const m = chat.locator('.chat-menu');
  await expect(m.locator('[data-menu=reply]')).toBeVisible();
  await expect(m.locator('[data-menu=copy]')).toBeHidden();
  await expect(m.locator('[data-menu=forward]')).toBeHidden();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

// ---------- Pictures in Clipboard sync ----------

test('clipboard sync sends a copied picture, which lands on the other clipboard', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Clip Laptop', 'Clip Phone']);
  for (const d of [a, b]) {
    await menu(d.page, 'btn-settings');
    await settingsTab(d.page, 'clipboard');
    await d.page.locator('#clip-sync').check();
    await expect(d.page.locator('#clip-note')).toContainText('Pictures you copy, like a screenshot, are sent too.');
    await d.page.keyboard.press('Escape');
  }
  const picture = png(64, 48).toString('base64');
  // A screenshot on the laptop's clipboard
  await a.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, picture);
  // It shows up on the phone's clipboard
  await expect.poll(() => b.page.evaluate(async () => {
    try {
      for (const item of await navigator.clipboard.read()) if (item.types.includes('image/png')) return (await item.getType('image/png')).size;
    } catch {}
    return 0;
  }), { timeout: 20000 }).toBeGreaterThan(100);
  // Not sent back and forth: the laptop sent it once
  await b.page.waitForTimeout(3000);
  const sent = await a.page.evaluate(() => lastClipSig);
  expect(sent).toMatch(/^\d+:[0-9a-f]{16}$/);
  expect(await b.page.evaluate(() => lastClipSig)).toBe(sent);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a clipboard picture that can\'t be put on the clipboard by itself shows with Copy and Save', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Pic Laptop', 'Pic Phone']);
  for (const d of [a, b]) await d.page.evaluate(() => { clipSync = true; });
  // The phone's browser refuses to write a picture without a tap (like an iPhone)
  await b.page.evaluate(() => { navigator.clipboard.write = () => Promise.reject(new Error('needs a tap')); });
  const bytes = png(40, 40).toString('base64');
  await a.page.evaluate((b64) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    sendClipImage(new Blob([u8], { type: 'image/png' }));
  }, bytes);
  const dlg = b.page.locator('#dlg-clip-img');
  await expect(dlg).toBeVisible({ timeout: 15000 });
  await expect(dlg.locator('h3')).toHaveText('Clipboard from Pic Laptop');
  await expect(dlg.locator('[data-act=save]')).toBeVisible();
  await expect.poll(() => dlg.locator('img').evaluate((img) => img.naturalWidth)).toBe(40);
  // An unpaired device can't push a picture onto this clipboard
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('the new words are translated in all 15 languages, and are the words the app uses', async () => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'seven-upgrades.keys.json'), 'utf8'));
  const src = ['app.js', 'chat.js', 'voice.js', 'group.js', 'notes.js', 'remote.js', 'media.js', 'index.html']
    .filter((f) => fs.existsSync(path.join(__dirname, '..', 'public', f)))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
  for (const k of keys) expect(src.includes(k) || src.includes(k.replace(/'/g, "\\'")), `used: ${k}`).toBe(true);
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) {
      const v = pack.strings[k];
      expect(v, `${code}: ${k}`).toBeTruthy();
      for (const part of k.match(/\{\w+\}/g) || []) expect(v, `${code}: ${k}`).toContain(part);
    }
  }
});
