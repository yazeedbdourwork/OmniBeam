// Makes the Google Play graphics into store/google-play/images/:
//   feature-graphic-1024x500.png and feature-graphic-ar-1024x500.png (the banner at the top of the listing)
//   phone-1-devices.png … phone-6-arabic.png (phone screenshots, 1080x1920)
// Start a local server first (its own data folder, so nothing real is touched):
//   PORT=4557 DATA_DIR=tests/.data-shots node server.js      then:   node tools/play-shots.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.SHOTS_BASE || 'http://localhost:4557/';
const OUT = path.join(__dirname, '..', 'store', 'google-play', 'images');
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  tablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  phone: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
};
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg')).toString('base64');
const settle = (page, ms = 800) => page.waitForTimeout(ms);

// ---------- Feature graphic ----------
function bannerHtml(lang) {
  const ar = lang === 'ar';
  const t = ar
    ? { h: 'أرسل الملفات بين كل أجهزتك', s: 'آيفون وأندرويد وويندوز وماك · مجاني وخاص وبلا حساب' }
    : { h: 'Send files between all your devices', s: 'iPhone, Android, Windows and Mac · Free, private, no account' };
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #fff;
      background: radial-gradient(circle at 80% 20%, #8f7cff 0, transparent 55%), linear-gradient(135deg, #3d33c9, #5248e8 55%, #7b6cff);
      display: flex; align-items: center; justify-content: space-between; padding: 0 70px; box-sizing: border-box; }
    .text { max-width: 560px; }
    .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
    .brand img { width: 74px; height: 74px; background: #fff; border-radius: 20px; padding: 8px; box-sizing: border-box; }
    .brand b { font-size: 44px; letter-spacing: -0.5px; direction: ltr; }
    h1 { font-size: ${ar ? 46 : 44}px; line-height: 1.15; margin: 0 0 18px; font-weight: 800; }
    p { font-size: 22px; margin: 0; opacity: 0.92; line-height: 1.4; }
    .art { position: relative; width: 300px; height: 300px; flex: none; }
    .laptop { position: absolute; inset-inline-end: 0; top: 40px; width: 230px; height: 150px; border-radius: 14px; background: #fff; box-shadow: 0 20px 40px rgba(0,0,0,.25); }
    .laptop::after { content: ""; position: absolute; left: -18px; right: -18px; bottom: -16px; height: 16px; background: #e3e6f2; border-radius: 0 0 14px 14px; }
    .phone { position: absolute; inset-inline-start: 0; top: 110px; width: 92px; height: 170px; border-radius: 18px; background: #fff; box-shadow: 0 20px 40px rgba(0,0,0,.3); border: 5px solid #1d1f26; box-sizing: border-box; }
    .file { position: absolute; width: 54px; height: 66px; border-radius: 8px; background: #ffd166; box-shadow: 0 6px 14px rgba(0,0,0,.2); }
    .file::after { content: ""; position: absolute; top: 0; inset-inline-end: 0; border: 9px solid #fff; border-bottom-color: transparent; border-inline-start-color: transparent; }
    .f1 { inset-inline-start: 110px; top: 60px; transform: rotate(${ar ? 10 : -10}deg); }
    .f2 { inset-inline-start: 150px; top: 150px; background: #6ee7b7; transform: rotate(${ar ? -8 : 8}deg); }
    .dots { position: absolute; inset-inline-start: 70px; top: 90px; width: 170px; height: 120px; border-top: 4px dashed rgba(255,255,255,.7); border-radius: 50% 50% 0 0; }
  </style></head><body>
    <div class="text"><div class="brand"><img src="${ICON}" alt=""><b>OmniBeam</b></div><h1>${t.h}</h1><p>${t.s}</p></div>
    <div class="art"><div class="dots"></div><div class="laptop"></div><div class="phone"></div><div class="file f1"></div><div class="file f2"></div></div>
  </body></html>`;
}

// ---------- Pictures used in the screenshots ----------
// A photo of a sheet of paper lying on a desk (for Scan to PDF) and a holiday "photo" (for the chat)
async function picture(browser, html, w, h, type) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html);
  const buf = await page.screenshot({ type, quality: type === 'jpeg' ? 88 : undefined });
  await page.close();
  return buf;
}
const PAPER = `<body style="margin:0;width:900px;height:1200px;background:repeating-linear-gradient(95deg,#7a5534 0 22px,#86603c 22px 47px,#6f4c2e 47px 60px)">
  <div style="position:absolute;left:150px;top:150px;width:600px;height:840px;background:#f7f4ec;transform:perspective(1400px) rotateX(14deg) rotateZ(-6deg);box-shadow:0 30px 40px rgba(0,0,0,.45);padding:60px 54px;box-sizing:border-box;font:22px/1.6 Georgia,serif;color:#222">
  <h2 style="margin:0 0 20px;font:700 34px sans-serif">Invoice #2026-114</h2><p>Bdour Design Studio<br>Amman, Jordan</p>
  <p style="margin-top:30px">1 × Website design ........ 450.00<br>2 × Logo variants ......... 120.00<br>1 × Print files .............. 80.00</p>
  <p style="margin-top:30px;font-weight:700">Total ........................ 650.00</p><p style="margin-top:60px;font-size:18px">Thank you for your business.</p></div></body>`;
const HOLIDAY = `<body style="margin:0;width:1200px;height:900px;background:linear-gradient(#ffb36b,#ff7e8a 45%,#6a5acd 46%,#3b6fb6 70%,#1f3f7a)">
  <div style="position:absolute;left:760px;top:170px;width:200px;height:200px;border-radius:50%;background:#ffe39a;box-shadow:0 0 80px #ffd27a"></div>
  <div style="position:absolute;left:0;right:0;top:420px;height:30px;background:rgba(255,255,255,.25)"></div></body>`;

async function device(browser, name, ua, opts = {}, prefs = {}) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 }, ...opts });
  const store = { 'omnibeam-name': name, 'omnibeam-lang': 'en', 'omnibeam-tour': 'done',
    'omnibeam-analytics': 'off', 'omnibeam-install': 'dismissed', ...prefs };
  await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
  const page = await ctx.newPage();
  await page.goto(BASE + (prefs['omnibeam-lang'] && prefs['omnibeam-lang'] !== 'en' ? prefs['omnibeam-lang'] + '/' : ''));
  return page;
}
async function shot(page, file) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(0, 0);
  await settle(page, 700);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('saved', file);
}
async function closeDialogs(page) {
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await settle(page, 300);
}
async function phone(browser, prefs = {}) {
  const page = await device(browser, 'My phone', UA.phone,
    { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, prefs);
  await page.waitForFunction(() => document.querySelectorAll('.peer:not(.offline)').length >= 3, null, { timeout: 30000 });
  await settle(page, 1200);
  return page;
}
const peerNamed = (page, name) => page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n)?.info.id, name);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const lang of ['en', 'ar']) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
    await page.setContent(bannerHtml(lang));
    await settle(page, 300);
    await page.screenshot({ path: path.join(OUT, lang === 'en' ? 'feature-graphic-1024x500.png' : 'feature-graphic-ar-1024x500.png') });
    await page.close();
    console.log('saved feature graphic', lang);
  }
  const paper = await picture(browser, PAPER, 900, 1200, 'jpeg');
  const holiday = await picture(browser, HOLIDAY, 1200, 900, 'jpeg');

  const iphone = await device(browser, "Yazeed's iPhone", UA.iphone);
  await device(browser, 'Living room TV', UA.tablet);
  await device(browser, 'Work MacBook', UA.mac);

  // 1. The devices
  let me = await phone(browser);
  await shot(me, 'phone-1-devices.png');

  // 2. Files arriving
  const files = [
    { name: 'Holiday photo.jpg', mimeType: 'image/jpeg', buffer: holiday },
    { name: 'Trip video.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(12 * 1024 * 1024, 1) },
    { name: 'Boarding pass.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(220 * 1024, 1) },
  ];
  const sendFrom = async (from, to, list) => {
    const id = await peerNamed(from, to);
    await from.evaluate(({ id, list }) => {
      const files = list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.mimeType }));
      peers.get(id).sendFiles(files);
    }, { id, list: list.map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.buffer.toString('base64') })) });
  };
  await sendFrom(iphone, 'My phone', files);
  await me.waitForSelector('#dlg-request[open]', { timeout: 30000 });
  await shot(me, 'phone-2-incoming.png');

  // 3. The chat with the iPhone: accept, then a few messages both ways
  await me.click('#dlg-request [data-act=accept]');
  await me.waitForSelector('#dlg-received[open]', { timeout: 60000 });
  await closeDialogs(me);
  const say = async (from, to, text) => {
    const id = await peerNamed(from, to);
    await from.evaluate(({ id, text }) => peers.get(id).sendText(text), { id, text });
    await settle(from, 900);
  };
  await say(iphone, 'My phone', 'Here are the photos from Saturday 🌅');
  await closeDialogs(me);
  await say(me, "Yazeed's iPhone", 'Thanks! Got them all, full quality 👍');
  await say(iphone, 'My phone', 'Can you scan the invoice for me?');
  await closeDialogs(me);
  await me.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), "Yazeed's iPhone");
  await me.waitForSelector('#dlg-chat[open] .bubble', { timeout: 10000 });
  await settle(me, 1200);
  await shot(me, 'phone-3-chat.png');
  await closeDialogs(me);

  // 4. Scan to PDF: a photo of a page, its edges found and straightened
  await me.evaluate((n) => openScan([...peers.values()].find((p) => p.info.name === n)), "Yazeed's iPhone");
  await me.waitForSelector('#dlg-scan[open]');
  const [chooser] = await Promise.all([me.waitForEvent('filechooser'), me.click('#dlg-scan [data-act=app]')]);
  await chooser.setFiles([{ name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: paper }]);
  await me.waitForSelector('#dlg-scan .scan-page img[src^=blob]', { timeout: 20000 });
  await shot(me, 'phone-4-scan.png');
  await closeDialogs(me);
  await me.context().close();

  // 5. Dark mode, the More… window with "Photos: Original / Smaller"
  me = await phone(browser, { 'omnibeam-theme': 'dark' });
  await me.evaluate((n) => openActions([...peers.values()].find((p) => p.info.name === n)), "Yazeed's iPhone");
  await shot(me, 'phone-5-dark.png');
  await me.context().close();

  // 6. Arabic: files arriving
  me = await phone(browser, { 'omnibeam-lang': 'ar' });
  await sendFrom(iphone, 'My phone', files);
  await me.waitForSelector('#dlg-request[open]', { timeout: 30000 });
  await shot(me, 'phone-6-arabic.png');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
