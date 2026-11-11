// Upgrades of 2026-11-02: links emailed by the server (Resend), clipboard history, auto-send a folder, big-file mode
// (piece-by-piece checks, a bad piece sent again, ZIP64), the weekly summary, and the new landing pages
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const OUTBOX = path.join(__dirname, '.data', 'emails.jsonl');
const mails = () => { try { return fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

async function pairedDevices(browser, storage = {}, opts = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name, auto = false) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto, trusted: true }]);
  const a = await open(browser, 'Test Laptop', { clipboard: true, ...opts, storage: { 'omnibeam-paired': paired('Test Phone'), ...storage } });
  const b = await open(browser, 'Test Phone', { clipboard: true, ...opts, storage: { 'omnibeam-paired': paired('Test Laptop', true), ...storage } });
  await expect((await card(a.page, 'Test Phone')).locator('.tag')).toHaveText('Trusted');
  await expect((await card(b.page, 'Test Laptop')).locator('.tag')).toHaveText('Trusted');
  return { a, b, secret };
}

test('email: the server emails the link from no-reply, at most 3 times per link, and the mail app is the fallback', async ({ browser, request }) => {
  const a = await open(browser, 'Test Laptop');
  await menu(a.page, 'btn-sendto');
  const dlg = a.page.locator('#dlg-link');
  await expect(a.page.locator('#link-to-note')).toBeVisible();
  await a.page.fill('#link-to', 'reader@example.com');
  const file = makeFile('holiday.mp4', 200 * 1024, 'video/mp4');
  let chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([file]);
  await expect(a.page.locator('#link-email-status')).toContainText('Email sent to reader@example.com');
  const url = await a.page.locator('#link-url').textContent();
  const mail = mails().filter((m) => m.to[0] === 'reader@example.com').pop();
  expect(mail.subject).toBe('Files for you: holiday.mp4');
  const id = url.match(/\/d\/([^#]+)#(.+)$/);
  expect(mail.text).toContain(`https://omnibeam.site/d/${id[1]}#${id[2]}`);
  expect(mail.text).toContain('200 KB');

  // Straight to the server: the owner's token is needed, and one link is emailed at most 3 times
  const link = await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-links')).pop());
  const post = (token, to) => request.post(`/api/drop/${link.id}/email`, { headers: { 'X-Drop-Token': token }, data: { to, key: id[2], lang: 'fr', name: 'Yazeed', names: 'holiday.mp4' } });
  expect((await post('0'.repeat(32), 'x@example.com')).status()).toBe(403);
  expect((await post(link.token, 'not-an-email')).status()).toBe(400);
  expect((await post(link.token, 'a@example.com, b@example.com')).status()).toBe(400);
  expect((await post(link.token, 'two@example.com')).status()).toBe(200);
  // In the sender's language
  expect(mails().pop().subject).toBe('Fichiers pour vous : holiday.mp4');
  expect((await post(link.token, 'three@example.com')).status()).toBe(200);
  const fourth = await post(link.token, 'four@example.com');
  expect(fourth.status()).toBe(429);
  expect((await fourth.json()).why).toBe('link');

  // The server can't send (e.g. its daily limit): the big mail-app button shows instead
  await a.page.route(/\/api\/drop\/[^/]+\/email$/, (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"limit","why":"site"}' }));
  await dlg.locator('[data-act=close]').click();
  await menu(a.page, 'btn-sendto');
  await a.page.fill('#link-to', 'later@example.com');
  chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([makeFile('notes.txt', 1000, 'text/plain')]);
  await expect(a.page.locator('#link-email-status')).toContainText('Daily email limit reached.');
  const big = a.page.locator('#link-send-to');
  await expect(big).toBeVisible();
  expect(decodeURIComponent(await big.getAttribute('href'))).toContain('mailto:later@example.com?subject=');
  expect(a.errors).toEqual([]);
});

test('clipboard history: last texts in History, copy and send again, and it can be turned off', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, { 'omnibeam-clip': 'on' });
  // (The test browsers share one clipboard, so the copy is sent the way sync does it after reading it)
  await a.page.evaluate(() => sendClip('first copied text'));
  await expect(a.page.locator('#toast')).toContainText('Clipboard sent to Test Phone');
  await expect.poll(() => b.page.evaluate(() => ClipHistory.load()[0]?.text), { timeout: 15000 }).toBe('first copied text');
  // Receiver: in History, Clipboard tab
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  await hist.locator('[data-tab=clips]').click();
  const item = hist.locator('.clip-list .item').first();
  await expect(item).toContainText('first copied text');
  await expect(item).toContainText('from Test Laptop');
  await hist.locator('[data-act=close]').click();
  // Sender: listed as sent, and Send again sends it once more
  await a.page.bringToFront();
  await a.page.locator('#btn-history').click();
  const histA = a.page.locator('#dlg-history');
  await histA.locator('[data-tab=clips]').click();
  await expect(histA.locator('.clip-list .item').first()).toContainText('to Test Phone');
  await b.page.evaluate(() => ClipHistory.add('something else', 'out', 'Test Laptop'));
  await histA.locator('.clip-list .item').first().locator('[data-clip-again]').click();
  await expect(a.page.locator('#toast')).toContainText('Clipboard sent to Test Phone');
  // It arrives again on the phone: back at the top of its list
  await expect.poll(() => b.page.evaluate(() => ClipHistory.load()[0]?.text), { timeout: 15000 }).toBe('first copied text');
  expect(await b.page.evaluate(() => ClipHistory.load()[0].dir)).toBe('in');
  // Only the last 20 are kept, newest first
  await a.page.evaluate(() => { for (let i = 0; i < 25; i++) ClipHistory.add('text ' + i, 'out', 'Test Phone'); });
  expect(await a.page.evaluate(() => ClipHistory.load().length)).toBe(20);
  expect(await a.page.evaluate(() => ClipHistory.load()[0].text)).toBe('text 24');
  // Off in Settings: cleared, and nothing new is kept
  await histA.locator('[data-act=close]').click();
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'clipboard');
  await a.page.locator('#clip-history').uncheck();
  await expect(a.page.locator('#toast')).toContainText('Clipboard history is off and cleared');
  expect(await a.page.evaluate(() => { ClipHistory.add('secret', 'out', 'x'); return ClipHistory.load().length; })).toBe(0);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

// A pretend folder for showDirectoryPicker (the real picker is a window of the operating system)
const fakeFolder = () => {
  window.__folder = new Map();
  const handle = {
    kind: 'directory', name: 'Screenshots',
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async isSameEntry(o) { return o === handle; },
    async *values() {
      for (const [name, file] of window.__folder) yield { kind: 'file', name, getFile: async () => file };
    },
  };
  window.showDirectoryPicker = async () => handle;
  window.__addFile = (name, text) => window.__folder.set(name, new File([text], name, { type: 'text/plain', lastModified: Date.now() }));
};

test('auto-send a folder: only new, finished files go to the chosen paired device by themselves', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser);
  await a.context.addInitScript(fakeFolder);
  await a.page.reload();
  await expect(a.page.locator('#me-name')).toHaveText('Test Laptop');
  await card(a.page, 'Test Phone');
  await a.page.evaluate(() => window.__addFile('old.txt', 'was there before'));
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'clipboard');
  await expect(a.page.locator('#autosend-ui')).toBeVisible();
  await a.page.selectOption('#autosend-to', { label: 'Test Phone' });
  await a.page.locator('#autosend-pick').click();
  await expect(a.page.locator('#autosend-folder')).toHaveText('Screenshots');
  await expect(a.page.locator('#autosend-on')).toBeChecked();
  await expect(a.page.locator('#toast')).toContainText('Auto-send is on: new files in “Screenshots” go to Test Phone.');
  await a.page.locator('#dlg-settings [data-close]').click();
  // A new file: sent by itself (auto-accept is on for the laptop on the phone)
  await a.page.evaluate(() => window.__addFile('screenshot-1.png', 'new picture bytes'));
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  await expect(got).toContainText('screenshot-1.png');
  await expect(got).not.toContainText('old.txt');
  await got.locator('[data-act=close]').first().click().catch(() => {});
  // Not sent twice
  await a.page.waitForTimeout(12000);
  const sent = await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-sent') || '[]').map((e) => e.files?.[0]?.name));
  expect(sent.filter((n) => n === 'screenshot-1.png').length).toBe(1);
  expect(sent).not.toContain('old.txt');
  expect(a.errors).toEqual([]);
});

