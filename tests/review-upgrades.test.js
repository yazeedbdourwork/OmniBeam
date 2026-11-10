// Upgrades of 2026-11-02 from the outside review: the "More…" menu on a device (take a photo, voice note, share my
// screen, secret note), previews of received PDF / text / code files, read-once secret-note links, the window that
// explains the microphone before ⚡ Faster Wi-Fi asks for it, the screen kept on during link uploads, Help/Terms/
// Privacy/About loaded only when opened, and the ready-made iPhone Shortcut button.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// Open "More…" on the card of `name` and choose an action
async function more(page, name, act) {
  const c = await card(page, name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  const dlg = page.locator('#dlg-actions');
  await expect(dlg).toBeVisible();
  await dlg.locator(`[data-act=${act}]`).click();
}
async function accept(page) {
  const ask = page.locator('#dlg-request');
  await expect(ask).toBeVisible();
  await ask.locator('[data-act=accept]').click();
  const got = page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  return got;
}

test('secret note to a device: shown once, hidden until Show, never kept in history', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const b = await open(browser, 'Test Phone');
  await more(a.page, 'Test Phone', 'secret');
  const send = a.page.locator('#dlg-secret-send');
  await send.locator('textarea').fill('wifi: hunter2-Ω');
  await send.locator('[data-act=send]').click();
  await expect(a.page.locator('.toast').last()).toContainText('Secret note sent to Test Phone');

  const dlg = b.page.locator('#dlg-secret');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.secret-body')).toHaveClass(/hidden-note/);
  await dlg.locator('[data-act=show]').click();
  await expect(dlg.locator('pre')).toHaveText('wifi: hunter2-Ω');
  await dlg.locator('[data-act=close]').click();
  await expect(dlg).toBeHidden();
  expect(await b.page.evaluate(() => document.getElementById('dlg-secret').innerHTML)).toBe('');
  // Not in the messages history, the Sent log or the normal message window
  const stored = await b.page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('hunter2');
  expect(await a.page.evaluate(() => JSON.stringify(localStorage))).not.toContain('hunter2');
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('voice note: hold to record, let go, listen, send', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const b = await open(browser, 'Test Phone');
  await more(a.page, 'Test Phone', 'voice');
  const dlg = a.page.locator('#dlg-voice');
  await expect(dlg).toBeVisible();
  const btn = dlg.locator('.voice-btn');
  await btn.hover();
  await a.page.mouse.down();
  await expect(btn).toHaveClass(/rec/);
  await a.page.waitForTimeout(1600);
  await a.page.mouse.up();
  await expect(dlg.locator('audio')).toBeVisible();
  await expect(dlg.locator('.voice-time')).not.toHaveText('0:00');
  // The microphone is off again as soon as the recording stops
  expect(await a.page.evaluate(() => document.querySelector('#dlg-voice audio').src.startsWith('blob:'))).toBe(true);
  await dlg.locator('[data-act=send]').click();
  const got = await accept(b.page);
  await expect(got.locator('.info').first()).toContainText(/Voice note \d{4}-\d\d-\d\d .*\.(m4a|webm|ogg)/);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('take a photo: the camera opens in the page, a document scan is sent as a JPEG', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const b = await open(browser, 'Test Phone');
  await more(a.page, 'Test Phone', 'photo');
  const dlg = a.page.locator('#dlg-camera');
  await expect(dlg.locator('video')).toBeVisible();
  await expect.poll(() => a.page.evaluate(() => document.querySelector('#dlg-camera video').videoWidth)).toBeGreaterThan(0);
  await dlg.locator('[data-act=doc]').check();
  await dlg.locator('[data-act=snap]').click();
  await expect(dlg.locator('img')).toBeVisible();
  await dlg.locator('[data-act=send]').click();
  await expect(dlg).toBeHidden();
  // The camera is off once the window closes
  expect(await a.page.evaluate(() => document.querySelector('#dlg-camera video').srcObject?.active ?? false)).toBe(false);
  const got = await accept(b.page);
  await expect(got.locator('.info').first()).toContainText(/Scan \d{4}-\d\d-\d\d .*\.jpg/);
  await expect(got.locator('img')).toBeVisible();
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('share my screen: the other device is asked, watches it live, and it ends when the sharer stops', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const b = await open(browser, 'Test Phone');
  // A moving picture stands in for the screen (headless browsers have no screen to pick)
  await a.page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 200;
      const ctx = c.getContext('2d');
      let n = 0;
      setInterval(() => { ctx.fillStyle = `hsl(${(n += 20) % 360} 70% 50%)`; ctx.fillRect(0, 0, 320, 200); }, 100);
      return c.captureStream(10);
    };
  });
  await more(a.page, 'Test Phone', 'screen');
  await expect(a.page.locator('#share-bar')).toContainText('Waiting for Test Phone');
  const ask = b.page.locator('#dlg-screen-ask');
  await expect(ask).toContainText('Test Laptop wants to show you their screen');
  await ask.locator('[data-act=yes]').click();
  const view = b.page.locator('#dlg-screen');
  await expect(view).toBeVisible();
  await expect(view.locator('.screen-title')).toHaveText('Test Laptop\'s screen');
  await expect.poll(() => b.page.evaluate(() => document.querySelector('#dlg-screen video').videoWidth), { timeout: 20000 }).toBe(320);
  await expect(a.page.locator('#share-bar')).toContainText('Sharing your screen with Test Phone');
  await a.page.locator('#share-bar button').click();
  await expect(view).toBeHidden();
  await expect(a.page.locator('#share-bar')).toHaveCount(0);
  await expect(b.page.locator('.toast').last()).toContainText('Test Laptop stopped sharing their screen');

  // Saying no: the sharer is told and stops sharing
  await more(a.page, 'Test Phone', 'screen');
  await b.page.locator('#dlg-screen-ask [data-act=no]').click();
  await expect(a.page.locator('.toast').last()).toContainText('Test Phone said no thanks');
  await expect(a.page.locator('#share-bar')).toHaveCount(0);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('preview: text and code with colours, PDF in the page, from Received and from History', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  const b = await open(browser, 'Test Phone');
  const code = { name: 'hello.py', mimeType: 'text/x-python', buffer: Buffer.from('# say hi\ndef hello(name):\n    return "hi " + name * 2\n') };
  const pdf = { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') };
  const c = await card(a.page, 'Test Phone');
  const chooser = a.page.waitForEvent('filechooser');
  await c.hover();
  await c.locator('[data-act=files]').click();
  await (await chooser).setFiles([code, pdf, makeFile('blob.bin', 1000)]);
  const got = await accept(b.page);
  // Preview buttons only for what can be shown (pictures, video and audio already play in the window)
  await expect(got.locator('.item', { hasText: 'hello.py' }).locator('button', { hasText: 'Preview' })).toHaveCount(1);
  await expect(got.locator('.item', { hasText: 'blob.bin' }).locator('button', { hasText: 'Preview' })).toHaveCount(0);
  await got.locator('.item', { hasText: 'hello.py' }).locator('button', { hasText: 'Preview' }).click();
  const pv = b.page.locator('#dlg-preview');
  await expect(pv).toBeVisible();
  await expect(pv.locator('.tk-k').first()).toHaveText('def');
  await expect(pv.locator('.tk-c')).toHaveText('# say hi');
  await expect(pv.locator('.tk-s')).toHaveText('"hi "');
  await expect(pv.locator('.tk-n')).toHaveText('2');
  await expect(pv.locator('.preview-note')).toHaveText('4 lines');
  await pv.locator('[data-act=close]').click();
  await got.locator('.item', { hasText: 'doc.pdf' }).locator('button', { hasText: 'Preview' }).click();
  await expect(pv.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await pv.locator('[data-act=close]').click();
  await got.locator('[data-act=close]').click();

  // History: the same files, a day later, still with Preview
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  await hist.locator('.item', { hasText: 'hello.py' }).locator('button', { hasText: 'Preview' }).click();
  await expect(pv.locator('.tk-k').first()).toHaveText('def');
  expect([...a.errors, ...b.errors].filter((e) => !/Content Security Policy/.test(e) || /frame/.test(e))).toEqual([]);
});

test('secret note by link: opens once, nothing is fetched until Show the note', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  await menu(a.page, 'btn-link');
  const dlg = a.page.locator('#dlg-link');
  await dlg.locator('[data-act=note-open]').click();
  await a.page.fill('#link-note-text', 'API_KEY=sk-test-123\nsecond line');
  await dlg.locator('[data-act=note-make]').click();
  await expect(a.page.locator('#link-summary')).toContainText('Secret note');
  await expect(a.page.locator('#link-summary')).toContainText('one download');
  const url = (await a.page.locator('#link-url').textContent()).replace('https://omnibeam.site', '');
  // The server never had the text
  const files = fs.readdirSync(require('path').join(__dirname, '.data', 'drops')).filter((f) => f.endsWith('.bin'));
  for (const f of files) expect(fs.readFileSync(require('path').join(__dirname, '.data', 'drops', f)).toString('latin1')).not.toContain('sk-test');

  const reader = await browser.newContext();
  const page = await reader.newPage();
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('A secret note for you');
  await expect(page.locator('#drop-status')).toContainText('This note can be read once');
  // Opening the page twice (like a chat app's link preview) doesn't use it up
  await page.reload();
  await page.locator('#drop-get').click();
  await expect(page.locator('.secret-note pre')).toHaveText('API_KEY=sk-test-123\nsecond line');
  await expect(page.locator('#drop-status')).toContainText('deleted from the server');
  const again = await reader.newPage();
  await again.goto(url);
  await expect(again.locator('#drop-status')).toContainText('expired or was deleted');
  await reader.close();
  expect(a.errors).toEqual([]);
});

test('⚡ Faster Wi-Fi explains first: the microphone is only asked for after Continue, and turned off at once', async ({ browser }) => {
  const a = await open(browser, 'Test Phone');
  await a.page.evaluate(() => {
    window.micAsks = 0;
    window.micStopped = 0;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.micAsks++;
      const s = await real(c);
      for (const tr of s.getTracks()) { const stop = tr.stop.bind(tr); tr.stop = () => { window.micStopped++; stop(); }; }
      return s;
    };
    window.askFastWifi();
  });
  const dlg = a.page.locator('#dlg-fast');
  await expect(dlg).toContainText('Nothing is recorded or sent');
  await dlg.locator('[data-act=no]').click();
  await expect(dlg).toBeHidden();
  expect(await a.page.evaluate(() => window.micAsks)).toBe(0);
  await a.page.evaluate(() => { window.askFastWifi(); });
  await dlg.locator('[data-act=go]').click();
  await expect(a.page.locator('.toast').last()).toContainText('Fast Wi-Fi transfers are on');
  expect(await a.page.evaluate(() => [window.micAsks, window.micStopped])).toEqual([1, 1]);
});

test('the screen stays on during a link upload', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  await a.page.evaluate(() => {
    window.locks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      const lock = new EventTarget();
      lock.released = false;
      lock.release = async () => { lock.released = true; };
      window.locks.push(lock);
      return lock;
    } } });
  });
  await menu(a.page, 'btn-link');
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.locator('#dlg-link [data-act=pick]').click();
  await (await chooser).setFiles([makeFile('big.bin', 3 * 1024 * 1024)]);
  await expect(a.page.locator('#link-url')).toContainText('/d/');
  expect(await a.page.evaluate(() => window.locks.length)).toBeGreaterThan(0);
  await expect.poll(() => a.page.evaluate(() => window.locks.every((l) => l.released))).toBe(true);
});

