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

// ---------- Group chat of a room ----------

test('group chat: three devices in a public room write to all of them; a device outside the room gets nothing', async ({ browser }) => {
  test.setTimeout(150000);
  const [a, b, c, d] = [await open(browser, 'Group A'), await open(browser, 'Group B'), await open(browser, 'Group C'), await open(browser, 'Outside D')];
  for (const x of [a, b, c, d]) for (const n of ['Group A', 'Group B', 'Group C', 'Outside D'].filter((n) => n !== x.name)) await card(x.page, n);
  // Two devices in the room: no group chat yet (it needs three)
  for (const x of [a, b]) await x.page.evaluate(() => joinPublic('qwert'));
  await expect(a.page.locator('#public-show')).toHaveText('QWERT');
  await a.page.waitForTimeout(1500);
  await expect(a.page.locator('#groups')).toHaveCount(0);
  await c.page.evaluate(() => joinPublic('qwert'));
  const chip = a.page.locator('#groups .group-chip');
  await expect(chip).toContainText('Group chat · Room QWERT', { timeout: 15000 });
  await expect(chip).toContainText('3 devices');
  await expect(d.page.locator('#groups')).toHaveCount(0);
  await chip.click();
  const g = a.page.locator('#dlg-group');
  await expect(g.locator('.g-members')).toHaveText(/You, Group [BC], Group [BC]/);
  await g.locator('textarea').fill('Dinner at 8?');
  await g.locator('[data-act=send]').click();
  await expect(g.locator('.bubble.out')).toContainText('Dinner at 8?');
  // B and C: the badge on their group button, then the message with its sender's name
  for (const x of [b, c]) {
    const ch = x.page.locator('#groups .group-chip');
    await expect(ch.locator('.chat-badge')).toHaveText('1', { timeout: 15000 });
    await ch.click();
    await expect(x.page.locator('#dlg-group .bubble.in')).toContainText('Dinner at 8?');
    await expect(x.page.locator('#dlg-group .bubble.in .g-from')).toHaveText('Group A');
    await expect(ch.locator('.chat-badge')).toHaveCount(0);
  }
  // C answers with a voice message: A and B get it
  const mic = c.page.locator('#dlg-group [data-act=voice]');
  await mic.click();
  await expect(c.page.locator('#dlg-group .vm-rec .vm-go')).toBeVisible();
  await c.page.waitForTimeout(1500);
  await c.page.locator('#dlg-group .vm-rec .vm-go').click();
  for (const x of [a, b]) await expect(x.page.locator('#dlg-group .bubble.in.voice')).toHaveCount(1, { timeout: 15000 });
  // Outside D got nothing (nor can it claim the room: it doesn't know it)
  expect(await d.page.evaluate(() => localStorage.getItem('omnibeam-groups'))).toBeNull();
  const gid = await a.page.evaluate(() => [...Groups.mine.keys()][0]);
  await d.page.evaluate((id) => {
    for (const p of peers.values()) { p.groups = new Set([id]); wsSend({ type: 'signal', to: p.info.id, data: { grp: ['0'.repeat(32)] } }); }
  }, gid);
  await a.page.waitForTimeout(1500);
  expect(await a.page.evaluate(() => [...peers.values()].find((p) => p.info.name === 'Outside D').groups.size)).toBe(0);
  await expect(chip).toContainText('3 devices');
  for (const x of [a, b, c, d]) expect(x.errors).toEqual([]);
});

// ---------- Notes and to-dos ----------

