// Request files by link: this device makes a link (⋯ menu, Request files), someone with no OmniBeam opens it in any
// browser, picks files, and they arrive here in Received files, end-to-end encrypted.
const { test, expect } = require('@playwright/test');
const { openDevice, makeFile, sha, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
// A plain browser with no OmniBeam set up: the person the link was sent to
async function visitor(browser, url) {
  const ctx = await browser.newContext();
  devices.push({ close: () => ctx.close() });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  return { page, errors };
}
async function makeLink(a, { ask = '', hours, max, pin } = {}) {
  await menu(a.page, 'btn-request');
  const dlg = a.page.locator('#dlg-asklink');
  await expect(dlg).toBeVisible();
  if (ask) await a.page.fill('#req-ask', ask);
  if (hours) await a.page.selectOption('#req-hours', String(hours));
  if (max) await a.page.selectOption('#req-max', String(max));
  if (pin) await a.page.fill('#req-pin', pin);
  await dlg.locator('[data-act=make]').click();
  await expect(a.page.locator('#req-done')).toBeVisible();
  const url = await a.page.locator('#req-url').textContent();
  expect(url).toMatch(/\/r\/[A-Za-z0-9_-]{16}#[A-Za-z0-9_-]{22}$/);
  return url;
}
// The newest received files on this device, with a hash of their bytes
async function received(page, n) {
  return page.evaluate(async (n) => Promise.all(History.items.slice(0, n).map(async (f) => {
    const blob = await History.blobOf(f);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { name: f.name, size: f.size, from: f.from, hash };
  })), n);
}

test('someone without OmniBeam sends files to a request link; they arrive here', async ({ browser }) => {
  const a = await open(browser, 'Yazeed PC');
  const url = await makeLink(a, { ask: 'The photos from Saturday', hours: 168, pin: '2468' });
  await expect(a.page.locator('#req-summary')).toContainText('“The photos from Saturday”');
  await expect(a.page.locator('#req-summary')).toContainText('PIN 2468');
  await expect(a.page.locator('#req-qr svg')).toBeVisible();
  const mail = decodeURIComponent(await a.page.locator('#req-email').getAttribute('href'));
  expect(mail).toContain(url);
  expect(mail).toContain('Yazeed PC asks you to send files');
  expect(mail).not.toContain('2468');
  await expect(a.page.locator('#req-list .item')).toHaveCount(1);
  await expect(a.page.locator('#req-list .fsize')).toContainText('0 uploads received');
  await a.page.locator('#dlg-asklink [data-act=close]').click();

  // The visitor: asked for the PIN, then sees who asks and for what
  const v = await visitor(browser, url);
  await expect(v.page.locator('#drop-pin')).toBeVisible();
  await v.page.fill('#drop-pin-input', '1111');
  await v.page.locator('#drop-pin button').click();
  await expect(v.page.locator('#drop-status')).toHaveText('Wrong PIN. 9 tries left.');
  await v.page.fill('#drop-pin-input', '2468');
  await v.page.locator('#drop-pin button').click();
  await expect(v.page.locator('#req-title')).toHaveText('Send files to Yazeed PC');
  await expect(v.page.locator('#req-ask')).toHaveText('The photos from Saturday');
  await expect(v.page.locator('#drop-status')).toContainText('Up to 100 MB at a time');
  await v.page.fill('#req-from', 'Sara');
  const files = [makeFile('beach.jpg', 5 * 1024 * 1024 + 123, 'image/jpeg'), makeFile('notes.txt', 2000, 'text/plain')];
  await v.page.setInputFiles('#req-input', files);
  await expect(v.page.locator('#drop-files li')).toHaveCount(2);
  await v.page.locator('#req-send').click();
  await expect(v.page.locator('#drop-status')).toHaveText('Sent ✓ Yazeed PC gets the files on their device.');
  await expect(v.page.locator('#req-more')).toBeVisible();

  // They arrive on the device that made the link, right away
  const got = a.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  await expect(got.locator('.who')).toHaveText('Sara (request link)');
  const list = await received(a.page, 2);
  const byName = Object.fromEntries(list.map((f) => [f.name, f]));
  expect(byName['beach.jpg'].hash).toBe(sha(files[0].buffer));
  expect(byName['notes.txt'].hash).toBe(sha(files[1].buffer));
  expect(byName['beach.jpg'].from).toBe('Sara (request link)');

  // Picked up, so deleted from the server; the link shows one upload
  const r = await a.page.evaluate(async () => {
    const l = JSON.parse(localStorage.getItem('omnibeam-requests'))[0];
    return (await fetch(`/api/request/${l.id}`, { headers: { 'X-Request-Token': l.token } })).json();
  });
  expect(r.files).toHaveLength(0);
  expect(r.uploads).toBe(1);
  expect(a.errors).toEqual([]);
  expect(v.errors).toEqual([]);
});

test('files sent while OmniBeam is closed arrive when it opens; upload limit; only the owner can download', async ({ browser }) => {
  const a = await open(browser, 'Yazeed Phone');
  const url = await makeLink(a, { max: 1 });
  const id = url.match(/\/r\/([^#]+)/)[1];
  // OmniBeam closed on the requesting device
  await a.page.goto('about:blank');
  a.errors.length = 0; // the test's start-up script can't use localStorage on about:blank

  const v = await visitor(browser, url);
  await expect(v.page.locator('#req-title')).toHaveText('Send files to Yazeed Phone');
  await expect(v.page.locator('#req-ask')).toBeHidden();
  const file = makeFile('contract.pdf', 70000, 'application/pdf');
  await v.page.setInputFiles('#req-input', [file]);
  await v.page.locator('#req-send').click();
  await expect(v.page.locator('#drop-status')).toContainText('Sent ✓');
  // That was the one upload allowed
  await expect(v.page.locator('#req-more')).toBeHidden();
  const again = await visitor(browser, url);
  await expect(again.page.locator('#drop-status')).toHaveText('This request link already got all the files it allows.');
  await expect(again.page.locator('#req-form')).toBeHidden();

  // Nobody but the requesting device can download it, or even see it
  const waiting = await v.page.evaluate(async (id) => {
    const info = await fetch(`/api/request/${id}`, { headers: { 'X-Request-Token': '0'.repeat(32) } });
    return info.status;
  }, id);
  expect(waiting).toBe(403);

  // OmniBeam opens again: the file arrives
  await a.page.goto('/');
  const got = a.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  await expect(got.locator('.who')).toHaveText('Request link');
  const [f] = await received(a.page, 1);
  expect(f.name).toBe('contract.pdf');
  expect(f.hash).toBe(sha(file.buffer));
  expect(a.errors).toEqual([]);
});

test('server: request uploads stay private and a deleted request link stops working', async ({ request }) => {
  const meta = 'A'.repeat(40);
  const made = await (await request.post('/api/request', { data: { hours: 1, max: 0, meta } })).json();
  expect(made.id).toBeTruthy();
  const up = await (await request.post(`/api/request/${made.id}/upload`, { data: { size: 10, meta: 'B'.repeat(60) } })).json();
  expect(up.part).toBe(4 * 1024 * 1024);
  expect((await request.put(`/api/drop/${up.id}/0`, { headers: { 'X-Drop-Token': up.token }, data: Buffer.alloc(26) })).status()).toBe(200);
  // Not visible as a shared link, and its data needs the request's token (not the uploader's)
  expect((await request.get(`/api/drop/${up.id}`)).status()).toBe(404);
  expect((await request.get(`/api/drop/${up.id}/data`)).status()).toBe(403);
  expect((await request.get(`/api/drop/${up.id}/data`, { headers: { 'X-Drop-Token': up.token } })).status()).toBe(403);
  const list = await (await request.get(`/api/request/${made.id}`, { headers: { 'X-Request-Token': made.token } })).json();
  expect(list.files.map((f) => f.id)).toEqual([up.id]);
  const data = await request.get(`/api/drop/${up.id}/data`, { headers: { 'X-Request-Token': made.token } });
  expect(data.status()).toBe(200);
  expect((await data.body()).length).toBe(26);
  // Downloaded once: gone
  expect((await request.get(`/api/drop/${up.id}/data`, { headers: { 'X-Request-Token': made.token } })).status()).toBe(404);
  // Delete the link: the upload page says it's gone
  expect((await request.delete(`/api/request/${made.id}`, { headers: { 'X-Request-Token': made.token } })).status()).toBe(200);
  expect((await request.get(`/api/request/${made.id}`)).status()).toBe(404);
  expect((await request.post(`/api/request/${made.id}/upload`, { data: { size: 10, meta: 'B'.repeat(60) } })).status()).toBe(404);
});

test('the request pages are translated', async ({ browser }) => {
  const a = await open(browser, 'Test PC', { storage: { 'omnibeam-lang': 'ar' } });
  await a.page.goto('/ar/');
  await a.page.locator('#btn-menu').click();
  await expect(a.page.locator('#btn-request')).toHaveText('اطلب ملفات');
  await a.page.locator('#btn-request').click();
  await expect(a.page.locator('#dlg-asklink h3')).toHaveText('اطلب ملفات');
  await a.page.locator('#dlg-asklink [data-act=make]').click();
  await expect(a.page.locator('#req-done')).toBeVisible();
  const url = await a.page.locator('#req-url').textContent();
  expect(url).toContain('/r/');
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('#req-title')).toHaveText('Envoyer des fichiers à Test PC');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
