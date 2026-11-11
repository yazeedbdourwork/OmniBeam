// The eight upgrades of 2026-11-06:
// 1. six new languages (ru, ja, zh, ko, it, ur; Urdu right to left like Arabic)
// 2. the Google Play listing pack (store/google-play)
// 3. the WordPress plugin for the "Send me files" box (tools/omnibeam-wordpress -> public/tools/omnibeam-wordpress.zip)
// 4. Scan to PDF (scan.js): pages from the camera, edges found and straightened, a PDF made in the browser
// 5. automatic deploys (.github/workflows/deploy.yml, .gitignore)
// 6. the chat view of a device (chat.js), with the unread number on its card
// 7. "Original / Smaller" photos before sending
// 8. supporter codes (Settings -> Supporter, /stats -> Supporters)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { openDevice, card, makeFile } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const NEW = ['ru', 'ja', 'zh', 'ko', 'it', 'ur'];
const ALL = ['en', 'ar', 'fr', 'es', 'tr', 'de', 'pt', 'hi', 'id', ...NEW];
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Unpacks a zip made by tools/deploy.js (stored or deflated entries): name -> Buffer
function unzip(buf) {
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString();
    const body = buf.slice(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out[name] = method === 8 ? zlib.inflateRawSync(body) : body;
    i += 30 + nameLen + extra + size;
  }
  return out;
}

// ---------- 1. Six new languages ----------

test('the six new languages: home page, direction, language menu, hreflang and every guide page', async ({ page, request }) => {
  test.setTimeout(180000);
  const en = fs.readdirSync(path.join(ROOT, 'public', 'pages', 'en')).filter((f) => f.endsWith('.html'));
  for (const code of NEW) {
    // The app's translations cover every text the other languages have
    const pack = require(`../public/lang/${code}.js`);
    const de = require('../public/lang/de.js');
    expect(pack.code).toBe(code);
    expect(pack.dir).toBe(code === 'ur' ? 'rtl' : 'ltr');
    const missing = Object.keys(de.strings).filter((k) => !pack.strings[k]);
    expect(missing, `${code}: untranslated`).toEqual([]);
    // Placeholders like {name} kept as they are
    for (const [k, v] of Object.entries(pack.strings)) {
      const want = (k.match(/\{[a-z]+\}/gi) || []).sort().join();
      const got = (v.match(/\{[a-z]+\}/gi) || []).filter((p) => (k.match(/\{[a-z]+\}/gi) || []).includes(p));
      expect([...new Set(got)].sort().join(), `${code}: ${k}`).toBe([...new Set(want.split(',').filter(Boolean))].sort().join());
    }
    // Every guide page of the English site in this language too
    const have = fs.readdirSync(path.join(ROOT, 'public', 'pages', code));
    expect(en.filter((f) => !have.includes(f)), `${code}: pages`).toEqual([]);
    const r = await request.get(`/${code}/`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain(`<html lang="${code}" dir="${code === 'ur' ? 'rtl' : 'ltr'}">`);
    expect(html).toContain(`<link rel="canonical" href="https://omnibeam.site/${code}/">`);
    for (const l of ALL.filter((x) => x !== 'en')) expect(html, `${code}: hreflang ${l}`).toContain(`hreflang="${l}"`);
    for (const slug of ['how-to-use', 'privacy', 'terms', 'about', 'embed', 'status', 'guides']) {
      const p = await request.get(`/${code}/${slug}`);
      expect(p.status(), `/${code}/${slug}`).toBe(200);
      expect(await p.text()).toContain(`<html lang="${code}" dir="${code === 'ur' ? 'rtl' : 'ltr'}">`);
    }
  }
  // The English home page lists them, the language menu has them, the sitemap has their pages
  const home = await (await request.get('/')).text();
  for (const code of NEW) {
    expect(home).toContain(`<link rel="alternate" hreflang="${code}" href="https://omnibeam.site/${code}/">`);
    expect(home).toContain(`<option value="${code}" lang="${code}">`);
  }
  const map = await (await request.get('/sitemap.xml')).text();
  for (const code of NEW) {
    expect(map).toContain(`<loc>https://omnibeam.site/${code}/</loc>`);
    expect(map).toContain(`<loc>https://omnibeam.site/${code}/how-to-use</loc>`);
  }
  // Urdu runs right to left in the app, like Arabic
  await page.addInitScript(() => { localStorage.setItem('omnibeam-tour', 'done'); localStorage.setItem('omnibeam-name', 'Urdu test'); });
  await page.goto('/ur/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#me-name')).toHaveText('Urdu test');
  await page.goto('/ja/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('every new text of the eight upgrades is translated in all 15 languages', async () => {
  const keys = ['Scan to PDF', 'Chat', 'Original', 'Smaller', 'Supporter', 'Black and white', 'Colour', 'Take page', 'Add page',
    'Save PDF', 'Photo size when sending', 'Smaller photos (up to 2048 px, JPG)', 'Unlock', 'Ocean', 'Rose',
    'Smaller: {size} instead of {was} (saved {saved})', '{n} new in the chat with {name}', 'Today', 'Yesterday',
    'Drag the four corners onto the corners of the page.', 'Thank you for supporting OmniBeam! ♥ The supporter perks are on.'];
  for (const code of ALL.filter((l) => l !== 'en')) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
  }
  // The small pages with their own translations (download page, upload page, cookie banner) know the new languages
  for (const f of ['get.js', 'put.js', 'consent.js']) {
    const src = read('public', f);
    for (const code of NEW) expect(src, `${f}: ${code}`).toMatch(new RegExp(`\\b${code}: [\\[{']`));
  }
});

