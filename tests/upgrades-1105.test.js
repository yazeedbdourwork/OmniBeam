// The five upgrades of 2026-11-05:
// 1. faster load: minified scripts in the upload zip (and the site still works from them), Google Analytics only
//    after Allow and when the page is idle, the Support links in the page from the start (no layout shift on /ar/)
// 2. the intro video on the home page: a poster that loads no video until pressed, in the page's language, VideoObject
// 3. the public status page (/status), with the uptime Worker's checks
// 4. the "Send me files" box for other websites (/embed/r/<id>), end-to-end with the device's public key
// 5. the Telegram bot (a fake Telegram API on port 3998 here)
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { openDevice, makeFile, sha, menu, settingsTab, sendAndReceive } = require('./helpers');

const ROOT = path.join(__dirname, '..');
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// A second OmniBeam server for a test that needs other settings (GA on, or the files of the upload zip)
async function startServer({ cwd = ROOT, port, env = {} }) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-1105-'));
  const proc = spawn(process.execPath, ['server.js'], { cwd, stdio: 'ignore', env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: 'test', GA_ID: ' ', ...env } });
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { if ((await fetch(`http://localhost:${port}/config.json`)).ok) break; } catch {}
  }
  const gone = new Promise((r) => proc.on('exit', r));
  return { url: `http://localhost:${port}`, stop: async () => { proc.kill(); await gone; try { fs.rmSync(data, { recursive: true, force: true }); } catch {} } };
}

// ---------- 1. Faster load ----------

