// TV mode (omnibeam.site/tv) and automatic error reports (tab crashes and stuck transfers on /stats and Telegram).
// The test server writes Telegram alerts to tests/.data/instant.jsonl instead of sending them (playwright.config.js).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

const INSTANT = path.join(__dirname, '.data', 'instant.jsonl');
const instant = () => { try { return fs.readFileSync(INSTANT, 'utf8'); } catch { return ''; } };
// A real (tiny) PNG, so the TV can show it
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');
const stats = (request) => request.get('/api/stats?days=2', { headers: { Authorization: 'Bearer test-stats-key' } }).then((r) => r.json());

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

test('TV mode: big QR code, a phone scans it, its photos play as a slideshow without asking', async ({ browser }) => {
  const tv = await open(browser, 'Living room TV', { path: '/tv' });
  const p = tv.page;
  await expect(p.locator('html')).toHaveClass(/\btv\b/);
  await expect(p.locator('#tv')).toBeVisible();
  // Receive-only: no sending, no menu, no device cards
  await expect(p.locator('header .actions')).toBeHidden();
  await expect(p.locator('#peers')).toBeHidden();
  await expect(p.locator('#tv-qr svg')).toBeVisible();
  // The code opens the normal app (not TV mode) on the phone
  await expect(p.locator('#tv-qr')).toHaveAttribute('data-link', /&n=Living%20room%20TV$/);
  const link = await p.locator('#tv-qr').getAttribute('data-link');
  expect(link).toMatch(/^http:\/\/localhost:\d+\/#qr=[0-9a-f]{64}&n=Living%20room%20TV$/);
  await expect(p.locator('#tv-peers')).toHaveText('No phone connected yet');

  const phone = await open(browser, 'Phone', { path: link.replace(/^http:\/\/localhost:\d+/, '') });
  await expect(phone.page.locator('#toast')).toContainText('Paired with Living room TV', { timeout: 15000 });
  await expect(p.locator('#tv-peers')).toHaveText('Connected: Phone');
  // A new code is ready for the next phone right away
  await expect.poll(() => p.locator('#tv-qr').getAttribute('data-link')).not.toBe(link);

  // The phone sends two photos and a document; the TV takes them by itself (paired) and plays the photos
  const target = await card(phone.page, 'Living room TV');
  const chooser = phone.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  await expect(p.locator('#tv-show')).toBeVisible({ timeout: 30000 });
  await expect(p.locator('#dlg-request')).toBeHidden();
  await expect(p.locator('#dlg-received')).toBeHidden();
  await expect(p.locator('#tv-stage img')).toBeVisible();
  expect(await p.locator('#tv-stage img').evaluate((img) => img.complete && img.naturalWidth)).toBe(2);
  await expect(p.locator('#tv-caption')).toHaveText('1 / 2 · from Phone');
  await expect(p.locator('#toast')).toContainText('Other files received: 1.');
  // The remote: ▶ next, OK pauses, Back returns to the QR code
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('#tv-caption')).toHaveText('2 / 2 · from Phone');
  await p.keyboard.press('Enter');
  await expect(p.locator('#tv-caption')).toHaveText('2 / 2 · from Phone · Paused');
  await p.keyboard.press('Escape');
  await expect(p.locator('#tv-show')).toBeHidden();
  await expect(p.locator('#tv-photos')).toHaveText('Show photos (2)');
  await p.locator('#tv-photos').click();
  await expect(p.locator('#tv-show')).toBeVisible();
  expect(tv.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('TV mode in other languages, and its address', async ({ page, request }) => {
  const r = await request.get('/tv/', { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers().location).toBe('/tv');
  const tv = await request.get('/tv');
  expect(tv.headers()['x-robots-tag']).toBe('noindex');
  expect(await tv.text()).toContain('<title>TV mode · OmniBeam</title>');
  await page.goto('/ar/tv');
  await expect(page).toHaveTitle('وضع التلفاز · OmniBeam');
  await expect(page.locator('#tv-title')).toHaveText('أرسل الصور إلى هذا التلفاز');
  // The ⋯ menu on the normal app links to TV mode in the page's language
  await page.goto('/ar/');
  await expect(page.locator('#menu-tv')).toHaveAttribute('href', '/ar/tv');
});

test('a tab that crashed and a stuck transfer are reported to /stats and Telegram', async ({ browser, request }) => {
  const a = await open(browser, 'Sender', { path: '/tv?reports=on' }); // (report.js stays quiet in test browsers otherwise)
  const b = await open(browser, 'Receiver', { path: '/?reports=on' });
  await card(b.page, 'Sender');
  // Stuck: a transfer whose progress stopped for 40 seconds while the page was on screen
  await b.page.evaluate(() => {
    const peer = [...peers.values()][0];
    const prog = { total: 50 * 1048576, sending: false };
    peer.checkStuck(prog, 1048576);
    prog.movedAt -= 40000;
    visibleSince -= 60000;
    peer.checkStuck(prog, 1048576);
    peer.checkStuck(prog, 1048576); // only once per transfer
  });
  // Crash: the TV page stops without closing (no pagehide, like a browser crash), then the tab opens it again.
  // A listener added before report.js's swallows the closing events while 'sim-crash' is set.
  await a.context.addInitScript(() => {
    for (const ev of ['pagehide', 'visibilitychange']) {
      addEventListener(ev, (e) => { if (sessionStorage.getItem('sim-crash')) e.stopImmediatePropagation(); }, true);
    }
  });
  await a.page.reload();
  await a.page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('omnibeam-alive'));
    sessionStorage.setItem('omnibeam-alive', JSON.stringify({ ...s, at: Date.now() - 5 * 60000, busy: true }));
    sessionStorage.setItem('sim-crash', '1');
  });
  await a.page.reload();
  await a.page.evaluate(() => sessionStorage.removeItem('sim-crash'));
  let list = [];
  await expect.poll(async () => { list = (await stats(request)).errors; return list.filter((e) => e.k === 'crash' || e.k === 'stuck').length; }).toBeGreaterThanOrEqual(2);
  const stuck = list.filter((e) => e.k === 'stuck' && e.size === 50 * 1048576);
  expect(stuck.length).toBe(1);
  expect(stuck[0]).toMatchObject({ role: 'receive', pct: 2, r: 'none' });
  expect(stuck[0].secs).toBeGreaterThanOrEqual(40);
  const crash = list.filter((e) => e.k === 'crash' && e.page === 'tv');
  expect(crash.length).toBe(1);
  expect(crash[0]).toMatchObject({ busy: true, up: 5 });
  // A normal reload is not a crash
  await a.page.reload();
  await a.page.waitForTimeout(1500);
  expect((await stats(request)).errors.filter((e) => e.k === 'crash' && e.page === 'tv').length).toBe(1);
  // Not crashes either: an old 'visible' note (iOS Safari restoring its tabs after it was swiped away), and a copy of
  // the note in a new tab while the page that wrote it is still open
  await a.page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('omnibeam-alive'));
    sessionStorage.setItem('omnibeam-alive', JSON.stringify({ ...s, state: 'visible', seen: Date.now() - 10 * 60000 }));
    sessionStorage.setItem('sim-crash', '1');
  });
  await a.page.reload();
  await a.page.evaluate(() => sessionStorage.removeItem('sim-crash'));
  const copy = await a.page.evaluate(() => sessionStorage.getItem('omnibeam-alive'));
  expect(JSON.parse(copy)).toMatchObject({ state: 'visible' });
  const dup = await a.context.newPage();
  await dup.addInitScript((c) => { if (!sessionStorage.getItem('dup-done')) { sessionStorage.setItem('omnibeam-alive', c); sessionStorage.setItem('dup-done', '1'); } }, copy);
  await dup.goto('/tv?reports=on');
  await dup.waitForTimeout(2500);
  expect((await stats(request)).errors.filter((e) => e.k === 'crash' && e.page === 'tv').length).toBe(1);
  await dup.close();
  // Telegram: gathered into one message
  await expect.poll(instant).toMatch(/stuck transfer|tab crash/);
  const msgs = instant().trim().split('\n').map((l) => JSON.parse(l));
  const all = msgs.map((m) => m.text).join('\n');
  expect(all).toMatch(/Stuck transfer: receiving at 2%, nothing moved for \d+ s · not connected · 50 MB/);
  expect(all).toMatch(/Tab crashed: during a transfer, open 5 min · page: tv/);
  expect(all).toContain('/admin');
});

