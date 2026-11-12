// Upgrades of 2026-11-12: event photo albums (one QR code, guests add photos and see everyone's, the host saves them
// all) and Share a folder / Browse files (a phone looks in a folder on a paired computer and takes files from it)
const zlib = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, card, sha, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
// A guest's phone: just the album page in its own browser profile
async function guestPage(browser, url) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('omnibeam-lang', 'en'));
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  const d = { context, page, errors, close: () => context.close() };
  devices.push(d);
  return d;
}

// A small real PNG picture (w x h, one colour), so the album page can make its small picture
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('event album: guests add photos and see everyone\'s, everything encrypted, the host stops uploads, saves all, deletes', async ({ browser, request }) => {
  const host = await open(browser, 'Test Laptop');
  await menu(host.page, 'btn-album');
  const dlg = host.page.locator('#dlg-album');
  await expect(dlg).toBeVisible();
  // A name is needed
  await dlg.locator('[data-act=make]').click();
  await expect(dlg.locator('#album-new')).toBeVisible();
  await host.page.fill('#album-name', 'Sara and Omar\'s wedding');
  await dlg.locator('[data-act=make]').click();
  await expect(dlg.locator('#album-done')).toBeVisible();
  await expect(dlg.locator('#album-qr svg')).toBeVisible();
  const url = await dlg.locator('#album-url').textContent();
  expect(url).toMatch(/\/e\/[A-Za-z0-9_-]+#[A-Za-z0-9_-]{22}$/);
  await expect(dlg.locator('#album-list .item')).toHaveCount(1);
  const saved = await host.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-albums'))[0]);
  const id = saved.id;
  // The server only has the name encrypted
  const raw = await (await request.get(`/api/album/${id}`)).json();
  expect(JSON.stringify(raw)).not.toContain('wedding');
  expect(raw.host).toBe(false);

  // A guest opens the link, adds two photos
  const guest = await guestPage(browser, url);
  await expect(guest.page.locator('#ev-title')).toHaveText('Sara and Omar\'s wedding');
  await expect(guest.page.locator('#ev-status')).toContainText('No photos yet');
  await expect(guest.page.locator('#ev-host')).toBeHidden();
  const red = png(64, 48, [220, 30, 30]);
  const blue = png(40, 40, [30, 30, 220]);
  await guest.page.fill('#ev-from', 'Lina');
  await guest.page.setInputFiles('#ev-input', [
    { name: 'red.png', mimeType: 'image/png', buffer: red },
    { name: 'blue.png', mimeType: 'image/png', buffer: blue },
  ]);
  await expect(guest.page.locator('#ev-status')).toContainText('2 photos added');
  await expect(guest.page.locator('#ev-grid li img')).toHaveCount(2);
  await expect(guest.page.locator('#ev-grid li .mine')).toHaveCount(2);

  // On the server: two items, encrypted (neither the bytes nor the names are there as they are)
  const after = await (await request.get(`/api/album/${id}`)).json();
  expect(after.items).toHaveLength(2);
  expect(JSON.stringify(after)).not.toContain('red.png');
  const stored = await (await request.get(`/api/album/${id}/${after.items[0].n}/full`)).body();
  expect(stored.includes(red.subarray(16, 48))).toBe(false);
  expect(stored.includes(blue.subarray(16, 48))).toBe(false);

  // Another guest sees them, opens one and saves it: the same bytes
  const other = await guestPage(browser, url);
  await expect(other.page.locator('#ev-grid li img')).toHaveCount(2);
  await expect(other.page.locator('#ev-status')).toContainText('2 photos');
  await other.page.locator('#ev-grid li button').last().click(); // oldest: red
  const view = other.page.locator('#ev-view');
  await expect(view).toBeVisible();
  await expect(view.locator('#ev-view-who')).toContainText('Added by Lina');
  await expect(view.locator('#ev-view-media img')).toBeVisible();
  await expect(view.locator('[data-act=delete]')).toBeHidden(); // not theirs
  const dl = other.page.waitForEvent('download');
  await view.locator('[data-act=save]').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('red.png');
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(red));
  await view.locator('[data-act=close]').click();
  // Deleting someone else's photo: refused by the server
  expect((await request.delete(`/api/album/${id}/${after.items[0].n}`)).status()).toBe(403);

  // The guest deletes one of their own
  guest.page.once('dialog', (dd) => dd.accept());
  await guest.page.locator('#ev-grid li button').first().click();
  await guest.page.locator('#ev-view [data-act=delete]').click();
  await expect(guest.page.locator('#ev-grid li')).toHaveCount(1);

  // The host's page: host tools, Save all as a ZIP, stop taking photos
  const hostPage = await host.context.newPage();
  await hostPage.goto(`/e/${id}#${saved.key}.${saved.token}`);
  await expect(hostPage.locator('#ev-host')).toBeVisible();
  // The token never stays in the address (a copied link must not carry it)
  expect(hostPage.url()).not.toContain(saved.token);
  await expect(hostPage.locator('#ev-grid li')).toHaveCount(1);
  const zipDl = hostPage.waitForEvent('download');
  await hostPage.locator('#ev-save-all').click();
  const zip = fs.readFileSync(await (await zipDl).path());
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.includes(Buffer.from('red.png'))).toBe(true);
  expect(zip.includes(red)).toBe(true);
  await hostPage.locator('#ev-open').click();
  await expect(hostPage.locator('#ev-open')).toHaveText('Take photos again');
  await expect(hostPage.locator('#ev-add')).toBeHidden();
  const closed = await request.post(`/api/album/${id}/add`, { headers: { 'X-Album-Size': '40', 'X-Thumb-Size': '0', 'X-Album-Meta': 'a'.repeat(40) }, data: Buffer.alloc(40) });
  expect(closed.status()).toBe(403);
  await other.page.reload();
  await expect(other.page.locator('#ev-grid li')).toHaveCount(1);
  await expect(other.page.locator('#ev-add')).toBeHidden();

  // Print poster: a page with the QR code
  const poster = await host.context.newPage();
  await poster.addInitScript(() => { window.print = () => { window.printed = true; }; });
  await poster.goto(`/e/${id}?poster=1#${saved.key}`);
  await expect(poster.locator('#ev-poster-qr svg')).toBeVisible();
  await expect(poster.locator('#ev-poster-title')).toHaveText('Sara and Omar\'s wedding');
  await expect.poll(() => poster.evaluate(() => window.printed === true)).toBe(true);

  // Delete the album: gone for everyone
  hostPage.once('dialog', (dd) => dd.accept());
  await hostPage.locator('#ev-delete').click();
  await expect(hostPage.locator('#ev-status')).toHaveText('Album deleted');
  expect((await request.get(`/api/album/${id}`)).status()).toBe(404);
  await other.page.reload();
  await expect(other.page.locator('#ev-status')).toHaveText('This album has ended or was deleted.');
  for (const x of [host, guest, other]) expect(x.errors).toEqual([]);
});

