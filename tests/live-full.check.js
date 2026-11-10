// The full check of the live site: run with live-full.config.js, never with the normal tests.
// Browsers on this PC act as devices on one network. Every test sends a few small files through the real server
// and makes short-lived share links (one or a few downloads, 1 hour). Visits use ?analytics=off.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const makeFile = (name, size, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: crypto.randomBytes(size) });
const run = crypto.randomBytes(2).toString('hex');
const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon-192.png'));
const LANGS = ['', 'ar/', 'fr/', 'es/', 'tr/', 'de/', 'pt/', 'hi/', 'id/', 'ru/', 'ja/', 'zh/', 'ko/', 'it/', 'ur/'];

let open = [];
test.afterEach(async () => {
  for (const c of open) await c.close().catch(() => {});
  open = [];
});

// A visitor in their own browser profile. Collects script errors, console errors and CSP violations.
async function device(browser, name, { relayOnly = false, path: p = '/', lang = 'en', storage = {}, clipboard = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, permissions: clipboard ? ['clipboard-read', 'clipboard-write'] : [] });
  open.push(context);
  await context.addInitScript(({ name, lang, storage }) => {
    localStorage.setItem('omnibeam-name', name);
    localStorage.setItem('omnibeam-tour', 'done');
    localStorage.setItem('omnibeam-analytics', 'off');
    if (!localStorage.getItem('omnibeam-lang')) localStorage.setItem('omnibeam-lang', lang);
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  }, { name, lang, storage });
  if (relayOnly) {
    await context.addInitScript(() => {
      const Real = window.RTCPeerConnection;
      window.RTCPeerConnection = function (cfg) { return new Real({ ...(cfg || {}), iceTransportPolicy: 'relay' }); };
      window.RTCPeerConnection.prototype = Real.prototype;
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  const [pathOnly, hash = ''] = p.split('#');
  await page.goto(pathOnly + (pathOnly.includes('?') ? '&' : '?') + 'analytics=off' + (hash ? '#' + hash : ''));
  await expect(page.locator('#me-name')).toHaveText(name);
  await expect(page.locator('#me-scope')).not.toHaveText(/Connecting/);
  return { page, context, errors, name };
}
const card = async (page, name) => {
  const el = page.locator('.peer:not(.offline)').filter({ has: page.locator('.name', { hasText: name }) });
  await expect(el).toBeVisible();
  return el;
};
const routeTo = (from, to) => from.page.evaluate((name) => [...peers.values()].find((p) => p.info && p.info.name === name)?.lastRoute, to.name);
async function pick(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}
async function accept(to) {
  const ask = to.page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
  const got = to.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 120000 });
  const download = to.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const d = await download;
  const buf = fs.readFileSync(await d.path());
  await expect(got).toBeHidden();
  return { name: d.suggestedFilename(), buf };
}
const send = async (from, to, files) => { await pick(from, to, files); return accept(to); };
async function menu(page, id) {
  await page.locator('#btn-menu').click();
  await page.locator(`#menu #${id}`).click();
}
// Runs fn over items, at most n at a time
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

test('live build matches this PC', async ({ request }) => {
  const html = await (await request.get('/?analytics=off')).text();
  // The upload zip has minified scripts (tools/minify.js), so compare with those, as the server has them
  const { shipped } = require('../tools/minify');
  const build = crypto.createHash('sha256')
    .update((await Promise.all(['index.html', 'app.js', 'style.css'].map((f) => shipped(`public/${f}`, fs.readFileSync(path.join(__dirname, '..', 'public', f)))))).join('\n'))
    .digest('hex').slice(0, 12);
  expect(html).toContain(`<meta name="omnibeam-build" content="${build}">`);
  // A query the CDN hasn't seen, so the answer comes from the server (Cloudflare keeps old copies of the bare URLs)
  for (const f of ['app.js', 'more.js', 'share.js', 'drop.js', 'i18n.js', 'consent.js', 'get.js', 'qrcode.js', 'media.js', 'autosend.js', 'report.js', 'request.js', 'put.js', 'stats.js']) {
    const live = await (await request.get(`/${f}?check=${run}`)).body();
    expect(sha(live), f).toBe(sha(await shipped(`public/${f}`, fs.readFileSync(path.join(__dirname, '..', 'public', f)))));
  }
});

test('discovery, pairing by code, and pairing by QR link', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  await card(a.page, b.name);
  await card(b.page, a.name);
  // Code: A creates it, B types it
  await a.page.locator('#btn-pair').click();
  await a.page.locator('#pair-tab-code').click();
  await a.page.locator('#dlg-pair [data-act=create]').click();
  await expect(a.page.locator('#pair-show')).toHaveText(/\d{3} \d{3}/);
  const code = (await a.page.locator('#pair-show').textContent()).replace(/\D/g, '');
  await b.page.locator('#btn-pair').click();
  await b.page.locator('#pair-tab-code').click();
  await b.page.locator('#pair-code').fill(code);
  await expect((await card(a.page, b.name)).locator('.tag')).toHaveText(/Paired|Trusted/, { timeout: 20000 });
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText(/Paired|Trusted/, { timeout: 20000 });

  // QR link: a third device opens the link from A's QR code
  const c = await device(browser, `Full Q ${run}`);
  await card(c.page, a.name);
  await a.page.keyboard.press('Escape');
  await a.page.locator('#btn-pair').click();
  await a.page.locator('#pair-tab-scan').click();
  await expect(a.page.locator('#pair-qr svg')).toBeVisible();
  const link = await a.page.evaluate(() => qrPairLink());
  expect(link).toMatch(/^https:\/\/omnibeam\.site\/.*#qr=[0-9a-f]{64}/);
  const d = await device(browser, `Full QR ${run}`, { path: '/' + link.split('/').pop() });
  await expect((await card(d.page, a.name)).locator('.tag')).toHaveText('Paired', { timeout: 20000 });
  await expect((await card(a.page, d.name)).locator('.tag')).toHaveText('Paired', { timeout: 20000 });
  expect(d.page.url()).not.toContain('qr=');
  expect([...a.errors, ...b.errors, ...c.errors, ...d.errors]).toEqual([]);
});

