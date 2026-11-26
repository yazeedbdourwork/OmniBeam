// Upgrades of 2026-11-26: a safety code both devices show (safety.js), a shared whiteboard (board.js), file tools
// before sending: merge PDFs and resize pictures (ftools.js, pdf-lib), and a phone that backs up new photos to its
// computer by itself (pbackup.js). Plus the new words in all 15 languages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu } = require('./helpers');
const { PDFDocument } = require('../public/pdf-lib.js');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function pairedDevices(browser, names, opts = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const a = await open(browser, names[0], { ...opts, storage: { 'omnibeam-paired': paired(names[1]) } });
  const b = await open(browser, names[1], { ...opts, storage: { 'omnibeam-paired': paired(names[0]) } });
  await expect((await card(a.page, names[1])).locator('.tag')).toHaveText('Trusted');
  await expect((await card(b.page, names[0])).locator('.tag')).toHaveText('Trusted');
  return { a, b };
}
async function more(page, name, act) {
  const c = await card(page, name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  await page.locator(`#dlg-actions [data-act=${act}]`).click();
}
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 128; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function pdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]);
  return Buffer.from(await doc.save());
}

for (const relayOnly of [false, true]) {
  test(`safety code: both devices show the same code (${relayOnly ? 'through the server' : 'direct'})`, async ({ browser }) => {
    const a = await open(browser, 'Safe Laptop', { relayOnly });
    const b = await open(browser, 'Safe Phone', { relayOnly });
    await more(a.page, 'Safe Phone', 'safety');
    const da = a.page.locator('#dlg-safety');
    await expect(da.locator('#sf-title')).toHaveText('Safety code with Safe Phone');
    await expect(da.locator('.sf-code')).toHaveText(/^\d{4} \d{4} \d{4}$/, { timeout: 30000 });
    await expect(da.locator('.sf-how')).toHaveText(relayOnly ? 'Through the OmniBeam server, end-to-end encrypted' : 'Direct connection, encrypted');
    const code = await da.locator('.sf-code').textContent();
    // Shown on the other device too, the same
    await da.locator('[data-act=show]').click();
    const db = b.page.locator('#dlg-safety');
    await expect(db.locator('#sf-title')).toHaveText('Safety code with Safe Laptop');
    await expect(db.locator('.sf-code')).toHaveText(code, { timeout: 20000 });
    await da.locator('[data-act=good]').click();
    await expect(da.locator('.sf-state')).toContainText('connected straight to Safe Phone');
    await db.locator('[data-act=bad]').click();
    await expect(db.locator('.sf-state')).toContainText('Don\'t send anything now');
    expect([...a.errors, ...b.errors]).toEqual([]);
  });
}

test('safety code: a device in between would give different codes', async ({ browser }) => {
  const a = await open(browser, 'Safe Laptop', { relayOnly: true });
  const b = await open(browser, 'Safe Phone', { relayOnly: true });
  await more(a.page, 'Safe Phone', 'safety');
  await expect(a.page.locator('#dlg-safety .sf-code')).toHaveText(/^\d{4} \d{4} \d{4}$/, { timeout: 30000 });
  // The same code from the other side, and a different one if the other side's key were someone else's
  const same = await b.page.evaluate(async () => {
    await loadSafety();
    const p = [...peers.values()][0];
    const real = await window.Safety.codeFor(p, 'r');
    const keep = p.theirPub;
    p.theirPub = E2E.pub; // as if a key in between had been swapped in
    const fake = await window.Safety.codeFor(p, 'r');
    p.theirPub = keep;
    return { real, fake };
  });
  expect(same.real).toBe(await a.page.locator('#dlg-safety .sf-code').textContent());
  expect(same.fake).not.toBe(same.real);
});

