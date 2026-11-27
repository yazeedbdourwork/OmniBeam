// 2026-11-27: send progress on a smartwatch (a phone shows send progress and "Sent" as notifications, which a watch
// mirrors), share link stats in the admin panel (most downloaded links, downloads by country) and share links in
// the weekly summary. Plus the new words in all 15 languages and the How to Use entry.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// Notifications are captured instead of shown (headless Chrome has no notification centre and says denied)
async function captureNotifications(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20000 });
  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    window.__notes = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) { window.__notes.push({ title, ...opts }); return Promise.resolve(); };
  });
}

test('a phone shows send progress and Sent as notifications (for a watch), and Settings turns it off', async ({ browser }) => {
  const phone = await open(browser, 'Watch Phone', { userAgent: ANDROID });
  const laptop = await open(browser, 'Watch Laptop');
  await captureNotifications(phone.page);
  await card(laptop.page, phone.name);
  await card(phone.page, laptop.name);
  // The receiver accepts by itself
  await laptop.page.evaluate(() => { window.__accept = setInterval(() => document.querySelector('#dlg-request[open] [data-act=accept]')?.click(), 100); });
  const send = async () => {
    await phone.page.evaluate(() => [...peers.values()].find((p) => p.info.name === 'Watch Laptop').sendFiles([new File([new Uint8Array(6 * 1024 * 1024)], 'watch-test.bin')]));
    await expect(laptop.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
    await laptop.page.locator('#dlg-received').evaluate((d) => d.close());
  };
  await send();
  await phone.page.waitForFunction(() => window.__notes.some((n) => n.title.startsWith('✓')));
  const notes = await phone.page.evaluate(() => window.__notes);
  const progress = notes.filter((n) => n.title === 'Sending to Watch Laptop');
  expect(progress.length).toBeGreaterThan(0);
  expect(progress[0]).toMatchObject({ tag: notes[0].tag, silent: true });
  expect(progress[0].body).toMatch(/^\d+% · /);
  const done = notes[notes.length - 1];
  expect(done.title).toBe('✓ Sent to Watch Laptop');
  expect(done.body).toBe('watch-test.bin · 6.0 MB');
  expect(done).toMatchObject({ silent: false, renotify: true });
  expect(new Set(notes.map((n) => n.tag)).size).toBe(1); // one notification, updated in place

  // Settings, Transfers, Smartwatch: off, and nothing more is shown
  await menu(phone.page, 'btn-settings');
  await settingsTab(phone.page, 'transfers');
  await expect(phone.page.locator('#watch-section')).toBeVisible();
  await expect(phone.page.locator('#watch-notes')).toBeChecked();
  await phone.page.locator('#watch-notes').uncheck();
  expect(await phone.page.evaluate(() => localStorage.getItem('omnibeam-watch-notes'))).toBe('off');
  await phone.page.locator('#dlg-settings').evaluate((d) => d.close());
  await phone.page.evaluate(() => { window.__notes = []; });
  await send();
  await phone.page.waitForTimeout(1000);
  expect(await phone.page.evaluate(() => window.__notes.length)).toBe(0);

  // A computer doesn't have the setting (watches mirror phones)
  await menu(laptop.page, 'btn-settings');
  await settingsTab(laptop.page, 'transfers');
  await expect(laptop.page.locator('#watch-section')).toBeHidden();
  expect([...phone.errors, ...laptop.errors]).toEqual([]);
});

test('admin panel: most downloaded share links and downloads by country; the weekly summary has share links', async ({ page, request }) => {
  const ip = { 'X-Forwarded-For': '203.0.113.81' };
  const make = async (pub) => {
    const c = await (await request.post('/api/drop', { headers: ip, data: { size: 100, hours: 1, meta: 'B'.repeat(40), ...(pub ? { pub: { title: pub } } : {}) } })).json();
    expect((await request.put(`/api/drop/${c.id}/0`, { headers: { ...ip, 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: Buffer.alloc(116, 3) })).ok()).toBe(true);
    return c;
  };
  const named = await make('Holiday photos');
  const secret = await make();
  // Opened and downloaded from Jordan (twice, from two networks) and Germany; the private one once from Jordan
  const download = async (c, cc, from) => {
    const info = await (await request.get(`/api/drop/${c.id}`, { headers: { 'CF-IPCountry': cc, 'X-Forwarded-For': from } })).json();
    const r = await request.post(`/api/drop/${c.id}/done`, { headers: { 'CF-IPCountry': cc, 'X-Forwarded-For': from, 'X-Drop-Key': info.k } });
    expect(r.ok()).toBe(true);
  };
  await download(named, 'JO', '198.51.100.1');
  await download(named, 'JO', '198.51.100.2');
  await download(named, 'DE', '198.51.100.3');
  await download(secret, 'JO', '198.51.100.4');

  const stats = await (await request.get('/api/stats?days=2', { headers: { Authorization: 'Bearer test-stats-key' } })).json();
  const today = new Date().toISOString().slice(0, 10);
  const mine = stats.links.find((l) => l.id === named.id);
  expect(mine).toMatchObject({ t: 'Holiday photos', s: 100, v: 3, live: true });
  expect(mine.dl[today]).toEqual({ JO: 2, DE: 1 });
  expect(stats.links.find((l) => l.id === secret.id).t).toBeUndefined();
  expect(stats.days[today].lc_JO).toBeGreaterThanOrEqual(3);

  await page.goto('/admin');
  await page.fill('#key', 'test-stats-key');
  await page.keyboard.press('Enter');
  await page.locator('#tab-transfers').click();
  const top = page.locator('#link-top tbody tr');
  await expect(top.first()).toContainText('Holiday photos');
  await expect(top.filter({ hasText: 'Holiday photos' })).toContainText('3');
  await expect(top.filter({ hasText: `/d/${secret.id.slice(0, 4)}` })).toContainText('Private file');
  await expect(page.locator('#link-countries')).toContainText('Jordan');
  await expect(page.locator('#link-countries')).toContainText('Germany');
  await expect(page.locator('#link-tiles')).toContainText('Downloads');

  // The weekly summary (preview in Settings, sent to the test outbox) has the share link line
  const weekly = await (await request.post('/api/stats/weekly-test', { headers: { Authorization: 'Bearer test-stats-key' } })).json();
  expect(weekly.preview.text).toMatch(/Share links: \d+ made/);
});

test('smartwatch words in all 15 languages, in the How to Use page and window', async ({ page, request }) => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'watch-linkstats.keys.json'), 'utf8'));
  const src = ['app.js', 'drop.js', 'index.html', 'parts/info.html']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
  for (const k of keys) expect(src.includes(k) || src.includes(k.replace(/"/g, '\\"')), `used: ${k}`).toBe(true);
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
  }
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    expect(html, code).toContain('<details id="watch">');
  }
  await page.goto('/de/how-to-use');
  await expect(page.locator('#watch summary')).toContainText('Smartwatch');
  const info = await (await request.get('/info-dialogs?lang=fr&v=13')).text();
  expect(info).toContain('Montre connectée :');
});