test('direct: a 4 MB file, a message, several files as a ZIP', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  const file = makeFile('live-full-photo.jpg', 4 * 1024 * 1024 + 17, 'image/jpeg');
  const got = await send(a, b, [file]);
  expect(got.name).toBe('live-full-photo.jpg');
  expect(sha(got.buf)).toBe(sha(file.buffer));
  const route = await routeTo(a, b);
  console.log(`  direct send went: ${route}`);
  expect(['lan', 'internet'], 'a direct route, not the relay').toContain(route);
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=message]').click();
  await a.page.locator('#dlg-chat textarea').fill(`full check ${run} https://omnibeam.site`);
  await a.page.locator('#dlg-chat [data-act=send]').click();
  await a.page.locator('#dlg-chat [data-act=close]').click();
  await expect(b.page.locator('#dlg-chat .bubble.in').last()).toContainText(`full check ${run}`);
  await expect(b.page.locator('#dlg-chat .bubble.in .msg-text a').last()).toHaveAttribute('href', 'https://omnibeam.site');
  await b.page.locator('#dlg-chat [data-act=close]').click();
  const many = [makeFile('one.txt', 1500, 'text/plain'), makeFile('two.bin', 700 * 1024), makeFile('three.pdf', 90 * 1024, 'application/pdf')];
  const zip = await send(b, a, many);
  expect(zip.name).toMatch(/\.zip$/);
  for (const f of many) expect(zip.buf.includes(f.buffer), f.name).toBe(true);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('forced relay: a 3 MB file through the TURN/relay path', async ({ browser }) => {
  const a = await device(browser, `Full RA ${run}`, { relayOnly: true });
  const b = await device(browser, `Full RB ${run}`, { relayOnly: true });
  const file = makeFile('live-full-relay.pdf', 3 * 1024 * 1024 + 3, 'application/pdf');
  const got = await send(a, b, [file]);
  expect(sha(got.buf)).toBe(sha(file.buffer));
  const route = await routeTo(a, b);
  console.log(`  relay-only send went: ${route}`);
  expect(['relay', 'turn']).toContain(route);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('decline and cancel', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  await pick(a, b, [makeFile('no-thanks.bin', 5000)]);
  await b.page.locator('#dlg-request [data-act=decline]').click();
  await expect(a.page.locator('#toast')).toContainText('declined');
  // Cancel: slow the sender down so the transfer is still running when Stop is pressed
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(25); return wait.call(this); };
  });
  await pick(a, b, [makeFile('cancel-me.bin', 25 * 1024 * 1024)]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const stop = (await card(a.page, b.name)).locator('.xfer-cancel');
  await expect(stop).toBeVisible({ timeout: 30000 });
  await stop.click();
  await expect(b.page.locator('#toast')).toContainText(/cancelled|stopped/i, { timeout: 15000 });
  await expect(b.page.locator('#dlg-received')).toBeHidden();
  await expect.poll(() => a.page.evaluate(() => [...peers.values()].every((p) => !p.busy)), { timeout: 15000 }).toBe(true);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('send to everyone reaches two devices', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  const c = await device(browser, `Full C ${run}`);
  await card(a.page, b.name);
  await card(a.page, c.name);
  // Other OmniBeam tabs on this network (real visitors) would get it too: only run when just these are visible
  const others = await a.page.evaluate(() => peers.size);
  test.skip(others !== 2, `${others} devices visible on this network, not sending to strangers`);
  await expect(a.page.locator('#btn-send-all')).toBeVisible();
  const file = makeFile('for-all.txt', 3000, 'text/plain');
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.locator('#btn-send-all').click();
  await (await chooser).setFiles([file]);
  const [gb, gc] = await Promise.all([accept(b), accept(c)]);
  expect(sha(gb.buf)).toBe(sha(file.buffer));
  expect(sha(gc.buf)).toBe(sha(file.buffer));
  expect([...a.errors, ...b.errors, ...c.errors]).toEqual([]);
});

async function makeLink(page, { file, pin, max }) {
  await menu(page, 'btn-link');
  await page.locator('#link-hours').selectOption('1');
  if (max) await page.locator('#link-max').selectOption(String(max));
  if (pin) await page.fill('#link-pin', pin);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#dlg-link [data-act=pick]').click();
  await (await chooser).setFiles([file]);
  await expect(page.locator('#link-url')).toContainText('/d/', { timeout: 60000 });
  return (await page.locator('#link-url').textContent()).trim();
}
async function fetchLink(browser, url, pin) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  open.push(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  if (pin) {
    await expect(p.locator('#drop-pin')).toBeVisible();
    await p.fill('#drop-pin-input', pin);
    await p.locator('#drop-pin button').click();
    await expect(p.locator('#drop-pin')).toBeHidden();
  }
  await expect(p.locator('#drop-get')).toBeVisible();
  const download = p.waitForEvent('download');
  await p.locator('#drop-get').click();
  const buf = fs.readFileSync(await (await download).path());
  return { page: p, buf, errors };
}