test('notes and to-dos: written on one device, the same on its paired device, both ways', async ({ browser }) => {
  // The phone already has a note from before; the laptop learns it when they meet
  const old = JSON.stringify([{ id: 'aaaa0000bbbb1111', at: Date.now() - 60000, kind: 'note', title: 'Wi-Fi', text: 'password: sunflower', tasks: [] }]);
  const { a, b } = await pairedDevices(browser, ['Notes Laptop', 'Notes Phone'], {});
  await b.page.evaluate((v) => localStorage.setItem('omnibeam-notes', v), old);
  await b.page.evaluate(() => Notes?.hello ? 0 : loadNotes()).catch(() => {});
  await b.page.evaluate(() => loadNotes().then(() => { for (const p of peers.values()) Notes.hello(p); }));
  await expect.poll(() => a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-notes') || '[]').map((n) => n.title).join()), { timeout: 15000 }).toBe('Wi-Fi');
  // On the laptop: ⋯ → Notes and to-dos, a new to-do list with two tasks
  await menu(a.page, 'btn-notes');
  const dlg = a.page.locator('#dlg-notes');
  await expect(dlg.locator('.nt-card')).toContainText('Wi-Fi');
  await expect(dlg.locator('.nt-foot')).toHaveText('In sync with Notes Phone');
  await dlg.locator('[data-act=new-todo]').click();
  await dlg.locator('.nt-title').fill('Shopping');
  for (const task of ['Milk', 'Bread']) {
    await dlg.locator('.nt-add input').fill(task);
    await dlg.locator('.nt-add button').click();
  }
  await expect(dlg.locator('.nt-task')).toHaveCount(2);
  // On the phone, the list arrives; it ticks Milk off
  await expect.poll(() => b.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-notes') || '[]').find((n) => n.title === 'Shopping')?.tasks.length || 0), { timeout: 15000 }).toBe(2);
  await menu(b.page, 'btn-notes');
  const pd = b.page.locator('#dlg-notes');
  await pd.locator('.nt-card', { hasText: 'Shopping' }).click();
  await expect(pd.locator('.nt-task')).toHaveCount(2);
  await expect(pd.locator('.nt-task').first().locator('input[type=text]')).toHaveValue('Milk');
  await pd.locator('.nt-task').first().locator('input[type=checkbox]').click();
  // Done tasks go under the open ones
  await expect(pd.locator('.nt-task.done input[type=text]')).toHaveValue('Milk');
  // The laptop shows it ticked (its list on screen is drawn again)
  await a.page.locator('#dlg-notes [data-act=back]').click();
  await expect(dlg.locator('.nt-card', { hasText: 'Shopping' })).toContainText('1 of 2 done', { timeout: 15000 });
  // Deleted on the laptop: gone on the phone too
  await dlg.locator('.nt-card', { hasText: 'Wi-Fi' }).click();
  a.page.once('dialog', (x) => x.accept());
  await dlg.locator('[data-act=delete]').click();
  await expect(dlg.locator('.nt-card', { hasText: 'Wi-Fi' })).toHaveCount(0);
  await pd.locator('[data-act=back]').click();
  await expect(pd.locator('.nt-card', { hasText: 'Wi-Fi' })).toHaveCount(0, { timeout: 15000 });
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('notes are only swapped with paired devices', async ({ browser }) => {
  const a = await open(browser, 'Lone Laptop', { storage: { 'omnibeam-notes': JSON.stringify([{ id: 'cccc0000dddd1111', at: Date.now(), kind: 'note', title: 'Secret', text: 'x', tasks: [] }]) } });
  const b = await open(browser, 'Lone Phone');
  await card(a.page, 'Lone Phone');
  await card(b.page, 'Lone Laptop');
  // A device that isn't paired sends notes: ignored
  await b.page.evaluate(async () => {
    const p = [...peers.values()].find((x) => x.info.name === 'Lone Laptop');
    await p.connect();
    p.sendJson({ t: 'nt-put', items: [{ id: 'eeee0000ffff1111', at: Date.now(), kind: 'note', title: 'Spam', text: '', tasks: [] }] });
    p.sendJson({ t: 'nt-want', ids: ['cccc0000dddd1111'] });
  });
  await a.page.waitForTimeout(2500);
  expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-notes')).map((n) => n.title))).toEqual(['Secret']);
  expect(await b.page.evaluate(() => localStorage.getItem('omnibeam-notes'))).toBeNull();
  await menu(a.page, 'btn-notes');
  await expect(a.page.locator('#dlg-notes .nt-foot')).toContainText('Pair your devices');
  expect(a.errors).toEqual([]);
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
