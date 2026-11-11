// Privacy and video (2026-11-11): App lock (PIN; the lock screen stays on top of windows that open while locked,
// wrong PINs wait, Change PIN / Turn off ask for the PIN, Forgot your PIN clears this device), Keep history (old
// items deleted by themselves) and the fast video shrinking with the browser's video encoder (WebCodecs), 480p.
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function turnOnLock(page, pin) {
  await menu(page, 'btn-settings');
  await settingsTab(page, 'privacy');
  await expect(page.locator('#lock-state')).toHaveText('Off');
  await page.locator('#lock-on').click();
  const set = page.locator('#dlg-lockset');
  await set.locator('#lockset-a').fill(pin);
  await set.locator('#lockset-b').fill(pin.slice(0, -1) + '0');
  await set.locator('#lockset-save').click();
  await expect(set.locator('#lockset-msg')).toHaveText('The two PINs are not the same.');
  await set.locator('#lockset-b').fill(pin);
  await set.locator('#lockset-save').click();
  await expect(set).toBeHidden();
  await expect(page.locator('#lock-state')).toHaveText('On: PIN');
  await page.locator('#dlg-settings [data-close]').click();
}

test('App lock: asks for the PIN when OmniBeam opens, stays on top, wrong PINs wait', async ({ browser }) => {
  const a = await open(browser, 'Lock PC');
  const b = await open(browser, 'Lock Phone');
  await turnOnLock(a.page, '2468');
  // Only a salted hash is kept, never the PIN
  const conf = await a.page.evaluate(() => localStorage.getItem('omnibeam-lock'));
  expect(conf).not.toContain('2468');
  await a.page.reload();
  const lock = a.page.locator('#dlg-lock');
  await expect(lock).toBeVisible();
  await expect(lock.locator('#lock-title')).toHaveText('OmniBeam is locked');
  await expect(a.page.locator('#me-name')).toBeHidden();
  // Escape doesn't open it
  await a.page.keyboard.press('Escape');
  await expect(lock).toBeVisible();
  // Files arrive while locked: the Accept window waits, hidden, behind the lock screen
  await card(b.page, 'Lock PC');
  await b.page.evaluate(() => { [...peers.values()].find((p) => p.info.name === 'Lock PC').sendFiles([new File(['hello under the lock'], 'note.txt', { type: 'text/plain' })]); });
  await expect(a.page.locator('#dlg-request')).toHaveAttribute('open', '');
  await expect(a.page.locator('#dlg-request')).toBeHidden();
  await expect(lock).toBeVisible();
  await expect(lock.locator('#lock-pin')).toBeEditable();
  await lock.locator('#lock-pin').fill('1111');
  await lock.locator('#lock-go').click();
  await expect(lock.locator('#lock-msg')).toHaveText('Wrong PIN. Try again.');
  await lock.locator('#lock-pin').fill('2468');
  await lock.locator('#lock-go').click();
  await expect(lock).toBeHidden();
  await expect(a.page.locator('#dlg-request')).toBeVisible();
  await expect(a.page.locator('#dlg-request')).toContainText('note.txt');
  // Five wrong PINs: wait before trying again
  await a.page.locator('#dlg-request [data-act=accept]').click();
  await a.page.evaluate(() => AppLock.lock());
  for (let i = 0; i < 5; i++) {
    await lock.locator('#lock-pin').fill('9999');
    await lock.locator('#lock-go').click();
    await expect(lock.locator('#lock-pin')).toHaveValue('');
  }
  await expect(lock.locator('#lock-msg')).toContainText('Too many wrong PINs');
  await expect(lock.locator('#lock-go')).toBeDisabled();
  expect(a.errors).toEqual([]);
});

test('App lock: Lock now, Change PIN and Turn off ask for the PIN; Forgot your PIN clears this device', async ({ browser }) => {
  const a = await open(browser, 'Lock Laptop');
  await turnOnLock(a.page, '1357');
  // Lock now from the ⋯ menu
  await a.page.locator('#btn-menu').click();
  await a.page.locator('#menu #menu-lock').click();
  const lock = a.page.locator('#dlg-lock');
  await expect(lock).toBeVisible();
  await lock.locator('#lock-pin').fill('1357');
  await lock.locator('#lock-pin').press('Enter');
  await expect(lock).toBeHidden();
  // Change PIN: the old one first (Cancel keeps everything)
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'privacy');
  await a.page.locator('#lock-change').click();
  await expect(lock.locator('#lock-title')).toHaveText('Type your PIN');
  await lock.locator('#lock-cancel').click();
  await expect(lock).toBeHidden();
  await a.page.locator('#lock-change').click();
  await lock.locator('#lock-pin').fill('1357');
  await lock.locator('#lock-go').click();
  await a.page.locator('#lockset-a').fill('8642');
  await a.page.locator('#lockset-b').fill('8642');
  await a.page.locator('#lockset-save').click();
  await expect(a.page.locator('#dlg-lockset')).toBeHidden();
  expect(await a.page.evaluate(() => AppLock.check('8642'))).toBe(true);
  // Lock again: a choice, remembered
  await a.page.locator('#lock-after').selectOption('15');
  expect(await a.page.evaluate(() => AppLock.conf.after)).toBe(15);
  // Turn off asks for the PIN
  await a.page.locator('#lock-off').click();
  await lock.locator('#lock-pin').fill('8642');
  await lock.locator('#lock-go').click();
  await expect(a.page.locator('#lock-state')).toHaveText('Off');
  await a.page.locator('#dlg-settings [data-close]').click();
  // Forgot your PIN: lock and private things gone after confirming
  await turnOnLock(a.page, '1111');
  await a.page.evaluate(() => {
    localStorage.setItem('omnibeam-messages', JSON.stringify([{ text: 'secret', from: 'x', at: Date.now() }]));
    localStorage.setItem('omnibeam-paired', JSON.stringify([{ secret: 'ab'.repeat(32), name: 'Old', at: Date.now() }]));
  });
  await a.page.reload();
  a.page.once('dialog', (d) => d.accept());
  await lock.locator('#lock-forgot').click();
  await a.page.waitForLoadState('load');
  await expect(a.page.locator('#me-name')).toBeVisible();
  await expect(lock).toBeHidden();
  const left = await a.page.evaluate(() => ['omnibeam-lock', 'omnibeam-messages', 'omnibeam-paired'].map((k) => localStorage.getItem(k)));
  expect(left).toEqual([null, null, null]);
  expect(a.errors).toEqual([]);
});