test('share link: create, open elsewhere, identical file', async ({ browser }) => {
  const a = await device(browser, `Full Link ${run}`);
  const file = makeFile('live-full-link.bin', 1536 * 1024);
  await a.page.locator('#btn-menu').click();
  await a.page.keyboard.press('Escape');
  const url = await makeLink(a.page, { file, max: 1 });
  expect(url).toMatch(/^https:\/\/omnibeam\.site\/d\/[^#]+#/);
  const got = await fetchLink(browser, url);
  expect(sha(got.buf)).toBe(sha(file.buffer));
  expect([...a.errors, ...got.errors]).toEqual([]);
});

test('share link with a PIN and 1 download: wrong PIN rejected, right PIN works, second download refused', async ({ browser, request }) => {
  const a = await device(browser, `Full Pin ${run}`);
  const file = makeFile('live-full-pin.pdf', 400 * 1024 + 9, 'application/pdf');
  const url = await makeLink(a.page, { file, pin: '5813', max: 1 });
  await expect(a.page.locator('#link-summary')).toContainText('PIN 5813');
  await expect(a.page.locator('#link-summary')).toContainText(/one download|1 download/);
  const ctx = await browser.newContext({ acceptDownloads: true });
  open.push(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await expect(p.locator('#drop-pin')).toBeVisible();
  await expect(p.locator('#drop-get')).toBeHidden();
  await p.fill('#drop-pin-input', '1111');
  await p.locator('#drop-pin button').click();
  await expect(p.locator('#drop-status')).toContainText('Wrong PIN');
  await p.fill('#drop-pin-input', '5813');
  await p.locator('#drop-pin button').click();
  await expect(p.locator('#drop-pin')).toBeHidden();
  await expect(p.locator('#drop-status')).toContainText('one download only');
  const download = p.waitForEvent('download');
  await p.locator('#drop-get').click();
  expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
  // Used up: the server no longer gives the data out
  const id = url.match(/\/d\/([^#?/]+)/)[1];
  const r = await request.get(`/api/drop/${id}/data`);
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(a.errors).toEqual([]);
});

test('team room and public room', async ({ browser }) => {
  const a = await device(browser, `Full TA ${run}`);
  await a.page.locator('#btn-pair').click();
  const dlg = a.page.locator('#dlg-pair');
  await dlg.locator('#pair-tab-rooms').click();
  await dlg.locator('#team-name').fill(`Team${run}`);
  await a.page.evaluate(() => { navigator.clipboard.writeText = (text) => { window.copied = text; return Promise.resolve(); }; });
  await dlg.locator('[data-act=team-create]').click();
  await expect(dlg.locator('.team-row .team-name')).toHaveText(`Team${run}`);
  const link = await a.page.evaluate(() => window.copied);
  expect(link).toMatch(/\/#team=[0-9a-f]{64}&n=/);
  await dlg.locator('[data-act=close]').click();
  const b = await device(browser, `Full TB ${run}`, { path: '/#' + link.split('#')[1] });
  await expect(b.page.locator('#toast')).toContainText('You joined the team room');
  await expect((await card(a.page, b.name)).locator('.tag')).toHaveText(`Team${run}`);
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText(`Team${run}`);

  // Public room: A creates, C joins by typing the code
  await a.page.locator('#btn-pair').click();
  await dlg.locator('[data-act=public-create]').click();
  await expect(a.page.locator('#public-active')).toBeVisible();
  const room = (await a.page.locator('#public-show').textContent()).replace(/[^a-z]/gi, '');
  expect(room).toMatch(/^[a-z]{5}$/i);
  const c = await device(browser, `Full PC ${run}`);
  await c.page.locator('#btn-pair').click();
  await c.page.locator('#pair-tab-rooms').click();
  await c.page.fill('#public-code', room);
  await c.page.locator('#dlg-pair [data-act=public-join]').click();
  await expect(c.page.locator('#toast')).toContainText('You are in public room');
  await card(c.page, a.name);
  await a.page.locator('#dlg-pair [data-act=public-leave]').click();
  await expect(a.page.locator('#public-idle')).toBeVisible();
  expect([...a.errors, ...b.errors, ...c.errors]).toEqual([]);
});

test('history (Received, Gallery, Sent), rename and avatar, themes', async ({ browser }) => {
  const a = await device(browser, `Full HA ${run}`);
  const b = await device(browser, `Full HB ${run}`);
  const photos = ['beach.png', 'dog.png'].map((name) => ({ name, mimeType: 'image/png', buffer: png }));
  await pick(a, b, [...photos, makeFile('notes.txt', 900, 'text/plain')]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  await b.page.locator('#dlg-received [data-act=close]').click();
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  await hist.locator('[data-tab=received]').click();
  await expect(hist).toContainText('notes.txt');
  await hist.locator('[data-tab=gallery]').click();
  await expect(hist.locator('.gallery .thumb')).toHaveCount(2);
  await hist.locator('[data-act=close]').click();
  await a.page.locator('#btn-history').click();
  await a.page.locator('#dlg-history [data-tab=sent]').click();
  await expect(a.page.locator('#dlg-history .sent-list .item').first()).toContainText('beach.png');
  await a.page.locator('#dlg-history [data-act=close]').click();

  // Rename and avatar, seen on the other device
  await a.page.locator('#me-rename').click();
  await a.page.fill('#me-name-input', `Full Renamed ${run}`);
  await a.page.locator('#dlg-me .avatar-opt[data-avatar="🦊"]').click();
  await a.page.locator('#dlg-me [data-act=save]').click();
  await expect(a.page.locator('#me-name')).toHaveText(`Full Renamed ${run}`);
  await expect((await card(b.page, `Full Renamed ${run}`)).locator('.avatar .emoji')).toHaveText('🦊');

  // Themes
  await menu(a.page, 'btn-settings');
  const settings = a.page.locator('#dlg-settings');
  await settings.locator('#theme-choice label', { hasText: 'Dark' }).click();
  await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings.locator('#theme-choice label', { hasText: 'Light' }).click();
  await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settings.locator('#theme-choice label', { hasText: 'Automatic' }).click();
  await expect(a.page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

let english = null;
for (const l of LANGS) {
  test(`language /${l}: lang, dir, translated, no console errors or CSP violations`, async ({ browser }) => {
    const code = l.slice(0, 2) || 'en';
    const d = await device(browser, `Full Lang ${run}`, { path: '/' + l, lang: code });
    await expect(d.page.locator('html')).toHaveAttribute('lang', code);
    await expect(d.page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    const ui = await d.page.evaluate(() => ({
      title: document.title,
      history: document.querySelector('#btn-history')?.textContent.trim(),
      pair: document.querySelector('#dlg-pair h3')?.textContent.trim(),
      settings: document.querySelector('#btn-settings')?.textContent.trim(),
    }));
    if (code === 'en') english = ui;
    else if (english) {
      expect(ui.title, 'title translated').not.toBe(english.title);
      expect(ui.pair, '"Pair devices" translated').not.toBe(english.pair);
      expect(ui.settings, '"Settings" translated').not.toBe(english.settings);
    }
    await d.page.locator('#btn-menu').click();
    await expect(d.page.locator('#menu')).toBeVisible();
    await d.page.waitForTimeout(1500);
    expect(d.errors).toEqual([]);
  });
}

test('help text covers the new features in every language, and the new icon loads', async ({ request }) => {
  const help = ['History:', 'Send again:', 'Send by email or text:', 'Link options:', 'Continue on another device:', 'Team rooms:',
    'Name and picture:', 'Theme:', 'Save to Photos:', 'Keep the screen on:'];
  const home = await (await request.get('/?analytics=off')).text();
  // The help moved into the window that loads when first opened (/info-dialogs)
  const info = await (await request.get('/info-dialogs?lang=en&v=2')).text();
  for (const h of help) expect(info, h).toContain(`<span class="em">${h}</span>`);
  expect(home).toContain('/icon-80.webp?v=2');
  expect((await request.get('/icon-80.webp?v=2')).status()).toBe(200);
  // Each translation has these strings, and the how-to guide page loads in each language
  for (const l of LANGS.filter(Boolean)) {
    const code = l.slice(0, 2);
    const src = await (await request.get(`/lang/${code}.js?check=${run}`)).text();
    for (const h of help) expect(src.includes(JSON.stringify(h).slice(1, -1)) || src.includes(`'${h}'`), `${code}: ${h}`).toBe(true);
    expect((await request.get(`/${l}how-to-use`)).status(), `/${l}how-to-use`).toBe(200);
  }
});

test('every sitemap URL and the extra pages answer', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`  sitemap has ${urls.length} URLs`);
  expect(urls.length).toBeGreaterThan(10);
  const extra = ['/how-to-use', '/compare', '/blog', '/privacy', '/terms', '/about', '/robots.txt', '/llms.txt',
    '/manifest.webmanifest', '/sw.js', '/stats'].map((p) => 'https://omnibeam.site' + p);
  const all = [...new Set([...urls, ...extra])];
  const res = await pool(all, 4, async (u) => {
    try { return { u, s: (await request.get(u, { maxRedirects: 0, timeout: 30000 })).status() }; } catch (e) { return { u, s: String(e.message).slice(0, 80) }; }
  });
  const bad = res.filter((r) => r.s !== 200);
  fs.mkdirSync(path.join(__dirname, '.results-live'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '.results-live', 'urls.json'), JSON.stringify(res, null, 1));
  expect(bad, 'URLs that did not answer 200').toEqual([]);
  // Missing pages: a real 404 with a page
  const missing = await request.get(`/no-such-page-${run}`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('<html');
});

test('service worker registers and the app works offline', async ({ browser }) => {
  const d = await device(browser, `Full Off ${run}`);
  await d.page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => { await d.page.reload(); return d.page.evaluate(() => !!navigator.serviceWorker.controller); }).toBe(true);
  await d.context.setOffline(true);
  await d.page.reload();
  await expect(d.page.locator('#me-name')).toBeVisible();
  await expect(d.page.locator('h1').first()).not.toHaveText("You're offline");
  // A page never opened before: the offline page
  await d.page.goto('/terms').catch(() => {});
  await expect(d.page.locator('h1')).toHaveText("You're offline");
  await d.context.setOffline(false);
});

test('outside links point at the right places and answer', async ({ request }) => {
  const html = await (await request.get('/?analytics=off')).text();
  const how = await (await request.get('/how-to-use')).text();
  const want = {
    'Chrome Web Store': 'https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki',
    'Microsoft Store': 'https://apps.microsoft.com/detail/9PLR2PMX3SQZ',
  };
  for (const [what, u] of Object.entries(want)) expect(html + how, what).toContain(u);
  const more = await (await request.get('/more.js')).text();
  const app = await (await request.get('/app.js')).text();
  const re = /https:\/\/(?:chromewebstore\.google\.com|apps\.microsoft\.com|paypal\.me|www\.paypal\.com|www\.facebook\.com|x\.com|t\.me|www\.linkedin\.com|api\.whatsapp\.com|www\.snapchat\.com)[^"'`\s<)\\]*/g;
  const found = [...(html + how + more + app).matchAll(re)].map((m) => m[0].replace(/&amp;/g, '&'));
  const links = [...new Set(found)].filter((u) => !u.includes('${'));
  const res = await pool(links, 4, async (u) => {
    try { return { u, s: (await request.get(u, { timeout: 30000 })).status() }; } catch (e) { return { u, s: String(e.message).slice(0, 80) }; }
  });
  fs.mkdirSync(path.join(__dirname, '.results-live'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '.results-live', 'external-links.json'), JSON.stringify(res, null, 1));
  for (const r of res) console.log(`  ${r.s}  ${r.u}`);
  // Social sites often refuse robots (403/400); only a missing page or a server error counts as broken
  expect(res.filter((r) => r.s === 404 || r.s === 410 || (typeof r.s === 'number' && r.s >= 500))).toEqual([]);
});

// ---------- Added 2026-11-03: the six picks and the review upgrades ----------

// Open "More…" on the card of `name` and choose an action
async function more(page, name, act) {
  const c = await card(page, name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  const dlg = page.locator('#dlg-actions');
  await expect(dlg).toBeVisible();
  await dlg.locator(`[data-act=${act}]`).click();
}
// Two devices already paired with each other (as after entering a pairing code)
async function pairedDevices(browser, storage = {}, opts = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name, auto = false) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto, trusted: true }]);
  const a = await device(browser, `Full PA ${run}`, { ...opts, storage: { 'omnibeam-paired': paired(`Full PB ${run}`), ...storage } });
  const b = await device(browser, `Full PB ${run}`, { ...opts, storage: { 'omnibeam-paired': paired(`Full PA ${run}`, true), ...storage } });
  await expect((await card(a.page, b.name)).locator('.tag')).toHaveText('Trusted');
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText('Trusted');
  return { a, b };
}
const LANDING = ['quick-share-alternative', 'send-files-iphone-to-android', 'share-files-mac-and-windows', 'shareit-alternative', 'wetransfer-alternative'];

test('More… menu on a device has Take a photo, Voice note, Share my screen and Secret note', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  const c = await card(a.page, b.name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  const dlg = a.page.locator('#dlg-actions');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.who')).toHaveText(b.name);
  for (const act of ['files', 'message', 'photo', 'voice', 'screen', 'secret', 'speed']) await expect(dlg.locator(`[data-act=${act}]`), act).toBeVisible();
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('secret note to a device: hidden until Show, gone after closing, never stored', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  await more(a.page, b.name, 'secret');
  const send = a.page.locator('#dlg-secret-send');
  await send.locator('textarea').fill(`wifi: hunter2-${run}`);
  await send.locator('[data-act=send]').click();
  await expect(a.page.locator('.toast').last()).toContainText('Secret note sent to');
  const dlg = b.page.locator('#dlg-secret');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.secret-body')).toHaveClass(/hidden-note/);
  await dlg.locator('[data-act=show]').click();
  await expect(dlg.locator('pre')).toHaveText(`wifi: hunter2-${run}`);
  await dlg.locator('[data-act=close]').click();
  expect(await b.page.evaluate(() => document.getElementById('dlg-secret').innerHTML)).toBe('');
  expect(await b.page.evaluate(() => JSON.stringify(localStorage))).not.toContain('hunter2');
  expect(await a.page.evaluate(() => JSON.stringify(localStorage))).not.toContain('hunter2');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('secret note by link: read once, then gone', async ({ browser }) => {
  const a = await device(browser, `Full Note ${run}`);
  await menu(a.page, 'btn-link');
  const dlg = a.page.locator('#dlg-link');
  await dlg.locator('[data-act=note-open]').click();
  await a.page.fill('#link-note-text', `API_KEY=sk-live-check-${run}\nsecond line`);
  await dlg.locator('[data-act=note-make]').click();
  await expect(a.page.locator('#link-summary')).toContainText('Secret note');
  const url = (await a.page.locator('#link-url').textContent()).trim();
  expect(url).toMatch(/^https:\/\/omnibeam\.site\/d\//);
  const reader = await browser.newContext();
  open.push(reader);
  const page = await reader.newPage();
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('A secret note for you');
  await expect(page.locator('#drop-status')).toContainText('This note can be read once');
  await page.reload(); // a chat app's link preview doesn't use it up
  await page.locator('#drop-get').click();
  await expect(page.locator('.secret-note pre')).toHaveText(`API_KEY=sk-live-check-${run}\nsecond line`);
  await expect(page.locator('#drop-status')).toContainText('deleted from the server');
  const again = await reader.newPage();
  await again.goto(url);
  await expect(again.locator('#drop-status')).toContainText('expired or was deleted');
  expect(a.errors).toEqual([]);
});

test('previews: code with colours and a PDF, from Received and from History', async ({ browser }) => {
  const a = await device(browser, `Full A ${run}`);
  const b = await device(browser, `Full B ${run}`);
  const code = { name: 'hello.py', mimeType: 'text/x-python', buffer: Buffer.from('# say hi\ndef hello(name):\n    return "hi " + name * 2\n') };
  const pdf = { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') };
  await pick(a, b, [code, pdf, makeFile('blob.bin', 1000)]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  const preview = (name) => got.locator('.item', { hasText: name }).locator('button', { hasText: 'Preview' });
  await expect(preview('blob.bin')).toHaveCount(0);
  await preview('hello.py').click();
  const pv = b.page.locator('#dlg-preview');
  await expect(pv.locator('.tk-k').first()).toHaveText('def');
  await expect(pv.locator('.tk-c')).toHaveText('# say hi');
  await expect(pv.locator('.preview-note')).toHaveText('4 lines');
  await pv.locator('[data-act=close]').click();
  await preview('doc.pdf').click();
  await expect(pv.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await pv.locator('[data-act=close]').click();
  await got.locator('[data-act=close]').click();
  await b.page.locator('#btn-history').click();
  await b.page.locator('#dlg-history [data-tab=received]').click();
  await b.page.locator('#dlg-history .item', { hasText: 'hello.py' }).locator('button', { hasText: 'Preview' }).click();
  await expect(pv.locator('.tk-k').first()).toHaveText('def');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('clipboard history: a synced text is listed on both devices', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, { 'omnibeam-clip': 'on' }, { clipboard: true });
  await a.page.evaluate((t) => sendClip(t), `copied ${run}`);
  await expect(a.page.locator('#toast')).toContainText('Clipboard sent to');
  await expect.poll(() => b.page.evaluate(() => ClipHistory.load()[0]?.text), { timeout: 20000 }).toBe(`copied ${run}`);
  await b.page.locator('#btn-history').click();
  await b.page.locator('#dlg-history [data-tab=clips]').click();
  await expect(b.page.locator('#dlg-history .clip-list .item').first()).toContainText(`copied ${run}`);
  await a.page.locator('#btn-history').click();
  await a.page.locator('#dlg-history [data-tab=clips]').click();
  await expect(a.page.locator('#dlg-history .clip-list .item').first()).toContainText('to ');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

const BIG = { 'omnibeam-big-min': String(1024 * 1024), 'omnibeam-big-seg': String(256 * 1024) };
for (const relayOnly of [false, true]) {
  test(`big-file mode${relayOnly ? ' through the relay' : ' direct'}: a spoiled piece is sent again, file intact`, async ({ browser }) => {
    const { a, b } = await pairedDevices(browser, BIG, { relayOnly });
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
    await pick(a, b, [file]);
    await expect(a.page.locator('#toast')).toContainText('Big-file mode');
    const got = b.page.locator('#dlg-received');
    await expect(got).toBeVisible({ timeout: 90000 });
    await expect(got.locator('.intact')).toBeVisible({ timeout: 20000 });
    expect(await b.page.evaluate(() => window.__redos)).toBe(1);
    const download = b.page.waitForEvent('download');
    await got.locator('[data-act=save-all]').click();
    expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
    console.log(`  big-file mode went: ${await routeTo(a, b)}`);
    expect([...a.errors, ...b.errors]).toEqual([]);
  });
}

test('⚡ Faster Wi-Fi explains first and asks for nothing when declined', async ({ browser }) => {
  const a = await device(browser, `Full Fast ${run}`);
  await a.page.evaluate(() => {
    window.micAsks = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.micAsks++; throw new Error('no mic here'); };
    window.askFastWifi();
  });
  const dlg = a.page.locator('#dlg-fast');
  await expect(dlg).toContainText('Nothing is recorded or sent');
  await dlg.locator('[data-act=no]').click();
  await expect(dlg).toBeHidden();
  expect(await a.page.evaluate(() => window.micAsks)).toBe(0);
  expect(a.errors).toEqual([]);
});

test('Help, Terms, Privacy and About load only when opened, in the page language', async ({ browser, request }) => {
  const html = await (await request.get('/?analytics=off')).text();
  expect(html).not.toContain('id="dlg-how"');
  expect(html).not.toContain('id="dlg-privacy"');
  expect(html).toContain('id="dlg-actions"');
  for (const l of LANGS) {
    const code = l.slice(0, 2) || 'en';
    const r = await request.get(`/info-dialogs?lang=${code}&v=2`);
    expect(r.status(), code).toBe(200);
    const part = await r.text();
    for (const id of ['dlg-how', 'dlg-terms', 'dlg-privacy', 'dlg-about']) expect(part, `${code} ${id}`).toContain(`id="${id}"`);
    if (code !== 'en') expect(part, code).not.toContain('<h3>How to Use OmniBeam</h3>');
  }
  const a = await device(browser, `Full Info ${run}`);
  await a.page.locator('#btn-menu').click();
  await a.page.locator('#menu [data-open=dlg-how]').click();
  await expect(a.page.locator('#dlg-how')).toContainText('Share my screen');
  await a.page.locator('#dlg-how [data-close]').first().click();
  for (const id of ['dlg-terms', 'dlg-privacy', 'dlg-about']) {
    await a.page.locator(`footer [data-open=${id}]`).first().click();
    await expect(a.page.locator(`#${id}`)).toBeVisible();
    await a.page.locator(`#${id} [data-close]`).last().click(); // the last one is Close (Privacy also has Cookie settings)
  }
  await expect(a.page.locator('#dlg-privacy')).toContainText('camera, microphone or screen');
  expect(a.errors).toEqual([]);
});

test('the 5 new landing pages answer in all 9 languages and are in the sitemap', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const urls = LANGS.flatMap((l) => LANDING.map((s) => `/${l}${s}`));
  const res = await pool(urls, 4, async (u) => {
    const r = await request.get(u);
    const html = await r.text();
    const want = (u.match(/^\/([a-z]{2})\//) || [null, 'en'])[1];
    return { u, s: r.status(), lang: (html.match(/<html[^>]*lang="([^"]+)"/) || [])[1], want, inMap: xml.includes(`https://omnibeam.site${u}<`) };
  });
  const bad = res.filter((r) => r.s !== 200 || r.lang !== r.want || !r.inMap);
  expect(bad, 'landing pages with a wrong status, language or missing from the sitemap').toEqual([]);
});

test('sending a link by email is on (the server sends it; nothing is sent here)', async ({ browser, request }) => {
  expect((await (await request.get('/config.json')).json()).drop.email).toBe(true);
  const a = await device(browser, `Full Mail ${run}`);
  await menu(a.page, 'btn-sendto');
  await expect(a.page.locator('#link-to-note')).toBeVisible();
  expect(a.errors).toEqual([]);
});

test('the iPhone Shortcut is gone: no inbox, nothing in Settings, not in the privacy pages', async ({ browser, request }) => {
  expect((await (await request.get('/config.json')).json()).inbox).toBeNull();
  expect((await request.post('/api/inbox/0123456789abcdef0123456789abcdef', { data: 'x' })).status()).toBe(404);
  const a = await device(browser, `Full Sc ${run}`);
  await menu(a.page, 'btn-settings');
  await expect(a.page.locator('#dlg-settings')).not.toContainText('iPhone Shortcut');
  expect(await a.page.locator('#shortcut-open, #dlg-shortcut').count()).toBe(0);
  const left = [];
  for (const l of LANGS) {
    const text = (await (await request.get(`/${l}privacy`)).text()).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
    // The Shortcut in each language (iPhone Shortcut, Raccourci, Kurzbefehl, Atajo, Atalho, Kestirme, Pintasan, शॉर्टकट, اختصار)
    if (/shortcut|raccourci|kurzbefehl|atajo|atalho|kestirme|pintasan|शॉर्टकट|اختصار/i.test(text)) left.push(`/${l}privacy`);
  }
  expect(left, 'privacy pages that still mention the Shortcut').toEqual([]);
});

// ---------- Added 2026-11-04: v59 (TV mode, Request files, error reports, screen-lock resume, brotli) ----------

// The newest received files on a device, with a hash of their bytes
async function receivedList(page, n) {
  return page.evaluate(async (n) => Promise.all(History.items.slice(0, n).map(async (f) => {
    const blob = await History.blobOf(f);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { name: f.name, size: f.size, from: f.from, hash };
  })), n);
}
// A real (tiny, 2×2) PNG, so the TV can show it
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

test('TV mode: QR code on the TV, a phone scans it and its photo plays and arrives intact', async ({ browser }) => {
  const tv = await device(browser, `Full TV ${run}`, { path: '/tv' });
  const p = tv.page;
  await expect(p.locator('html')).toHaveClass(/\btv\b/);
  await expect(p.locator('#tv')).toBeVisible();
  await expect(p.locator('header .actions')).toBeHidden();
  await expect(p.locator('#peers')).toBeHidden();
  await expect(p.locator('#tv-qr svg')).toBeVisible();
  // (Not checked: "No phone connected yet", since another OmniBeam device on this Wi-Fi shows there too)
  // The code is redrawn every 0.5 s once the TV's name is known (the first one can carry a made-up name)
  await expect(p.locator('#tv-qr')).toHaveAttribute('data-link', /^https:\/\/omnibeam\.site\/#qr=[0-9a-f]{64}&n=Full%20TV%20/);
  const link = await p.locator('#tv-qr').getAttribute('data-link');

  const phone = await device(browser, `Full TVPhone ${run}`, { path: link.replace(/^https:\/\/[^/]+/, '') });
  await expect(phone.page.locator('#toast')).toContainText(`Paired with ${tv.name}`, { timeout: 20000 });
  await expect(p.locator('#tv-peers')).toContainText(phone.name);
  const target = await card(phone.page, tv.name);
  const chooser = phone.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([{ name: 'tv.png', mimeType: 'image/png', buffer: TINY_PNG }]);
  // Taken by itself (paired), no question, shown as a slideshow
  await expect(p.locator('#tv-show')).toBeVisible({ timeout: 60000 });
  await expect(p.locator('#dlg-request')).toBeHidden();
  await expect(p.locator('#tv-stage img')).toBeVisible();
  expect(await p.locator('#tv-stage img').evaluate((img) => img.complete && img.naturalWidth)).toBe(2);
  await expect(p.locator('#tv-caption')).toContainText(`from ${phone.name}`);
  const [got] = await receivedList(p, 1);
  expect(got.name).toBe('tv.png');
  expect(got.hash).toBe(sha(TINY_PNG));
  expect(tv.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('Request files: a link made on one device, someone without OmniBeam uploads, the files arrive intact', async ({ browser }) => {
  const a = await device(browser, `Full Req ${run}`);
  await menu(a.page, 'btn-request');
  const dlg = a.page.locator('#dlg-asklink');
  await expect(dlg).toBeVisible();
  await a.page.fill('#req-ask', 'Live check files');
  await a.page.selectOption('#req-hours', '1');
  await a.page.selectOption('#req-max', '1');
  await dlg.locator('[data-act=make]').click();
  await expect(a.page.locator('#req-done')).toBeVisible();
  const url = (await a.page.locator('#req-url').textContent()).trim();
  expect(url).toMatch(/^https:\/\/omnibeam\.site\/r\/[A-Za-z0-9_-]{16}#[A-Za-z0-9_-]{22}$/);
  await expect(a.page.locator('#req-qr svg')).toBeVisible();
  await dlg.locator('[data-act=close]').click();

  // The visitor: a plain browser, no OmniBeam name or settings
  const ctx = await browser.newContext();
  open.push(ctx);
  const v = await ctx.newPage();
  const vErrors = [];
  v.on('pageerror', (e) => vErrors.push(e.message));
  await v.goto(url.replace('#', '?analytics=off#'));
  await expect(v.locator('#req-title')).toHaveText(`Send files to ${a.name}`);
  await expect(v.locator('#req-ask')).toHaveText('Live check files');
  await v.fill('#req-from', 'Live checker');
  const files = [makeFile('photo.jpg', 600 * 1024 + 7, 'image/jpeg'), makeFile('notes.txt', 1500, 'text/plain')];
  await v.setInputFiles('#req-input', files);
  await expect(v.locator('#drop-files li')).toHaveCount(2);
  await v.locator('#req-send').click();
  await expect(v.locator('#drop-status')).toContainText('Sent ✓');
  await expect(v.locator('#req-more')).toBeHidden(); // that was the 1 upload allowed

  const got = a.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  await expect(got.locator('.who')).toHaveText('Live checker (request link)');
  const byName = Object.fromEntries((await receivedList(a.page, 2)).map((f) => [f.name, f]));
  expect(byName['photo.jpg']?.hash).toBe(sha(files[0].buffer));
  expect(byName['notes.txt']?.hash).toBe(sha(files[1].buffer));
  // Picked up, so deleted from the server
  const r = await a.page.evaluate(async () => {
    const l = JSON.parse(localStorage.getItem('omnibeam-requests'))[0];
    return (await fetch(`/api/request/${l.id}`, { headers: { 'X-Request-Token': l.token } })).json();
  });
  expect(r.files).toHaveLength(0);
  expect(r.uploads).toBe(1);
  expect(a.errors).toEqual([]);
  expect(vErrors).toEqual([]);
});

test('error reports: the page reports its own script errors, and the server takes one report', async ({ browser, request }) => {
  // In the page: a script error in OmniBeam's own file is noted (caught here, so it never reaches the server and
  // nobody gets a Telegram message for it)
  const a = await device(browser, `Full Rep ${run}`, { path: '/?reports=on' });
  const sent = [];
  await a.page.route('**/api/report', (route) => { sent.push(route.request().postDataJSON()); route.fulfill({ status: 204 }); });
  const v = await a.page.evaluate(() => document.querySelector('script[src*="/app.js"]').src.match(/v=(\d+)/)[1]);
  await a.page.evaluate((v) => dispatchEvent(new ErrorEvent('error', { message: 'Live check: harmless test error', filename: `${location.origin}/app.js?v=${v}`, lineno: 1 })), v);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ k: 'js', m: 'Live check: harmless test error', src: `/app.js?v=${v}`, line: 1, v }); // the server drops the ?v=
  // An error from another site's script is ignored
  await a.page.evaluate(() => dispatchEvent(new ErrorEvent('error', { message: 'other', filename: 'https://example.com/x.js', lineno: 1 })));
  await a.page.waitForTimeout(500);
  expect(sent.length).toBe(1);
  a.errors.length = 0;
  // The server: one report of a kind that sends no Telegram/email alert (only "js", "crash" and "stuck" do)
  const r = await request.post('/api/report', { data: { k: 'storage', m: `OmniBeam live check ${run}: harmless test report, please ignore` } });
  expect(r.status()).toBe(204);
  expect((await request.post('/api/report', { data: { k: 'nonsense', m: 'x' } })).status()).toBe(400);
  // /stats needs the owner's key: nothing is shown without it
  expect((await request.get('/api/stats')).status()).toBe(403);
  const stats = await request.get('/stats');
  expect(stats.status()).toBe(200);
  expect(await stats.text()).not.toContain(`live check ${run}`);
});

// ---- Screen lock: an iPhone's screen turns off mid-transfer ----
async function setHidden(page, hidden) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
// A device that counts the file bytes it receives (window.rxBytes) and sends a little slower, like a phone, so the
// screen can turn off before the transfer is over
async function slowDevice(browser, name, opts = {}) {
  const d = await device(browser, name, opts);
  await d.page.evaluate(() => {
    window.rxBytes = 0;
    const onChunk = Peer.prototype.onChunk;
    Peer.prototype.onChunk = function (buf) { if (this.incoming) window.rxBytes += buf.byteLength; return onChunk.call(this, buf); };
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(40); return wait.call(this); };
  });
  return d;
}
const rxBytes = (d) => d.page.evaluate(() => window.rxBytes);
// The phone's screen turns off for ms: hidden, its direct connection and its connection to the server close (iOS
// cuts them), then nothing runs on the page at all (paused with the debugger, like Safari on a locked iPhone)
async function lockScreen(ph, other, ms) {
  await setHidden(ph.page, true);
  await ph.page.waitForTimeout(300);
  await ph.page.evaluate(() => { for (const p of peers.values()) p.pc?.close(); ws?.close(); });
  const cdp = await ph.context.newCDPSession(ph.page);
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.pause');
  await other.page.waitForTimeout(ms);
  const woke = Date.now();
  await cdp.send('Debugger.resume');
  await cdp.detach();
  await setHidden(ph.page, false);
  return woke;
}
for (const [sending, relayOnly] of [[false, false], [true, true]]) {
  test(`screen lock: phone ${sending ? 'sending through TURN' : 'receiving direct'}, locked 10 s mid-transfer, continues by itself, file intact`, async ({ browser }) => {
    const laptop = await slowDevice(browser, `Full Lap ${run}`, { relayOnly });
    const ph = await slowDevice(browser, `Full Phone ${run}`, { relayOnly });
    await ph.page.evaluate(() => { isPhone = true; freezesHidden = true; });
    const [from, to] = sending ? [ph, laptop] : [laptop, ph];
    const file = makeFile('clip.mov', 14 * 1024 * 1024 + 77, 'video/quicktime');
    await pick(from, to, [file]);
    await to.page.locator('#dlg-request [data-act=accept]').click();
    await expect.poll(() => rxBytes(to), { timeout: 60000 }).toBeGreaterThan(2 * 1024 * 1024);
    const before = await rxBytes(to);
    expect(before, 'the transfer finished before the screen could turn off').toBeLessThan(file.buffer.length - 3 * 1024 * 1024);
    const woke = await lockScreen(ph, laptop, 10000);
    // Moving again by itself, nobody taps anything
    await expect.poll(async () => (await rxBytes(to)) - before, { timeout: 60000, intervals: [200] }).toBeGreaterThan(1024 * 1024);
    console.log(`screen lock (${sending ? 'phone sending, TURN' : 'phone receiving, direct'}): moving again ${((Date.now() - woke) / 1000).toFixed(1)} s after waking`);
    const got = to.page.locator('#dlg-received');
    await expect(got).toBeVisible({ timeout: 120000 });
    await expect(to.page.locator('#dlg-request')).toBeHidden();
    await expect(got.locator('.info .muted.intact')).toHaveCount(1);
    const download = to.page.waitForEvent('download');
    await got.locator('[data-act=save-all]').click();
    expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
    expect(laptop.errors).toEqual([]);
    expect(ph.errors).toEqual([]);
  });
}

// Fetches url with only this Accept-Encoding and decodes the body itself (to see the compressed size too)
function rawGet(url, encoding) {
  const https = require('https');
  const zlib = require('zlib');
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept-Encoding': encoding, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) OmniBeam live check' } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(parts);
        const ce = res.headers['content-encoding'] || '';
        const body = ce === 'br' ? zlib.brotliDecompressSync(raw) : ce === 'gzip' ? zlib.gunzipSync(raw) : raw;
        resolve({ status: res.statusCode, ce, size: raw.length, body, headers: res.headers });
      });
    }).on('error', reject);
  });
}
test('brotli: pages and scripts come with brotli, decode to the same bytes, and app.js is fetched early', async ({ baseURL }) => {
  const home = (await rawGet(`${baseURL}/?analytics=off&c=${run}`, 'identity')).body.toString();
  const app = home.match(/<script src="(\/app\.js\?v=\d+)"/)[1];
  expect(app).toBe(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').match(/<script src="(\/app\.js\?v=\d+)"/)[1]);
  expect(home).toContain(`<link rel="preload" href="${app}" as="script">`);
  const de = (await rawGet(`${baseURL}/de/?analytics=off&c=${run}`, 'identity')).body.toString();
  const deLang = de.match(/<script src="(\/lang\/de\.js\?v=[^"]+)"/)[1];
  expect(de).toContain(`<link rel="preload" href="${deLang}" as="script">`);
  // The upload zip holds minified scripts and styles (tools/minify.js), so compare with those
  const { shipped } = require('../tools/minify');
  const local = (f) => shipped(`public/${f}`, fs.readFileSync(path.join(__dirname, '..', 'public', f)));
  // Scripts and styles: brotli, smaller than gzip, and the same bytes as this PC's (minified) file
  for (const [u, f] of [[app, 'app.js'], ['/style.css?v=57', 'style.css'], [deLang, 'lang/de.js'], ['/report.js?v=3', 'report.js'], ['/request.js?v=2', 'request.js'], ['/pages.css', 'pages.css']]) {
    const q = `${baseURL}${u}${u.includes('?') ? '&' : '?'}c=${run}`;
    const [br, gz] = [await rawGet(q, 'br'), await rawGet(q, 'gzip')];
    expect([u, br.status, br.ce]).toEqual([u, 200, 'br']);
    expect([u, gz.ce]).toEqual([u, 'gzip']);
    expect(br.size, `${u}: brotli smaller than gzip`).toBeLessThan(gz.size);
    expect(sha(br.body), `${u} decoded`).toBe(sha(await local(f)));
    expect(sha(gz.body), `${u} gzip decoded`).toBe(sha(await local(f)));
  }
  // Pages: brotli, and the decoded page is the same as the uncompressed one
  for (const u of ['/', '/de/', '/tv', '/privacy', '/ar/how-to-use']) {
    const q = `${baseURL}${u}?analytics=off&c=${run}`;
    const [br, plain] = [await rawGet(q, 'br'), await rawGet(q, 'identity')];
    expect([u, br.status, br.ce]).toEqual([u, 200, 'br']);
    expect(plain.ce).toBe('');
    expect(br.body.toString(), `${u} decoded`).toBe(plain.body.toString());
  }
});

// ---------- Added 2026-11-04: the app folder's .htaccess (deploy/htaccess-omnibeam.txt) ----------

test('only public/ is the website: server.js, data/, logs and notes in the app folder are refused', async ({ request }) => {
  // Status only (HEAD): nothing of these is downloaded
  const paths = ['/server.js', '/package.json', '/service-worker.js', '/stderr.log', '/DEPLOY-speed-screen.txt', '/vendor/ws/index.js',
    '/data/push-keys.json', '/data/push.json', '/data/stats.json', '/data/errors.json', '/data/alert.json', '/data/inbox-boxes.json', '/public/../server.js'];
  const open = [];
  for (const p of paths) {
    const s = (await request.head(`${p}?c=${run}`, { maxRedirects: 0 })).status();
    if (s === 200) open.push(`${p} ${s}`);
  }
  expect(open, 'app-folder files anyone can download').toEqual([]);
  // The site itself still works: pages, the Node app's addresses and the files in public/
  for (const p of ['/', '/ar/', '/tv', '/privacy', '/sw.js', '/config.json', `/app.js?c=${run}`, '/robots.txt', '/manifest.webmanifest', '/icon-192.png', '/lang/fr.js']) {
    expect([p, (await request.get(p, { maxRedirects: 0 })).status()]).toEqual([p, 200]);
  }
});

test('files with a version are kept a year (Cloudflare cache rule); scripts without one are not, pages and sw.js are checked every time', async ({ baseURL }) => {
  const cc = async (u) => (await rawGet(`${baseURL}${u}`, 'br')).headers['cache-control'];
  const home = (await rawGet(`${baseURL}/?analytics=off&c=${run}`, 'identity')).body.toString();
  const versioned = [...new Set(home.match(/\/[\w./-]+\.(?:js|css|woff2|svg|webp|png)\?v=[\w]+/g))];
  expect(versioned.length).toBeGreaterThan(5);
  const short = [];
  for (const u of versioned) if (!/max-age=31536000/.test(await cc(u))) short.push(`${u}: ${await cc(u)}`);
  expect(short, 'versioned files without the 1-year cache').toEqual([]);
  // Unversioned scripts: never kept long (the pages only load versioned ones; Cloudflare gives them 4 h at most)
  expect(await cc(`/app.js?c=${run}`)).not.toMatch(/max-age=31536000/);
  expect(await cc('/sw.js')).toMatch(/no-store/);
  expect(await cc('/')).toMatch(/no-cache/);
  expect((await rawGet(`${baseURL}/manifest.webmanifest`, 'identity')).headers['content-type']).toMatch(/manifest\+json/);
});
