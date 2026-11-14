// Upgrade of 2026-11-14: photo backup that skips repeats. A paired phone chooses photos; the computer answers which
// ones its backup folder doesn't have yet (same photo under another name, or the same name and size, count as had),
// and only those are sent, as they are, into a subfolder named after the phone.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// A folder the computer can write into, in place of the browser's folder picker (which a test can't click).
// Its files are in window.fakeTree, so the test can look at what was written.
function fakeFolder(files) {
  const tree = {};
  for (const [p, b64] of Object.entries(files)) {
    const parts = p.split('/');
    let d = tree;
    for (const x of parts.slice(0, -1)) d = d[x] = d[x] || {};
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    d[parts[parts.length - 1]] = new File([bin], parts[parts.length - 1], { lastModified: 1700000000000 });
  }
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
    async getDirectoryHandle(n, o) {
      if (!(n in dir) && o?.create) dir[n] = {};
      if (!dir[n] || dir[n] instanceof File) throw notFound();
      return make(n, dir[n]);
    },
    async getFileHandle(n, o) {
      if (!(n in dir) && o?.create) dir[n] = new File([], n);
      if (!(dir[n] instanceof File)) throw notFound();
      return fileHandle(dir, n);
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => make('Backups', tree);
}

test('photo backup: the phone sends only the photos the computer doesn\'t have, into a folder named after the phone', async ({ browser }) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  // Four photos on the phone: A is on the computer under another name, B has the same name and size there, C and D
  // are new, and D is picked twice
  const A = crypto.randomBytes(300000);
  const B = crypto.randomBytes(5000);
  const C = crypto.randomBytes(200000);
  const D = crypto.randomBytes(1200);
  const pc = await open(browser, 'Test Laptop', { storage: { 'omnibeam-paired': paired('Test Phone') } });
  await pc.page.evaluate(fakeFolder, {
    'old phone/IMG_0001 copy.jpg': A.toString('base64'),
    'IMG_0002.JPG': crypto.randomBytes(5000).toString('base64'), // same name and size as B, other bytes
    'notes.txt': Buffer.from('hello').toString('base64'),
  });
  const phone = await open(browser, 'Test Phone', { storage: { 'omnibeam-paired': paired('Test Laptop') } });
  await expect((await card(phone.page, 'Test Laptop')).locator('.tag')).toHaveText('Trusted');
  await expect((await card(pc.page, 'Test Phone')).locator('.tag')).toHaveText('Trusted');

  const laptop = await card(phone.page, 'Test Laptop');
  const pick = async (files) => {
    await laptop.hover();
    await laptop.locator('[data-act=more]').click();
    await phone.page.locator('#dlg-actions [data-act=pbackup]').click();
    const dlg = phone.page.locator('#dlg-pbk');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#pbk-title')).toHaveText('Back up photos to Test Laptop');
    const chooser = phone.page.waitForEvent('filechooser');
    await dlg.locator('[data-act=pick]').click();
    await (await chooser).setFiles(files);
    return dlg;
  };
  const photos = [
    { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: A },
    { name: 'IMG_0002.JPG', mimeType: 'image/jpeg', buffer: B },
    { name: 'IMG_0003.JPG', mimeType: 'image/jpeg', buffer: C },
    { name: 'IMG_0004.HEIC', mimeType: 'image/heic', buffer: D },
  ];

  // Not set up on the computer yet: the phone is told how
  let dlg = await pick(photos);
  await expect(dlg.locator('.pbk-msg')).toContainText('isn\'t set up for photo backup');
  await dlg.locator('[data-act=close]').click();

  // The computer turns it on: its trusted phone is ticked already
  await menu(pc.page, 'btn-pbackup');
  const set = pc.page.locator('#dlg-pbackup');
  await expect(set.locator('.fs-state')).toHaveText('Photo backup is off.');
  await set.locator('[data-act=pick]').click();
  await expect(set.locator('.fs-state')).toHaveText('Backing up into: Backups');
  await expect(set.locator('input[data-secret]')).toBeChecked();
  await set.locator('[data-act=close]').click();

  // Only C and D go (D once), as they are, and the computer saves them without asking or showing them
  dlg = await pick([...photos, { name: 'IMG_0004.HEIC', mimeType: 'image/heic', buffer: D }]);
  await expect(dlg.locator('.pbk-msg')).toHaveText('Sending 2 new photos. 3 are already on Test Laptop.');
  await expect(pc.page.locator('#toast')).toContainText('Backed up 2 new photos from Test Phone into Backups/Test Phone', { timeout: 30000 });
  await expect(pc.page.locator('#dlg-request')).toBeHidden();
  await expect(pc.page.locator('#dlg-received')).toBeHidden();
  const written = await pc.page.evaluate(async () => {
    const out = {};
    for (const [n, f] of Object.entries(window.fakeTree['Test Phone'] || {})) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      out[n] = btoa(s);
    }
    return out;
  });
  expect(Object.keys(written).sort()).toEqual(['IMG_0003.JPG', 'IMG_0004.HEIC']);
  expect(Buffer.from(written['IMG_0003.JPG'], 'base64').equals(C)).toBe(true);
  expect(Buffer.from(written['IMG_0004.HEIC'], 'base64').equals(D)).toBe(true);
  await dlg.locator('[data-act=close]').click();

  // The next backup sends nothing: everything is there now
  dlg = await pick(photos);
  await expect(dlg.locator('.pbk-msg')).toHaveText('All 4 are already on Test Laptop. Nothing to send.');
  await expect(dlg.locator('[data-k=last]')).toContainText('Last backup:');
  await dlg.locator('[data-act=close]').click();

  // Untick the phone on the computer: it can't back up there any more
  await menu(pc.page, 'btn-pbackup');
  await expect(set.locator('[data-k=kept]')).toHaveText('2 photos backed up here so far');
  await set.locator('input[data-secret]').uncheck();
  await set.locator('[data-act=close]').click();
  dlg = await pick(photos);
  await expect(dlg.locator('.pbk-msg')).toContainText('but not from this device');

  // A file the computer didn't ask for still needs a tap: a made-up want is not accepted by itself
  const auto = await pc.page.evaluate(() => window.PhotoBackup.wanted([...peers.values()][0].info.id, 'f'.repeat(32), [{ size: 1 }]));
  expect(auto).toBeNull();
  for (const x of [pc, phone]) expect(x.errors).toEqual([]);
});

test('photo backup: shown in the menu and device window, and every new text is translated in all 15 languages', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  expect(html).toContain('id="btn-pbackup"');
  expect(html).toContain('data-act="pbackup"');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'pbackup.js'), 'utf8');
  const keys = new Set([...src.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\'/g, '\'')));
  keys.add('Photo backup'); keys.add('Back up photos'); keys.add('Photo backup:');
  const dir = path.join(__dirname, '..', 'public', 'lang');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const lang = require(path.join(dir, f));
    const missing = [...keys].filter((k) => !(k in lang.strings));
    expect(missing, `${f} is missing`).toEqual([]);
    for (const k of keys) {
      const want = [...k.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
      expect([...lang.strings[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), `${f}: ${k}`).toEqual(want);
    }
  }
  // The How to Use page has it in every language
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const p = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    expect(p, code).toContain('<h2>38. ');
  }
  // The menu item is there on a computer
  await page.goto('/');
  await page.locator('#btn-menu').click();
  await expect(page.locator('#btn-pbackup')).toBeVisible();
});
