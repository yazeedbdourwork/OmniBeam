// The live site, end to end: the newest files are served, pages in 5 languages load without errors, the first
// visit stays light, the ⋯ menu works, two browsers on this PC find each other and send files (directly and
// through the server), a message, a pairing QR code, and a share link that downloads intact.
// Run with live.config.js (see there), never with the normal tests.
const fs = require('fs');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const makeFile = (name, size, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: crypto.randomBytes(size) });
const run = crypto.randomBytes(2).toString('hex'); // so these test devices are easy to tell apart

let open = [];
test.afterEach(async () => {
  for (const c of open) await c.close().catch(() => {});
  open = [];
});

// A visitor in their own browser profile, with a fixed device name and the walkthrough already seen
async function device(browser, name, { relayOnly = false, path = '/' } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  open.push(context);
  await context.addInitScript((name) => {
    localStorage.setItem('omnibeam-name', name);
    localStorage.setItem('omnibeam-tour', 'done');
    localStorage.setItem('omnibeam-analytics', 'off');
    if (!localStorage.getItem('omnibeam-lang')) localStorage.setItem('omnibeam-lang', 'en');
  }, name);
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
  await page.goto(path + (path.includes('?') ? '&' : '?') + 'analytics=off');
  await expect(page.locator('#me-name')).toHaveText(name);
  await expect(page.locator('#me-scope')).not.toHaveText(/Connecting/);
  return { page, errors, name };
}
const card = async (page, name) => {
  const el = page.locator('.peer:not(.offline)').filter({ has: page.locator('.name', { hasText: name }) });
  await expect(el).toBeVisible();
  return el;
};
// How the last transfer to that device went (other OmniBeam tabs on this network can be in the list too)
const routeTo = (from, to) => from.page.evaluate((name) => [...peers.values()].find((p) => p.info && p.info.name === name)?.lastRoute, to.name);
async function send(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
  const ask = to.page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
  const got = to.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 90000 });
  const download = to.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const d = await download;
  const buf = fs.readFileSync(await d.path());
  await expect(got).toBeHidden();
  return { name: d.suggestedFilename(), buf };
}

test('the newest version is live', async ({ request }) => {
  const res = await request.get('/?analytics=off');
  expect(res.status()).toBe(200);
  const html = await res.text();
  const path = require('path');
  const local = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  expect(html).toContain(local.match(/\/app\.js\?v=\d+/)[0]);
  // style.css is put inside the page now (no ?v= link), so compare the build fingerprint the server works out
  // from index.html, app.js and style.css, the same way as server.js does
  // The upload zip has minified scripts (tools/minify.js), so the fingerprint is made from those, as on the server
  const { shipped } = require('../tools/minify');
  const build = require('crypto').createHash('sha256')
    .update((await Promise.all(['index.html', 'app.js', 'style.css'].map((f) => shipped(`public/${f}`, fs.readFileSync(path.join(__dirname, '..', 'public', f)))))).join('\n'))
    .digest('hex').slice(0, 12);
  expect(html, 'the live build differs from the files on this PC').toContain(`<meta name="omnibeam-build" content="${build}">`);
  expect(html).toContain('id="btn-menu"');
  expect(html).not.toContain('fonts.googleapis.com');
  for (const file of ['/more.js?v=3', '/fonts/plus-jakarta-sans-latin.woff2?v=1', '/qrcode.js?v=1', '/sw.js', '/manifest.webmanifest']) {
    expect((await request.get(file)).status(), file).toBe(200);
  }
  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toContain('no-store');
  expect(await sw.text()).toMatch(/const VERSION = '[0-9a-f]{12}';/);
  const csp = res.headers()['content-security-policy'] || '';
  expect(csp).toContain("font-src 'self'");
});

test('old page addresses send visitors to the current pages', async ({ request }) => {
  // The old hand-uploaded copies (public/about.html…) are removed on deploy (tools/old-site-files.txt), so the
  // server answers these and sends them to the pages built from public/pages/
  for (const slug of ['about', 'privacy', 'terms', 'how-to-use']) {
    const res = await request.get(`/${slug}.html`, { maxRedirects: 0 });
    expect(res.status(), `/${slug}.html`).toBe(301);
    expect(res.headers().location, `/${slug}.html`).toMatch(new RegExp(`/${slug}$`));
  }
  expect((await request.get('/index.zip', { maxRedirects: 0 })).status()).toBe(404);
});