// ---------- 2. Google Play listing pack: skipped at the owner's request (2026-11-06) ----------

// ---------- 3. WordPress plugin ----------

test('the WordPress plugin: zip on the site, shortcode, block, settings, only omnibeam.site boxes, escaped', async ({ request }) => {
  const r = await request.get('/tools/omnibeam-wordpress.zip');
  expect(r.status()).toBe(200);
  const files = unzip(await r.body());
  expect(Object.keys(files).sort()).toEqual(['omnibeam-box/block.js', 'omnibeam-box/omnibeam-box.php', 'omnibeam-box/readme.txt', 'omnibeam-box/uninstall.php']);
  const php = files['omnibeam-box/omnibeam-box.php'].toString();
  expect(php).toMatch(/\* Plugin Name:\s+OmniBeam/);
  expect(php).toMatch(/\* License:\s+GPL-2\.0-or-later/);
  expect(php).toContain("add_shortcode( 'omnibeam_box'");
  expect(php).toContain("register_block_type(\n\t\t'omnibeam/box'");
  expect(php).toContain('add_options_page(');
  expect(php).toContain("if ( ! defined( 'ABSPATH' ) )");
  for (const f of ['esc_url(', 'esc_attr(', 'esc_html__(', 'esc_textarea(']) expect(php).toContain(f);
  // The PHP rule for box links, tried here with JavaScript's regular expressions (same syntax for this pattern)
  const rule = new RegExp(php.match(/preg_match\( '~(.*?)~', \$value \)/)[1]);
  const box = 'https://omnibeam.site/embed/r/AbCdEfGh12?lang=ar#key_part.publicKey-123';
  expect(rule.test(box)).toBe(true);
  for (const bad of ['http://omnibeam.site/embed/r/AbCdEfGh12#key_part.public', 'https://evil.example/embed/r/AbCdEfGh12#key_part.public',
    'https://omnibeam.site/r/AbCdEfGh12#key_part.publicKey', 'https://omnibeam.site/embed/r/AbCdEfGh12#x" onload="alert(1)',
    'https://omnibeam.site.evil.example/embed/r/AbCdEfGh12#key_part.public']) expect(rule.test(bad), bad).toBe(false);
  const js = files['omnibeam-box/block.js'].toString();
  expect(js).toContain("registerBlockType( 'omnibeam/box'");
  expect(js).toContain('save: function () { return null; }');
  const readme = files['omnibeam-box/readme.txt'].toString();
  for (const k of ['=== OmniBeam Send Me Files Box ===', 'Stable tag: 1.0.0', 'License: GPLv2 or later', '== Description ==', '== Changelog ==', '= External service =']) expect(readme).toContain(k);
  // The /embed guide mentions it in every language
  for (const code of ALL) {
    const p = await request.get(code === 'en' ? '/embed' : `/${code}/embed`);
    expect(await p.text(), code).toContain('/tools/omnibeam-wordpress.zip');
  }
});