test('the upload zip: minified scripts parse, keep their addresses, and the site works from them', async ({ browser }) => {
  test.setTimeout(240000);
  const { shipped } = require('../tools/minify');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-zip-'));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  let before = 0, after = 0;
  for (const f of walk(path.join(ROOT, 'public'))) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel.startsWith('public/media/') || rel.endsWith('.zip')) continue; // big files nobody minifies
    const raw = fs.readFileSync(f);
    const out = await shipped(rel, raw);
    if (/^public\/(?!tools\/|pages\/).+\.js$/.test(rel)) { before += raw.length; after += out.length; }
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), out);
  }
  expect(after).toBeLessThan(before * 0.85);
  // The addresses server.js reads from app.js keep their quotes
  const urls = (s) => [...s.matchAll(/['`](\/[a-z0-9-]+\.js\?v=\d+)['`]/g)].map((m) => m[1]).sort();
  expect(urls(fs.readFileSync(path.join(dir, 'public/app.js'), 'utf8'))).toEqual(urls(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8')));
  // The rest of the app folder as it is on the host (only server.js and public/ are in the zip)
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(dir, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'service-worker.js'), path.join(dir, 'service-worker.js'));
  fs.cpSync(path.join(ROOT, 'vendor'), path.join(dir, 'vendor'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public', 'media'), path.join(dir, 'public', 'media'), { recursive: true });
  // MINIFY=false: what LiteSpeed does, the files go out exactly as they are in the zip
  const srv = await startServer({ cwd: dir, port: 3995, env: { MINIFY: 'false' } });
  try {
    const appJs = await (await fetch(`${srv.url}/app.js?v=1`)).text();
    expect(appJs.length).toBeLessThan(fs.statSync(path.join(ROOT, 'public/app.js')).size * 0.7);
    const a = await open(browser, 'Zip PC', { path: `${srv.url}/` });
    const b = await open(browser, 'Zip Phone', { path: `${srv.url}/` });
    const files = [makeFile('zip.bin', 300000)];
    const got = await sendAndReceive(a, b, files);
    expect(sha(got.buf)).toBe(sha(files[0].buffer));
    // A part loaded on demand (more.js) and a translated page
    await menu(a.page, 'btn-settings');
    await expect(a.page.locator('#dlg-settings')).toBeVisible();
    const c = await open(browser, 'Zip Arabic', { path: `${srv.url}/ar/` });
    await expect(c.page.locator('.empty-title')).toHaveText('جاهز للإرسال');
    for (const d of [a, b, c]) expect(d.errors).toEqual([]);
  } finally {
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('Google Analytics: nothing from Google before Allow; then the page view, when idle or at the first tap', async ({ browser }) => {
  test.setTimeout(120000);
  const srv = await startServer({ port: 3994, env: { GA_ID: 'G-TEST12345', FB_PIXEL_ID: '' } });
  try {
    const visit = async (storage) => {
      const ctx = await browser.newContext();
      await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); localStorage.setItem('omnibeam-tour', 'done'); }, storage);
      const google = [];
      // The route added last is asked first: the stub for Google comes after the catch-all
      await ctx.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort());
      await ctx.route(/googletagmanager\.com/, (r) => { google.push(Date.now()); r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__gtagLoaded = (window.__gtagLoaded || 0) + 1;' }); });
      const page = await ctx.newPage();
      await page.goto(`${srv.url}/`);
      return { ctx, page, google };
    };
    // First visit: the banner, and no request to Google at all, even after a while and a tap
    const first = await visit({});
    await expect(first.page.locator('.ob-consent')).toBeVisible();
    await first.page.mouse.click(5, 300);
    await first.page.waitForTimeout(2500);
    expect(first.google).toEqual([]);
    // Allow: Google's script is fetched now, and the page view comes after the consent update
    await first.page.locator('.ob-consent .ob-allow').click();
    await expect.poll(() => first.google.length).toBe(1);
    const queue = await first.page.evaluate(() => dataLayer.map((a) => [a[0], a[1], a[2] && a[2].analytics_storage]));
    const update = queue.findIndex((q) => q[0] === 'consent' && q[1] === 'update' && q[2] === 'granted');
    const config = queue.findIndex((q) => q[0] === 'config' && q[1] === 'G-TEST12345');
    expect(update).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(update);
    await first.ctx.close();
    // Allowed on an earlier visit: not during the load, then once (idle at the latest after 5 s)
    const again = await visit({ 'omnibeam-analytics': 'yes' });
    const loaded = await again.page.evaluate(() => performance.getEntriesByType('navigation')[0].loadEventEnd);
    await expect.poll(() => again.google.length, { timeout: 10000 }).toBe(1);
    const at = await again.page.evaluate(() => performance.getEntriesByType('resource').find((r) => /googletagmanager/.test(r.name))?.startTime || 0);
    expect(at).toBeGreaterThanOrEqual(loaded);
    await again.page.mouse.click(5, 300);
    await again.page.waitForTimeout(500);
    expect(again.google.length).toBe(1);
    await again.ctx.close();
    // No thanks: never
    const no = await visit({ 'omnibeam-analytics': 'no' });
    await no.page.waitForTimeout(6000);
    await no.page.mouse.click(5, 300);
    expect(no.google).toEqual([]);
    await no.ctx.close();
  } finally {
    await srv.stop();
  }
});

test('the Support links are in the page from the start, so nothing moves on /ar/ when the app starts', async ({ browser, baseURL }) => {
  const html = await (await fetch(`${baseURL}/ar/`)).text();
  expect(html).toMatch(/<a class="footer-link-btn support-link" id="footer-support" href="https:\/\/ko-fi\.com\/omnibeam-test" target="_blank" rel="noopener">/);
  expect(html).toMatch(/<span class="dot-sep support-link">/);
  expect(html).toMatch(/<a id="btn-support" class="icon-btn support-btn support-link" href="https:\/\/ko-fi\.com\/omnibeam-test"/);
  // Layout shift while a phone on a slow connection loads /ar/ (it was 0.14 before)
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('omnibeam-tour', 'done');
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${baseURL}/ar/`, { waitUntil: 'load', timeout: 60000 });
  await expect(page.locator('#me-name')).not.toHaveText('…', { timeout: 30000 });
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.05);
  await ctx.close();
});

// ---------- 2. The intro video ----------