test('event album: a link without its key, bad uploads and limits are refused', async ({ request, page }) => {
  await page.goto('/e/AAAAAAAAAAAAAAAA');
  await expect(page.locator('#ev-status')).toContainText('This link is incomplete');
  expect((await request.post('/api/album', { data: { days: 7, meta: 'short' } })).status()).toBe(400);
  const made = await request.post('/api/album', { data: { days: 99, meta: 'x'.repeat(40) } });
  expect(made.status()).toBe(200);
  const a = await made.json();
  expect(a.expires - Date.now()).toBeLessThanOrEqual(30 * 86400000 + 5000); // at most 30 days
  // The size header must match the body; the small picture must fit inside it
  const add = (headers, body) => request.post(`/api/album/${a.id}/add`, { headers: { 'X-Album-Meta': 'm'.repeat(40), ...headers }, data: body });
  expect((await add({ 'X-Album-Size': '10', 'X-Thumb-Size': '0' }, Buffer.alloc(100))).status()).toBe(400);
  expect((await add({ 'X-Album-Size': '100', 'X-Thumb-Size': '100' }, Buffer.alloc(100))).status()).toBe(400);
  expect((await add({ 'X-Album-Size': String(200 * 1048576), 'X-Thumb-Size': '0' }, Buffer.alloc(100))).status()).toBe(413);
  const ok = await add({ 'X-Album-Size': '100', 'X-Thumb-Size': '20' }, crypto.randomBytes(100));
  expect(ok.status()).toBe(200);
  const { n, del } = await ok.json();
  expect((await request.get(`/api/album/${a.id}/${n}/thumb`)).body().then((b) => b.length)).resolves.toBe(20);
  expect((await (await request.get(`/api/album/${a.id}/${n}/full`)).body()).length).toBe(80);
  // Only the host stops uploads or deletes the album; the uploader deletes their own photo
  expect((await request.post(`/api/album/${a.id}/settings`, { data: { open: false } })).status()).toBe(403);
  expect((await request.delete(`/api/album/${a.id}`)).status()).toBe(403);
  expect((await request.delete(`/api/album/${a.id}/${n}`, { headers: { 'X-Album-Del': del } })).status()).toBe(200);
  expect((await request.delete(`/api/album/${a.id}`, { headers: { 'X-Album-Token': a.token } })).status()).toBe(200);
});