// ---------- 4. Scan to PDF ----------

test('scan to PDF: loaded only when used, finds the page edges, makes a PDF and sends it', async ({ browser }) => {
  test.setTimeout(150000);
  const a = await open(browser, 'Scan A');
  const b = await open(browser, 'Scan B');
  // Not part of the first load
  expect(await a.page.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/scan.js')))).toBe(false);
  expect(await a.page.evaluate(() => typeof window.Scan)).toBe('undefined');
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=more]').click();
  await a.page.locator('#dlg-actions [data-act=scan]').click();
  const dlg = a.page.locator('#dlg-scan');
  await expect(dlg).toBeVisible();
  // The fake camera of the test browser
  await expect.poll(() => a.page.evaluate(() => document.querySelector('#dlg-scan video')?.videoWidth || 0)).toBeGreaterThan(0);
  await dlg.locator('[data-act=snap]').click();
  await dlg.locator('[data-act=snap]').click();
  await expect(dlg.locator('[data-act=done]')).toHaveText('Done (2)');
  await dlg.locator('[data-act=done]').click();
  await expect(dlg.locator('.scan-page')).toHaveCount(2);
  // Reorder, delete and black and white
  await dlg.locator('.scan-page').nth(0).locator('[data-page=next]').click();
  await dlg.locator('[data-mode=bw]').click();
  await expect(dlg.locator('[data-mode=bw]')).toHaveAttribute('aria-pressed', 'true');
  // Edge detection on a picture of a tilted sheet of paper on a dark desk: corners within 3% of the real ones
  const err = await a.page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 1000, height: 1300 });
    const g = c.getContext('2d');
    g.fillStyle = '#3b3129'; g.fillRect(0, 0, 1000, 1300);
    const q = [[180, 120], [830, 170], [880, 1150], [120, 1090]];
    g.fillStyle = '#f4f1ea'; g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    g.fillStyle = '#222'; g.font = '30px sans-serif';
    for (let i = 0; i < 12; i++) g.fillText('Line of text number ' + i, 260, 280 + i * 60);
    const found = Scan.edgesOf(c);
    return Math.max(...found.map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1]))) / 1300;
  });
  expect(err).toBeLessThan(0.03);
  // The corners can be moved by hand
  await dlg.locator('.scan-page').nth(0).locator('button[data-page=adjust]').click();
  await expect(dlg.locator('.scan-adjust canvas')).toBeVisible();
  await dlg.locator('[data-act=whole]').click();
  await dlg.locator('[data-act=adjusted]').click();
  await expect(dlg.locator('.scan-page')).toHaveCount(2);
  // Send to B: it arrives as one PDF with two pages
  await dlg.locator('[data-act=send]').click();
  const ask = b.page.locator('#dlg-request');
  await expect(ask).toBeVisible({ timeout: 30000 });
  await expect(ask.locator('.file-list')).toContainText('.pdf');
  await ask.locator('[data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  const download = b.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  const pdf = fs.readFileSync(await (await download).path());
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  expect((text.match(/\/Type \/Page /g) || []).length).toBe(2);
  expect((text.match(/\/Filter \/DCTDecode/g) || []).length).toBe(2);
  // The xref table points at the objects
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  expect(text.slice(xref, xref + 4)).toBe('xref');
  const first = Number(text.slice(xref).split('\n')[3].slice(0, 10));
  expect(text.slice(first, first + 7)).toBe('1 0 obj');
  expect(a.errors.concat(b.errors)).toEqual([]);
});