for (const lang of ['', 'ar/', 'fr/', 'es/', 'tr/']) {
  test(`home page /${lang} and its guides load without errors`, async ({ browser, request }) => {
    const d = await device(browser, `Live check ${run}`, { path: '/' + lang });
    if (lang === 'ar/') await expect(d.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await d.page.locator('#btn-menu').click();
    await expect(d.page.locator('#menu')).toBeVisible();
    expect(d.errors).toEqual([]);
    for (const p of ['how-to-use', 'privacy', 'send-large-files-by-link', 'guides', 'blog']) {
      expect((await request.get('/' + lang + p)).status(), lang + p).toBe(200);
    }
  });
}

test('the first visit loads only what it needs', async ({ browser }) => {
  const d = await device(browser, `Live check ${run}`);
  const loaded = await d.page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  expect(loaded.some((u) => u.includes('/more.js'))).toBe(false);
  expect(loaded.some((u) => u.includes('/qrcode.js'))).toBe(false);
  expect(loaded.some((u) => /fonts\.(googleapis|gstatic)/.test(u))).toBe(false);
  const t = await d.page.evaluate(() => performance.getEntriesByType('navigation')[0].toJSON());
  console.log(`  page loaded in ${Math.round(t.loadEventEnd)} ms on this PC`);
});

test('two browsers find each other, send files both ways and a message', async ({ browser }) => {
  const a = await device(browser, `Live A ${run}`);
  const b = await device(browser, `Live B ${run}`);
  const one = makeFile('live-photo.jpg', 2 * 1024 * 1024 + 11, 'image/jpeg');
  let got = await send(a, b, [one]);
  expect(sha(got.buf)).toBe(sha(one.buffer));
  console.log('  A → B went', await routeTo(a, b));
  const two = [makeFile('a.txt', 2000, 'text/plain'), makeFile('b.bin', 300 * 1024)];
  got = await send(b, a, two);
  expect(got.name).toMatch(/\.zip$/);
  for (const f of two) expect(got.buf.includes(f.buffer)).toBe(true);
  // A message
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=message]').click();
  await a.page.locator('#dlg-chat textarea').fill(`hello from the live check ${run}`);
  await a.page.locator('#dlg-chat [data-act=send]').click();
  await expect(b.page.locator('#dlg-chat .bubble.in').last()).toContainText(`hello from the live check ${run}`);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a file goes through the server when a direct connection is impossible', async ({ browser }) => {
  const a = await device(browser, `Live C ${run}`, { relayOnly: true });
  const b = await device(browser, `Live D ${run}`, { relayOnly: true });
  const file = makeFile('live-report.pdf', 1024 * 1024 + 5, 'application/pdf');
  const got = await send(a, b, [file]);
  expect(sha(got.buf)).toBe(sha(file.buffer));
  expect(['relay', 'turn']).toContain(await routeTo(a, b));
});

test('menu items, the pairing QR code and the connection check work', async ({ browser }) => {
  const d = await device(browser, `Live check ${run}`);
  await d.page.locator('#btn-pair').click();
  await expect(d.page.locator('#pair-qr svg')).toBeVisible();
  await d.page.keyboard.press('Escape');
  await d.page.locator('#btn-menu').click();
  await d.page.locator('#menu-check').click();
  await expect(d.page.locator('#dlg-check .check-list')).toContainText('Connected to the OmniBeam server', { timeout: 30000 });
  await d.page.locator('#dlg-check [data-act=close]').first().click();
  await d.page.locator('#bar-settings').click();
  await expect(d.page.locator('#dlg-settings')).toBeVisible();
  expect(d.errors).toEqual([]);
});

test('a share link uploads and downloads intact', async ({ browser }) => {
  const d = await device(browser, `Live check ${run}`);
  await d.page.locator('#btn-menu').click();
  await expect(d.page.locator('#btn-link')).toBeVisible();
  await d.page.locator('#btn-link').click();
  await d.page.locator('#link-hours').selectOption('1');
  await d.page.locator('#link-max').selectOption('1');
  const file = makeFile('live-link.bin', 600 * 1024);
  const chooser = d.page.waitForEvent('filechooser');
  await d.page.locator('#dlg-link [data-act=pick]').click();
  await (await chooser).setFiles([file]);
  await expect(d.page.locator('#link-url')).toContainText('/d/', { timeout: 60000 });
  await expect(d.page.locator('#link-qr svg')).toBeVisible();
  const url = await d.page.locator('#link-url').textContent();
  // Someone else opens the link
  const ctx = await browser.newContext({ acceptDownloads: true });
  open.push(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await expect(p.locator('#drop-get')).toBeVisible();
  const download = p.waitForEvent('download');
  await p.locator('#drop-get').click();
  const buf = fs.readFileSync(await (await download).path());
  expect(sha(buf)).toBe(sha(file.buffer));
  expect(d.errors).toEqual([]);
});