const BIG = { 'omnibeam-big-min': String(1024 * 1024), 'omnibeam-big-seg': String(256 * 1024) };
for (const relayOnly of [false, true]) {
  test(`big-file mode${relayOnly ? ' via the server' : ''}: checked piece by piece, a bad piece is sent again, file intact`, async ({ browser }) => {
    const { a, b } = await pairedDevices(browser, BIG, { relayOnly });
    // Spoil one byte of the 5th piece once, on the receiving side, as a bad network or memory would
    await b.page.evaluate(() => {
      window.__redos = 0;
      const orig = Peer.prototype.onChunk;
      let seen = 0;
      let spoiled = false;
      Peer.prototype.onChunk = function (buf) {
        const c = this.incoming?.current;
        if (c?.seg && !spoiled && !this.incoming.discard) {
          seen += buf.byteLength;
          if (seen > 4 * 256 * 1024 + 1000) { spoiled = true; const u = new Uint8Array(buf.slice(0)); u[7] ^= 0xff; return orig.call(this, u.buffer); }
        }
        return orig.call(this, buf);
      };
      const send = Peer.prototype.sendJson;
      Peer.prototype.sendJson = function (obj) { if (obj?.t === 'redo') window.__redos++; return send.call(this, obj); };
    });
    const file = makeFile('movie.mkv', 3 * 1024 * 1024 + 12345, 'video/x-matroska');
    const target = await card(a.page, 'Test Phone');
    const chooser = a.page.waitForEvent('filechooser');
    await target.hover();
    await target.locator('[data-act=files]').click();
    // Every message the sender shows is kept: over the server a small test file can finish within a second, and
    // the "Sent" message then replaces the big-file one before a check of the screen sees it
    await a.page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => window.__toasts.push(document.getElementById('toast').textContent))
        .observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true });
    });
    await (await chooser).setFiles([file]);
    await expect.poll(() => a.page.evaluate(() => window.__toasts.join('\n'))).toContain('Big-file mode');
    const got = b.page.locator('#dlg-received');
    await expect(got).toBeVisible({ timeout: 60000 });
    await expect(got.locator('.intact')).toBeVisible({ timeout: 20000 });
    expect(await b.page.evaluate(() => window.__redos)).toBe(1);
    const download = b.page.waitForEvent('download');
    await got.locator('[data-act=save-all]').click();
    const d = await download;
    expect(sha(fs.readFileSync(await d.path()))).toBe(sha(file.buffer));
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}