// ---------- 5. Automatic deploys ----------

test('automatic deploys: the workflow tests, builds, uploads, restarts and checks; .gitignore keeps secrets out', async () => {
  const wf = read('.github', 'workflows', 'deploy.yml');
  for (const k of ['npm test', 'node tools/build-upload.js ci', 'CPANEL_HOST', 'CPANEL_USER', 'CPANEL_TOKEN', 'FTP_HOST', 'FTP_PASSWORD',
    'restart.txt', 'node tools/deploy.js --check', 'tests/live.config.js', 'needs: test', 'branches: [main]']) expect(wf, k).toContain(k);
  expect(wf).not.toMatch(/\t/);
  const ignore = read('.gitignore').split(/\r?\n/);
  for (const k of ['data/', 'deploy/', 'node_modules/', 'backup-*/', '*.keystore', '**/KEEP-SAFE/', '.env', '*.pem', 'tests/.data/']) expect(ignore, k).toContain(k);
  // The setup steps live in deploy/ on the owner's PC, which never goes to GitHub: only checked where it exists
  if (fs.existsSync(path.join(__dirname, '..', 'deploy', 'AUTO-DEPLOY-SETUP.txt'))) expect(read('deploy', 'AUTO-DEPLOY-SETUP.txt')).toContain('CPANEL_TOKEN');
});

// ---------- 6. Chat view ----------

