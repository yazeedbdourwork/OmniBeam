// The first-visit walkthrough, one-tap QR pairing, notifications for a closed device (web push, checked against a
// stand-in push service), and the Chrome extension
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { test, expect, chromium } = require('@playwright/test');
const { openDevice, card, makeFile, sha, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close().catch(() => {});
  devices = [];
});

const pairedList = (secret, name, extra = {}) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true, ...extra }]);

test('first visit shows the three-step walkthrough once, and Settings shows it again', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop', { storage: { 'omnibeam-tour': null } });
  devices.push(a);
  const tour = a.page.locator('#dlg-tour');
  await expect(tour).toBeVisible({ timeout: 5000 });
  await expect(tour.locator('.tour-step:visible h3')).toHaveText('Open OmniBeam on your other device');
  await tour.locator('[data-tour=next]').click();
  await expect(tour.locator('.tour-step:visible h3')).toHaveText('Not showing up? Pair once');
  await tour.locator('[data-tour=back]').click();
  await expect(tour.locator('.tour-step:visible h3')).toHaveText('Open OmniBeam on your other device');
  await tour.locator('[data-tour=next]').click();
  await tour.locator('[data-tour=next]').click();
  await expect(tour.locator('.tour-step:visible h3')).toHaveText('Tap a device to send');
  await expect(tour.locator('[data-tour=next]')).toHaveText('Start');
  await tour.locator('[data-tour=next]').click();
  await expect(tour).toBeHidden();
  // The dialog's close event (which saves this) fires just after it is hidden
  await expect.poll(() => a.page.evaluate(() => localStorage.getItem('omnibeam-tour'))).toBe('done');
  await menu(a.page, 'btn-settings');
  await a.page.locator('#tour-open').click();
  await expect(tour).toBeVisible();
  // "Pair now" on step 2 goes to the pairing window
  await tour.locator('[data-tour=next]').click();
  await tour.locator('[data-tour=pair]').click();
  await expect(a.page.locator('#dlg-pair')).toBeVisible();
  expect(a.errors).toEqual([]);
});

test('the walkthrough is in the page language', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop', { path: '/fr/', storage: { 'omnibeam-tour': null, 'omnibeam-lang': 'fr' } });
  devices.push(a);
  await expect(a.page.locator('#dlg-tour .tour-step:visible h3')).toHaveText('Ouvrez OmniBeam sur votre autre appareil', { timeout: 5000 });
  await expect(a.page.locator('#dlg-tour [data-tour=next]')).toHaveText('Suivant');
});

test('one-tap pairing: opening the QR code link on the phone pairs both devices', async ({ browser }) => {
  // Different "networks": the phone only finds the laptop through the QR code
  const a = await openDevice(browser, 'Test Laptop');
  devices.push(a);
  await a.page.locator('#btn-pair').click();
  await expect(a.page.locator('#pair-qr svg')).toBeVisible();
  const link = await a.page.evaluate(() => qrPairLink());
  expect(link).toMatch(/#qr=[0-9a-f]{64}&n=Test%20Laptop$/);
  // The phone's camera opens the link
  const b = await openDevice(browser, 'Test Phone', { path: '/' + link.split('/').pop() });
  devices.push(b);
  await expect((await card(b.page, 'Test Laptop')).locator('.tag')).toHaveText('Paired', { timeout: 10000 });
  await expect((await card(a.page, 'Test Phone')).locator('.tag')).toHaveText('Paired', { timeout: 10000 });
  await expect(a.page.locator('#dlg-pair')).toBeHidden();
  const saved = (p) => p.evaluate(() => loadPaired().map((x) => x.secret));
  expect(await saved(a.page)).toEqual(await saved(b.page));
  expect((await saved(a.page)).length).toBe(1);
  // The address bar no longer shows the secret
  expect(b.page.url()).not.toContain('qr=');
  // A second phone scanning the same (now used) code doesn't pair
  const c = await openDevice(browser, 'Other Phone', { path: '/' + link.split('/').pop() });
  devices.push(c);
  await c.page.waitForTimeout(2500);
  expect(await saved(c.page)).toEqual([]);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

// A stand-in for Apple's/Google's push service: records what the server sends and decrypts it like a browser would
function fakePushService() {
  const ecdh = crypto.createECDH('prime256v1');
  const uaPublic = ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const got = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      got.push({ headers: req.headers, body: Buffer.concat(parts) });
      res.writeHead(201);
      res.end();
    });
  });
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  // RFC 8291, receiving side
  const decrypt = (body) => {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const data = body.subarray(21 + idlen);
    const ikm = hmac(hmac(auth, ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const d = crypto.createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16),
      hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
  };
  // The VAPID signature must check out with the server's public key
  const vapidOk = (header, publicKey) => {
    const m = String(header).match(/^vapid t=([^,]+), k=(.+)$/);
    if (!m || m[2] !== publicKey) return false;
    const [h, c, s] = m[1].split('.');
    const point = Buffer.from(publicKey, 'base64url');
    const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
    return crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  };
  return new Promise((resolve) => server.listen(0, () => resolve({
    got, decrypt, vapidOk, close: () => server.close(),
    sub: (n) => ({ endpoint: `http://localhost:${server.address().port}/push/${n}`, keys: { p256dh: uaPublic.toString('base64url'), auth: auth.toString('base64url') } }),
  })));
}

