// Nine upgrades (2026-11-25): voice and video calls between two devices (call.js), search in a chat, "Media, files
// and links", Forward, Translate (the browser's own translator), disappearing messages, Send later, a photo editor
// before sending one photo (edit.js), a whole folder by share link, and a notification when a share link is
// downloaded. Plus the new words in all 15 languages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const http = require('http');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, sha } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const chatWith = (page, name) => page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), name);
const say = async (chat, text) => {
  await chat.locator('textarea').fill(text);
  await chat.locator('[data-act=send]').click();
};
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x & 255; raw[o + 1] = y & 255; raw[o + 2] = 160; }
  const head = Buffer.alloc(13); head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A stand-in for a browser's push service (as in upgrades.test.js): it keeps what the server sends and can read it
function fakePushService() {
  const ecdh = crypto.createECDH('prime256v1');
  const uaPublic = ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const got = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      got.push({ headers: req.headers, body: Buffer.concat(parts) });
      res.writeHead(201);
      res.end();
    });
  });
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  // RFC 8291, receiving side
  const decrypt = (body) => {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const data = body.subarray(21 + idlen);
    const ikm = hmac(hmac(auth, ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const d = crypto.createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16),
      hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
  };
  // The VAPID signature must check out with the server's public key
  const vapidOk = (header, publicKey) => {
    const m = String(header).match(/^vapid t=([^,]+), k=(.+)$/);
    if (!m || m[2] !== publicKey) return false;
    const [h, c, s] = m[1].split('.');
    const point = Buffer.from(publicKey, 'base64url');
    const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
    return crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  };
  return new Promise((resolve) => server.listen(0, () => resolve({
    got, decrypt, vapidOk, close: () => server.close(),
    sub: (n) => ({ endpoint: `http://localhost:${server.address().port}/push/${n}`, keys: { p256dh: uaPublic.toString('base64url'), auth: auth.toString('base64url') } }),
  })));
}
function unzip(buf) {
  const out = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
    out[name] = buf.subarray(start, start + size);
    at = start + size;
  }
  return out;
}