test('intro video: a poster until pressed (no video bytes), the page language, its length, VideoObject', async ({ browser, baseURL }) => {
  const a = await open(browser, 'Video PC', { path: '/ar/' });
  const video = [];
  a.page.on('request', (r) => { if (/\.mp4/.test(r.url())) video.push(r.url()); });
  const poster = a.page.locator('.intro-poster .intro-play');
  await expect(poster).toHaveAttribute('href', '/media/intro-ar.mp4?v=4');
  await expect(poster.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(poster.locator('img')).toHaveAttribute('src', '/media/intro-ar.webp?v=4');
  await expect(poster.locator('.intro-time')).toHaveText('1:02');
  await expect(a.page.locator('#intro-title')).toHaveText('OmniBeam في دقيقة واحدة');
  await poster.scrollIntoViewIfNeeded();
  await a.page.waitForTimeout(1000);
  expect(video).toEqual([]);
  const box = await poster.boundingBox();
  await poster.click();
  const player = a.page.locator('.intro-poster video.intro-inline');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('src', /\/media\/intro-ar\.mp4\?v=4$/);
  await expect.poll(() => video.length).toBeGreaterThan(0);
  // Same place and size: nothing below it moves
  const now = await player.boundingBox();
  expect(Math.abs(now.height - box.height)).toBeLessThan(2);
  expect(a.errors).toEqual([]);
  // Search engines: a VideoObject in this language, with the length from the file
  for (const [p, lang, secs] of [['/', 'en', 52], ['/ar/', 'ar', 62], ['/de/', 'de', 53]]) {
    const html = await (await fetch(`${baseURL}${p}`)).text();
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const v = ld['@graph'].find((g) => g['@type'] === 'VideoObject');
    expect(v).toMatchObject({ inLanguage: lang, duration: `PT${secs}S`, contentUrl: `https://omnibeam.site/media/intro-${lang}.mp4?v=4` });
    expect(v.thumbnailUrl[0]).toBe(`https://omnibeam.site/media/intro-${lang}.jpg`);
    expect(v.name.length).toBeGreaterThan(5);
    expect(v.uploadDate).toMatch(/^2026-/);
  }
});

// ---------- 3. The status page ----------

test('status page: all working, the Worker\'s checks make uptime and incidents, in every language, linked in the footer', async ({ request, baseURL }) => {
  const res = await request.get('/status');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(res.headers()['x-robots-tag']).toBe('noindex');
  let html = await res.text();
  expect(html).toContain('<h1>OmniBeam status</h1>');
  expect(html).toMatch(/class="status-now (ok|bad)"/);
  expect(html.match(/<div class="status-bars"[^>]*>([\s\S]*?)<\/div>/)[1].match(/<span/g).length).toBe(30);
  // The Worker's secret is needed
  expect((await request.post('/api/status/checks', { data: { checks: [] } })).status()).toBe(403);
  expect((await request.post('/api/status/checks', { data: { checks: [] }, headers: { Authorization: 'Bearer wrong' } })).status()).toBe(403);
  // An outage of two checks while the site was down, sent late (the Worker keeps them), then it is back
  const t = Date.now() - 20 * 60 * 1000;
  const auth = { Authorization: 'Bearer test-status-key' };
  const post = await request.post('/api/status/checks', { headers: auth, data: { checks: [
    { at: t, ok: false, status: 0, error: 'timeout' }, { at: t + 300000, ok: false, status: 502 }, { at: t + 600000, ok: true, ms: 300 }] } });
  expect(await post.json()).toMatchObject({ ok: true, added: 3 });
  // Sent again: not counted twice
  expect(await (await request.post('/api/status/checks', { headers: auth, data: { checks: [{ at: t + 600000, ok: true }] } })).json()).toMatchObject({ added: 0 });
  const s = await (await request.get('/api/status')).json();
  expect(s.parts.web).toBe(true);
  expect(s.outside).toBe(true);
  expect(s.incidents[0]).toMatchObject({ part: 'web', start: t });
  expect(s.incidents[0].end).toBe(t + 600000);
  html = await (await request.get('/status')).text();
  expect(html).toContain('The website could not be reached');
  expect(html).toContain('10 min');
  expect(JSON.stringify(s)).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no addresses
  // Translated, and linked from the home page and every page's footer
  for (const [lang, word] of [['ar', 'حالة OmniBeam'], ['fr', "État d'OmniBeam"], ['hi', 'OmniBeam की स्थिति']]) {
    const page = await (await request.get(`/${lang}/status`)).text();
    expect(page).toContain(`<h1>${word}</h1>`);
    expect(page).toContain(`<link rel="alternate" hreflang="en" href="https://omnibeam.site/status">`);
  }
  expect(await (await request.get('/')).text()).toMatch(/<a class="footer-link-btn" href="\/status">Status<\/a>/);
  expect(await (await request.get('/ar/')).text()).toMatch(/<a class="footer-link-btn" href="\/ar\/status">الحالة<\/a>/);
  expect(await (await request.get('/privacy')).text()).toContain('<a href="/status">Status</a>');
  // Not in the sitemap (it changes all the time and isn't indexed)
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain('/status<');
  void baseURL;
});

// ---------- 4. The "Send me files" box for websites ----------

test('website box: the code from Request files works inside another site, end-to-end, with a Powered by link', async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Blog Owner');
  await menu(a.page, 'btn-request');
  await a.page.fill('#req-ask', 'Your photos for the blog');
  await a.page.selectOption('#req-hours', '8760');
  await a.page.locator('#dlg-asklink [data-act=make]').click();
  await expect(a.page.locator('#req-done')).toBeVisible();
  await expect(a.page.locator('#req-summary')).toContainText('days left');
  await a.page.locator('#dlg-asklink [data-act=embed]').click();
  const code = await a.page.locator('#req-embed-code').inputValue();
  expect(code).toMatch(/^<iframe src="http:\/\/localhost:3999\/embed\/r\/[A-Za-z0-9_-]{16}#[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{87}" title="Send me files"/);
  expect(code).toContain('<a href="http://localhost:3999/">Powered by OmniBeam</a>');
  await expect(a.page.locator('#req-embed-short')).toBeHidden();
  // The key never reaches the server: only after #
  const src = code.match(/src="([^"]+)"/)[1];
  expect(src.split('#')[0]).not.toContain(src.split('#')[1].split('.')[0]);

  // Only this page may be framed by other sites; every other page still refuses
  const embedRes = await fetch(src.split('#')[0]);
  expect(embedRes.headers.get('content-security-policy')).toContain('frame-ancestors *');
  expect(embedRes.headers.get('x-frame-options')).toBeNull();
  expect(embedRes.headers.get('x-robots-tag')).toContain('noindex');
  const home = await fetch(`${baseURL}/`);
  expect(home.headers.get('x-frame-options')).toBe('DENY');
  expect(home.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const req = await fetch(`${baseURL}${new URL(src).pathname.replace('/embed', '')}`);
  expect(req.headers.get('x-frame-options')).toBe('DENY');

  // Someone's blog, on another origin, with the code pasted in
  const blog = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(`<!doctype html><title>My blog</title><h1>My blog</h1>${code}`); });
  await new Promise((r) => blog.listen(3993, r));
  const ctx = await browser.newContext();
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:3993/');
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#req-title')).toHaveText('Send files to Blog Owner');
    await expect(frame.locator('#req-ask')).toHaveText('Your photos for the blog');
    await expect(frame.locator('.embed-powered a')).toHaveAttribute('target', '_blank');
    const files = [makeFile('from-blog.jpg', 600000, 'image/jpeg')];
    await frame.locator('#req-input').setInputFiles(files);
    let meta = '';
    page.on('request', (r) => { if (/\/api\/request\/[^/]+\/upload$/.test(r.url())) meta = JSON.parse(r.postData()).meta; });
    await frame.locator('#req-send').click();
    await expect(frame.locator('#drop-status')).toHaveText('Sent ✓ Blog Owner gets the files on their device.');
    // Sealed to the device's public key, not with the (public) link key
    expect(meta).toMatch(/^x1\.[A-Za-z0-9_-]{87}\./);
    const got = a.page.locator('#dlg-received');
    await expect(got).toBeVisible({ timeout: 30000 });
    const list = await a.page.evaluate(async () => Promise.all(History.items.slice(0, 1).map(async (f) => {
      const blob = await History.blobOf(f);
      return { name: f.name, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('') };
    })));
    expect(list[0]).toEqual({ name: 'from-blog.jpg', hash: sha(files[0].buffer) });
    // In the box's language when the code says so
    await page.goto('about:blank');
    const ar = await ctx.newPage();
    await ar.goto(src.replace('#', '?lang=ar#'));
    await expect(ar.locator('.embed-powered a')).toHaveText('مدعوم من OmniBeam');
    expect(errors).toEqual([]);
  } finally {
    blog.close();
  }
  // The guide page exists in all 9 languages and is listed with the guides
  for (const p of ['/embed', '/ar/embed', '/fr/embed', '/es/embed', '/tr/embed', '/de/embed', '/pt/embed', '/hi/embed', '/id/embed', '/ru/embed', '/ja/embed', '/zh/embed', '/ko/embed', '/it/embed', '/ur/embed']) {
    const r = await fetch(`${baseURL}${p}`);
    expect([p, r.status]).toEqual([p, 200]);
    expect(await r.text()).toContain('"@type":"FAQPage"');
  }
  expect(await (await fetch(`${baseURL}/guides`)).text()).toContain('href="/embed"');
  expect(a.errors).toEqual([]);
});