test('files for a closed paired device: it gets a notification, and they go when it opens OmniBeam', async ({ browser, request }) => {
  const push = await fakePushService();
  try {
    const { push: publicKey } = await (await request.get('/config.json')).json();
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const secret = crypto.randomBytes(32).toString('hex');
    const a = await openDevice(browser, 'Test Laptop', { storage: { 'omnibeam-paired': pairedList(secret, 'Test Phone', { trusted: false }) } });
    let b = await openDevice(browser, 'Test Phone', { storage: { 'omnibeam-paired': pairedList(secret, 'Test Laptop', { trusted: false }), 'omnibeam-push': 'on' } });
    devices.push(a, b);
    await expect((await card(a.page, 'Test Phone')).locator('.tag')).toHaveText('Paired');
    // The phone turned notifications on: it gives the server its push address (here, the stand-in's)
    // (The test browser has no notifications: pretend they were allowed)
    await b.context.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted' }));
    await b.page.reload();
    await card(b.page, 'Test Laptop');
    await b.page.evaluate((sub) => wsSend({ type: 'push-sub', sub, secrets: loadPaired().map((p) => p.secret), lang: 'en' }), push.sub(1));
    await b.page.evaluate(() => [...peers.values()].forEach((p) => sendPairHello(p)));
    await expect.poll(() => a.page.evaluate(() => loadPaired()[0].push)).toBe(true);
    await b.close();
    // Not trusted, but it can be woken: it stays on the laptop's screen, greyed out
    const offline = a.page.locator('.peer.offline');
    await expect(offline.locator('.name')).toHaveText('Test Phone', { timeout: 10000 });
    const file = makeFile('report.pdf', 300 * 1024, 'application/pdf');
    const chooser = a.page.waitForEvent('filechooser');
    await offline.click();
    await (await chooser).setFiles([file]);
    await expect(offline.locator('.status')).toHaveText('1 file(s) waiting to send');
    await expect(a.page.locator('#toast')).toContainText('Test Phone got a notification');
    await expect.poll(() => push.got.length).toBe(1);
    const sent = push.got[0];
    expect(sent.headers['content-encoding']).toBe('aes128gcm');
    expect(push.vapidOk(sent.headers.authorization, publicKey)).toBe(true);
    const note = push.decrypt(sent.body);
    expect(note.title).toBe('Test Laptop wants to send you 1 file(s)');
    expect(note.url).toBe('/?wake=1');
    // Tapping the notification opens OmniBeam on the phone: the file goes right away
    b = await openDevice(browser, 'Test Phone', { path: '/?wake=1', storage: { 'omnibeam-paired': pairedList(secret, 'Test Laptop', { trusted: false }) } });
    devices.push(b);
    const ask = b.page.locator('#dlg-request');
    await expect(ask).toBeVisible({ timeout: 20000 });
    await ask.locator('[data-act=accept]').click();
    const got = b.page.locator('#dlg-received');
    await expect(got).toBeVisible({ timeout: 30000 });
    const download = b.page.waitForEvent('download');
    await got.locator('[data-act=save-all]').click();
    expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
    await expect(a.page.locator('.peer.offline')).toHaveCount(0);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    push.close();
  }
});

test('Settings has notifications, and the server only accepts real push services', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop');
  devices.push(a);
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'transfers');
  await expect(a.page.locator('#push-on')).toBeVisible();
  // A push address that isn't a browser push service is ignored (no "push-ok")
  const answer = (endpoint) => a.page.evaluate((endpoint) => new Promise((resolve) => {
    const before = ws.onmessage;
    ws.onmessage = (e) => { before(e); if (JSON.parse(e.data).type === 'push-ok') resolve('ok'); };
    setTimeout(() => resolve('ignored'), 1500);
    wsSend({ type: 'push-sub', sub: { endpoint, keys: { p256dh: btoa(String.fromCharCode(4, ...new Uint8Array(64))).replace(/=/g, ''), auth: 'AAAAAAAAAAAAAAAAAAAAAA' } } });
  }), endpoint);
  expect(await answer('https://example.com/steal')).toBe('ignored');
  expect(await answer('https://fcm.googleapis.com/fcm/send/abc')).toBe('ok');
});