test('new script errors go to Telegram once; /stats shows crashes and stuck transfers', async ({ page, request }) => {
  const js = (ip, m) => request.post('/api/report', {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36' },
    data: { k: 'js', m, src: '/app.js', line: 77 },
  });
  expect((await js('203.0.113.50', 'TypeError: x is undefined (tv test)')).status()).toBe(204);
  await expect.poll(instant).toContain('New script error: TypeError: x is undefined (tv test)');
  await page.waitForTimeout(1200);
  expect((await js('203.0.113.51', 'TypeError: x is undefined (tv test)')).status()).toBe(204);
  await page.waitForTimeout(1500);
  expect(instant().split('x is undefined (tv test)').length - 1).toBe(1);

  await page.goto('/stats');
  await page.fill('#key', 'test-stats-key');
  await page.click('#login button');
  await expect(page.locator('#crash-tiles')).toContainText('Tab crashes');
  await expect(page.locator('#crash-tiles')).toContainText('Stuck transfers');
  await expect(page.locator('#crash-recent')).toContainText('Stuck transfer');
  await expect(page.locator('#crash-recent')).toContainText('Tab crashed');
  await expect(page.locator('#alerts')).toContainText('Crashes, stuck transfers and new script errors also go by Telegram');
});

test('TV mode with a PIN: only phones that type it pair, and unpaired phones are turned away', async ({ browser }) => {
  const tv = await open(browser, 'Den TV', { path: '/tv', storage: { 'omnibeam-tv-pin': '4826' } });
  const p = tv.page;
  await expect(p.locator('#tv-pin-note')).toBeVisible();
  await expect(p.locator('#tv-alt')).toBeHidden();
  await expect(p.locator('#tv-pin')).toHaveText('Change PIN');
  await expect(p.locator('#tv-qr')).toHaveAttribute('data-link', /&n=Den%20TV&p=1$/);
  const link = await p.locator('#tv-qr').getAttribute('data-link');
  expect(link).not.toContain('4826'); // the PIN is never in the code

  // A phone on the same Wi-Fi that has not paired: the TV turns its files away without asking
  const phone = await open(browser, 'Phone');
  const sendPhoto = async () => {
    const target = await card(phone.page, 'Den TV');
    const chooser = phone.page.waitForEvent('filechooser');
    await target.hover();
    await target.locator('[data-act=files]').click();
    await (await chooser).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
  };
  await sendPhoto();
  await expect(p.locator('#toast')).toContainText('Phone is not paired with this TV', { timeout: 15000 });
  await expect(p.locator('#dlg-request')).toBeHidden();
  await expect(p.locator('#tv-show')).toBeHidden();

  // Scanning with the wrong PIN does not pair
  const hash = link.replace(/^[^#]*/, '');
  let answer = '1111';
  const asked = [];
  phone.page.on('dialog', (d) => { asked.push(d.message()); d.accept(answer); });
  await phone.page.evaluate((h) => { location.hash = h; }, hash);
  await expect(phone.page.locator('#toast')).toContainText('Check the PIN', { timeout: 20000 });
  expect(asked[0]).toBe('Den TV has a PIN. Type the PIN to pair:');
  expect(await phone.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-paired') || '[]').length)).toBe(0);

  // The right PIN pairs, and then photos play by themselves
  answer = '4826';
  await phone.page.evaluate((h) => { location.hash = h; }, hash);
  await expect(phone.page.locator('#toast')).toContainText('Paired with Den TV', { timeout: 15000 });
  await sendPhoto();
  await expect(p.locator('#tv-show')).toBeVisible({ timeout: 30000 });
  await p.keyboard.press('Escape');

  // Turning the PIN off (empty) unpairs everyone and the code no longer asks for one
  const tvAnswers = ['12', ''];
  p.on('dialog', (d) => d.accept(tvAnswers.shift()));
  await p.locator('#tv-pin').click();
  await expect(p.locator('#toast')).toContainText('The PIN must be 4 to 8 digits.');
  await p.locator('#tv-pin').click();
  await expect(p.locator('#toast')).toContainText('PIN turned off.');
  await expect(p.locator('#tv-pin-note')).toBeHidden();
  await expect(p.locator('#tv-pin')).toHaveText('Set a PIN');
  await expect(p.locator('#tv-qr')).toHaveAttribute('data-link', /&n=Den%20TV$/);
  expect(await p.evaluate(() => [localStorage.getItem('omnibeam-tv-pin'), JSON.parse(localStorage.getItem('omnibeam-paired') || '[]').length])).toEqual([null, 0]);
  expect(tv.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});