test('whiteboard: what one device draws shows on the other; undo and clear', async ({ browser }) => {
  const a = await open(browser, 'Board Laptop');
  const b = await open(browser, 'Board Phone');
  await more(a.page, 'Board Phone', 'board');
  await expect(a.page.locator('#dlg-board #wb-title')).toHaveText('Whiteboard with Board Phone');
  await expect(a.page.locator('#dlg-board .wb-note')).toContainText('Waiting for Board Phone');
  // The other device is asked first
  const ask = b.page.locator('#dlg-board-ask');
  await expect(ask).toBeVisible({ timeout: 20000 });
  await expect(ask.locator('p')).toHaveText('Board Laptop wants to draw with you on a shared whiteboard.');
  await ask.locator('[data-act=yes]').click();
  await expect(b.page.locator('#dlg-board')).toBeVisible();
  await expect(a.page.locator('#dlg-board .wb-who')).toHaveText('Board Phone is here');
  await expect(a.page.locator('#dlg-board .wb-note')).toBeHidden();

  // A red line on the laptop
  await a.page.locator('#dlg-board .sw').nth(1).click();
  const box = await a.page.locator('#dlg-board canvas').boundingBox();
  await a.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await a.page.mouse.down();
  for (let i = 1; i <= 10; i++) await a.page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * 0.5);
  await a.page.mouse.up();
  await expect.poll(() => b.page.evaluate(() => window.Board.strokes().length)).toBe(1);
  const got = await b.page.evaluate(() => window.Board.strokes()[0]);
  expect(got.c).toBe('#e5383b');
  expect(got.p.length).toBeGreaterThan(10);
  // In the same place of the board: from about x 320 to 1120 of 1600, y 500 of 1000
  expect(Math.abs(got.p[0] - 320)).toBeLessThan(30);
  expect(Math.abs(got.p[1] - 500)).toBeLessThan(30);
  // A pixel on the phone's board is red now
  const red = await b.page.evaluate(([x, y]) => [...$('#dlg-board canvas').getContext('2d').getImageData(x, y, 1, 1).data], [got.p[4], got.p[5]]);
  expect(red[0]).toBeGreaterThan(200);
  expect(red[1]).toBeLessThan(100);

  // The phone draws too, and the laptop gets it
  const bb = await b.page.locator('#dlg-board canvas').boundingBox();
  await b.page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.2);
  await b.page.mouse.down();
  await b.page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.8, { steps: 8 });
  await b.page.mouse.up();
  await expect.poll(() => a.page.evaluate(() => window.Board.strokes().length)).toBe(2);
  // Undo takes back only your own line
  await a.page.locator('#dlg-board [data-act=undo]').click();
  await expect.poll(() => b.page.evaluate(() => window.Board.strokes().length)).toBe(1);
  expect(await a.page.evaluate(() => window.Board.strokes().length)).toBe(1);
  // Clear, after asking: gone on both
  await b.page.locator('#dlg-board [data-act=clear]').click();
  await b.page.locator('.wb-confirm [data-v="1"]').click();
  await expect.poll(() => a.page.evaluate(() => window.Board.strokes().length)).toBe(0);
  await expect(a.page.locator('#toast')).toContainText('Board Phone cleared the whiteboard');
  // Save picture gives a PNG
  const dl = a.page.waitForEvent('download');
  await a.page.locator('#dlg-board [data-act=save]').click();
  expect((await dl).suggestedFilename()).toMatch(/^OmniBeam whiteboard .+\.png$/);
  // Closing tells the other
  await b.page.locator('#dlg-board [data-act=close]').click();
  await expect(a.page.locator('#dlg-board .wb-who')).toHaveText('Board Phone closed the whiteboard');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('file tools: merge PDFs in order and send the result; resize pictures', async ({ browser }) => {
  const a = await open(browser, 'Tools Laptop');
  const b = await open(browser, 'Tools Phone');
  await menu(a.page, 'btn-ftools');
  const dlg = a.page.locator('#dlg-ftools');
  await expect(dlg.locator('#ft-title')).toHaveText('File tools');
  await expect(dlg.locator('[data-act=merge]')).toBeDisabled();
  let chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=add-pdf]').click();
  await (await chooser).setFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await pdf(2) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await pdf(3) },
    { name: 'not.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
  ]);
  await expect(dlg.locator('[data-list=pdf] li')).toHaveCount(2);
  // two.pdf first
  await dlg.locator('[data-list=pdf] li').nth(1).locator('[data-act=up]').click();
  await expect(dlg.locator('[data-list=pdf] li .n').first()).toHaveText('two.pdf');
  await dlg.locator('[data-act=merge]').click();
  await expect(dlg.locator('.ft-state')).toHaveText('Done: one PDF with 5 pages.', { timeout: 30000 });
  await expect(dlg.locator('[data-list=out] li .n')).toHaveText('two (merged).pdf');
  // Sent to the phone
  await expect(dlg.locator('.ft-send select')).toHaveValue(await a.page.evaluate(() => [...peers.values()][0].info.id));
  await dlg.locator('[data-act=send]').click();
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  await expect(got).toContainText('two (merged).pdf');
  const bytes = await b.page.evaluate(async () => {
    const f = (await Store.list()).find((x) => x.name === 'two (merged).pdf');
    const blob = f.blob || (await Store.get(f.id))?.blob;
    return [...new Uint8Array(await blob.arrayBuffer())];
  }).catch(() => null);
  if (bytes) expect((await PDFDocument.load(Buffer.from(bytes))).getPageCount()).toBe(5);

  // Pictures
  await b.page.keyboard.press('Escape');
  await menu(a.page, 'btn-ftools');
  await dlg.locator('[data-tab=pic]').click();
  chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=add-pic]').click();
  await (await chooser).setFiles([{ name: 'big.png', mimeType: 'image/png', buffer: png(2400, 1200) }]);
  await dlg.locator('#ft-max').selectOption('800');
  await dlg.locator('#ft-fmt').selectOption('image/jpeg');
  await dlg.locator('[data-act=resize]').click();
  await expect(dlg.locator('.ft-state')).toContainText('1 pictures ready', { timeout: 30000 });
  await expect(dlg.locator('[data-list=out] li .n')).toHaveText('big (800x400).jpg');
  const dl = a.page.waitForEvent('download');
  await dlg.locator('[data-act=save]').click();
  expect((await dl).suggestedFilename()).toBe('big (800x400).jpg');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