test('search in the chat, Media, files and links, the ⋮ menu', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Find A');
  const b = await open(browser, 'Find B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  const chatB = b.page.locator('#dlg-chat');
  await say(chatA, 'the blue door is open');
  await say(chatA, 'see https://example.com/map for the way');
  await say(chatA, 'BLUE car outside');
  await expect(chatB.locator('.bubble.in')).toHaveCount(3);
  // Search: both "blue" messages marked, the newest one first, ↑ goes to the older one
  await chatB.locator('[data-act=search]').click();
  await chatB.locator('.chat-search input').fill('blue');
  await expect(chatB.locator('.bubble mark')).toHaveCount(2);
  await expect(chatB.locator('.chat-search .n')).toHaveText('2/2');
  await expect(chatB.locator('.bubble.hit-now')).toContainText('BLUE car outside');
  await chatB.locator('[data-act=hit-prev]').click();
  await expect(chatB.locator('.chat-search .n')).toHaveText('1/2');
  await expect(chatB.locator('.bubble.hit-now')).toContainText('the blue door is open');
  await chatB.locator('.chat-search input').fill('nothing like this');
  await expect(chatB.locator('.chat-search .n')).toHaveText('No results');
  await chatB.locator('[data-act=search-x]').click();
  await expect(chatB.locator('.chat-search')).toBeHidden();
  await expect(chatB.locator('.bubble mark')).toHaveCount(0);
  // ⋮: the menu with Media, Send later, Disappearing messages, Ring, Pin, sound, Clear chat; Esc closes it only
  await chatB.locator('[data-act=head-more]').click();
  const more = chatB.locator('.chat-head-menu');
  await expect(more).toBeVisible();
  for (const act of ['media', 'later', 'vanish', 'ring', 'pin', 'sound', 'clear']) await expect(more.locator(`[data-act=${act}]`)).toBeVisible();
  await b.page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await expect(chatB).toBeVisible();
  // Media, files and links: the link in Links, nothing in Media yet
  await chatB.locator('[data-act=head-more]').click();
  await more.locator('[data-act=media]').click();
  const panel = chatB.locator('.chat-media');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.cm-empty')).toHaveText('No photos or videos in this chat yet');
  await panel.locator('[data-tab=links]').click();
  await expect(panel.locator('.chat-link-card')).toHaveCount(1);
  await expect(panel.locator('.chat-link-card')).toContainText('example.com');
  await panel.locator('[data-tab=files]').click();
  await expect(panel.locator('.cm-empty')).toHaveText('No files in this chat yet');
  await panel.locator('[data-act=media-x]').click();
  await expect(panel).toBeHidden();
  // Calls: the phone and camera buttons while the device is here
  await expect(chatB.locator('[data-act=call-voice]')).toBeVisible();
  await expect(chatB.locator('[data-act=call-video]')).toBeVisible();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('Forward a message to another device: "Forwarded" on both sides', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Fwd A');
  const b = await open(browser, 'Fwd B');
  const c = await open(browser, 'Fwd C');
  for (const [x, y] of [[a, b], [b, a], [b, c], [c, b]]) await card(x.page, y.name);
  await chatWith(a.page, b.name);
  await say(a.page.locator('#dlg-chat'), 'the code is 4455');
  const chatB = b.page.locator('#dlg-chat');
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  await chatB.locator('.bubble.in').click({ button: 'right' });
  await chatB.locator('.chat-menu [data-menu=forward]').click();
  const choose = b.page.locator('#dlg-choose');
  await expect(choose).toBeVisible();
  await choose.locator('.choose-item', { hasText: c.name }).click();
  // C gets it (its chat opens by itself) marked Forwarded; B's Sent list has it too
  const chatC = c.page.locator('#dlg-chat');
  await expect(chatC.locator('.bubble.in .msg-text')).toHaveText('the code is 4455');
  await expect(chatC.locator('.bubble.in .chat-fwd')).toHaveText('↪ Forwarded');
  expect(await b.page.evaluate(() => Sent.items.find((e) => e.text === 'the code is 4455')?.fwd)).toBe(1);
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('Translate a message with the browser translator (here a stand-in), and Show original', async ({ browser }) => {
  const fake = async (ctx) => ctx.addInitScript(() => {
    window.LanguageDetector = { create: async () => ({ detect: async (text) => [{ detectedLanguage: /hola/i.test(text) ? 'es' : 'en', confidence: 0.95 }] }) };
    window.Translator = {
      availability: async () => 'available',
      create: async ({ sourceLanguage, targetLanguage }) => ({ translate: async (text) => `[${sourceLanguage}>${targetLanguage}] ${text.replace(/hola/i, 'hello')}` }),
    };
  });
  const a = await open(browser, 'Tr A');
  const b = await open(browser, 'Tr B', { setup: fake });
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  await say(a.page.locator('#dlg-chat'), 'Hola amigo');
  const chatB = b.page.locator('#dlg-chat');
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  await chatB.locator('.bubble.in').click({ button: 'right' });
  await chatB.locator('.chat-menu [data-menu=translate]').click();
  await expect(chatB.locator('.bubble.in .msg-trans span')).toHaveText('[es>en] hello amigo');
  await chatB.locator('.bubble.in').click({ button: 'right' });
  await expect(chatB.locator('.chat-menu [data-menu=translate]')).toContainText('Show original');
  await chatB.locator('.chat-menu [data-menu=translate]').click();
  await expect(chatB.locator('.msg-trans')).toHaveCount(0);
  // No translator in this browser (A): no Translate in its menu
  await a.page.locator('#dlg-chat .bubble.out').click({ button: 'right' });
  await expect(a.page.locator('#dlg-chat .chat-menu [data-menu=translate]')).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('disappearing messages: set on one device, the other follows; old messages go', async ({ browser }) => {
  const a = await open(browser, 'Gone A');
  const b = await open(browser, 'Gone B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  await say(chatA, 'this goes later');
  const chatB = b.page.locator('#dlg-chat');
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  await chatA.locator('[data-act=head-more]').click();
  await chatA.locator('.chat-head-menu [data-act=vanish]').click();
  const pick = a.page.locator('#dlg-chat-vanish');
  await expect(pick.locator('[role=radio][aria-checked=true]')).toHaveText('Off');
  await pick.locator('[role=radio]', { hasText: '24 hours' }).click();
  await expect(chatA.locator('.chat-vanish')).toHaveText(/Messages in this chat disappear after 24 hours/);
  // B is told and shows the same
  await expect(b.page.locator('#toast')).toContainText(`${a.name} set messages in this chat to disappear after 24 hours`);
  await expect(chatB.locator('.chat-vanish')).toBeVisible();
  // A message older than that is deleted on the next sweep
  await b.page.evaluate(() => { const all = JSON.parse(localStorage.getItem('omnibeam-messages')); all[0].at -= 25 * 3600000; localStorage.setItem('omnibeam-messages', JSON.stringify(all)); Vanish.sweep(); });
  await expect(chatB.locator('.bubble.in')).toHaveCount(0);
  // Off again from B: A follows
  await chatB.locator('.chat-vanish').click();
  await b.page.locator('#dlg-chat-vanish [role=radio]', { hasText: 'Off' }).click();
  await expect(chatB.locator('.chat-vanish')).toBeHidden();
  await expect(chatA.locator('.chat-vanish')).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('Send later: scheduled in the chat, Cancel, and it goes at its time', async ({ browser }) => {
  const a = await open(browser, 'Later A');
  const b = await open(browser, 'Later B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  await chatA.locator('textarea').fill('happy birthday!');
  // Right-click (long-press on phones) on Send: Send later
  await chatA.locator('[data-act=send]').click({ button: 'right' });
  const later = a.page.locator('#dlg-chat-later');
  await expect(later).toBeVisible();
  await expect(later.locator('.later-what')).toContainText('happy birthday!');
  await expect(later.locator('.chat-later-when button').first()).toHaveText('In 1 hour');
  await later.locator('[data-act=yes]').click();
  await expect(chatA.locator('.bubble.later')).toHaveCount(1);
  await expect(chatA.locator('.bubble.later .chat-meta')).toContainText('Scheduled for');
  await expect(chatA.locator('textarea')).toHaveValue('');
  // Cancel takes it away
  await chatA.locator('.bubble.later [data-later-act=cancel]').click();
  await expect(chatA.locator('.bubble.later')).toHaveCount(0);
  // One due in 2 seconds goes by itself
  await a.page.evaluate((n) => Later.add(chatWho([...peers.values()].find((p) => p.info.name === n)), Date.now() + 2000, 'on time'), b.name);
  await expect(chatA.locator('.bubble.later')).toHaveCount(1);
  await expect(b.page.locator('#dlg-chat .bubble.in .msg-text')).toHaveText('on time', { timeout: 20000 });
  await expect(chatA.locator('.bubble.later')).toHaveCount(0);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('one photo from the chat opens the editor: rotate and send a new picture', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Edit A');
  const b = await open(browser, 'Edit B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  await chatWith(b.page, a.name); // B's chat is open: it asks there
  const chatA = a.page.locator('#dlg-chat');
  const chooser = a.page.waitForEvent('filechooser');
  await chatA.locator('[data-act=attach]').click();
  await (await chooser).setFiles([{ name: 'wide.png', mimeType: 'image/png', buffer: png(120, 60) }]);
  const ed = a.page.locator('#dlg-photo-edit');
  await expect(ed).toBeVisible();
  await expect(ed.locator('#edit-title')).toHaveText(`Send to ${b.name}`);
  for (const tool of ['rotate', 'crop', 'draw', 'blur', 'undo']) await expect(ed.locator(`[data-act=${tool}]`)).toBeVisible();
  await expect(ed.locator('[data-act=undo]')).toBeDisabled();
  await ed.locator('[data-act=rotate]').click();
  expect(await ed.locator('canvas').evaluate((c) => [c.width, c.height])).toEqual([60, 120]);
  // Blur: drag a box; Undo puts it back
  await ed.locator('[data-act=blur]').click();
  await expect(ed.locator('.edit-hint')).toHaveText('Drag a box over what to hide');
  const box = await ed.locator('canvas').boundingBox();
  await a.page.mouse.move(box.x + 5, box.y + 5);
  await a.page.mouse.down();
  await a.page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 4 });
  await a.page.mouse.up();
  await ed.locator('[data-act=undo]').click();
  await ed.locator('[data-act=send]').click();
  await expect(ed).toBeHidden();
  // B is asked in its chat; the picture is the rotated one
  const ask = b.page.locator('#dlg-chat .chat-ask');
  await expect(ask).toBeVisible({ timeout: 30000 });
  await ask.getByRole('button', { name: 'Accept' }).click();
  await expect(b.page.locator('#dlg-chat .bubble.in.file')).toContainText('wide.png', { timeout: 60000 });
  const size = await b.page.evaluate(async () => {
    const f = History.items[0];
    const bmp = await createImageBitmap(await History.blobOf(f));
    return [bmp.width, bmp.height];
  });
  expect(size).toEqual([60, 120]);
  // Cancel sends nothing
  const chooser2 = a.page.waitForEvent('filechooser');
  await chatA.locator('[data-act=attach]').click();
  await (await chooser2).setFiles([{ name: 'other.png', mimeType: 'image/png', buffer: png(30, 30) }]);
  await ed.locator('[data-act=cancel]').click();
  await expect(ed).toBeHidden();
  await a.page.waitForTimeout(800);
  await expect(b.page.locator('#dlg-chat .chat-ask')).toHaveCount(0);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('a voice call and a video call between two devices', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Call A');
  const b = await open(browser, 'Call B');
  for (const d of [a, b]) await d.context.grantPermissions(['microphone', 'camera']);
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  // Declined
  await chatA.locator('[data-act=call-voice]').click();
  const callA = a.page.locator('#dlg-call');
  const callB = b.page.locator('#dlg-call');
  await expect(callA.locator('.call-state')).toHaveText('Calling…');
  await expect(callB.locator('.call-state')).toHaveText('Incoming voice call');
  await expect(callB.locator('[data-act=yes-video]')).toBeHidden();
  await callB.locator('[data-act=no]').click();
  await expect(callA).toBeHidden();
  await expect(a.page.locator('#toast')).toContainText(`${b.name} declined the call`);
  // A video call, answered with video: both connected, with the other's picture and a timer
  await chatA.locator('[data-act=call-video]').click();
  await expect(callB.locator('.call-state')).toHaveText('Incoming video call');
  await callB.locator('[data-act=yes-video]').click();
  await expect(callA.locator('.call-top')).toBeVisible({ timeout: 30000 });
  await expect(callB.locator('.call-top')).toBeVisible({ timeout: 30000 });
  await expect(callA.locator('.call-remote')).toBeVisible();
  await expect.poll(() => callA.locator('.call-remote').evaluate((v) => v.srcObject?.getTracks().map((t) => t.kind).sort().join(','))).toBe('audio,video');
  await expect(callA.locator('.call-time')).toHaveText(/^0:0\d$/);
  // Mute
  await callA.locator('[data-act=mute]').click();
  await expect(callA.locator('[data-act=mute]')).toHaveAttribute('aria-pressed', 'true');
  expect(await a.page.evaluate(() => document.querySelector('#dlg-call .call-local').srcObject.getAudioTracks()[0].enabled)).toBe(false);
  // B hangs up: both windows close
  await callB.locator('[data-act=end]').click();
  await expect(callB).toBeHidden();
  await expect(callA).toBeHidden();
  await expect(a.page.locator('#toast')).toContainText(`${b.name} ended the call`);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('a whole folder by share link: the paths in the list and inside the ZIP, named after the folder', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Folder A');
  await a.page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': '203.0.113.91' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-folder-'));
  const root = path.join(dir, 'Trip');
  fs.mkdirSync(path.join(root, 'day 1'), { recursive: true });
  const files = { 'Trip/notes.txt': Buffer.from('packing list\n'), 'Trip/day 1/beach.png': png(40, 30), 'Trip/day 1/map.bin': crypto.randomBytes(5000) };
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), buf);
  await menu(a.page, 'btn-link');
  const dlg = a.page.locator('#dlg-link');
  await expect(dlg.locator('[data-act=pick-folder]')).toBeVisible();
  await a.page.locator('#link-folder-input').setInputFiles(root);
  await expect(a.page.locator('#link-done')).toBeVisible({ timeout: 60000 });
  await expect(a.page.locator('#link-summary')).toContainText('📁 Trip (3 files)');
  const url = (await a.page.locator('#link-url').textContent()).replace(/^https?:\/\/[^/]+/, '');
  // Your links: "Notify me when someone downloads my links" is on, and the link is offered to the server for it
  await expect(a.page.locator('#link-notify')).toBeChecked();
  expect(await a.page.evaluate(() => window.shareLinksForPush().length)).toBe(1);

  const ctx = await browser.newContext({ acceptDownloads: true });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('📁 Trip');
  const rows = page.locator('#drop-files li.f');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#drop-files')).toContainText('Trip/day 1/beach.png');
  await page.locator('#drop-get').click();
  await expect(page.locator('#drop-zip')).toBeVisible({ timeout: 30000 });
  await expect(rows.locator('a.save').first()).toHaveAttribute('download', /^[^/]+$/);
  const download = page.waitForEvent('download');
  await page.locator('#drop-zip').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('Trip.zip');
  const got = unzip(fs.readFileSync(await d.path()));
  expect(Object.keys(got).sort()).toEqual(Object.keys(files).sort());
  for (const [name, buf] of Object.entries(files)) expect(sha(got[name])).toBe(sha(buf));
  fs.rmSync(dir, { recursive: true, force: true });
  expect(a.errors).toEqual([]);
});

test('a download of a share link sends a notification to the devices of its owner only', async ({ browser, request }) => {
  const push = await fakePushService();
  try {
    const a = await open(browser, 'Notify A');
    await a.page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': '203.0.113.93' });
    await menu(a.page, 'btn-link');
    const chooser = a.page.waitForEvent('filechooser');
    await a.page.locator('#dlg-link [data-act=pick]').click();
    await (await chooser).setFiles([{ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('the plan\n') }]);
    await expect(a.page.locator('#link-done')).toBeVisible({ timeout: 60000 });
    const id = (await a.page.locator('#link-url').textContent()).match(/\/d\/([^#]+)#/)[1];
    // The owner's device gives the server its push address with its links; another one tries with a wrong token
    await a.page.evaluate((sub) => wsSend({ type: 'push-sub', sub, links: window.shareLinksForPush(), lang: 'en' }), push.sub(1));
    await a.page.evaluate(([sub, id]) => wsSend({ type: 'push-sub', sub, links: [{ id, token: 'f'.repeat(32) }], lang: 'en' }), [push.sub(2), id]);
    await a.page.waitForTimeout(500);
    // Someone downloads it
    const r = await request.get(`/api/drop/${id}/data`, { headers: { 'X-Forwarded-For': '203.0.113.94' } });
    expect(r.ok()).toBe(true);
    await expect.poll(() => push.got.length).toBe(1);
    const note = push.decrypt(push.got[0].body);
    expect(note.title).toBe('Someone downloaded your share link');
    expect(note.body).toBe('Downloads: 1');
    expect(note.url).toBe('/?links=1');
    expect(a.errors).toEqual([]);
  } finally { push.close(); }
});

test('share link server: a long list of folder names is accepted, up to a limit', async ({ request }) => {
  const meta = 'A'.repeat(60000); // a folder with many files
  const c = await (await request.post('/api/drop', { headers: { 'X-Forwarded-For': '203.0.113.92' }, data: { size: 100, hours: 1, meta } })).json();
  expect(c.id).toBeTruthy();
  const tooLong = await request.post('/api/drop', { headers: { 'X-Forwarded-For': '203.0.113.92' }, data: { size: 100, hours: 1, meta: 'A'.repeat(300001) } });
  expect(tooLong.status()).toBe(400);
});

test('the new words are translated in all 15 languages', async () => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'nine-upgrades.keys.json'), 'utf8'));
  expect(keys.length).toBeGreaterThan(70);
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) {
      const v = pack.strings[k];
      expect(v, `${code}: ${k}`).toBeTruthy();
      // The {name}, {n}, {time} and {text} parts are kept
      for (const part of k.match(/\{\w+\}/g) || []) expect(v, `${code}: ${k}`).toContain(part);
    }
  }
});
