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
  // The window asks the computer first and says whether it's ready (data-s ok or no)
  const openDlg = async () => {
    await laptop.hover();
    await laptop.locator('[data-act=more]').click();
    await phone.page.locator('#dlg-actions [data-act=pbackup]').click();
    const dlg = phone.page.locator('#dlg-pbk');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#pbk-title')).toHaveText('Back up photos to Test Laptop');
    await expect(dlg.locator('[data-k=ready]')).toHaveAttribute('data-s', /^(ok|no)$/);
    return dlg;
  };
  const pick = async (files) => {
    const dlg = await openDlg();
    await expect(dlg.locator('[data-k=ready]')).toHaveText('Ready: photos go into Backups on Test Laptop.');
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

  // Not set up on the computer yet: the phone says so before anything is chosen, and the computer offers the fix
  let dlg = await openDlg();
  await expect(dlg.locator('[data-k=ready]')).toContainText('isn\'t set up for photo backup');
  await expect(dlg.locator('[data-act=pick]')).toBeDisabled();
  await expect(pc.page.locator('#pbk-card')).toContainText('Test Phone wants to back up its photos on this computer.');
  await pc.page.locator('#pbk-card [data-v="0"]').click(); // Later: here it's turned on from the menu instead
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
  await expect(dlg.locator('.pbk-msg')).toHaveText('Done: 2 new photos backed up to Test Laptop.', { timeout: 30000 });
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
  dlg = await openDlg();
  await expect(dlg.locator('[data-k=ready]')).toContainText('but not from this device');
  await expect(dlg.locator('[data-act=pick]')).toBeDisabled();

  // A file the computer didn't ask for still needs a tap: a made-up want is not accepted by itself
  const auto = await pc.page.evaluate(() => window.PhotoBackup.wanted([...peers.values()][0].info.id, 'f'.repeat(32), [{ size: 1 }]));
  expect(auto).toBeNull();
  for (const x of [pc, phone]) expect(x.errors).toEqual([]);
});

test('photo backup: one tap on the computer\'s card sets it up, and the phone shows it ready, the progress and Done', async ({ browser }) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const pc = await open(browser, 'Card Laptop', { storage: { 'omnibeam-paired': paired('Card Phone') } });
  await pc.page.evaluate(fakeFolder, {});
  const phone = await open(browser, 'Card Phone', { storage: { 'omnibeam-paired': paired('Card Laptop') } });
  const laptop = await card(phone.page, 'Card Laptop');
  await laptop.hover();
  await laptop.locator('[data-act=more]').click();
  await phone.page.locator('#dlg-actions [data-act=pbackup]').click();
  const dlg = phone.page.locator('#dlg-pbk');
  await expect(dlg.locator('[data-k=ready]')).toContainText('Or tap the card that just appeared on Card Laptop.');
  await expect(dlg.locator('[data-act=pick]')).toBeDisabled();
  // On the computer: Choose backup folder on the card (no folder yet); the phone is ticked and told at once
  const c = pc.page.locator('#pbk-card');
  await expect(c.locator('[data-v="1"]')).toHaveText('Choose backup folder');
  await c.locator('[data-v="1"]').click();
  await expect(c).toBeHidden();
  await expect(dlg.locator('[data-k=ready]')).toHaveText('Ready: photos go into Backups on Card Laptop.');
  await expect(dlg.locator('[data-act=pick]')).toBeEnabled();
  const chooser = phone.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([{ name: 'IMG_0100.JPG', mimeType: 'image/jpeg', buffer: crypto.randomBytes(400000) }]);
  await expect(dlg.locator('.pbk-msg')).toHaveText('Done: 1 new photos backed up to Card Laptop.', { timeout: 30000 });
  await expect(dlg.locator('progress')).toBeHidden();
  await expect.poll(() => pc.page.evaluate(() => Object.keys(window.fakeTree['Card Phone'] || {}))).toEqual(['IMG_0100.JPG']);
  await dlg.locator('[data-act=close]').click();
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
    expect(p, code).toContain('<details id="photo-backup">');
  }
  // The menu item is there on a computer
  await page.goto('/');
  await page.locator('#btn-menu').click();
  await expect(page.locator('#btn-pbackup')).toBeVisible();
});