// A camera folder the phone can read, in place of the browser's folder picker; window.addPhoto adds a new photo
function fakeCamera() {
  const dir = {};
  window.addPhoto = (name, size) => { dir[name] = new File([new Uint8Array(size).map((_, i) => (i * 7 + name.length) % 251)], name, { type: 'image/jpeg', lastModified: Date.now() - 10000 }); };
  const fileHandle = (n) => ({ kind: 'file', name: n, async getFile() { return dir[n]; } });
  const handle = {
    kind: 'directory', name: 'Camera',
    async *entries() { for (const n of Object.keys(dir)) yield [n, fileHandle(n)]; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  window.showDirectoryPicker = async () => handle;
}
// The computer's backup folder (as in photo-backup.test.js)
function fakeFolder() {
  const tree = {};
  window.fakeTree = tree;
  const notFound = () => new DOMException('no', 'NotFoundError');
  const fileHandle = (dir, n) => ({
    kind: 'file', name: n,
    async getFile() { return dir[n]; },
    async createWritable() {
      const parts = [];
      return new WritableStream({ write(c) { parts.push(c); }, close() { dir[n] = new File(parts, n, { lastModified: Date.now() }); } });
    },
  });
  const make = (name, dir) => ({
    kind: 'directory', name,
    async *entries() { for (const [n, v] of Object.entries(dir)) yield [n, v instanceof File ? fileHandle(dir, n) : make(n, v)]; },
    async getDirectoryHandle(n, o) { if (!(n in dir) && o?.create) dir[n] = {}; if (!dir[n] || dir[n] instanceof File) throw notFound(); return make(n, dir[n]); },
    async getFileHandle(n, o) { if (!(n in dir) && o?.create) dir[n] = new File([], n); if (!(dir[n] instanceof File)) throw notFound(); return fileHandle(dir, n); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => make('Backups', tree);
}

test('automatic photo backup: new photos in the phone\'s camera folder go to the computer by themselves', async ({ browser }) => {
  const { a: pc, b: phone } = await pairedDevices(browser, ['Auto Laptop', 'Auto Phone']);
  await pc.page.evaluate(fakeFolder);
  await menu(pc.page, 'btn-pbackup');
  await pc.page.locator('#dlg-pbackup [data-act=pick]').click();
  await expect(pc.page.locator('#dlg-pbackup .fs-state')).toHaveText('Backing up into: Backups');
  await pc.page.locator('#dlg-pbackup [data-act=close]').click();

  await phone.page.evaluate(fakeCamera);
  await more(phone.page, 'Auto Laptop', 'pbackup');
  const dlg = phone.page.locator('#dlg-pbk');
  await expect(dlg.locator('[data-k=auto-label]')).toHaveText('Back up new photos by themselves');
  await dlg.locator('[data-k=auto]').check();
  await expect(dlg.locator('[data-k=auto-note]')).toContainText('new photos in Camera go to Auto Laptop');
  await dlg.locator('[data-act=close]').click();
  // A photo taken now: it goes at the next look (here: when the computer shows up again, or every 5 minutes)
  await phone.page.evaluate(() => window.addPhoto('IMG_1001.jpg', 40000));
  await phone.page.evaluate(() => window.PhotoBackup.autoHere([...peers.values()][0]));
  await expect(pc.page.locator('#toast')).toContainText('Backed up 1 new photos from Auto Phone', { timeout: 30000 });
  expect(await pc.page.evaluate(() => Object.keys(window.fakeTree['Auto Phone'] || {}))).toEqual(['IMG_1001.jpg']);
  // Not sent twice; the next new one goes
  await phone.page.evaluate(() => window.addPhoto('IMG_1002.jpg', 30000));
  await phone.page.evaluate(() => window.PhotoBackup.autoHere([...peers.values()][0]));
  await expect.poll(() => pc.page.evaluate(() => Object.keys(window.fakeTree['Auto Phone'] || {}).sort())).toEqual(['IMG_1001.jpg', 'IMG_1002.jpg']);
  expect(JSON.parse(await phone.page.evaluate(() => localStorage.getItem('omnibeam-pbk-seen')))).toHaveLength(2);
  expect([...pc.errors, ...phone.errors]).toEqual([]);
});

test('automatic photo backup on a phone that can\'t read folders: a one-tap card when the computer is online', async ({ browser }) => {
  const noFolders = async (context) => context.addInitScript(() => { delete window.showDirectoryPicker; });
  const { a: pc, b: phone } = await pairedDevices(browser, ['Auto Laptop', 'Auto Phone'], { setup: noFolders });
  await more(phone.page, 'Auto Laptop', 'pbackup');
  const dlg = phone.page.locator('#dlg-pbk');
  await expect(dlg.locator('[data-k=auto-note]')).toContainText('can\'t see new photos by itself');
  await dlg.locator('[data-k=auto]').check();
  await expect(dlg.locator('[data-k=auto-note]')).toContainText('offers to back up your new photos with one tap');
  await dlg.locator('[data-act=close]').click();
  // 12 hours later the computer shows up: the card
  await phone.page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('omnibeam-pbk-auto'));
    localStorage.setItem('omnibeam-pbk-auto', JSON.stringify({ ...a, asked: Date.now() - 13 * 3600000 }));
    window.PhotoBackup.autoHere([...peers.values()][0]);
  });
  const c = phone.page.locator('#pbk-card');
  await expect(c).toContainText('Auto Laptop is online. Back up your new photos?');
  const chooser = phone.page.waitForEvent('filechooser');
  await c.locator('[data-v="1"]').click();
  await chooser;
  await expect(dlg).toBeVisible();
  expect([...pc.errors, ...phone.errors]).toEqual([]);
});

test('the new words are translated in all 15 languages, and are the words the app uses', async () => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'upgrades-1126.keys.json'), 'utf8'));
  const src = ['app.js', 'safety.js', 'board.js', 'ftools.js', 'pbackup.js', 'index.html', 'parts/info.html']
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