test('Chrome extension: right-click sending of text and an image to a device', async ({ browser }, testInfo) => {
  const ext = path.join(__dirname, '..', 'tools', 'omnibeam-chrome');
  const base = testInfo.project.use.baseURL;
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  devices.push({ close: () => ctx.close() });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate((site) => chrome.storage.sync.set({ site }), base);
  await ctx.addInitScript(() => {
    localStorage.setItem('omnibeam-name', 'Chrome Laptop');
    localStorage.setItem('omnibeam-lang', 'en');
    localStorage.setItem('omnibeam-tour', 'done');
  });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(base + '/');
  const b = await openDevice(browser, 'Test Phone');
  devices.push(b);
  // The OmniBeam tab told the extension which devices are here
  await expect.poll(() => sw.evaluate(() => chrome.storage.session.get('peers').then((r) => (r.peers || []).map((p) => p.name))), { timeout: 15000 })
    .toEqual(['Test Phone']);
  const id = await sw.evaluate(() => chrome.storage.session.get('peers').then((r) => r.peers[0].id));
  // Selected text, sent straight to the phone
  await sw.evaluate((to) => send({ text: 'selected on a web page' }, to), id);
  // It lands in the chat with the computer, which opens by itself (no message window)
  await expect(b.page.locator('#dlg-chat .bubble.in .msg-text')).toHaveText('selected on a web page', { timeout: 15000 });
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await b.page.locator('#dlg-chat [data-act=close]').click();
  // An image: sent as the image file
  await sw.evaluate(async ({ to, src }) => send(await imageItem(src), to), { to: id, src: base + '/icon-192.png' });
  const ask = b.page.locator('#dlg-request');
  await expect(ask).toBeVisible({ timeout: 20000 });
  await ask.locator('[data-act=accept]').click();
  await expect(b.page.locator('#dlg-received .received .info')).toContainText('icon-192.png', { timeout: 20000 });
  // No device chosen: the OmniBeam tab asks which one
  await sw.evaluate(() => send({ text: 'pick a device' }, null));
  await expect(page.locator('#share-banner')).toBeVisible();
  expect(b.errors).toEqual([]);
});

// After the server's notification keys are changed (data/push-keys.json replaced), a device with notifications on
// drops its old subscription by itself and makes one with the new key, without asking again
test('notifications: a subscription made with an old server key is replaced by itself', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Phone', { storage: { 'omnibeam-push': 'on' } });
  devices.push(a);
  const run = (fail) => a.page.evaluate(async (fail) => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    const log = [];
    const fakeSub = (key, endpoint) => ({ options: { applicationServerKey: key.buffer }, endpoint,
      unsubscribe: async () => { log.push('unsubscribe ' + endpoint); return true; },
      toJSON: () => ({ endpoint, keys: { p256dh: 'x', auth: 'y' } }) });
    const old = fakeSub(new Uint8Array(65).fill(7), 'https://fcm.googleapis.com/fcm/send/old');
    PushManager.prototype.getSubscription = async () => old;
    PushManager.prototype.subscribe = async (o) => {
      if (fail) throw new Error('needs a tap');
      log.push('subscribe');
      return fakeSub(new Uint8Array(o.applicationServerKey), 'https://fcm.googleapis.com/fcm/send/new');
    };
    window.wsSend = (m) => { if (m.type === 'push-sub') log.push('push-sub ' + m.sub.endpoint); };
    await navigator.serviceWorker.register('/sw.js');
    await sendPushSub();
    return { log, on: localStorage.getItem('omnibeam-push') };
  }, fail);
  await expect.poll(() => a.page.evaluate(() => !!pushPublicKey)).toBe(true);
  expect(await run(false)).toEqual({ log: ['unsubscribe https://fcm.googleapis.com/fcm/send/old', 'subscribe', 'push-sub https://fcm.googleapis.com/fcm/send/new'], on: 'on' });
  // If the browser won't make a new one without a tap: the old one is still dropped, and notifications show as off
  expect(await run(true)).toEqual({ log: ['unsubscribe https://fcm.googleapis.com/fcm/send/old'], on: 'off' });
  expect(a.errors).toEqual([]);
});