// A folder for the computer's tests, in place of the browser's folder picker (which a test can't click)
function fakeFolder() {
  const make = (name, tree) => ({
    kind: 'directory', name,
    async *entries() {
      for (const [n, v] of Object.entries(tree)) yield [n, typeof v === 'string' ? fileHandle(n, v) : make(n, v)];
    },
    async getDirectoryHandle(n) { if (typeof tree[n] !== 'object') throw new DOMException('no', 'NotFoundError'); return make(n, tree[n]); },
    async getFileHandle(n) { if (typeof tree[n] !== 'string') throw new DOMException('no', 'NotFoundError'); return fileHandle(n, tree[n]); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  const fileHandle = (n, text) => ({ kind: 'file', name: n, async getFile() { return new File([text], n, { type: 'text/plain', lastModified: 1700000000000 }); } });
  const tree = { 'notes.txt': 'shopping list', '.secret': 'hidden', 'day 1': { 'beach.txt': 'sun and sea '.repeat(500), 'boat.txt': 'boat' } };
  window.showDirectoryPicker = async () => make('Holiday', tree);
}

test('browse my computer: a paired phone looks in a shared folder and takes files; only ticked devices; nothing outside it', async ({ browser }) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const pc = await open(browser, 'Test Laptop', { storage: { 'omnibeam-paired': paired('Test Phone') } });
  await pc.page.evaluate(fakeFolder);
  const phone = await open(browser, 'Test Phone', { storage: { 'omnibeam-paired': paired('Test Laptop') } });
  await expect((await card(pc.page, 'Test Phone')).locator('.tag')).toHaveText('Trusted');
  await expect((await card(phone.page, 'Test Laptop')).locator('.tag')).toHaveText('Trusted');

  // Not shared yet: the phone is told how
  const laptop = await card(phone.page, 'Test Laptop');
  await laptop.hover();
  await laptop.locator('[data-act=more]').click();
  await phone.page.locator('#dlg-actions [data-act=browse]').click();
  const look = phone.page.locator('#dlg-browse');
  await expect(look).toBeVisible();
  await expect(look.locator('.fs-msg')).toContainText('isn\'t sharing a folder');

  // The computer shares a folder: its trusted phone is ticked already
  await menu(pc.page, 'btn-fshare');
  const share = pc.page.locator('#dlg-fshare');
  await expect(share.locator('.fs-state')).toHaveText('Not sharing a folder.');
  await share.locator('[data-act=pick]').click();
  await expect(share.locator('.fs-state')).toHaveText('Sharing: Holiday');
  await expect(share.locator('input[data-secret]')).toBeChecked();
  await share.locator('[data-act=close]').click();

  // The phone looks: folders first, nothing starting with "."
  await look.locator('[data-act=close]').click();
  await laptop.hover();
  await laptop.locator('[data-act=more]').click();
  await phone.page.locator('#dlg-actions [data-act=browse]').click();
  await expect(look.locator('.fs-list li')).toHaveCount(2);
  await expect(look.locator('.fs-list li').first()).toContainText('day 1');
  await expect(look.locator('.fs-list')).not.toContainText('.secret');
  await expect(look.locator('.fs-crumb')).toHaveText('Holiday');
  await expect(pc.page.locator('#toast')).toContainText('Test Phone is looking at your shared folder');
  await look.locator('[data-act=dir]').click();
  await expect(look.locator('.fs-crumb')).toHaveText('Holiday / day 1');
  await expect(look.locator('.fs-list li')).toHaveCount(2);
  await look.locator('.fs-search').fill('bea');
  await expect(look.locator('.fs-list li')).toHaveCount(1);
  await look.locator('.fs-list input').check();
  await expect(look.locator('[data-act=get]')).toHaveText('Get file');
  await look.locator('[data-act=get]').click();
  // It arrives without asking: the phone asked for it
  const got = phone.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  await expect(phone.page.locator('#dlg-request')).toBeHidden();
  const dl = phone.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('beach.txt');
  expect(fs.readFileSync(await file.path(), 'utf8')).toBe('sun and sea '.repeat(500));

  // Nothing outside the folder, and no files the phone didn't ask for
  const answers = await phone.page.evaluate(async () => {
    const p = [...peers.values()].find((x) => x.info.name === 'Test Laptop');
    const seen = [];
    const real = window.Browse.onMsg;
    window.Browse.onMsg = (peer, msg) => { seen.push(msg); };
    p.sendJson({ t: 'fs-ls', path: '../..' });
    p.sendJson({ t: 'fs-ls', path: '.secret' });
    await new Promise((r) => setTimeout(r, 1500));
    window.Browse.onMsg = real;
    return seen;
  });
  expect(answers.map((m) => m.t + ':' + m.why)).toEqual(['fs-no:gone', 'fs-no:gone']);

  // Untick the phone: it can't look any more
  await menu(pc.page, 'btn-fshare');
  await share.locator('input[data-secret]').uncheck();
  await share.locator('[data-act=close]').click();
  await look.locator('[data-act=up]').click();
  await expect(look.locator('.fs-msg')).toContainText('not with this device');
  for (const x of [pc, phone]) expect(x.errors).toEqual([]);
});