// ---------- 5. The Telegram bot ----------

// A fake Telegram Bot API: records what the server asks and serves one file
function fakeTelegram() {
  const calls = [];
  const fileBody = crypto.randomBytes(150000);
  const srv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
      const reply = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
      if (req.url.startsWith('/file/bottest-token/photos/file_1.jpg')) { res.writeHead(200); return res.end(fileBody); }
      if (!m || m[1] !== 'test-token') { res.writeHead(401); return res.end('{"ok":false,"description":"Unauthorized"}'); }
      const method = m[2];
      const json = /json/.test(req.headers['content-type'] || '') ? JSON.parse(body.toString() || '{}') : null;
      calls.push({ method, json, body, type: req.headers['content-type'] });
      if (method === 'getFile') return reply({ file_id: json.file_id, file_path: 'photos/file_1.jpg', file_size: fileBody.length });
      reply(method === 'getMe' ? { username: 'OmniBeam_test_bot' } : { message_id: calls.length });
    });
  });
  return { calls, fileBody, start: () => new Promise((r) => srv.listen(3998, r)), stop: () => new Promise((r) => srv.close(r)) };
}

test('Telegram: link from Settings, receive text and a photo, the 20 MB limit, send a file to the chat, unlink', async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const tgApi = fakeTelegram();
  await tgApi.start();
  try {
    const hook = `${baseURL}/api/tg/${crypto.createHash('sha256').update('omnibeam-tg-path:test-token').digest('hex').slice(0, 32)}`;
    const secret = crypto.createHash('sha256').update('omnibeam-tg-header:test-token').digest('hex').slice(0, 48);
    let updateId = 1;
    const send = (message, headers = { 'X-Telegram-Bot-Api-Secret-Token': secret }) => fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ update_id: updateId++, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Yazeed', language_code: 'en' }, ...message } }) });
    const said = async (re) => expect.poll(() => tgApi.calls.filter((c) => c.method === 'sendMessage').map((c) => c.json.text).find((t) => re.test(t)) || '', { timeout: 15000 }).toMatch(re);

    // Only Telegram (with the secret header) can use the webhook
    expect((await send({ text: 'hi' }, {})).status).toBe(403);

    const a = await open(browser, 'Telegram PC');
    await menu(a.page, 'btn-settings');
    await settingsTab(a.page, 'apps');
    await expect(a.page.locator('#tg-section')).toBeVisible();
    await expect(a.page.locator('#tg-state')).toHaveText('Not linked yet.');
    await a.page.locator('#tg-link').click();
    await expect(a.page.locator('#tg-wait')).toBeVisible();
    const tme = await a.page.locator('#tg-open').getAttribute('href');
    expect(tme).toMatch(/^https:\/\/t\.me\/OmniBeam_test_bot\?start=[A-Za-z0-9_-]{16}$/);
    // Not linked by a wrong code; linked by the right one ("Start" in Telegram)
    await send({ text: '/start wrongcode123' });
    await said(/expired or was already used/);
    await send({ text: `/start ${tme.split('=')[1]}` });
    await said(/Linked to Telegram PC/);
    await expect(a.page.locator('#tg-state')).toHaveText('Linked to Telegram (Yazeed).', { timeout: 10000 });
    await expect(a.page.locator('#tg-on')).toBeVisible();
    await a.page.locator('#dlg-settings').evaluate((d) => d.close());

    // A text message arrives as a message
    await send({ text: 'Hello from Telegram' });
    await expect(a.page.locator('#dlg-text .text-body')).toHaveText('Hello from Telegram', { timeout: 20000 });
    await said(/Sent to Telegram PC/);
    await a.page.locator('#dlg-text [data-act=close]').click();
    // A photo arrives as a file with its bytes, sealed to this device on the server
    await send({ photo: [{ file_id: 'small', file_size: 1000 }, { file_id: 'big', file_size: tgApi.fileBody.length }] });
    await expect(a.page.locator('#dlg-received')).toBeVisible({ timeout: 20000 });
    await expect(a.page.locator('#dlg-received .who')).toHaveText('Yazeed (Telegram)');
    const got = await a.page.evaluate(async () => {
      const f = History.items[0];
      const blob = await History.blobOf(f);
      return { name: f.name, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('') };
    });
    expect(got.name).toMatch(/^Photo .+\.jpg$/);
    expect(got.hash).toBe(sha(tgApi.fileBody));
    expect(tgApi.calls.find((c) => c.method === 'getFile').json.file_id).toBe('big');
    await a.page.locator('#dlg-received [data-act=close]').click();
    // Too big for a bot: told in Telegram, nothing downloaded
    const before = tgApi.calls.filter((c) => c.method === 'getFile').length;
    await send({ document: { file_id: 'huge', file_size: 25 * 1024 * 1024, file_name: 'movie.mp4' } });
    await said(/This file is 25 MB\. Telegram only lets bots receive files up to 20 MB/);
    expect(tgApi.calls.filter((c) => c.method === 'getFile').length).toBe(before);

    // From OmniBeam to the chat: ⋯ → Send to Telegram
    await menu(a.page, 'btn-tg');
    await expect(a.page.locator('#dlg-tg')).toBeVisible();
    await a.page.fill('#tg-text', 'A note too');
    const chooser = a.page.waitForEvent('filechooser');
    await a.page.locator('#tg-pick').click();
    const out = makeFile('report.pdf', 70000, 'application/pdf');
    await (await chooser).setFiles([out]);
    await a.page.locator('#tg-send').click();
    await expect(a.page.locator('#toast')).toContainText('Sent to Telegram');
    const doc = tgApi.calls.find((c) => c.method === 'sendDocument');
    expect(doc.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(doc.body.includes(out.buffer)).toBe(true);
    expect(doc.body.toString('latin1')).toContain('filename="report.pdf"');
    expect(doc.body.toString('latin1')).toContain('name="chat_id"\r\n\r\n555');
    await said(/A note too/);

    // Unlink in Settings: the chat is told, and messages there are no longer passed on
    await menu(a.page, 'btn-settings');
    await settingsTab(a.page, 'apps');
    await a.page.locator('#tg-unlink').click();
    await expect(a.page.locator('#tg-state')).toHaveText('Not linked yet.');
    await said(/Unlinked/);
    await send({ text: 'still there?' });
    await said(/not linked to a device yet/);
    expect(a.errors).toEqual([]);
  } finally {
    await tgApi.stop();
  }
});

test('Telegram is off without a token: no section, no menu item, the API answers 404', async ({ browser }) => {
  const srv = await startServer({ port: 3992, env: { TG_BOT_TOKEN: '', SUPPORT_URL: '' } });
  try {
    expect((await fetch(`${srv.url}/api/tg/pair?id=x`, { method: 'POST' })).status).toBe(404);
    const cfg = await (await fetch(`${srv.url}/config.json`)).json();
    expect(cfg.telegram).toBeNull();
    const a = await open(browser, 'No Bot PC', { path: `${srv.url}/` });
    await menu(a.page, 'btn-settings');
    await settingsTab(a.page, 'apps');
    await expect(a.page.locator('#tg-section')).toBeHidden();
    await expect(a.page.locator('#btn-tg')).toBeHidden();
  } finally {
    await srv.stop();
  }
});
