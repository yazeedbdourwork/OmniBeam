// Share links as a file page (2026-11-24): short links, a row per file with its icon or small picture, previews
// before the download (links without a limit), Save all as ZIP, when it was shared and how many times it was opened
// and downloaded, a password with letters, WhatsApp / Telegram buttons, and chat previews (name and picture) only
// when the sender asks for them.
const fs = require('fs');
const zlib = require('zlib');
const { test, expect } = require('@playwright/test');
const { openDevice, makeFile, sha, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
// Every test browser is on one network, which may make only 20 links an hour (DROP_LINKS_PER_HOUR): the links here
// come from addresses of their own, so the other link tests still have theirs
const open = async (browser, name, ip) => {
  const d = await openDevice(browser, name);
  devices.push(d);
  await d.page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
  return d;
};

// A real PNG picture (w x h), so the page and the sender's thumbnail can draw it
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
// The files in a ZIP without compression: name -> bytes
function unzip(buf) {
  const out = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
    out[name] = { data: buf.subarray(start, start + size), crc: buf.readUInt32LE(at + 14) };
    at = start + size;
  }
  return out;
}
const crc32 = (b) => zlib.crc32 ? zlib.crc32(b) : null;

async function makeLink(page, files, setup = async () => {}) {
  await menu(page, 'btn-link');
  const dlg = page.locator('#dlg-link');
  await expect(dlg).toBeVisible();
  await setup(dlg);
  const chooser = page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles(files);
  await expect(page.locator('#link-done')).toBeVisible({ timeout: 60000 });
  return (await page.locator('#link-url').textContent()).replace(/^https?:\/\/[^/]+/, '');
}

test('a file page: short link, icons and pictures, preview before the download, ZIP, counts', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop', '203.0.113.71');
  const photo = { name: 'beach.png', mimeType: 'image/png', buffer: png(320, 200) };
  const text = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello from the file page\n'.repeat(10)) };
  const video = makeFile('holiday.mp4', 5 * 1024 * 1024 + 99, 'video/mp4'); // two parts: the text and photo are in part 0
  const zip = makeFile('old.zip', 3000, 'application/zip');
  const url = await makeLink(a.page, [photo, text, video, zip]);
  // Short: /d/ + 8 letters, then the key
  expect(url).toMatch(/^\/d\/[A-Za-z0-9_-]{8}#[A-Za-z0-9_-]{22}$/);
  // WhatsApp and Telegram buttons carry the link
  expect(decodeURIComponent(await a.page.locator('#link-wa').getAttribute('href'))).toContain(url);
  expect(decodeURIComponent(await a.page.locator('#link-tg').getAttribute('href'))).toContain(url);

  const ctx = await browser.newContext({ acceptDownloads: true });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const rows = page.locator('#drop-files li.f');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('beach.png');
  await expect(rows.nth(0)).toContainText('PNG');
  await expect(rows.nth(2)).toContainText('5.0 MB · MP4');
  // The photo's small picture, fetched and decrypted on its own (no download used)
  await expect(rows.nth(0).locator('.ic img')).toBeVisible();
  await expect.poll(() => rows.nth(0).locator('.ic img').evaluate((i) => i.naturalWidth)).toBe(320);
  // Preview buttons for what this browser can show; none for a ZIP
  await expect(rows.nth(1).locator('.pv')).toBeVisible();
  await expect(rows.nth(3).locator('.pv')).toHaveCount(0);
  await expect(page.locator('#drop-stats')).toContainText('Downloads: 0');
  await expect(page.locator('#drop-stats')).toContainText('Views: 1');
  await expect(page.locator('#drop-stats')).toContainText('Shared');
  await rows.nth(1).locator('.pv').click();
  await expect(page.locator('#drop-view')).toBeVisible();
  await expect(page.locator('#drop-view .dv-text')).toContainText('Hello from the file page');
  await page.locator('#drop-view-close').click();
  await expect(page.locator('#drop-view')).toBeHidden();
  await expect(page.locator('.drop-own')).toContainText('Send your own files with OmniBeam');

  // Download all: each file gets Save, and Save all as ZIP has every file, byte for byte
  await page.locator('#drop-get').click();
  await expect(page.locator('#drop-zip')).toBeVisible({ timeout: 30000 });
  await expect(rows.locator('a.save')).toHaveCount(4);
  await expect(page.locator('#drop-stats')).toContainText('Downloads: 1');
  const download = page.waitForEvent('download');
  await page.locator('#drop-zip').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^OmniBeam .*\.zip$/);
  const got = unzip(fs.readFileSync(await d.path()));
  expect(Object.keys(got)).toEqual(['beach.png', 'notes.txt', 'holiday.mp4', 'old.zip']);
  for (const f of [photo, text, video, zip]) {
    expect(sha(got[f.name].data)).toBe(sha(f.buffer));
    const want = crc32(f.buffer);
    if (want != null) expect(got[f.name].crc).toBe(want);
  }

  // The sender sees the views and the download under "Your links"
  await a.page.locator('#dlg-link [data-act=close]').click();
  await menu(a.page, 'btn-link');
  await expect(a.page.locator('#link-list .fsize')).toContainText('1 download');
  await expect(a.page.locator('#link-list .fsize')).toContainText('Views: 1');
  expect(errors).toEqual([]);
  expect(a.errors).toEqual([]);
});