test('Keep history: older messages, sent items and clipboard history are deleted by themselves', async ({ browser }) => {
  const now = Date.now();
  const old = now - 3 * 36e5, fresh = now - 60e3;
  const a = await open(browser, 'Keep PC', { storage: {
    'omnibeam-messages': JSON.stringify([{ text: 'fresh one', from: 'X', at: fresh }, { text: 'old one', from: 'X', at: old }]),
    'omnibeam-sent': JSON.stringify([{ id: 's1', at: old, to: 'X', result: 'ok', text: 'old sent' }, { id: 's2', at: fresh, to: 'X', result: 'ok', text: 'new sent' }]),
    'omnibeam-clips': JSON.stringify([{ id: 'c1', text: 'old clip', dir: 'in', who: 'X', at: old }, { id: 'c2', text: 'new clip', dir: 'in', who: 'X', at: fresh }]),
  } });
  const page = a.page;
  expect(await page.evaluate(() => Messages.items.length)).toBe(2);
  await menu(page, 'btn-settings');
  await settingsTab(page, 'privacy');
  await expect(page.locator('input[name=keep][value="7d"]')).toBeChecked();
  await page.locator('#keep-choice label', { hasText: '1 hour' }).click();
  const got = await page.evaluate(() => ({
    m: JSON.parse(localStorage.getItem('omnibeam-messages')).map((x) => x.text),
    s: JSON.parse(localStorage.getItem('omnibeam-sent')).map((x) => x.text),
    c: JSON.parse(localStorage.getItem('omnibeam-clips')).map((x) => x.text),
    k: localStorage.getItem('omnibeam-keep'),
  }));
  expect(got).toEqual({ m: ['fresh one'], s: ['new sent'], c: ['new clip'], k: '1h' });
  await page.locator('#dlg-settings [data-close]').click();
  await page.locator('#btn-history').click();
  await expect(page.locator('#dlg-history .history-note')).toContainText('1 hour');
  expect(a.errors).toEqual([]);
});

test('videos are made smaller quickly with the video encoder (480p), and sent as MP4', async ({ browser }) => {
  const a = await open(browser, 'Video PC', { storage: { 'omnibeam-shrink': 'small', 'omnibeam-video-min': '100000' } });
  const b = await open(browser, 'Video Phone');
  // A 6-second 1280x720 WebM at a high bit rate, made in the page
  const made = await a.page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8e6 });
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(500);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = performance.now() - t0;
        for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${(i * 37 + t / 5) % 360} 80% 50%)`; g.fillRect(Math.random() * 1280, Math.random() * 720, 120, 120); }
        if (t < 6000) requestAnimationFrame(draw); else resolve();
      };
      draw();
    });
    rec.stop();
    await done;
    window.__video = new File(parts, 'clip.webm', { type: 'video/webm' });
    return window.__video.size;
  });
  expect(made).toBeGreaterThan(500000);
  await card(a.page, 'Video Phone');
  const t0 = Date.now();
  await a.page.evaluate(() => { [...peers.values()].find((p) => p.info.name === 'Video Phone').sendFiles([window.__video]); });
  const ask = b.page.locator('#dlg-request');
  await expect(ask).toBeVisible({ timeout: 60000 });
  const shrinkSeconds = (Date.now() - t0) / 1000;
  await expect(ask).toContainText('clip.mp4');
  await ask.locator('[data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 60000 });
  const info = await b.page.evaluate(async () => {
    const item = History.items[0];
    const blob = await History.blobOf(item);
    const v = document.createElement('video');
    v.src = URL.createObjectURL(blob);
    await new Promise((r) => { v.onloadedmetadata = r; });
    return { name: item.name, size: item.size, w: v.videoWidth, h: v.videoHeight, dur: v.duration };
  });
  expect(info.name).toBe('clip.mp4');
  expect(info.size).toBeLessThan(made * 0.8);
  expect(info.h).toBe(480);
  expect(info.w).toBe(854);
  expect(info.dur).toBeGreaterThan(4);
  // Faster than the video plays (the old way took the whole 6 s plus)
  expect(shrinkSeconds).toBeLessThan(6);
  expect(a.errors).toEqual([]);
});