test('chat view: messages and files with one device in time order, unread number on its card, reply box', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Chat A');
  const b = await open(browser, 'Chat B');
  await card(a.page, b.name);
  const cardA = await card(b.page, a.name);
  // A sends B a message and a photo; B is busy in Settings, so the message shows a banner and counts as new
  await b.page.evaluate(() => document.getElementById('dlg-settings').showModal());
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).sendText('hello from A'), b.name);
  await expect(b.page.locator('#msg-banner.show')).toContainText('hello from A');
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await b.page.evaluate(() => document.getElementById('dlg-settings').close());
  await expect(cardA.locator('.chat-badge')).toHaveText('1');
  const target = await card(a.page, b.name);
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  // A small real PNG (1x1)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await (await chooser).setFiles([{ name: 'dot.png', mimeType: 'image/png', buffer: png }]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
  await b.page.locator('#dlg-received [data-act=close]').click().catch(() => b.page.keyboard.press('Escape'));
  await expect(cardA.locator('.chat-badge')).toHaveText('2');
  // Open the chat from the badge: the message and the photo on the "in" side, in order
  await cardA.locator('.chat-badge').click();
  const chat = b.page.locator('#dlg-chat');
  await expect(chat).toBeVisible();
  await expect(chat.locator('#chat-title')).toHaveText(a.name);
  await expect(chat.locator('.bubble.in')).toHaveCount(2);
  await expect(chat.locator('.bubble.in').nth(0)).toContainText('hello from A');
  await expect(chat.locator('.bubble.in').nth(1)).toContainText('dot.png');
  await expect(chat.locator('.bubble.in').nth(1).locator('img.chat-thumb')).toHaveAttribute('src', /^blob:/);
  await expect(chat.locator('.bubble.in').nth(1).getByRole('button', { name: 'Save' })).toBeVisible();
  // Read now: the number is gone
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  // Reply from the box at the bottom: it arrives on A and shows on the "out" side
  await chat.locator('textarea').fill('hi back from B');
  await chat.locator('[data-act=send]').click();
  // A had nothing open: the chat with B opened by itself
  await expect(a.page.locator('#dlg-chat .bubble.in')).toContainText('hi back from B');
  await expect(chat.locator('.bubble.out')).toHaveCount(1);
  await expect(chat.locator('.bubble.out')).toContainText('hi back from B');
  // A's own chat with B: its sent message and photo out, the reply in
  await a.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), b.name);
  const chatA = a.page.locator('#dlg-chat');
  await expect(chatA.locator('.bubble.out')).toHaveCount(2);
  await expect(chatA.locator('.bubble.in')).toHaveCount(1);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('chat view open: a message and files from that device show up only in the chat, no windows, sent on the right', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Live A');
  const b = await open(browser, 'Live B');
  await card(a.page, b.name);
  const cardA = await card(b.page, a.name);
  // Both have the chat with the other open
  await a.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), b.name);
  await b.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), a.name);
  const chatA = a.page.locator('#dlg-chat');
  const chatB = b.page.locator('#dlg-chat');
  await expect(chatB).toBeVisible();
  // A short message typed in A's chat: a bubble on B, no "Message from" window, no unread number
  await chatA.locator('textarea').fill('Hi');
  await chatA.locator('[data-act=send]').click();
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  await expect(chatB.locator('.bubble.in')).toContainText('Hi');
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  // On A it is A's own bubble, on the right; Copy and the time stay on one line
  const out = chatA.locator('.bubble.out');
  await expect(out).toHaveCount(1);
  const thread = await chatA.locator('.chat-thread').boundingBox();
  const box = await out.boundingBox();
  expect(box.x + box.width).toBeGreaterThan(thread.x + thread.width - 40);
  expect(box.x).toBeGreaterThan(thread.x + 40);
  const inB = chatB.locator('.bubble.in');
  const meta = await inB.locator('.chat-meta').boundingBox();
  const copy = await inB.getByRole('button', { name: 'Copy' }).boundingBox();
  expect(meta.height).toBeLessThan(20);
  expect(Math.abs((meta.y + meta.height / 2) - (copy.y + copy.height / 2))).toBeLessThan(8);
  // A file from A's paper clip: B answers inside the chat, and it arrives as a bubble, no windows
  const chooser = a.page.waitForEvent('filechooser');
  await chatA.locator('[data-act=attach]').click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await (await chooser).setFiles([{ name: 'dot.png', mimeType: 'image/png', buffer: png }]);
  const ask = chatB.locator('.chat-ask');
  await expect(ask).toBeVisible({ timeout: 30000 });
  await expect(ask).toContainText('dot.png');
  await expect(b.page.locator('#dlg-request')).toBeHidden();
  await ask.getByRole('button', { name: 'Accept' }).click();
  await expect(chatB.locator('.bubble.in.file')).toContainText('dot.png', { timeout: 60000 });
  await expect(chatB.locator('.chat-ask')).toHaveCount(0);
  await b.page.waitForTimeout(500);
  await expect(b.page.locator('#dlg-received')).toBeHidden();
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  // With the chat closed (and nothing else open), a message opens the chat again by itself: read, no number
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).sendText('are you there?'), b.name);
  await expect(chatB.locator('.bubble.in').last()).toContainText('are you there?');
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('chat view: in Arabic and Urdu the sides swap (what came in is on the right)', async ({ browser }) => {
  const a = await open(browser, 'Rtl A', { path: '/ur/' });
  const b = await open(browser, 'Rtl B', { path: '/ur/' });
  await card(a.page, b.name);
  await card(b.page, a.name);
  await b.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).sendText('Salam'), a.name);
  await expect(a.page.locator('#dlg-chat .bubble.in')).toContainText('Salam');
  await a.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), b.name);
  const chat = a.page.locator('#dlg-chat');
  const thread = await chat.locator('.chat-thread').boundingBox();
  const bubble = await chat.locator('.bubble.in').boundingBox();
  expect(bubble.x + bubble.width).toBeGreaterThan(thread.x + thread.width - 40);
  expect(bubble.x).toBeGreaterThan(thread.x + 40);
});