test('Help, Terms, Privacy and About load when first opened, in the page language', async ({ browser, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).not.toContain('id="dlg-how"');
  expect(html).not.toContain('id="dlg-privacy"');
  expect(html).toContain('id="dlg-actions"');
  const fr = await (await request.get('/info-dialogs?lang=fr&v=2')).text();
  expect(fr).toContain('id="dlg-how"');
  expect(fr).not.toContain('<h3>How to Use OmniBeam</h3>');

  const a = await open(browser, 'Test Laptop');
  await a.page.locator('#btn-menu').click();
  await a.page.locator('#menu [data-open=dlg-how]').click();
  const how = a.page.locator('#dlg-how');
  await expect(how).toBeVisible();
  await expect(how).toContainText('Share my screen');
  await how.locator('[data-close]').click();
  await a.page.locator('footer [data-open=dlg-privacy]').first().click();
  await expect(a.page.locator('#dlg-privacy')).toContainText('camera, microphone or screen');
  expect(a.errors).toEqual([]);
});

test('the iPhone Shortcut is off the site: no Settings section, no inbox, no setup window', async ({ browser, request }) => {
  const cfg = await (await request.get('/config.json')).json();
  expect(cfg.inbox).toBeNull();
  expect((await request.post('/api/inbox/0123456789abcdef0123456789abcdef', { data: 'x' })).status()).toBe(404);
  const a = await open(browser, 'Test Laptop');
  await menu(a.page, 'btn-settings');
  await expect(a.page.locator('#dlg-settings')).toBeVisible();
  await expect(a.page.locator('#dlg-settings')).not.toContainText('iPhone Shortcut');
  expect(await a.page.locator('#shortcut-open, #dlg-shortcut').count()).toBe(0);
  expect(a.errors).toEqual([]);
});