test('share link server: parts of a link for previews, not counted, and not for limited links', async ({ request }) => {
  const meta = 'A'.repeat(40);
  const make = async (opts) => {
    const c = await (await request.post('/api/drop', { headers: { 'X-Forwarded-For': '203.0.113.73' }, data: { size: 100, hours: 1, meta, ...opts } })).json();
    expect((await request.put(`/api/drop/${c.id}/0`, { headers: { 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: Buffer.alloc(116, 7) })).ok()).toBe(true);
    return c;
  };
  const free = await make({});
  expect(free.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  const part = await request.get(`/api/drop/${free.id}/data`, { headers: { Range: 'bytes=10-19' } });
  expect(part.status()).toBe(206);
  expect((await part.body()).length).toBe(10);
  let info = await (await request.get(`/api/drop/${free.id}`)).json();
  expect(info).toMatchObject({ downloads: 0, views: 1 });
  expect(info.created).toBeGreaterThan(Date.now() - 60000);
  expect((await request.get(`/api/drop/${free.id}/data`)).status()).toBe(200);
  const owner = async (c) => (await request.get(`/api/drop/${c.id}`, { headers: { 'X-Drop-Token': c.token } })).json();
  await expect.poll(async () => (await owner(free)).downloads).toBe(1);
  expect((await owner(free)).views).toBe(1);
  // A link with a download limit: a Range is ignored (the whole download, counted)
  const two = await make({ max: 2 });
  const whole = await request.get(`/api/drop/${two.id}/data`, { headers: { Range: 'bytes=0-9' } });
  expect(whole.status()).toBe(200);
  expect((await whole.body()).length).toBe(116);
  await expect.poll(async () => (await owner(two)).downloads).toBe(1);
});

test('chat previews only when asked: name and picture in the page tags, never with a PIN', async ({ browser, request }) => {
  const a = await open(browser, 'Test Laptop', '203.0.113.72');
  const photo = { name: 'party <night>.png', mimeType: 'image/png', buffer: png(900, 600) };
  // Not ticked: the general title, and the server has no name
  const plain = await makeLink(a.page, [photo]);
  let html = await (await request.get(plain.split('#')[0])).text();
  expect(html).toContain('<meta property="og:title" content="Files shared with you on OmniBeam">');
  expect(html).not.toContain('party');
  // Ticked: the name (escaped) and a small JPEG
  await a.page.locator('#dlg-link [data-act=close]').click();
  const shown = await makeLink(a.page, [photo], async (dlg) => {
    await expect(dlg.locator('#link-pub-box')).toBeVisible();
    await dlg.locator('#link-pub').check();
  });
  const id = shown.split('#')[0].split('/').pop();
  html = await (await request.get(`/d/${id}`)).text();
  expect(html).toContain('content="party &lt;night&gt;.png (');
  expect(html).toContain(`/api/drop/${id}/thumb`);
  const thumb = await request.get(`/api/drop/${id}/thumb`);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()['content-type']).toBe('image/jpeg');
  expect((await thumb.body()).length).toBeLessThan(110000);
  // With a password (letters too): no preview, and the box is hidden
  await a.page.locator('#dlg-link [data-act=close]').click();
  const locked = await makeLink(a.page, [photo], async (dlg) => {
    await a.page.fill('#link-pin', 'blue-Fox9');
    await expect(dlg.locator('#link-pub-box')).toBeHidden();
  });
  html = await (await request.get(locked.split('#')[0])).text();
  expect(html).not.toContain('party');
  // The receiver opens it with the password
  const ctx = await browser.newContext();
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(locked);
  await expect(page.locator('#drop-pin')).toBeVisible();
  await page.fill('#drop-pin-input', 'blue-fox9');
  await page.locator('#drop-pin button').click();
  await expect(page.locator('#drop-status')).toHaveText('Wrong PIN. 9 tries left.');
  await page.fill('#drop-pin-input', 'blue-Fox9');
  await page.locator('#drop-pin button').click();
  await expect(page.locator('#drop-files')).toContainText('party <night>.png');
  expect(a.errors).toEqual([]);
});