// ---------- 7. Original / Smaller photos ----------

test('photos: Original by default, Smaller makes a big photo 2048 px and says how much it saved, PNGs with transparency stay', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Shrink A');
  const b = await open(browser, 'Shrink B');
  expect(await a.page.evaluate(() => shrinkMode)).toBe('off');
  // The More… window has the switch; it is remembered on the device
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=more]').click();
  const actions = a.page.locator('#dlg-actions');
  await expect(actions.locator('[data-shrink=off]')).toHaveAttribute('aria-pressed', 'true');
  await actions.locator('[data-shrink=photos]').click();
  await expect(actions.locator('[data-shrink=photos]')).toHaveAttribute('aria-pressed', 'true');
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-shrink'))).toBe('photos');
  await a.page.keyboard.press('Escape');
  // A 3000x2000 photo full of detail (so it is several MB) and a PNG with a see-through part
  const sizes = await a.page.evaluate(async (n) => {
    const c = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 });
    const g = c.getContext('2d');
    const img = g.createImageData(3000, 2000);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = (i * 7) % 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = (i >> 9) % 255; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    const jpg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const p = Object.assign(document.createElement('canvas'), { width: 1600, height: 1200 });
    const pg = p.getContext('2d');
    const pimg = pg.createImageData(1600, 1200);
    for (let i = 0; i < pimg.data.length; i += 4) { pimg.data[i] = Math.random() * 255; pimg.data[i + 1] = 90; pimg.data[i + 2] = 40; pimg.data[i + 3] = i < pimg.data.length / 2 ? 0 : 255; }
    pg.putImageData(pimg, 0, 0);
    const png = await new Promise((r) => p.toBlob(r, 'image/png'));
    window.__files = [new File([jpg], 'big.jpg', { type: 'image/jpeg' }), new File([png], 'clear.png', { type: 'image/png' })];
    [...peers.values()].find((x) => x.info.name === n).sendFiles(window.__files);
    return [jpg.size, png.size];
  }, b.name);
  expect(sizes[0]).toBeGreaterThan(2 * 1024 * 1024);
  await expect(a.page.locator('#toast')).toContainText('saved', { timeout: 30000 });
  const ask = b.page.locator('#dlg-request');
  await expect(ask).toBeVisible({ timeout: 30000 });
  await ask.locator('[data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
  const got = await b.page.evaluate(async () => {
    const out = [];
    for (const f of History.items) {
      const blob = await History.blobOf(f);
      const bmp = await createImageBitmap(blob);
      out.push({ name: f.name, size: f.size, w: bmp.width, h: bmp.height });
    }
    return out;
  });
  const big = got.find((f) => f.name === 'big.jpg');
  expect([big.w, big.h]).toEqual([2048, 1365]);
  expect(big.size).toBeLessThan(sizes[0]);
  const clear = got.find((f) => f.name === 'clear.png');
  expect(clear.size).toBe(sizes[1]); // sent as it is
  // Back to Original in Settings
  await a.page.evaluate(() => setShrink('off'));
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-shrink'))).toBe('off');
  expect(a.errors.concat(b.errors)).toEqual([]);
});

// ---------- 8. Supporter codes ----------

