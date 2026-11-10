// Makes the Galaxy Store / AppGallery phone screenshots (1080x1920) into store/android/images/.
// Start the local server first:  PORT=4556 node server.js   then:  node tools/android-shots.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = 'http://localhost:4556/';
const OUT = path.join(__dirname, '..', 'store', 'android', 'images');
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  tablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  phone: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
};
const FILES = [
  { name: 'Holiday photo.jpg', mimeType: 'image/jpeg', size: 75 * 1024 },
  { name: 'Trip video.mov', mimeType: 'video/quicktime', size: 12 * 1024 * 1024 },
  { name: 'Boarding pass.pdf', mimeType: 'application/pdf', size: 220 * 1024 },
].map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.alloc(f.size, 1) }));

async function device(browser, name, ua, opts = {}, prefs = {}) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 }, ...opts });
  const store = { 'omnibeam-name': name, 'omnibeam-lang': 'en', 'omnibeam-tour': 'done',
    'omnibeam-analytics': 'off', 'omnibeam-install': 'dismissed', ...prefs };
  await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
  const page = await ctx.newPage();
  await page.goto(BASE);
  return page;
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);
async function shot(page, file) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(0, 0);
  await settle(page, 600);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('saved', file);
}

async function closeDialogs(page) {
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 400);
}

async function phone(browser, prefs = {}) {
  const page = await device(browser, 'My phone', UA.phone,
    { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, prefs);
  await page.waitForFunction(() => document.querySelectorAll('.peer:not(.offline)').length >= 3, null, { timeout: 30000 });
  await settle(page, 1500);
  return page;
}

// Sends the three fake files from the iPhone to My phone and waits for the request dialog there.
async function incoming(iphone, me) {
  const card = iphone.locator('.peer:not(.offline)', { hasText: 'My phone' }).last();
  await card.hover();
  const [chooser] = await Promise.all([iphone.waitForEvent('filechooser'), card.locator('[data-act=files]').click()]);
  await chooser.setFiles(FILES);
  await me.waitForSelector('#dlg-request[open]', { timeout: 30000 });
  await settle(me, 1000);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Uses the installed Chrome, so `npx playwright install` isn't needed
  const browser = await chromium.launch({ channel: 'chrome' });
  const iphone = await device(browser, "Yazeed's iPhone", UA.iphone);
  await device(browser, 'Living room tablet', UA.tablet);
  await device(browser, 'Work MacBook', UA.mac);

  let me = await phone(browser);
  await shot(me, 'phone-screenshot-1-main.png');

  await incoming(iphone, me);
  await shot(me, 'phone-screenshot-2-incoming.png');
  await closeDialogs(me);
  await me.context().close();

  me = await phone(browser);
  await me.click('#btn-pair');
  await settle(me, 1000);
  await shot(me, 'phone-screenshot-3-pair.png');
  await closeDialogs(me);

  await me.click('#btn-menu');
  await settle(me, 400);
  await me.click('#btn-link');
  await settle(me, 1000);
  await shot(me, 'phone-screenshot-4-link.png');
  await me.context().close();

  me = await phone(browser, { 'omnibeam-theme': 'dark' });
  await shot(me, 'phone-screenshot-5-dark.png');
  await me.context().close();

  me = await phone(browser, { 'omnibeam-lang': 'ar' });
  await incoming(iphone, me);
  await shot(me, 'phone-screenshot-6-arabic.png');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