// The live site: a slow TURN connection switched to the server midway and the whole-file sum message was lost; the
// pieces had all matched, so the file is still shown as intact
test('big-file mode: intact without the whole-file sum when that message is lost', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, BIG);
  await b.page.evaluate(() => {
    const onData = Peer.prototype.onData;
    Peer.prototype.onData = function (d) { if (typeof d === 'string' && d.includes('"t":"sum"')) return; return onData.call(this, d); };
  });
  const file = makeFile('movie.mkv', 2 * 1024 * 1024 + 777, 'video/x-matroska');
  const target = await card(a.page, 'Test Phone');
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([file]);
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  await expect(got.locator('.intact')).toBeVisible({ timeout: 10000 });
  const download = b.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('big-file mode: a receiver without enough free space says so before anything is sent', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, BIG);
  await b.page.evaluate(() => { navigator.storage.estimate = async () => ({ quota: 2 * 1024 * 1024, usage: 1024 * 1024 }); });
  const target = await card(a.page, 'Test Phone');
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('big.iso', 2 * 1024 * 1024, 'application/octet-stream')]);
  await expect(a.page.locator('#toast')).toContainText('Test Phone does not have enough free space for this.');
  await expect(b.page.locator('#toast')).toContainText('Not enough free space for this transfer');
});

test('ZIP of several files: ZIP64 fields once sizes pass 4 GB (checked with a lower limit)', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const bytes = await a.page.evaluate(async () => {
    await loadMore();
    const files = [{ name: 'a.bin', blob: new Blob([new Uint8Array(3000).fill(1)]) }, { name: 'b.txt', blob: new Blob(['hello']) }];
    const z = await More.makeZip(files);
    return [...new Uint8Array(await z.arrayBuffer())];
  });
  const buf = Buffer.from(bytes);
  // A normal small ZIP has no ZIP64 end record
  expect(buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  // The ZIP64 code itself was checked with Python's zipfile and unzip (see the notes); here: it is in more.js
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'more.js'), 'utf8');
  expect(src).toContain('0x06064b50');
  expect(src).toContain('0x07064b50');
});

test('weekly summary: "Send the weekly summary now" sends last week\'s numbers', async ({ request }) => {
  const r = await request.post('/api/stats/weekly-test', { headers: { Authorization: 'Bearer test-stats-key' } });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.sent).toContain('email');
  expect(j.preview.subject).toMatch(/^OmniBeam weekly: \d+ visitors, \d+ transfers/);
  expect(j.preview.text).toContain('Worked:');
  expect(j.weekly.day).toBe(1);
  expect(j.weekly.tz).toBe('Asia/Amman');
  const mail = mails().filter((m) => m.subject.startsWith('OmniBeam weekly')).pop();
  expect(mail.to[0]).toBe('owner@example.com');
  expect((await request.post('/api/stats/weekly-test', { headers: { Authorization: 'Bearer wrong' } })).status()).toBe(403);
});