test('supporter codes: made on /stats, checked by the server, badge seen by others, themes and pictures, taken back', async ({ browser, request }) => {
  test.setTimeout(120000);
  const auth = { Authorization: 'Bearer test-stats-key' };
  // Only the owner can make codes
  expect((await request.post('/api/stats/supporters?note=x', { headers: { Authorization: 'Bearer wrong' } })).status()).toBe(403);
  const made = await (await request.post('/api/stats/supporters?note=' + encodeURIComponent('Test donor <b>'), { headers: auth })).json();
  expect(made.made).toMatch(/^OB-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  expect(made.codes[0].note).toBe('Test donor  b');
  // The server checks codes by their signature (also written in small letters, without dashes)
  const check = async (code) => (await (await request.post('/api/supporter', { data: { code } })).json()).ok;
  expect(await check(made.made)).toBe(true);
  expect(await check(made.made.toLowerCase().replace(/-/g, ''))).toBe(true);
  const fake = made.made.slice(0, -1) + (made.made.endsWith('0') ? '1' : '0');
  expect(await check(fake)).toBe(false);
  expect(await check('OB-0000-0000-0000-0000')).toBe(false);

  const a = await open(browser, 'Donor A');
  const b = await open(browser, 'Friend B');
  const donorOnB = await card(b.page, a.name);
  await expect(donorOnB.locator('.supporter-tag')).toHaveCount(0);
  // Settings -> Supporter: a wrong code, then the right one
  await a.page.locator('#bar-settings').click();
  const dlg = a.page.locator('#dlg-settings');
  await expect(dlg.locator('#supporter-section')).toBeVisible();
  await dlg.locator('#supporter-code').fill(fake);
  await dlg.locator('#supporter-unlock').click();
  await expect(dlg.locator('#supporter-msg')).toContainText("doesn't work");
  await dlg.locator('#supporter-code').fill(made.made);
  await dlg.locator('#supporter-unlock').click();
  await expect(dlg.locator('#supporter-on')).toBeVisible();
  // The badge others see, checked by the server
  await expect(donorOnB.locator('.supporter-tag')).toHaveCount(1);
  // Four colour themes
  await expect(dlg.locator('#supporter-colors [data-color]')).toHaveCount(5);
  await dlg.locator('#supporter-colors [data-color=ocean]').click();
  await expect(a.page.locator('html')).toHaveAttribute('data-color', 'ocean');
  // Extra pictures, which the server passes on only for a supporter
  await a.page.keyboard.press('Escape');
  const extra = await a.page.evaluate(() => SUPPORTER_AVATARS[0]);
  await a.page.evaluate(() => openMeDialog());
  await a.page.locator(`#avatar-pick [data-avatar="${extra}"]`).click();
  await a.page.locator('#dlg-me [data-act=save]').click();
  await expect(donorOnB.locator('.avatar .emoji')).toHaveText(extra);
  // A device without a code can't use the extra pictures (the server drops them)
  await b.page.evaluate((e) => wsSend({ type: 'rename', avatar: e }), extra);
  const bOnA = await card(a.page, b.name);
  await b.page.waitForTimeout(800);
  await expect(bOnA.locator('.avatar .emoji')).toHaveCount(0);
  // The owner takes the code back: the badge goes, the perks turn off on the device
  const list = await (await request.post(`/api/stats/supporters?revoke=${made.codes[0].id}`, { headers: auth })).json();
  expect(list.codes[0].revoked).toBeTruthy();
  await expect(donorOnB.locator('.supporter-tag')).toHaveCount(0);
  await expect.poll(() => a.page.evaluate(() => Supporter.on())).toBe(false);
  await expect(a.page.locator('html')).not.toHaveAttribute('data-color', 'ocean');
  expect(await check(made.made)).toBe(false);
  // The stats page lists the codes
  const page = b.page;
  await page.evaluate(() => localStorage.setItem('omnibeam-stats-key', 'test-stats-key'));
  await page.goto('/stats');
  await expect(page.locator('#sup-list')).toContainText(made.made);
  await expect(page.locator('#sup-list')).toContainText('taken back');
  expect(a.errors).toEqual([]);
});

test('the Support and About texts mention the supporter perks', async ({ request }) => {
  const about = await (await request.get('/about')).text();
  expect(about).toContain('supporter code');
  const info = await (await request.get('/info-dialogs?lang=en')).text();
  expect(info).toContain('supporter code');
});
